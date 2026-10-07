const $ = (id) => document.getElementById(id);
$('stop').onclick = () => chrome.runtime.sendMessage({ target: 'background', type: 'stop' });
chrome.runtime.onMessage.addListener((m) => {
  if (m.target !== 'panel') return;
  if (m.type === 'status') { $('status').textContent = m.text; $('status').className = ''; }
  if (m.type === 'error') { $('status').textContent = m.message; $('status').className = 'err'; }
  if (m.type === 'level') {
    $(m.ch).style.width = Math.min(100, m.rms * 400) + '%';
    $(m.ch + 'n').textContent = `(${m.frames} frames)`;
  }
  if (m.type === 'files') {
    $('files').innerHTML = Object.entries(m.files)
      .map(([ch, f]) => `<div><a href="${f.url}" download="${ch}.wav">Download ${ch}.wav</a> (${f.seconds}s)</div>`)
      .join('') || 'No audio captured.';
  }
});
