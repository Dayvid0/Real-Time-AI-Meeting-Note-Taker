/**
 * Meeting Notes AI - Side Panel UI
 *
 * Live transcript, rolling summary, final notes and meeting history.
 * Dark theme, system font, no UI framework.
 */

import { createLogger } from '../logger.js';

const log = createLogger('panel');

type Speaker = 'you' | 'others';

interface ActionItem {
  owner?: string;
  task: string;
  due?: string | null;
}

interface MeetingSummary {
  id: string;
  title: string;
  startTime: number;
  endTime: number;
}

interface PanelMessage {
  type: string;
  status?: string;
  text?: string;
  speaker?: Speaker;
  isFinal?: boolean;
  summary?: string;
  keyPoints?: string[];
  decisions?: string[];
  action_items?: ActionItem[];
  actionItems?: ActionItem[];
  title?: string;
  meetings?: MeetingSummary[];
}

interface PanelApi {
  connectPanel: (meetingId: string, title?: string) => Promise<void>;
  handlePanelMessage: (message: PanelMessage) => void;
  addTranscriptUI: (text: string, speaker: Speaker, isFinal: boolean) => void;
  renderSummaryUI: (summary: string, keyPoints?: string[]) => void;
  renderHistoryUI: (meetings: MeetingSummary[]) => void;
}

declare global {
  interface Window {
    PanelUI: PanelApi;
    initPanel: () => Promise<void>;
  }
}

// --- State ---

let meetingTitle = 'Meeting';
let isRecording = false;
let sessionId = '';
let activeSocket: WebSocket | null = null;
let timerInterval: number | null = null;

const DEFAULT_BACKEND_URL = 'ws://localhost:8000';

// --- DOM helpers ---

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing required element #${id}`);
  return node as T;
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

// --- Connection ---

function getBackendUrl(): Promise<string> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['backendUrl'], (result) => {
      const configured = result.backendUrl;
      resolve(typeof configured === 'string' && configured ? configured : DEFAULT_BACKEND_URL);
    });
  });
}

async function connectPanel(meetingId: string, title = 'Meeting'): Promise<void> {
  meetingTitle = title;
  sessionId = generateSessionId();
  el<HTMLHeadingElement>('meetingTitle').textContent = meetingTitle;

  const baseUrl = await getBackendUrl();
  const ws = new WebSocket(`${baseUrl}/ws/${encodeURIComponent(meetingId)}`);
  activeSocket = ws;

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'start_meeting', meeting_title: meetingTitle, session_id: sessionId }));
    showStatus('connected');
  };

  ws.onmessage = (event: MessageEvent<string>) => {
    try {
      handlePanelMessage(JSON.parse(event.data) as PanelMessage);
    } catch (err) {
      log.warn('Discarding malformed backend message', err);
    }
  };

  ws.onclose = () => {
    showStatus('disconnected');
    // Reconnect unless this socket was intentionally replaced.
    if (activeSocket === ws) {
      window.setTimeout(() => void connectPanel(meetingId, meetingTitle), 3000);
    }
  };

  ws.onerror = () => showStatus('error');
}

// --- Message handling ---

function handlePanelMessage(message: PanelMessage): void {
  switch (message.type) {
    case 'status_update':
      updateStatus(message.status ?? '');
      break;

    case 'transcript':
      addTranscriptUI(message.text ?? '', message.speaker ?? 'others', message.isFinal ?? true);
      break;

    case 'summary':
      if (message.summary !== undefined) {
        renderSummaryUI(message.summary, message.keyPoints);
      }
      break;

    case 'notes':
    case 'final_notes':
      showFinalNotes(message);
      break;

    case 'meeting_history':
      renderHistoryUI(message.meetings ?? []);
      break;

    default:
      log.debug('Unhandled panel message:', message.type);
  }
}

// --- Status / timer ---

function showStatus(state: string): void {
  const dot = el<HTMLDivElement>('statusDot');
  const classes: Record<string, string> = {
    connected: 'status-dot connected',
    disconnected: 'status-dot',
    error: 'status-dot error',
  };
  dot.className = classes[state] ?? 'status-dot';
  dot.title = state;
}

function updateStatus(status: string): void {
  isRecording = status === 'recording';
  const dot = el<HTMLDivElement>('statusDot');
  dot.className = isRecording ? 'status-dot connected' : 'status-dot';
  dot.title = status;

  if (isRecording) {
    startTimer();
  } else {
    stopTimer();
    el<HTMLDivElement>('liveTimer').textContent = '--:--';
  }
}

function startTimer(): void {
  stopTimer();
  const start = Date.now();
  const timerEl = el<HTMLDivElement>('liveTimer');
  timerEl.style.display = 'block';
  timerInterval = window.setInterval(() => {
    const elapsed = Date.now() - start;
    timerEl.textContent = `${pad2(Math.floor(elapsed / 60000))}:${pad2(
      Math.floor((elapsed % 60000) / 1000),
    )}`;
  }, 1000);
}

function stopTimer(): void {
  el<HTMLDivElement>('liveTimer').style.display = 'none';
  if (timerInterval !== null) {
    window.clearInterval(timerInterval);
    timerInterval = null;
  }
}

// --- Transcript ---

function buildTranscriptLine(text: string, speaker: Speaker, partial: boolean): HTMLDivElement {
  const line = document.createElement('div');
  line.className = partial ? 'transcript-line text-partial' : 'transcript-line';
  line.dataset.text = text;
  line.dataset.speaker = speaker;

  const speakerSpan = document.createElement('span');
  speakerSpan.className = `speaker-${speaker}`;
  speakerSpan.textContent = `${speaker.charAt(0).toUpperCase()}${speaker.slice(1)}: `;
  line.appendChild(speakerSpan);

  const textSpan = document.createElement('span');
  textSpan.className = partial ? `text-${speaker} text-partial` : `text-${speaker}`;
  textSpan.textContent = text;
  line.appendChild(textSpan);

  const now = new Date();
  const tsSpan = document.createElement('span');
  tsSpan.className = 'timestamp';
  tsSpan.textContent = `${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  line.appendChild(tsSpan);

  return line;
}

function addTranscriptUI(text: string, speaker: Speaker, isFinal: boolean): void {
  const area = el<HTMLDivElement>('transcriptArea');

  if (!isFinal) {
    // Partials render dimmed and update in place.
    const lines = area.querySelectorAll<HTMLElement>('.transcript-line');
    for (const line of Array.from(lines)) {
      if (line.dataset.text === text && line.dataset.speaker === speaker) {
        line.classList.add('text-partial');
        line.classList.remove('text-you', 'text-others');
        return;
      }
    }
  }

  area.insertBefore(buildTranscriptLine(text, speaker, !isFinal), area.firstChild);
  if (isFinal) area.scrollTop = 0;
}

// --- Summary / notes ---

function renderSummaryUI(summary: string, keyPoints?: string[]): void {
  const container = el<HTMLDivElement>('summaryContainer');
  const content = el<HTMLDivElement>('summaryContent');

  content.textContent = summary || 'No summary yet';
  content.classList.toggle('empty', !summary);

  const parent = content.parentElement;
  if (parent) {
    const existingList = parent.querySelector('ul');
    if (existingList) existingList.remove();

    if (keyPoints && keyPoints.length > 0) {
      const list = document.createElement('ul');
      for (const point of keyPoints) {
        const li = document.createElement('li');
        li.textContent = point;
        list.appendChild(li);
      }
      parent.appendChild(list);
    }
  }

  container.style.display = 'block';
}

function showFinalNotes(message: PanelMessage): void {
  const container = el<HTMLDivElement>('summaryContainer');

  let summaryText = 'Meeting concluded';
  let decisions: string[] = [];
  let actionItems: ActionItem[] = [];

  if (message.type === 'notes') {
    summaryText = message.summary || 'Meeting concluded';
    decisions = message.decisions ?? [];
    actionItems = message.action_items ?? [];
  } else {
    summaryText = message.title || 'Meeting concluded';
    decisions = message.keyPoints ?? [];
    actionItems = message.actionItems ?? [];
  }

  container.replaceChildren();

  const heading = document.createElement('h3');
  heading.textContent = 'Final Notes';
  container.appendChild(heading);

  const summaryPara = document.createElement('p');
  const summaryLabel = document.createElement('strong');
  summaryLabel.textContent = 'Summary: ';
  summaryPara.appendChild(summaryLabel);
  summaryPara.appendChild(document.createTextNode(summaryText));
  container.appendChild(summaryPara);

  if (decisions.length > 0) {
    const decisionsHeading = document.createElement('h4');
    decisionsHeading.textContent = 'Decisions';
    container.appendChild(decisionsHeading);

    const list = document.createElement('ul');
    for (const decision of decisions) {
      const li = document.createElement('li');
      li.textContent = decision;
      list.appendChild(li);
    }
    container.appendChild(list);
  }

  if (actionItems.length > 0) {
    const itemsHeading = document.createElement('h4');
    itemsHeading.textContent = 'Action Items';
    container.appendChild(itemsHeading);

    const table = document.createElement('table');
    for (const item of actionItems) {
      const row = document.createElement('tr');
      const owner = document.createElement('td');
      owner.textContent = item.owner || 'Unassigned';
      const task = document.createElement('td');
      task.textContent = item.task;
      const due = document.createElement('td');
      due.textContent = item.due ? new Date(item.due).toLocaleDateString() : '—';
      row.append(owner, task, due);
      table.appendChild(row);
    }
    container.appendChild(table);
  }

  container.style.display = 'block';
}

// --- History ---

function renderHistoryUI(meetings: MeetingSummary[]): void {
  const section = el<HTMLDivElement>('historySection');
  const list = el<HTMLDivElement>('historyList');
  list.replaceChildren();

  if (!meetings || meetings.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'history-item empty';
    empty.textContent = 'No meetings recorded';
    list.appendChild(empty);
    section.style.display = 'block';
    return;
  }

  for (const meeting of meetings) {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.dataset.meetingId = meeting.id;
    item.title = `${meeting.title} on ${new Date(meeting.startTime).toLocaleString()}`;

    const title =
      meeting.title.length > 30 ? `${meeting.title.slice(0, 30)}...` : meeting.title;
    item.textContent = `${title} — ${((meeting.endTime - meeting.startTime) / 60000).toFixed(1)}min`;

    item.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'restore_meeting', meetingId: meeting.id });
    });

    list.appendChild(item);
  }

  section.style.display = 'block';
}

// --- Misc ---

function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

// --- Wiring ---

document.addEventListener('DOMContentLoaded', () => {
  el<HTMLButtonElement>('endMeetingBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'end_meeting' });
  });
});

// Exposed for background.js and manual debugging.
window.PanelUI = {
  connectPanel,
  handlePanelMessage,
  addTranscriptUI,
  renderSummaryUI,
  renderHistoryUI,
};

window.initPanel = async () => {
  log.info('Panel initialized');
};
