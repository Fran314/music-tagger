import express from 'express'
import path from 'path'
import fs from 'fs/promises'
import { existsSync, readdirSync, statSync, createReadStream } from 'fs'
import { fileURLToPath } from 'url'
import * as mm from 'music-metadata'
import NodeID3 from 'node-id3'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = process.env.PORT || 8293
const INPUT_DIR_PATH = process.env.INPUT_DIR || './input'
const OUTPUT_DIR_PATH = process.env.OUTPUT_DIR || './output'

const INPUT_DIR = path.resolve(__dirname, INPUT_DIR_PATH)
const OUTPUT_DIR = path.resolve(__dirname, OUTPUT_DIR_PATH)

const ALLOWED_GENRES = new Set(['boogie woogie', 'lindy hop'])

const app = express()
app.set('view engine', 'ejs')
// Middleware to parse JSON bodies from POST requests
app.use(express.json())

/**
 * Recursively finds all music files in a directory.
 * This uses synchronous methods from 'fs' for simplicity on startup.
 */
function findMusicFiles(baseDir, currentDir = '') {
    const fullCurrentDir = path.join(baseDir, currentDir)
    let files = []

    try {
        const entries = readdirSync(fullCurrentDir, { withFileTypes: true })
        for (const entry of entries) {
            const entryRelativePath = path.join(currentDir, entry.name)
            if (entry.isDirectory()) {
                files = files.concat(findMusicFiles(baseDir, entryRelativePath))
            } else if (
                entry.isFile() &&
                path.extname(entry.name).toLowerCase() === '.mp3'
            ) {
                const stats = statSync(path.join(baseDir, entryRelativePath))
                files.push({
                    path: entryRelativePath.replace(/\\/g, '/'),
                    mtime: stats.mtime,
                })
            }
        }
    } catch (error) {
        console.error(`Error reading directory ${fullCurrentDir}:`, error)
    }

    return files
}

if (!existsSync(INPUT_DIR)) {
    console.error(`Error: Input directory not found at '${INPUT_DIR}'.`)
    process.exit(1)
}
if (!existsSync(OUTPUT_DIR)) {
    console.error(`Error: Output directory not found at '${OUTPUT_DIR}'.`)
    process.exit(1)
}

app.get('/', (req, res) => {
    const inputFiles = findMusicFiles(INPUT_DIR)
    const outputFiles = findMusicFiles(OUTPUT_DIR)
    inputFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    outputFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    res.render(path.join(__dirname, 'assets', 'index.ejs'), {
        inputFiles,
        outputFiles,
    })
})

app.get('/style.css', (req, res) => {
    res.sendFile(path.join(__dirname, 'assets', 'style.css'))
})
app.get('/icon.svg', (req, res) => {
    res.sendFile(path.join(__dirname, 'assets', 'icon.svg'))
})
app.get('/metronome.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'assets', 'metronome.js'))
})

/**
 * Sanitizes a string to be used as a valid filename.
 * @param {string} filename - The proposed filename.
 * @returns {string} A sanitized filename.
 */
function sanitizeFilename(filename) {
    // Replaces characters that are invalid in Windows/Linux/macOS filenames
    return filename.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim()
}

async function getFileMetadata(filePathParam, baseDir) {
    const fullFilePath = path.join(baseDir, filePathParam)
    if (!fullFilePath.startsWith(baseDir)) {
        return null // Security check
    }

    try {
        const metadata = await mm.parseFile(fullFilePath)
        const { common } = metadata

        let finalGenres = []
        if (common.genre) {
            // 1. Flatten the array, handling cases where an element is a comma-separated string.
            //    e.g., ["boogie woogie, lindy hop"] -> ["boogie woogie", "lindy hop"]
            const potentialGenres = common.genre.flatMap(g =>
                g.split(',').map(subG => subG.trim()),
            )

            // 2. Use a Set to store the unique, valid genres found (in their canonical lowercase form).
            const foundAllowedGenres = new Set()
            for (const pGenre of potentialGenres) {
                const pGenreLower = pGenre.toLowerCase()
                if (ALLOWED_GENRES.has(pGenreLower)) {
                    foundAllowedGenres.add(pGenreLower)
                }
            }
            finalGenres = [...foundAllowedGenres]
        }

        return {
            title: common.title || '',
            artist: common.artist || '',
            // Join the *filtered* list to be sent to the frontend.
            genre: finalGenres.join(', '),
            bpm: common.bpm || '',
            comment:
                common.comment && common.comment.length > 0
                    ? common.comment[0]
                    : '',
        }
    } catch (error) {
        console.error(`Error parsing metadata for ${fullFilePath}:`, error)
        return null
    }
}

app.get('/tags/input/*filePath', async (req, res) => {
    const filePathParam = req.params.filePath[0]
    const tags = await getFileMetadata(filePathParam, INPUT_DIR)
    if (!tags) {
        return res.status(500).json({ error: 'Failed to read metadata.' })
    }
    res.json(tags)
})

app.get('/tags/output/*filePath', async (req, res) => {
    const filePathParam = req.params.filePath[0]
    const tags = await getFileMetadata(filePathParam, OUTPUT_DIR)
    if (!tags) {
        return res.status(500).json({ error: 'Failed to read metadata.' })
    }
    res.json(tags)
})

app.post('/save', async (req, res) => {
    const { sourceDir, sourcePath, tags } = req.body

    if (!sourceDir || !sourcePath || !tags) {
        return res.status(400).json({ error: 'Missing required fields.' })
    }

    const sourceBaseDir = sourceDir === 'input' ? INPUT_DIR : OUTPUT_DIR
    const sourceFullPath = path.join(sourceBaseDir, sourcePath)

    if (!sourceFullPath.startsWith(sourceBaseDir)) {
        return res.status(403).json({ error: 'Forbidden: Invalid path.' })
    }

    const newFilename = sanitizeFilename(
        `${tags.artist || 'Unknown Artist'} - ${tags.title || 'Untitled'}.mp3`,
    )
    const destFullPath = path.join(OUTPUT_DIR, newFilename)

    try {
        const fileBuffer = await fs.readFile(sourceFullPath)
        const newTagsForWrite = {
            title: tags.title,
            artist: tags.artist,
            genre: tags.genre,
            bpm: tags.bpm,
            comment: { language: 'eng', text: tags.comment },
        }
        const success = NodeID3.write(newTagsForWrite, fileBuffer)
        if (success === false) {
            throw new Error('Failed to write ID3 tags to buffer.')
        }
        await fs.writeFile(destFullPath, success)
        if (sourceDir === 'input') {
            await fs.unlink(sourceFullPath)
        }
        res.json({
            message: 'File saved successfully.',
            newPath: path.basename(destFullPath),
        })
    } catch (error) {
        console.error('Error saving file:', error)
        res.status(500).json({ error: 'Failed to save file.' })
    }
})

/**
 * POST route to move a file from the output directory back to the input directory.
 */
app.post('/move-to-input', async (req, res) => {
    const { filePath } = req.body

    if (!filePath) {
        return res.status(400).json({ error: 'Missing file path.' })
    }

    const sourcePath = path.join(OUTPUT_DIR, filePath)
    const destPath = path.join(INPUT_DIR, path.basename(filePath))

    if (!sourcePath.startsWith(OUTPUT_DIR)) {
        return res.status(403).json({ error: 'Forbidden: Invalid path.' })
    }

    try {
        await fs.rename(sourcePath, destPath)
        res.json({ message: 'File moved back to input successfully.' })
    } catch (error) {
        console.error(`Failed to move file ${filePath} to input:`, error)
        res.status(500).json({ error: 'Failed to move file.' })
    }
})

function streamFile(filePathParam, baseDir, req, res) {
    const fullFilePath = path.join(baseDir, filePathParam)
    if (!fullFilePath.startsWith(baseDir)) {
        return res.status(403).send('Forbidden: Access is denied.')
    }
    const stat = statSync(fullFilePath, { throwIfNoEntry: false })
    if (!stat) {
        return res.status(404).send('File not found.')
    }

    const fileSize = stat.size
    const range = req.headers.range
    const contentType = 'audio/mpeg'

    if (range) {
        const parts = range.replace(/bytes=/, '').split('-')
        const start = parseInt(parts[0], 10)
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
        const chunksize = end - start + 1
        const file = createReadStream(fullFilePath, { start, end })
        const head = {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': contentType,
        }
        res.writeHead(206, head)
        file.pipe(res)
    } else {
        const head = {
            'Content-Length': fileSize,
            'Content-Type': contentType,
        }
        res.writeHead(200, head)
        createReadStream(fullFilePath).pipe(res)
    }
}

app.get('/play/input/*filePath', (req, res) => {
    const filePathParam = req.params.filePath[0]
    streamFile(filePathParam, INPUT_DIR, req, res)
})

app.get('/play/output/*filePath', (req, res) => {
    const filePathParam = req.params.filePath[0]
    streamFile(filePathParam, OUTPUT_DIR, req, res)
})

app.listen(PORT, () => {
    console.log(`Music Tagger is running at http://localhost:${PORT}`)
    console.log(`Input directory: ${INPUT_DIR}`)
    console.log(`Output directory: ${OUTPUT_DIR}`)
})
