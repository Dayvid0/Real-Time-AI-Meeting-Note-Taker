// Runs on the audio thread. Mixes to mono, converts float32 -> PCM16,
// and emits 100 ms frames (1600 samples @ 16 kHz).
class PCMCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(1600); this.n = 0; }
  process(inputs, outputs) {
    const chs = inputs[0];
    if (!chs || !chs.length) return true;
    for (let i = 0; i < chs[0].length; i++) {
      let s = 0;
      for (const c of chs) s += c[i];
      s = Math.max(-1, Math.min(1, s / chs.length));
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.buf.length) {
        const out = this.buf;
        this.port.postMessage(out, [out.buffer]);
        this.buf = new Int16Array(1600);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PCMCapture);
