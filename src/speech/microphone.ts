import { ASR_FRAME_SAMPLES, ASR_SAMPLE_RATE } from './asrProtocol.ts'
import type { AudioSource } from './local.ts'

const WORKLET_URL = '/asr-worklet.js'

/**
 * The microphone as 16 kHz mono float frames: the AudioContext resamples, and the worklet in
 * public/asr-worklet.js cuts the stream into frames of ASR_FRAME_SAMPLES (100 ms). The extension
 * passes its own copy of the worklet's address. Stopping closes the worklet's port and the context,
 * so no frame is queued anywhere once the socket is gone.
 */
export function createMicrophoneFrames(workletUrl: string = WORKLET_URL): AudioSource {
  let stream: MediaStream | null = null
  let context: AudioContext | null = null
  let node: AudioWorkletNode | null = null
  let wanted = false

  const stop = (): void => {
    wanted = false
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    if (node) {
      node.port.onmessage = null
      node.port.close()
      node.disconnect()
      node = null
    }
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
      await ctx.audioWorklet.addModule(workletUrl)
      if (!wanted) return
      const worklet = new AudioWorkletNode(ctx, 'asr-frames', { processorOptions: { frameSamples: ASR_FRAME_SAMPLES } })
      node = worklet
      worklet.port.onmessage = (event: MessageEvent<Float32Array<ArrayBuffer>>) => {
        // A frame that is not whole (never, unless the worklet changes) or arrives after stop is dropped here, not queued.
        if (wanted && event.data.length === ASR_FRAME_SAMPLES) onFrame(event.data)
      }
      ctx.createMediaStreamSource(media).connect(worklet)
      // The worklet outputs silence; connecting it keeps the graph running.
      worklet.connect(ctx.destination)
      await ctx.resume()
    },
    stop,
  }
}
