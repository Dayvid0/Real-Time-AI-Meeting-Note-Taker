import { listMeetings, loadMeeting } from './lib/db';
import { acceptConsent, dismissReminder, readConsent } from './lib/consent';
import { exportFilename, exportMarkdown } from './lib/export';
import { applyUpdate, emptySession, type SessionView, type ViewUpdate } from './lib/session-view';
import { formatTime } from './lib/transcript';

const output = document.getElementById('output')!;
const transcript = document.getElementById('transcript')!;
const warning = document.getElementById('warning')!;
const start = document.getElementById('start') as HTMLButtonElement;
const stop = document.getElementById('stop') as HTMLButtonElement;
const close = document.getElementById('close-panel') as HTMLButtonElement;
const microphoneSetup = document.getElementById('microphone-setup') as HTMLButtonElement;
let closeWhenSaved = false;
let closePending = false;
let microphonePending = false;
const followBar = document.getElementById('follow-bar')!;
const rows = new Map<string, HTMLElement>();
let state = emptySession();
let selected: SessionView | null = null;
let activeView: 'live' | 'notes' | 'history' = 'live';
let historyRequest = 0;
let historyTimer: ReturnType<typeof setTimeout> | undefined;
const titleInput = document.getElementById('meeting-title') as HTMLInputElement;
let loading = true;
let commandPending = false;
let commandError = '';
let following = true;
let lastScrollTop = 0;
const pending: ViewUpdate[] = [];

function renderConsent(): void {
  const consent = readConsent(localStorage);
  document.getElementById('consent-screen')!.hidden = consent.accepted;
  document.getElementById('privacy-reminder')!.hidden = !consent.reminderDue;
}

(document.getElementById('consent-accept') as HTMLButtonElement).onclick = () => {
  const saved = acceptConsent(localStorage);
  const error = document.getElementById('consent-error')!;
  error.hidden = saved;
  error.textContent = saved ? '' : 'Consent could not be saved. Check that browser storage is available, then try again.';
  renderConsent();
};
(document.getElementById('privacy-reminder-dismiss') as HTMLButtonElement).onclick = () => {
  if (dismissReminder(localStorage)) renderConsent();
};
renderConsent();

function setText(id: string, value: string): void { document.getElementById(id)!.textContent = value; }
function updateClock(): void {
  const elapsed = state.startedAt === null ? 0 : (state.endedAt ?? Date.now()) - state.startedAt;
  setText('elapsed', formatTime(elapsed));
}

function renderStatus(): void {
  const phase = state.phase;
  close.disabled = loading || commandPending || closePending || closeWhenSaved;
  close.textContent = closeWhenSaved ? 'Saving…' : state.active ? 'Stop & close' : '× Close';
  close.title = state.active ? 'Stop recording, save this meeting, then close' : 'Close Meeting Notes';
  microphoneSetup.hidden = state.active && state.microphone === 'available';
  microphoneSetup.disabled = loading || microphonePending || state.microphone === 'reconnecting' || closeWhenSaved || closePending || phase === 'stopping';
  microphoneSetup.textContent = microphonePending ? 'Opening…' : state.microphone === 'reconnecting' ? 'Reconnecting mic…' : 'Enable microphone';
  const labels: Record<SessionView['phase'], string> = {
    idle: 'Ready', connecting: 'Connecting', recording: 'Live', reconnecting: 'Connection lost',
    stopping: 'Finishing', stopped: state.complete ? 'Finished' : 'Stopped',
  };
  document.getElementById('status')!.dataset.state = phase;
  setText('status-label', labels[phase]);
  document.getElementById('capture-indicator')!.hidden = !state.active || ['stopping', 'stopped'].includes(phase);
  start.hidden = state.active;
  start.disabled = loading || commandPending || closeWhenSaved || closePending;
  start.textContent = state.sessionId ? 'New meeting' : 'Start meeting';
  stop.hidden = !state.active;
  stop.disabled = commandPending || ['stopping', 'stopped'].includes(phase);
  stop.textContent = ['stopping', 'stopped'].includes(phase) ? 'Finishing…' : 'Stop';
  let hint = 'Open your meeting tab, then press Start.';
  if (state.active) {
    hint = phase === 'reconnecting' ? 'Cannot reach the transcription service. Reconnecting automatically; new words and notes are paused.'
      : ['stopping', 'stopped'].includes(phase) ? 'Waiting for the last words before closing.'
      : phase === 'connecting' ? 'Connecting. Begin speaking when the status says Live.'
      : state.microphone === 'reconnecting' ? 'Reconnecting your microphone automatically. Keep this meeting open.'
      : state.microphone === 'available' ? 'You = microphone · Others = meeting tab'
      : state.microphone === 'unavailable' ? 'Tab audio only · Enable microphone to include your voice.'
      : 'Checking your microphone…';
  } else if (state.sessionId) hint = 'Start another meeting. Previous meetings stay in History.';
  titleInput.disabled = state.active;
  const storage = document.getElementById('storage-status')!;
  storage.dataset.failed = String(state.storage === 'failed');
  storage.textContent = state.storage === 'failed' ? 'Saving failed. Keep this panel open and export your transcript.' : state.sessionId ? state.storage === 'saved' ? 'Saved on this browser' : 'Saving…' : 'Meetings are saved on this browser.';
  setText('capture-hint', hint);
  const message = commandError || state.warning?.message || '';
  warning.hidden = !message;
  warning.textContent = message;
  updateClock();
}

function scrollToLatest(): void {
  output.scrollTop = output.scrollHeight;
  lastScrollTop = output.scrollTop;
}
function renderTranscript(): void {
  const display = selected ?? state;
  const wanted = new Set(display.transcript.lines.map(line => line.id));
  for (const [id, element] of rows) if (!wanted.has(id)) { element.remove(); rows.delete(id); }
  let count = 0;
  for (const line of display.transcript.lines) {
    let element = rows.get(line.id);
    if (!element) {
      element = document.createElement('li');
      if (line.type === 'gap') {
        element.className = 'gap';
        const title = document.createElement('strong'); title.textContent = 'Audio gap';
        const message = document.createElement('p'); message.className = 'gap-text';
        element.append(title, message);
      } else {
        element.className = 'line';
        const head = document.createElement('div'); head.className = 'line-head';
        const speaker = document.createElement('span'); speaker.className = 'speaker';
        const draft = document.createElement('span'); draft.className = 'draft-label';
        const time = document.createElement('time'); time.className = 'line-time';
        head.append(speaker, draft, time);
        const text = document.createElement('p'); text.className = 'line-text';
        element.append(head, text);
      }
      rows.set(line.id, element);
      transcript.append(element);
    }
    if (line.type === 'gap') {
      element.querySelector('.gap-text')!.textContent = line.message;
    } else {
      count++;
      element.dataset.speaker = line.speaker;
      element.dataset.draft = String(!line.final);
      element.querySelector('.speaker')!.textContent = line.speaker === 'local' ? 'You' : 'Others';
      element.querySelector('.draft-label')!.textContent = line.final ? '' : line.interrupted ? 'Unconfirmed' : 'Listening…';
      element.querySelector('.line-time')!.textContent = formatTime(line.startMs);
      // Transcript content is always text, never markup.
      const text = element.querySelector('.line-text')!;
      if (text.textContent !== line.text) text.textContent = line.text;
    }
  }
  document.getElementById('empty')!.hidden = display.transcript.lines.length > 0;
  setText('empty-title', display.active ? 'Listening for the conversation…' : display.sessionId ? 'No speech captured.' : 'A little less note-taking.');
  setText('empty-text', display.active ? 'Speak into your microphone or play audio in the meeting tab.' : display.sessionId ? 'Start a new meeting to try again.' : 'Start your meeting and the conversation will appear here, with your voice and others clearly labeled.');
  setText('line-count', `${count} ${count === 1 ? 'line' : 'lines'}`);
  followBar.hidden = following;
  if (following) scrollToLatest();
}
function render(): void {
  document.getElementById('saved-banner')!.hidden = selected === null;
  setText('saved-title', selected?.title || '');
  renderStatus(); renderTranscript(); renderNotes();
  finishCloseIfReady();
}
document.getElementById('return-live')!.onclick = () => {
  selected = null; rows.forEach(row => row.remove()); rows.clear(); following = true; showView('live');
};
function showView(view: 'live' | 'notes' | 'history'): void {
  activeView = view;
  for (const name of ['live', 'notes', 'history']) {
    document.getElementById(`${name}-view`)!.hidden = view !== name;
    document.getElementById(`${name}-tab`)!.setAttribute('aria-pressed', String(view === name));
  }
  if (view === 'history') void refreshHistory();
  render();
}
function renderNotes(): void {
  const display = selected ?? state;
  const notes = display.notes;
  setText('transcript-heading', selected ? selected.title : 'Live transcript');
  setText('notes-title', display.title || 'Meeting notes');
  const reasons: Record<string, string> = {
    not_configured: 'Notes are unavailable until the server has a model API key.',
    budget_exhausted: 'The meeting’s notes budget was reached. Your transcript is saved.',
    invalid_response: 'The model returned invalid notes. Your transcript is saved.',
    provider_failed: 'The notes provider is unavailable. Your transcript is saved.',
    timeout: 'Notes took too long. Your transcript is saved.',
  };
  setText('summary-label', state.notes.status === 'unavailable' ? 'Unavailable' : state.notes.rolling ? 'Updated' : 'Waiting');
  setText('rolling-summary', state.notes.rolling || (state.notes.status === 'unavailable' ? reasons[state.notes.reason] : 'A summary will appear after about a minute of conversation.') || 'Summary unavailable.');
  const statusText = notes.final ? (notes.final.partial ? 'Partial notes: review the transcript for missing context.' : 'Generated notes — review for accuracy.')
    : notes.status === 'unavailable' ? reasons[notes.reason] || 'Notes unavailable. Your transcript is saved.'
    : display.active ? 'Final notes appear after you stop the meeting.' : 'No final notes are available for this meeting.';
  setText('notes-status', statusText);
  const content = document.getElementById('notes-content')!;
  const signature = JSON.stringify(notes.final);
  if (content.dataset.signature !== signature) {
    content.dataset.signature = signature; content.replaceChildren();
    if (notes.final) {
      const summary = document.createElement('p'); summary.textContent = notes.final.summary; content.append(summary);
      for (const [heading, values] of [
        ['Decisions', notes.final.decisions],
        ['Action items', notes.final.actionItems.map(item => `${item.owner}: ${item.task}${item.due ? ` — Due: ${item.due}` : ''}`)],
      ] as [string, string[]][]) {
        const title = document.createElement('h3'); title.textContent = heading; content.append(title);
        const list = document.createElement('ul');
        for (const value of values.length ? values : ['None identified.']) {
          const item = document.createElement('li'); item.textContent = value; list.append(item);
        }
        content.append(list);
      }
    }
  }
  (document.getElementById('copy-notes') as HTMLButtonElement).disabled = !display.sessionId;
  (document.getElementById('export-notes') as HTMLButtonElement).disabled = !display.sessionId;
}
async function refreshHistory(): Promise<void> {
  const request = ++historyRequest;
  const query = (document.getElementById('history-search') as HTMLInputElement).value;
  try {
    const meetings = await listMeetings(query);
    if (request !== historyRequest) return;
    const list = document.getElementById('history-list')!; list.replaceChildren();
    for (const meeting of meetings) {
      const row = document.createElement('li'); const button = document.createElement('button');
      const title = document.createElement('strong'); title.textContent = meeting.title;
      const date = document.createElement('span'); date.textContent = new Date(meeting.startedAt ?? meeting.updatedAt).toLocaleString();
      button.append(title, date); row.append(button); list.append(row);
      button.onclick = () => { void loadMeeting(meeting.id).then(value => {
        if (!value) return;
        selected = value; rows.forEach(row => row.remove()); rows.clear(); following = true;
        showView('notes');
      }).catch(() => { setText('history-status', 'Could not open this meeting.'); }); };
    }
    setText('history-status', meetings.length ? `${meetings.length} saved ${meetings.length === 1 ? 'meeting' : 'meetings'}` : 'No saved meetings found.');
  } catch { setText('history-status', 'Could not access saved meetings.'); }
}
for (const name of ['live', 'notes', 'history'] as const) document.getElementById(`${name}-tab`)!.onclick = () => {
  if (name === 'live') { rows.forEach(row => row.remove()); rows.clear(); following = true; }
  showView(name);
};
document.getElementById('history-search')!.addEventListener('input', () => {
  clearTimeout(historyTimer); historyTimer = setTimeout(() => { void refreshHistory(); }, 200);
});
document.getElementById('copy-notes')!.onclick = () => {
  void navigator.clipboard.writeText(exportMarkdown(selected ?? state)).then(() => setText('export-status', 'Markdown copied.'))
    .catch(() => setText('export-status', 'Copy was blocked. Use Export .md instead.'));
};
document.getElementById('export-notes')!.onclick = () => {
  const display = selected ?? state;
  const url = URL.createObjectURL(new Blob([exportMarkdown(display)], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = exportFilename(display); link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000); setText('export-status', 'Markdown export started.');
};
function accept(update: ViewUpdate): void {
  if (update.revision <= state.revision) return;
  if (update.event.type === 'session-start') {
    commandError = '';
    selected = null; rows.forEach(row => row.remove()); rows.clear();
    following = true;
  }
  state = applyUpdate(state, update);
  if (update.event.type === 'notes' && !selected) showView('notes');
  if (update.event.type === 'storage' && activeView === 'history') void refreshHistory();
  render();
}

// Pause as soon as the user moves upward, including while new lines are arriving.
output.addEventListener('wheel', event => { if (event.deltaY < 0) { following = false; followBar.hidden = false; } }, { passive: true });
output.addEventListener('keydown', event => {
  if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) { following = false; followBar.hidden = false; }
});
output.addEventListener('scroll', () => {
  const atBottom = output.scrollHeight - output.clientHeight - output.scrollTop <= 12;
  if (output.scrollTop < lastScrollTop) following = false;
  else if (atBottom) following = true;
  lastScrollTop = output.scrollTop;
  followBar.hidden = following;
}, { passive: true });
document.getElementById('jump')!.onclick = () => { following = true; followBar.hidden = true; scrollToLatest(); };

start.onclick = () => {
  if (state.active || commandPending) return;
  commandPending = true; commandError = ''; selected = null; showView('live'); renderStatus();
  void (async () => {
    // The panel window determines the target. No microphone/network access lives in the panel.
    const window = await chrome.windows.getCurrent();
    const [tab] = await chrome.tabs.query({ active: true, windowId: window.id });
    if (tab?.id === undefined) throw new Error('No meeting tab');
    const reply = await chrome.runtime.sendMessage({ target: 'background', type: 'start', tabId: tab.id, title: titleInput.value.trim() || 'Untitled meeting' });
    if (!reply?.ok) commandError = reply?.message || 'Could not start. Open your meeting tab and click the toolbar icon first.';
  })().catch(() => { commandError = 'Could not start. Open your meeting tab and click the Meeting Notes toolbar icon, then try again.'; })
    .finally(() => { commandPending = false; renderStatus(); });
};
function requestStop(): void {
  if (!state.active || commandPending) return;
  commandPending = true; renderStatus();
  void chrome.runtime.sendMessage({ target: 'background', type: 'stop' }).then(reply => {
    if (!reply?.ok) { closeWhenSaved = false; commandError = reply?.message || 'Could not stop capture. Reload the extension to end it.'; }
  }).catch(() => { closeWhenSaved = false; commandError = 'Could not stop capture. Reload the extension to end it.'; })
    .finally(() => { commandPending = false; renderStatus(); finishCloseIfReady(); });
}
stop.onclick = requestStop;

function finishCloseIfReady(): void {
  if (!closeWhenSaved || state.active || commandPending || closePending) return;
  if (state.sessionId && state.storage === 'failed') {
    closeWhenSaved = false;
    commandError = 'Saving failed. Export your meeting before closing.';
    renderStatus(); return;
  }
  if (state.sessionId && state.storage !== 'saved') return;
  closeWhenSaved = false; closePending = true; renderStatus();
  void chrome.windows.getCurrent().then(win => chrome.runtime.sendMessage({ target: 'background', type: 'close-panel', windowId: win.id }))
    .then(reply => { if (!reply?.ok) commandError = reply?.message || 'Could not close the panel.'; })
    .catch(() => { commandError = 'Could not close the panel. Your saved meeting is still here.'; })
    .finally(() => { closePending = false; renderStatus(); });
}
close.onclick = () => {
  if (loading || commandPending || closePending || closeWhenSaved) return;
  closeWhenSaved = true; commandError = '';
  if (state.active) requestStop();
  renderStatus(); finishCloseIfReady();
};
microphoneSetup.onclick = () => {
  if (microphonePending) return;
  microphonePending = true; commandError = ''; renderStatus();
  void (async () => {
    const win = await chrome.windows.getCurrent();
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
    if (tab?.id === undefined) throw new Error('No meeting tab');
    const reply = await chrome.runtime.sendMessage({ target: 'background', type: 'microphone-setup', tabId: tab.id });
    if (!reply?.ok) commandError = reply?.message || 'Could not open microphone setup.';
  })().catch(() => { commandError = 'Could not open microphone setup. Return to your meeting tab and try again.'; })
    .finally(() => { microphonePending = false; renderStatus(); });
};

chrome.runtime.onMessage.addListener(message => {
  if (message.target !== 'panel' || !message.event || !Number.isInteger(message.revision)) return;
  if (loading) pending.push(message as ViewUpdate);
  else accept(message as ViewUpdate);
});
void chrome.runtime.sendMessage({ target: 'offscreen', type: 'snapshot' }).then(snapshot => {
  if (snapshot?.state) state = snapshot.state as SessionView;
}).catch(() => { /* No offscreen document exists before the first meeting. */ }).finally(() => {
  loading = false;
  pending.sort((a, b) => a.revision - b.revision).forEach(accept);
  pending.length = 0;
  render();
});
setInterval(updateClock, 1000);
