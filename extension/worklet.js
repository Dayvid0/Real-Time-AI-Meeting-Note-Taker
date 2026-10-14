/**
 * AudioWorklet processor for Meeting Notes AI.
 *
 * Converts float32 audio to PCM16 LE mono 16 kHz frames and posts fixed-size
 * frames (4096 samples ≈ 256 ms) to the offscreen document with the
 * source-tagged ArrayBuffer transferred for zero-copy hand-off.
 */

class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sourceType = 'unknown';
    this.frameSize = 4096;
    this.port.onmessage = (event) => {
      if (event.data && typeof event.data.sourceType === 'string') {
        this.sourceType = event.data.sourceType;
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0] || input[0].length === 0) {
      return true;
    }

    // Mono downmix: use the first channel.
    const channel = input[0];
    const numCompleteFrames = Math.floor(channel.length / this.frameSize);

    for (let f = 0; f < numCompleteFrames; f++) {
      const frameStart = f * this.frameSize;

      const pcm16Buffer = new ArrayBuffer(this.frameSize * 2);
      const pcm16View = new Int16Array(pcm16Buffer);

      for (let i = 0; i < this.frameSize; i++) {
        const sample = Math.max(-1, Math.min(1, channel[frameStart + i]));
        pcm16View[i] = Math.floor(sample * 32767);
      }

      this.port.postMessage(
        { source: this.sourceType, sampleRate, data: pcm16Buffer },
        [pcm16Buffer],
      );
    }

    // Any trailing samples that do not fill a complete frame are dropped.
    return true;
  }
}

registerProcessor('pcm-processor', PcmProcessor);
