// Service worker: session lifecycle only. It cannot hold an AudioContext (MV3),
// so the offscreen document does the audio work.
let capturing = false;

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Capture tab and microphone audio'
  });
}

const toPanel = (m) => chrome.runtime.sendMessage({ target: 'panel', ...m }).catch(() => {});

chrome.action.onClicked.addListener(async (tab) => {
  chrome.sidePanel.open({ tabId: tab.id }); // must run inside the click gesture
  if (capturing) return stop();
  try {
    // The stream ID expires within seconds, so fetch and use it immediately.
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    await ensureOffscreen();
    capturing = true;
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'start', streamId });
  } catch (e) {
    toPanel({ type: 'error', message: String(e.message || e) });
  }
});

function stop() {
  capturing = false;
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' });
}

chrome.runtime.onMessage.addListener((m) => {
  if (m.target !== 'background') return;
  if (m.type === 'stop') stop();
  if (m.type === 'mic-denied') chrome.tabs.create({ url: 'mic-permission.html' });
});
