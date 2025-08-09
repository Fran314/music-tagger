/**
 * A self-contained Metronome class using the Web Audio API for precise timing.
 * This class does not interact directly with the DOM.
 */
class Metronome {
    /**
     * @param {number} initialBpm The starting BPM for the metronome.
     */
    constructor(initialBpm = 120) {
        this.audioContext = null
        this.isPlaying = false
        this.bpm = initialBpm

        // Scheduling parameters
        this.lookahead = 25.0 // How often to wake up and schedule (in ms)
        this.scheduleAheadTime = 0.1 // How far ahead to schedule audio (in s)
        this.nextNoteTime = 0.0 // When the next note is due
        this.timerID = null
    }

    /**
     * The scheduling loop. It checks for upcoming notes and schedules them with the Web Audio API.
     */
    scheduler() {
        while (
            this.nextNoteTime <
            this.audioContext.currentTime + this.scheduleAheadTime
        ) {
            this.scheduleNote(this.nextNoteTime)
            const secondsPerBeat = 60.0 / this.bpm
            this.nextNoteTime += secondsPerBeat
        }
        this.timerID = setTimeout(() => this.scheduler(), this.lookahead)
    }

    /**
     * Schedules a single synthesized "tick" sound to be played at a precise time.
     * @param {number} time The absolute time (from audioContext.currentTime) to play the note.
     */
    scheduleNote(time) {
        // Create an oscillator for the sound wave
        const osc = this.audioContext.createOscillator()
        osc.frequency.setValueAtTime(1000, time) // High-pitched tick

        // Use a GainNode to shape the volume, creating a sharp "click"
        const gain = this.audioContext.createGain()
        gain.gain.setValueAtTime(1, time)
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05)

        // Connect the nodes and schedule the sound
        osc.connect(gain)
        gain.connect(this.audioContext.destination)
        osc.start(time)
        osc.stop(time + 0.05)
    }

    /**
     * Starts the metronome. Lazily initializes the AudioContext on the first run.
     */
    start() {
        if (this.isPlaying) return

        if (this.audioContext === null) {
            this.audioContext = new (window.AudioContext ||
                window.webkitAudioContext)()
        }

        this.isPlaying = true
        this.nextNoteTime = this.audioContext.currentTime + 0.05
        this.scheduler()
    }

    /**
     * Stops the metronome.
     */
    stop() {
        if (!this.isPlaying) return

        this.isPlaying = false
        clearTimeout(this.timerID)
    }

    /**
     * Updates the BPM.
     * @param {number} newBpm The new BPM value.
     */
    setBpm(newBpm) {
        this.bpm = newBpm
    }
}
