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

const ALLOWED_GENRES = ['boogie woogie', 'lindy hop']

const app = express()

app.use(express.json())
app.use(express.static(path.join(__dirname, 'assets')))

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

// API endpoint to get the list of music files
app.get('/api/files', (req, res) => {
    const inputFiles = findMusicFiles(INPUT_DIR)
    const outputFiles = findMusicFiles(OUTPUT_DIR)
    inputFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    outputFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    res.json({
        inputFiles,
        outputFiles,
    })
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

const formatGenres = genres => {
    if (!genres) return []

    const filtered = genres
        .flatMap(g => g.split(',').map(subG => subG.trim().toLowerCase()))
        .filter(g => ALLOWED_GENRES.includes(g))

    const unique = [...new Set(filtered)].sort()
    return unique
}
const readTags = async source => {
    try {
        const tags = (await mm.parseFile(source)).common
        const comment = tags.comment?.[0] || ''
        const structure = comment.split('|')[0] || ''
        const quadre = comment.split('|')[1] || ''
        return {
            title: tags.title || '',
            artist: tags.artist || '',
            genre: formatGenres(tags.genre),
            bpm: tags.bpm || '',
            structure,
            quadre,
            // comment: tags.comment?.[0] || '',
        }
    } catch (error) {
        return {
            title: '',
            artist: '',
            genre: [],
            bpm: '',
            structure: '',
            quadre: '',
        }
    }
}
const writeTags = async (tags, dest) => {
    try {
        const fileBuffer = await fs.readFile(dest)
        const success = NodeID3.write(
            {
                ...tags,
                genre: tags.genre.join(', '),
                comment: {
                    language: 'eng',
                    text: `${tags.structure}|${tags.quadre}`,
                },
            },
            fileBuffer,
        )
        if (success === false) {
            throw new Error('Failed to write ID3 tags to buffer.')
        }
        await fs.writeFile(dest, success)
    } catch (error) {
        console.error('Error saving file:', error)
    }
}

app.get('/api/tags/:dir/*filePath', async (req, res) => {
    const filePathParam = req.params.filePath[0]
    const dir = req.params.dir
    const baseDir = dir === 'input' ? INPUT_DIR : OUTPUT_DIR

    const fullFilePath = path.join(baseDir, filePathParam)
    if (!fullFilePath.startsWith(baseDir)) {
        return res.sendStatus(403)
    }
    const tags = await readTags(fullFilePath)
    res.json(tags)
})

app.post('/api/save', async (req, res) => {
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
        `${tags.artist || 'Unknown Artist'} — ${tags.title || 'Untitled'}.mp3`,
    )
    const destFullPath = path.join(OUTPUT_DIR, newFilename)

    try {
        if (sourceFullPath !== destFullPath) {
            await fs.cp(sourceFullPath, destFullPath)
        }
        const newTags = {
            title: tags.title,
            artist: tags.artist,
            genre: tags.genre,
            bpm: tags.bpm,
            structure: tags.structure,
            quadre: tags.quadre,
        }
        await writeTags(newTags, destFullPath)

        if (sourceFullPath !== destFullPath) {
            await fs.unlink(sourceFullPath)
        }
        const newFileStats = await fs.stat(destFullPath)
        res.json({
            message: 'File saved successfully.',
            newFile: {
                path: path.basename(destFullPath),
                mtime: newFileStats.mtime,
            },
        })
    } catch (error) {
        console.error('Error saving file:', error)
        res.status(500).json({ error: 'Failed to save file.' })
    }
})

/**
 * POST route to move a file from the output directory back to the input directory.
 */
app.post('/api/move-to-input', async (req, res) => {
    const { file } = req.body // Expect the full file object

    if (!file || !file.path) {
        return res.status(400).json({ error: 'Missing file path.' })
    }

    const sourcePath = path.join(OUTPUT_DIR, file.path)
    const destPath = path.join(INPUT_DIR, path.basename(file.path))

    if (!sourcePath.startsWith(OUTPUT_DIR)) {
        return res.status(403).json({ error: 'Forbidden: Invalid path.' })
    }

    try {
        await fs.cp(sourcePath, destPath)
        await fs.unlink(sourcePath)
        const newFileStats = await fs.stat(destPath)
        res.json({
            message: 'File moved back to input successfully.',
            newFile: {
                path: path.basename(destPath),
                mtime: newFileStats.mtime,
            },
        })
    } catch (error) {
        console.error(`Failed to move file ${file.path} to input:`, error)
        res.status(500).json({ error: 'Failed to move file.' })
    }
})

/**
 * DELETE route to permanently delete a file from either the input or output directory.
 */
app.delete('/api/files/:dir/*filePath', async (req, res) => {
    const { dir } = req.params
    const filePathParam = req.params.filePath[0]

    if (!filePathParam || !dir) {
        return res
            .status(400)
            .json({ error: 'Missing file path or directory.' })
    }

    const baseDir = dir === 'input' ? INPUT_DIR : OUTPUT_DIR
    const fullPath = path.join(baseDir, filePathParam)

    // Security check to prevent path traversal
    if (!fullPath.startsWith(baseDir)) {
        return res.status(403).json({ error: 'Forbidden: Invalid path.' })
    }

    try {
        await fs.unlink(fullPath)
        res.status(200).json({ message: `File ${filePathParam} deleted.` })
    } catch (error) {
        if (error.code === 'ENOENT') {
            return res.status(404).json({ error: 'File not found.' })
        }
        console.error(`Failed to delete file ${filePathParam}:`, error)
        res.status(500).json({ error: 'Failed to delete file.' })
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

app.get('/api/play/:dir/*filePath', (req, res) => {
    const filePathParam = req.params.filePath[0]
    const dir = req.params.dir
    const baseDir = dir === 'input' ? INPUT_DIR : OUTPUT_DIR
    streamFile(filePathParam, baseDir, req, res)
})

// Fallback to serve index.html for any other GET request.
app.get('/{*filePath}', (req, res) => {
    res.sendFile(path.join(__dirname, 'assets', 'index.html'))
})

const server = app.listen(PORT, () => {
    console.log(`Music Tagger is running at http://localhost:${PORT}`)
    console.log(`Input directory: ${INPUT_DIR}`)
    console.log(`Output directory: ${OUTPUT_DIR}`)
})

/**
 * Handles graceful shutdown by closing the server and exiting the process.
 */
function gracefulShutdown() {
    console.log('Received shutdown signal, shutting down gracefully.')
    server.close(() => {
        console.log('HTTP server closed.')
        // When server has finished handling all existing connections, exit.
        process.exit(0)
    })
}

// Listen for termination signals
process.on('SIGTERM', gracefulShutdown)
process.on('SIGINT', gracefulShutdown)
