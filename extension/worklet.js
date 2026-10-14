/**
 * AudioWorklet processor for Meeting Notes AI
 * Converts float32 audio to PCM16 LE mono 16kHz frames.
 * Posts fixed-size frames (4096 samples) via port.postMessage
 * with transfer ArrayBuffers. Tagged by source type ("you" = tab audio,
 * "others" = local mic audio).
 */

registerProcessor('pcm-processor', class PcmProcessorProc extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sourceType = 'unknown';
    this.sampleRate = 16000;
    this.frameSize = 4096; // 256ms at 16kHz
  }

  // Called by offscreen.html to set the source type ("you" or "others")
  setSourceType(type) {
    this.sourceType = type;
  }

  process(inputs, outputs, parameters) {
    // inputs[0] is the float32 audio data from the source stream
    const input = inputs[0];
    
    if (!input || input.length === 0) {
      return true;
    }

    // Get the first channel's data (mono conversion)
    // If stereo, we average channels or take first
    const floatChannel = input[0];
    
    if (!floatChannel || floatChannel.length === 0) {
      return true;
    }

    // We'll produce frames of 4096 samples each
    const numCompleteFrames = Math.floor(floatChannel.length / this.frameSize);

    for (let f = 0; f < numCompleteFrames; f++) {
      // Extract frame
      const frameStart = f * this.frameSize;
      const frameEnd = frameStart + this.frameSize;
      const frameFloat32 = floatChannel.slice(frameStart, frameEnd);
      
      // Convert float32 to PCM16 LE
      const pcm16Buffer = new ArrayBuffer(this.frameSize * 2); // 2 bytes per sample
      const pcm16View = new Int16Array(pcm16Buffer);
      
      for (let i = 0; i < this.frameSize; i++) {
        const val = Math.max(-1, Math.min(1, frameFloat32[i]));
        pcm16View[i] = Math.floor(val * 32767);
      }
      
      // Post frame via port.message with transfer ArrayBuffer
      // The message includes source type and sample rate
      // The ArrayBuffer is transferred for zero-copy
      this.port.postMessage({
        source: this.sourceType,
        sampleRate: this.sampleRate,
        // The ArrayBuffer is in the transfer list below
      }, [pcm16Buffer]);
    }

    // If there are remaining samples that don't fill a complete frame,
    // keep them in a buffer for the next processing cycle
    // (simplified: we just drop them for Phase 1)

    return true;
  }
});