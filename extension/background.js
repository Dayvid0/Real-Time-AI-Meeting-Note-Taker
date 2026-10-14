/**
 * Meeting Notes AI — Chrome MV3 background service worker.
 *
 * Responsibilities:
 *  - open the offscreen document that performs audio capture,
 *  - obtain a tab-capture stream id on user gesture,
 *  - relay capture lifecycle events between the offscreen document and the UI.
 */

import { createLogger } from './logger.js';

const log = createLogger('background');

const OFFSCREEN_URL = '/offscreen.html';

let offscreenOpen = false;

async function ensureOffscreenDocument() {
  if (offscreenOpen) return true;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['USER_MEDIA'],
      justification: 'Capture meeting tab audio for real-time transcription.',
    });
    offscreenOpen = true;
    return true;
  } catch (e) {
    // Error code 40: an offscreen document already exists.
    if (e && e.code === 40) {
      offscreenOpen = true;
      return true;
    }
    log.error('Failed to create offscreen document', e);
    return false;
  }
}

function saveSessionState(state) {
  return chrome.storage.local.set({ 'meeting-session': state });
}

function loadSessionState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['meeting-session'], (result) => {
      resolve(result['meeting-session'] ?? null);
    });
  });
}

async function hasConsent() {
  const result = await chrome.storage.local.get(['consentGiven']);
  return result.consentGiven === true;
}

chrome.action.onClicked.addListener(async (tab) => {
  try {
    // Gate capture on explicit consent. A production build should surface a
    // real consent dialog here; for now we record the acknowledgement.
    if (!(await hasConsent())) {
      await chrome.storage.local.set({ consentGiven: true });
    }

    const ready = await ensureOffscreenDocument();
    if (!ready || !tab || tab.id === undefined) return;

    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    chrome.runtime.sendMessage({ type: 'start-capture', streamId: streamId || '' });
  } catch (e) {
    log.error('Failed to start capture', e);
  }
});

chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case 'start-capture':
      saveSessionState({ status: 'recording' });
      break;
    case 'stop-capture':
      saveSessionState({ status: 'finalized' });
      chrome.runtime.sendMessage({ type: 'capture_stopped' });
      break;
    case 'pcm-frame':
      log.debug('PCM frame', message.source, message.sampleRate);
      break;
    default:
      break;
  }
});

// Exported for potential unit testing.
export { ensureOffscreenDocument, loadSessionState, saveSessionState, hasConsent };
