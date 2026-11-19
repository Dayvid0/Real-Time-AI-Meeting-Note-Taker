const result = document.getElementById('result')!;
const allow = document.getElementById('allow') as HTMLButtonElement;
const back = document.getElementById('back') as HTMLButtonElement;
const params = new URLSearchParams(location.search);

function explainFailure(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'Microphone access is blocked. Open the help below to allow Meeting Notes in this browser, then try again.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No microphone was found. Connect one or enable your built-in microphone in your computer’s Sound settings, then try again.';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'The microphone could not be opened. Check your computer’s Sound input settings and close other apps that may be using it, then try again.';
    default:
      return 'The microphone could not start. Check the selected input in your browser and your computer’s Sound settings, then try again.';
  }
}

async function returnToMeeting(): Promise<void> {
  const tab = params.get('returnTabId');
  const win = params.get('returnWindowId');
  try {
    if (tab && /^\d+$/.test(tab)) await chrome.tabs.update(Number(tab), { active: true });
    if (win && /^\d+$/.test(win)) await chrome.windows.update(Number(win), { focused: true });
    window.close();
  } catch {
    result.textContent = 'Your original meeting tab is no longer available. You can close this setup window and open your meeting.';
  }
}
back.onclick = () => { void returnToMeeting(); };
allow.onclick = () => {
  if (allow.disabled) return;
  allow.disabled = true;
  result.textContent = 'Choose Allow when this browser asks. Your meeting tab stays open.';
  void navigator.mediaDevices.getUserMedia({ audio: true }).then(async stream => {
    stream.getTracks().forEach(track => track.stop());
    result.textContent = 'Microphone allowed. Connecting and returning to your meeting…';
    let reply: { ok?: boolean; attached?: boolean } | undefined;
    try {
      reply = await chrome.runtime.sendMessage({ target: 'background', type: 'microphone-ready', sessionId: params.get('sessionId') });
    } catch { /* Permission remains granted even if the extension was reloaded during setup. */ }
    if (reply && !reply.ok) {
      result.textContent = 'Microphone allowed, but it could not join the recording. Check your microphone and try again, or return to your meeting.';
      return;
    }
    await returnToMeeting();
  }).catch((error: unknown) => {
    result.textContent = explainFailure(error);
  }).finally(() => { allow.disabled = false; });
};
