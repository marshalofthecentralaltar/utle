import { ASR_FRAME_SAMPLES, ASR_SAMPLE_RATE } from './asrProtocol.ts'
import type { AudioSource } from './local.ts'

const WORKLET_URL = '/asr-worklet.js'

/**
 * The microphone as 16 kHz mono float frames: the AudioContext resamples, and the worklet in
 * public/asr-worklet.js cuts the stream into frames of ASR_FRAME_SAMPLES.
 */
export function createMicrophoneFrames(): AudioSource {
  let stream: MediaStream | null = null
  let context: AudioContext | null = null
  let wanted = false

  const stop = (): void => {
    wanted = false
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    void context?.close().catch(() => {})
    context = null
  }

  return {
    async start(onFrame) {
      wanted = true
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      if (!wanted) {
        media.getTracks().forEach((track) => track.stop())
        return
      }
      stream = media
      const ctx = new AudioContext({ sampleRate: ASR_SAMPLE_RATE })
      context = ctx
      await ctx.audioWorklet.addModule(WORKLET_URL)
      if (!wanted) return
      const node = new AudioWorkletNode(ctx, 'asr-frames', { processorOptions: { frameSamples: ASR_FRAME_SAMPLES } })
      node.port.onmessage = (event: MessageEvent<Float32Array<ArrayBuffer>>) => {
        if (wanted) onFrame(event.data)
      }
      ctx.createMediaStreamSource(media).connect(node)
      // The worklet outputs silence; connecting it keeps the graph running.
      node.connect(ctx.destination)
      await ctx.resume()
    },
    stop,
  }
}
