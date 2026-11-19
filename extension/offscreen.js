// Owns the AudioContext. Two independent channels: 'tab' (others) and 'mic' (you).
let ctx, streams = [], chunks = { tab: [], mic: [] }, urls = [];
const RATE = 16000;
const toPanel = (m) => chrome.runtime.sendMessage({ target: 'panel', ...m }).catch(() => {});

chrome.runtime.onMessage.addListener((m) => {
  if (m.target !== 'offscreen') return;
  if (m.type === 'start') start(m.streamId);
  if (m.type === 'stop') stop();
});

function tap(source, ch) {
  const node = new AudioWorkletNode(ctx, 'pcm-capture');
  node.port.onmessage = (e) => {
    const pcm = e.data;
    chunks[ch].push(pcm);
    let sum = 0;
    for (let i = 0; i < pcm.length; i++) sum += (pcm[i] / 32768) ** 2;
    toPanel({ type: 'level', ch, rms: Math.sqrt(sum / pcm.length), frames: chunks[ch].length });
  };
  const sink = ctx.createGain();   // silent sink so the graph is actually pulled
  sink.gain.value = 0;
  source.connect(node).connect(sink).connect(ctx.destination);
}

async function start(streamId) {
  urls.forEach(URL.revokeObjectURL); urls = [];
  chunks = { tab: [], mic: [] };
  ctx = new AudioContext({ sampleRate: RATE });
  await ctx.audioWorklet.addModule('pcm-worklet.js');

  const tabStream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }
  });
  streams.push(tabStream);
  const tabSrc = ctx.createMediaStreamSource(tabStream);
  tabSrc.connect(ctx.destination); // capturing mutes the tab; route it back so you still hear it
  tap(tabSrc, 'tab');

  try {
    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } });
    streams.push(mic);
    tap(ctx.createMediaStreamSource(mic), 'mic');
    toPanel({ type: 'status', text: 'Recording tab + mic' });
  } catch (e) {
    toPanel({ type: 'status', text: 'Recording tab only (mic not allowed yet, grant it in the new tab, then click the icon again)' });
    chrome.runtime.sendMessage({ target: 'background', type: 'mic-denied' });
  }
}

function wav(int16s) {
  const len = int16s.reduce((a, c) => a + c.length, 0);
  const buf = new ArrayBuffer(44 + len * 2), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); w(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, len * 2, true);
  let o = 44;
  for (const c of int16s) for (let i = 0; i < c.length; i++, o += 2) v.setInt16(o, c[i], true);
  return { blob: new Blob([buf], { type: 'audio/wav' }), seconds: len / RATE };
}

async function stop() {
  streams.forEach((s) => s.getTracks().forEach((t) => t.stop())); streams = [];
  if (ctx) await ctx.close(); ctx = null;
  const files = {};
  for (const ch of ['tab', 'mic']) {
    if (!chunks[ch].length) continue;
    const { blob, seconds } = wav(chunks[ch]);
    const url = URL.createObjectURL(blob); urls.push(url);
    files[ch] = { url, seconds: seconds.toFixed(1) };
  }
  toPanel({ type: 'files', files });
  toPanel({ type: 'status', text: 'Stopped' });
}
