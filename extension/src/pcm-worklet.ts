import { mono, writeStereo } from './lib/pcm';
import { FRAME_SAMPLES, MAX_FRAME_BYTES } from './lib/protocol';

declare class AudioWorkletProcessor { readonly port: MessagePort; }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class StereoCapture extends AudioWorkletProcessor {
  private frame = new ArrayBuffer(MAX_FRAME_BYTES);
  private view = new DataView(this.frame);
  private count = 0;
  private stopped = false;
  constructor() {
    super();
    this.port.onmessage = event => {
      if (event.data?.type !== 'flush') return;
      this.stopped = true;
      if (this.count) this.emit();
      this.port.postMessage({ type: 'flushed' });
    };
  }
  private emit(): void {
    const frame = this.count === FRAME_SAMPLES ? this.frame : this.frame.slice(0, this.count * 4);
    this.port.postMessage(frame, [frame]);
    this.frame = new ArrayBuffer(MAX_FRAME_BYTES);
    this.view = new DataView(this.frame);
    this.count = 0;
  }
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.stopped) return false;
    const local = inputs[0] ?? [], remote = inputs[1] ?? [];
    const length = outputs[0]?.[0]?.length ?? 128;
    for (let i = 0; i < length; i++) {
      writeStereo(this.view, this.count++, mono(local, i), mono(remote, i));
      if (this.count === FRAME_SAMPLES) this.emit();
    }
    return true;
  }
}
registerProcessor('stereo-capture', StereoCapture);
