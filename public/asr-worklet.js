// Cuts the microphone into fixed frames for the local recogniser (ARCHITECTURE 20.1).
// Runs on the audio thread; the AudioContext already resamples to 16 kHz.
class AsrFrames extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.size = (options.processorOptions && options.processorOptions.frameSamples) || 1600
    this.frame = new Float32Array(this.size)
    this.filled = 0
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (!channel) return true
    let read = 0
    while (read < channel.length) {
      const take = Math.min(channel.length - read, this.size - this.filled)
      this.frame.set(channel.subarray(read, read + take), this.filled)
      this.filled += take
      read += take
      if (this.filled === this.size) {
        this.port.postMessage(this.frame, [this.frame.buffer])
        this.frame = new Float32Array(this.size)
        this.filled = 0
      }
    }
    return true
  }
}

registerProcessor('asr-frames', AsrFrames)
