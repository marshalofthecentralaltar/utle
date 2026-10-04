/** How loud the microphone is right now, so the interface can show that it is hearing. */
export interface LevelMeter {
  start(): Promise<void>
  stop(): void
}

const INTERVAL_MS = 66

/**
 * Reports the microphone level from 0 to 1 about fifteen times a second.
 * Fails quietly: with no microphone or no permission the level simply stays at 0.
 */
export function createLevelMeter(onLevel: (level: number) => void): LevelMeter {
  let stream: MediaStream | null = null
  let context: AudioContext | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let wanted = false

  const stop = (): void => {
    wanted = false
    if (timer !== null) clearInterval(timer)
    timer = null
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    void context?.close().catch(() => {})
    context = null
    onLevel(0)
  }

  return {
    async start() {
      if (wanted) return
      wanted = true
      try {
        const media = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (!wanted) {
          media.getTracks().forEach((track) => track.stop())
          return
        }
        stream = media
        context = new AudioContext()
        const analyser = context.createAnalyser()
        analyser.fftSize = 512
        context.createMediaStreamSource(media).connect(analyser)
        const samples = new Uint8Array(analyser.fftSize)
        timer = setInterval(() => {
          analyser.getByteTimeDomainData(samples)
          let sum = 0
          for (const sample of samples) {
            const centred = (sample - 128) / 128
            sum += centred * centred
          }
          onLevel(Math.min(1, Math.sqrt(sum / samples.length) * 5))
        }, INTERVAL_MS)
      } catch {
        stop()
      }
    },
    stop,
  }
}
