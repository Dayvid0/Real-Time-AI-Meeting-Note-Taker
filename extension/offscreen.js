/**
 * Offscreen document coordination for audio capture.
 * Chrome MV3 offscreen document is created from the background service worker,
 * not from a standalone module. This file exports the rationale/configuration
 * that would be used when creating the offscreen document.
 */
// The offscreen document is created via:
// chrome.offscreen.createDocument({ name, url, reason, justification })
// in the background service worker's onInstalled handler.
// Audio capture in the offscreen document uses:
// - chrome.tabCapture.getTab({ audio: true, video: false }) for tab audio
// - navigator.mediaDevices.getUserMedia({ audio: {...} }) for microphone
// - AudioContext + AudioWorklet for PCM16 LE mono 16kHz output
// - postMessage to background WebSocket for relay
export const OFFSCREEN_CONFIG = {
    name: 'meeting-notes-audio-capture',
    url: '/offscreen.html',
    reason: 'Captures tab audio and microphone for meeting transcription',
    justification: 'Real-time meeting transcription requires audio capture from browser tab and microphone',
};
