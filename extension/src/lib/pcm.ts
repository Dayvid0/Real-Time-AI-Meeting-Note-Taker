export function pcm16(value: number): number {
  const clipped = Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
  return Math.trunc(clipped < 0 ? clipped * 32768 : clipped * 32767);
}

export function mono(channels: Float32Array[], index: number): number {
  if (!channels.length) return 0;
  let total = 0;
  for (const channel of channels) total += channel[index] ?? 0;
  return total / channels.length;
}

// Explicit little-endian writes, with local in channel 0 and remote in channel 1.
export function writeStereo(view: DataView, sample: number, local: number, remote: number): void {
  view.setInt16(sample * 4, pcm16(local), true);
  view.setInt16(sample * 4 + 2, pcm16(remote), true);
}
