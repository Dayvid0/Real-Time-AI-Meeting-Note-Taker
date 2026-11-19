// Offscreen documents can't show permission prompts, so we ask once from a normal tab.
navigator.mediaDevices.getUserMedia({ audio: true })
  .then((s) => { s.getTracks().forEach((t) => t.stop()); document.getElementById('m').textContent = 'Mic allowed. Close this tab and click the extension icon again.'; })
  .catch((e) => { document.getElementById('m').textContent = 'Mic blocked: ' + e.name; });
