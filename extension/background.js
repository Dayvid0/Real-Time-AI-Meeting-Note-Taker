/**
 * Meeting Notes AI — Chrome MV3 Extension
 * Phase 1: Audio capture foundation
 * Phase 3: Panel wire-up (minimal)
 */

// Ensure offscreen document
const OFFSCREEN_NAME = 'meeting-notes-audio-capture';
const OFFSCREEN_URL = '/offscreen.html';

let offscreenOpen = false;

async function ensureOffscreenDocument() {
  if (offscreenOpen) return true;
  try {
    await chrome.offscreen.createDocument({
      name: OFFSCREEN_NAME,
      url: OFFSCREEN_URL,
      reason: 'Audio capture for meeting transcription',
    });
    offscreenOpen = true;
    return true;
  } catch (e) {
    if (e.code === 40) { offscreenOpen = true; return true; }
    return false;
  }
}

// Session state in storage
function saveSessionState(state) {
  chrome.storage.local.set({ 'meeting-session': state });
}

function loadSessionState() {
  return new Promise(r => {
    chrome.storage.local.get(['meeting-session'], r => {
      r.result['meeting-session'] ? r.resolve(r.result['meeting-session']) : r.resolve(null);
    });
  });
}

// Capture state
let isCapturing = false;
let currentStreamId = '';

chrome.action.onClicked.addListener(async (tab) => {
  try {
    const ready = await ensureOffscreenDocument();
    if (ready) {
      const streams = await chrome.tabCapture.getMediaStreamId({ audio: true, video: false });
      currentStreamId = streams.id || '';
      chrome.runtime.sendMessage({ type: 'start-capture', streamId: currentStreamId });
    }
  } catch (e) { console.error(e); }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'start-capture') {
    isCapturing = true;
    currentStreamId = message.streamId;
    saveSessionState({ status: 'recording' });
  }
  if (message.type === 'stop-capture') {
    isCapturing = false;
    saveSessionState({ status: 'finalized' });
    chrome.runtime.sendMessage({ type: 'capture_stopped' });
  }
  if (message.type === 'pcm-frame') {
    console.log('[PCM Frame]', message.source, message.sampleRate, message.data?.byteLength);
  }
  // Phase 3: route panel messages
  if (message.type && (message.type === 'status_update' || message.type === 'transcript' || message.type === 'summary' || message.type === 'final_notes' || message.type === 'meeting_history')) {
    try { chrome.runtime.sendMessage(message); } catch (e) {}
  }
  return true;
});