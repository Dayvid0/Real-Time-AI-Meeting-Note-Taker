let busy = false;
let microphoneWindowId: number | undefined;
let openingMicrophone: Promise<Reply> | null = null;
type Reply = { ok: boolean; message?: string };

async function start(tabId: number, title?: string): Promise<Reply> {
  if (busy) return { ok: false, message: 'A capture is already starting. Please wait.' };
  busy = true;
  try {
    if (!await chrome.offscreen.hasDocument()) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html', reasons: [chrome.offscreen.Reason.USER_MEDIA],
        justification: 'Capture and transcribe meeting tab and microphone audio',
      });
    }
    const state = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'state' });
    if (state?.active) return { ok: true };
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    const response = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'start', streamId, title, tabId });
    return response?.ok ? { ok: true } : { ok: false, message: 'The previous capture is still finishing. Please wait.' };
  } catch {
    return { ok: false, message: 'Open your meeting tab and click the Meeting Notes toolbar icon, then press Start. Browser settings pages cannot be captured.' };
  } finally { busy = false; }
}

async function microphoneSetup(tabId: number): Promise<Reply> {
  if (openingMicrophone) return openingMicrophone;
  openingMicrophone = (async () => {
    if (microphoneWindowId !== undefined) {
      try { await chrome.windows.update(microphoneWindowId, { focused: true }); return { ok: true }; }
      catch { microphoneWindowId = undefined; }
    }
    const state = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'state' }).catch(() => null);
    const targetId = state?.active && Number.isInteger(state.tabId) ? state.tabId : tabId;
    const tab = await chrome.tabs.get(targetId);
    const url = new URL(chrome.runtime.getURL('mic-permission.html'));
    url.searchParams.set('returnTabId', String(targetId));
    url.searchParams.set('returnWindowId', String(tab.windowId));
    if (state?.active && typeof state.sessionId === 'string') url.searchParams.set('sessionId', state.sessionId);
    const created = await chrome.windows.create({ url: url.href, type: 'popup', width: 480, height: 560, focused: true });
    microphoneWindowId = created?.id;
    return { ok: true };
  })().catch(() => ({ ok: false, message: 'Could not open microphone setup. Return to your meeting tab and try again.' }))
    .finally(() => { openingMicrophone = null; });
  return openingMicrophone;
}

async function closePanel(windowId: number): Promise<Reply> {
  try {
    const panel = chrome.sidePanel as typeof chrome.sidePanel & { close?: (options: { windowId: number }) => Promise<void> };
    if (panel.close) await panel.close({ windowId });
    else {
      // Older Chromium releases close the panel when disabled. Restore availability for the next toolbar click.
      await panel.setOptions({ enabled: false });
      await panel.setOptions({ enabled: true });
    }
    return { ok: true };
  } catch { return { ok: false, message: 'Could not close the panel. Your meeting is still saved here.' }; }
}

chrome.action.onClicked.addListener(tab => {
  if (tab.id === undefined) return;
  // The toolbar grants activeTab; opening the panel never toggles recording.
  void chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
});
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.target !== 'background') return;
  if (message.type === 'start' && Number.isInteger(message.tabId) && message.tabId >= 0) {
    void start(message.tabId, typeof message.title === 'string' ? message.title.slice(0, 200) : undefined).then(respond);
    return true;
  }
  if (message.type === 'stop') {
    void chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' })
      .then(() => respond({ ok: true })).catch(() => respond({ ok: false, message: 'No active capture was found.' }));
    return true;
  }
  if (message.type === 'microphone-setup' && Number.isInteger(message.tabId) && message.tabId >= 0) {
    void microphoneSetup(message.tabId).then(respond);
    return true;
  }
  if (message.type === 'microphone-ready') {
    void chrome.runtime.sendMessage({ target: 'offscreen', type: 'enable-microphone', sessionId: message.sessionId })
      .then(respond).catch(() => respond({ ok: true, attached: false }));
    return true;
  }
  if (message.type === 'close-panel' && Number.isInteger(message.windowId) && message.windowId >= 0) {
    void closePanel(message.windowId).then(respond);
    return true;
  }
});
