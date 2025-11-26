const { createApp, ref, reactive, computed, onMounted } = Vue

const app = createApp({
    setup() {
        // State
        const inputFiles = ref([])
        const outputFiles = ref([])
        const searchTerm = ref('')
        const currentTrack = ref(null)
        const currentTrackDir = ref(null)
        const nowPlayingText = ref('Select a track to play')
        const isLoading = ref(false)
        const isSaving = ref(false)
        const trackErrors = ref([])
        const topContainerClass = ref('')

        const tags = reactive({
            title: '',
            artist: '',
            bpm: '',
            // comment: '',
            structure: '',
            quadre: '',
            genres: [],
        })

        // BPM Tapper state
        const tapTimestamps = ref([])
        const TAP_RESET_THRESHOLD_MS = 2000
        const MAX_TAPS_TO_AVERAGE = 128

        // Template Refs
        const audioPlayer = ref(null)
        const searchInput = ref(null)

        // Computed Properties
        const isFormDisabled = computed(
            () => !currentTrack.value || isLoading.value,
        )
        const isSaveDisabled = computed(
            () => !currentTrack.value || isLoading.value || isSaving.value,
        )
        const formPlaceholder = computed(() => {
            if (isLoading.value) return 'Loading...'
            if (!currentTrack.value) return '-'
            return ''
        })

        const filterFiles = files => {
            if (!searchTerm.value) {
                return files
            }
            const lowerCaseSearch = searchTerm.value.toLowerCase()
            return files.filter(file =>
                file.path.toLowerCase().includes(lowerCaseSearch),
            )
        }

        const filteredInputFiles = computed(() => filterFiles(inputFiles.value))
        const filteredOutputFiles = computed(() =>
            filterFiles(outputFiles.value),
        )

        // Methods
        const fetchFiles = async () => {
            try {
                const response = await fetch('/api/files')
                if (!response.ok) throw new Error('Failed to fetch file lists.')
                const data = await response.json()
                inputFiles.value = data.inputFiles || []
                outputFiles.value = data.outputFiles || []
            } catch (error) {
                console.error('Error fetching files:', error)
                nowPlayingText.value = 'Error loading files.'
            }
        }

        const clearTagInputs = () => {
            tags.title = ''
            tags.artist = ''
            tags.bpm = ''
            // tags.comment = ''
            tags.structure = ''
            tags.quadre = ''
            tags.genres = []
            tapTimestamps.value = []
        }

        const fetchTags = async () => {
            if (!currentTrack.value) return
            isLoading.value = true
            clearTagInputs()
            try {
                const response = await fetch(
                    `/api/tags/${currentTrackDir.value}/${encodeURIComponent(currentTrack.value.path)}`,
                )
                if (!response.ok) throw new Error('Failed to fetch tags.')
                const loadedTags = await response.json()

                tags.title = loadedTags.title || ''
                tags.artist = loadedTags.artist || ''
                tags.bpm = loadedTags.bpm || ''
                // tags.comment = loadedTags.comment || ''
                // TODO maybe force to cast to one of the possible structures
                tags.structure = loadedTags.structure || ''
                tags.quadre = loadedTags.quadre || ''
                tags.genres = loadedTags.genre
            } catch (error) {
                console.error('Error fetching tags:', error)
                nowPlayingText.value = `Error loading tags for ${currentTrack.value.path}`
                clearTagInputs()
            } finally {
                isLoading.value = false
            }
        }

        const selectTrack = (track, dir) => {
            if (currentTrack.value?.path === track.path) return

            currentTrack.value = track
            currentTrackDir.value = dir
            nowPlayingText.value = `Now Playing: ${track.path}`
            trackErrors.value = trackErrors.value.filter(p => p !== track.path)

            if (audioPlayer.value) {
                audioPlayer.value.src = `/api/play/${dir}/${encodeURIComponent(track.path)}`
                audioPlayer.value.play()
            }

            fetchTags()
        }

        const saveTags = async () => {
            if (isSaveDisabled.value) return
            isSaving.value = true

            const payload = {
                sourceDir: currentTrackDir.value,
                sourcePath: currentTrack.value.path,
                tags: {
                    title: tags.title,
                    artist: tags.artist,
                    bpm: tags.bpm,
                    // comment: tags.comment,
                    structure: tags.structure,
                    quadre: tags.quadre,
                    genre: tags.genres,
                },
            }

            try {
                const response = await fetch('/api/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                })
                if (!response.ok) {
                    const errData = await response.json()
                    throw new Error(errData.error || 'Server error')
                }
                const result = await response.json()

                // Remove from the source list
                if (currentTrackDir.value === 'input') {
                    inputFiles.value = inputFiles.value.filter(
                        f => f.path !== currentTrack.value.path,
                    )
                } else {
                    outputFiles.value = outputFiles.value.filter(
                        f => f.path !== currentTrack.value.path,
                    )
                }

                // Add to the output list and sort
                outputFiles.value.push(result.newFile)
                outputFiles.value.sort(
                    (a, b) => new Date(b.mtime) - new Date(a.mtime),
                )

                // Reset state
                nowPlayingText.value =
                    'Saved successfully. Select a track to play.'
                currentTrack.value = null
                currentTrackDir.value = null
                clearTagInputs()
                if (audioPlayer.value) {
                    audioPlayer.value.pause()
                    audioPlayer.value.removeAttribute('src')
                    audioPlayer.value.load()
                }
            } catch (error) {
                console.error('Failed to save:', error)
                alert(`Error saving file: ${error.message}`)
            } finally {
                isSaving.value = false
            }
        }

        const moveToInput = async file => {
            try {
                const response = await fetch('/api/move-to-input', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ file }),
                })
                if (!response.ok) {
                    const errData = await response.json()
                    throw new Error(errData.error || 'Server error')
                }
                const result = await response.json()

                // Remove from output list
                outputFiles.value = outputFiles.value.filter(
                    f => f.path !== file.path,
                )
                // Add to input list and sort
                inputFiles.value.push(result.newFile)
                inputFiles.value.sort(
                    (a, b) => new Date(b.mtime) - new Date(a.mtime),
                )

                // If the moved track was the current one, reset the form.
                if (currentTrack.value?.path === file.path) {
                    currentTrack.value = null
                    currentTrackDir.value = null
                    clearTagInputs()
                }
            } catch (error) {
                console.error('Failed to move file to input:', error)
                alert(`Error moving file: ${error.message}`)
            }
        }

        const deleteFile = async (file, dir) => {
            // Ask for confirmation before deleting
            if (
                !confirm(
                    `Are you sure you want to permanently delete "${file.path}"?`,
                )
            ) {
                return
            }

            try {
                const response = await fetch(
                    `/api/files/${dir}/${encodeURIComponent(file.path)}`,
                    {
                        method: 'DELETE',
                    },
                )

                if (!response.ok) {
                    const errData = await response.json()
                    throw new Error(errData.error || 'Server error')
                }

                // Remove from the correct list
                if (dir === 'input') {
                    inputFiles.value = inputFiles.value.filter(
                        f => f.path !== file.path,
                    )
                } else {
                    outputFiles.value = outputFiles.value.filter(
                        f => f.path !== file.path,
                    )
                }

                // If the deleted track was the current one, reset the player and form.
                if (currentTrack.value?.path === file.path) {
                    nowPlayingText.value = 'Select a track to play.'
                    currentTrack.value = null
                    currentTrackDir.value = null
                    clearTagInputs()
                    if (audioPlayer.value) {
                        audioPlayer.value.pause()
                        audioPlayer.value.removeAttribute('src')
                        audioPlayer.value.load()
                    }
                }
            } catch (error) {
                console.error('Failed to delete file:', error)
                alert(`Error deleting file: ${error.message}`)
            }
        }

        const toggleGenre = genre => {
            if (isFormDisabled.value) return
            const index = tags.genres.indexOf(genre)
            if (index > -1) {
                tags.genres.splice(index, 1)
            } else {
                tags.genres.push(genre)
            }
        }

        const handleBpmTap = () => {
            const now = Date.now()
            if (
                tapTimestamps.value.length > 0 &&
                now - tapTimestamps.value[tapTimestamps.value.length - 1] >
                    TAP_RESET_THRESHOLD_MS
            ) {
                tapTimestamps.value = []
            }
            tapTimestamps.value.push(now)
            if (tapTimestamps.value.length > MAX_TAPS_TO_AVERAGE) {
                tapTimestamps.value.shift()
            }
            if (tapTimestamps.value.length > 1) {
                const len = tapTimestamps.value.length
                const calculatedBpm =
                    (tapTimestamps.value[len - 1] - tapTimestamps.value[0]) /
                    (len - 1)
                if (calculatedBpm > 0) {
                    tags.bpm = Math.round(60000 / calculatedBpm)
                }
            }
        }

        const handleAudioError = () => {
            console.error('Error playing audio.')
            if (currentTrack.value) {
                nowPlayingText.value = `Error: Could not play ${currentTrack.value.path}`
                trackErrors.value.push(currentTrack.value.path)
            }
        }

        const triggerNoTrackFeedback = () => {
            topContainerClass.value = 'no-track-feedback'
            setTimeout(() => {
                topContainerClass.value = ''
            }, 600) // Must match the animation duration in CSS
        }

        const handleKeydown = event => {
            if (event.target.tagName.toLowerCase() === 'input') {
                return
            }
            if (event.key === '/' || (event.code === 'KeyF' && event.ctrlKey)) {
                event.preventDefault()
                searchInput.value.focus()
                searchInput.value.select()
                return
            }

            // Handle next/previous track navigation
            if (
                event.shiftKey &&
                (event.code === 'ArrowRight' || event.code === 'ArrowLeft')
            ) {
                event.preventDefault()
                if (!currentTrack.value) {
                    triggerNoTrackFeedback()
                    return
                }

                const visibleTracks =
                    currentTrackDir.value === 'input'
                        ? filteredInputFiles.value
                        : filteredOutputFiles.value
                const currentIndex = visibleTracks.findIndex(
                    track => track.path === currentTrack.value.path,
                )
                if (currentIndex === -1) return

                const nextIndex =
                    event.code === 'ArrowRight'
                        ? currentIndex + 1
                        : currentIndex - 1
                if (nextIndex >= 0 && nextIndex < visibleTracks.length) {
                    selectTrack(visibleTracks[nextIndex], currentTrackDir.value)
                }
                return
            }

            const player = audioPlayer.value
            if (!player) return

            // For all other media keys, require a loaded track.
            if (!currentTrack.value || !player.currentSrc) {
                // Only trigger the visual shake for explicit play/seek attempts.
                if (['Space', 'ArrowRight', 'ArrowLeft'].includes(event.code)) {
                    triggerNoTrackFeedback()
                }
                // Prevent action regardless.
                return
            }

            switch (event.code) {
                case 'Space':
                    event.preventDefault()
                    if (player.paused) player.play()
                    else player.pause()
                    break
                case 'ArrowRight':
                    event.preventDefault()
                    player.currentTime += 5
                    break
                case 'ArrowLeft':
                    event.preventDefault()
                    player.currentTime -= 5
                    break
                case 'ArrowUp':
                    event.preventDefault()
                    player.volume = Math.min(1, player.volume + 0.05)
                    break
                case 'ArrowDown':
                    event.preventDefault()
                    player.volume = Math.max(0, player.volume - 0.05)
                    break
                case 'KeyM':
                    event.preventDefault()
                    player.muted = !player.muted
                    break
            }
        }

        // Lifecycle Hooks
        onMounted(() => {
            fetchFiles()
            window.addEventListener('keydown', handleKeydown)
        })

        // Return everything needed in the template
        return {
            inputFiles,
            outputFiles,
            searchTerm,
            currentTrack,
            nowPlayingText,
            isLoading,
            isSaving,
            tags,
            trackErrors,
            topContainerClass,
            audioPlayer,
            searchInput,
            isFormDisabled,
            isSaveDisabled,
            formPlaceholder,
            filteredInputFiles,
            filteredOutputFiles,
            selectTrack,
            saveTags,
            moveToInput,
            deleteFile,
            toggleGenre,
            handleBpmTap,
            handleAudioError,
        }
    },
})

app.mount('#app')
