/**
 * Meeting Notes AI - Side Panel UI
 * Panel.html + Panel.ts - Live transcript, rolling summary, final notes, meeting history
 * Dark theme, system font, no UI framework
 */

// Panel UI elements reference
const panel = document.getElementById('panel');
const transcriptArea = document.getElementById('transcriptArea');
const liveTimer = document.getElementById('liveTimer');
const statusDot = document.getElementById('statusDot');
const meetingTitleEl = document.getElementById('meetingTitle');
const endMeetingBtn = document.getElementById('endMeetingBtn');

// Initialize panel state
let meetingTitle = 'Meeting';
let isRecording = false;
let sessionId = '';

// Connect to backend WebSocket with token
async function connectPanel(token, title = 'Meeting') {
  meetingTitle = title;
  sessionId = generateSessionId();

  // Set meeting title in UI
  meetingTitleEl.textContent = meetingTitle;

  // Connect WS client
  const WS_URL = 'wss://' + location.host + '/ws/' + token;
  const ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    // Send start message
    ws.send(JSON.stringify({ type: 'start', meeting_title: meetingTitle }));
    showStatus('connected');
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    handlePanelMessage(message);
  };

  ws.onclose = () => {
    showStatus('disconnected');
    // Attempt reconnect
    setTimeout(() => connectPanel(token, meetingTitle), 3000);
  };

  ws.onerror = () => {
    showStatus('error');
  };
}

// Handle incoming messages from backend
function handlePanelMessage(message) {
  switch (message.type) {
    case 'status_update':
      updateStatus(message.status);
      break;

    case 'transcript':
      addTranscriptUI(message.text, message.speaker, message.isFinal);
      break;

    case 'summary':
      // Backend sends {"type": "summary", "kind": "rolling", ...} for rolling summaries
      // or {"type": "summary"} for rolling without kind flag
      if (message && message.summary !== undefined) {
        renderSummaryUI(message.summary, message.keyPoints);
      }
      break;

    case 'notes':
      // Phase 4: Final notes from backend with JSON schema
      showFinalNotes(message);
      break;

    case 'final_notes':
      // Backward compatibility: show final notes from legacy message type
      showFinalNotes(message);
      break;

    case 'meeting_history':
      renderHistoryUI(message.meetings);
      break;

    default:
      console.log('Unhandled panel message:', message.type);
  }
}

// Update recording status UI
function updateStatus(status) {
  isRecording = status === 'recording';
  statusDot.className = status === 'recording' ? 'status connected' : 'status';
  statusDot.title = status;

  if (status === 'recording') {
    startTimer();
  } else {
    stopTimer();
    document.getElementById('liveTimer').textContent = '--:--';
  }
}

// Start live timer
function startTimer() {
  const start = new Date().getTime();
  document.getElementById('liveTimer').style.display = 'block';
  window.setInterval(() => {
    const elapsed = new Date().getTime() - start;
    const mins = Math.floor(elapsed / 60000);
    const secs = Math.floor((elapsed % 60000) / 1000);
    document.getElementById('liveTimer').textContent =
      `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, 1000);
}

// Stop timer
function stopTimer() {
  document.getElementById('liveTimer').style.display = 'none';
  clearInterval(document._timerInterval);
}

// Add transcript line to UI
function addTranscriptUI(text, speaker, isFinal) {
  const area = transcriptArea;

  // Only render FINAL segments; partials render dimmed updating in place
  if (!isFinal) {
    // Render partial dimmed, updating in place
    let found = false;
    const lines = area.querySelectorAll('.transcript-line');
    lines.forEach(line => {
      if (line.dataset.text === text && line.dataset.speaker === speaker) {
        // Update existing partial
        line.classList.add('text-partial');
        line.classList.remove('text-you', 'text-others');
        found = true;
      }
    });
    if (!found) {
      const line = document.createElement('div');
      line.className = 'transcript-line text-partial';
      line.dataset.text = text;
      line.dataset.speaker = speaker;
      const speakerSpan = document.createElement('span');
      speakerSpan.className = 'speaker-' + speaker;
      speakerSpan.textContent =
        speaker.charAt(0).toUpperCase() + speaker.slice(1) + ': ';
      line.appendChild(speakerSpan);
      const textSpan = document.createElement('span');
      textSpan.className = 'text-' + speaker + ' text-partial';
      textSpan.textContent = text;
      line.appendChild(textSpan);
      const ts = new Date();
      const tsSpan = document.createElement('span');
      tsSpan.className = 'timestamp';
      tsSpan.textContent =
        `${ts.getMinutes().toString().padStart(2, '0')}:${ts.getSeconds().toString().padStart(2, '0')}`;
      line.appendChild(tsSpan);
      area.insertBefore(line, area.firstChild);
    }
    return;
  }

  // Final segment
  const line = document.createElement('div');
  line.className = 'transcript-line';
  line.dataset.text = text;
  line.dataset.speaker = speaker;

  const speakerSpan = document.createElement('span');
  speakerSpan.className = 'speaker-' + speaker;
  speakerSpan.textContent =
    speaker.charAt(0).toUpperCase() + speaker.slice(1) + ': ';
  line.appendChild(speakerSpan);

  const textSpan = document.createElement('span');
  textSpan.className = 'text-' + speaker;
  textSpan.textContent = text;
  line.appendChild(textSpan);

  const ts = new Date();
  const tsSpan = document.createElement('span');
  tsSpan.className = 'timestamp';
  tsSpan.textContent =
    `${ts.getMinutes().toString().padStart(2, '0')}:${ts.getSeconds().toString().padStart(2, '0')}`;
  line.appendChild(tsSpan);

  area.insertBefore(line, area.firstChild);

  // Auto-scroll
  area.scrollTop = 0;
}

// Render rolling summary UI
function renderSummaryUI(summary, keyPoints) {
  const summaryContainer = document.getElementById('summaryContainer');
  const summaryContent = document.getElementById('summaryContent');
  const summaryToggle = document.getElementById('summaryToggle');
  const collapseBtn = document.getElementById('collapseBtn');

  if (summary) {
    summaryContent.textContent = summary;
    summaryContent.classList.remove('empty');
  } else {
    summaryContent.textContent = 'No summary yet';
    summaryContent.classList.add('empty');
  }

  // If keyPoints are provided, append them
  if (keyPoints && keyPoints.length > 0) {
    const kpList = document.createElement('ul');
    keyPoints.forEach(point => {
      const li = document.createElement('li');
      li.textContent = point;
      kpList.appendChild(li);
    });
    // Insert after summary text
    const existingKp = summaryContent.parentNode.querySelector('ul');
    if (existingKp) existingKp.remove();
    summaryContent.parentNode.appendChild(kpList);
  }

  summaryContainer.style.display = 'block';
}

// Show final notes view — handles both old 'final_notes' and new 'notes' message types
function showFinalNotes(message) {
  const summaryContainer = document.getElementById('summaryContainer');

  let summaryText = '';
  let decisions: string[] = [];
  let actionItems: Array<{ owner: string; task: string; due: string | null }> = [];

  // Handle new 'notes' message type from Phase 4 backend
  if (message.type === 'notes') {
    summaryText = message.summary || 'Meeting concluded';
    decisions = message.decisions || [];
    actionItems = message.action_items || [];
  }
  // Handle old 'final_notes' message type for backward compatibility
  else if (message.type === 'final_notes' || (message.title !== undefined || message.keyPoints !== undefined)) {
    summaryText = message.title || 'Meeting concluded';
    decisions = message.keyPoints || [];
    // Try to parse action items from legacy format
    if (message.actionItems && message.actionItems.length > 0) {
      actionItems = message.actionItems;
    }
  }

  // Build action items table HTML
  let actionItemsHtml = '';
  if (actionItems && actionItems.length > 0) {
    actionItemsHtml = '<h4>Action Items</h4><table>';
    actionItems.forEach(item => {
      const due = item.due ? new Date(item.due).toLocaleDateString() : '—';
      actionItemsHtml +=
        `<tr><td>${item.owner || 'Unassigned'}</td><td>${item.task}</td><td>${due}</td></tr>`;
    });
    actionItemsHtml += '</table>';
  }

  // Build decisions list HTML
  let decisionsHtml = '';
  if (decisions && decisions.length > 0) {
    decisionsHtml = '<h4>Decisions</h4><ul>';
    decisions.forEach(d => {
      decisionsHtml += `<li>${d}</li>`;
    });
    decisionsHtml += '</ul>';
  }

  summaryContainer.innerHTML = `
    <h3>Final Notes</h3>
    <p><strong>Summary:</strong> ${summaryText}</p>
    ${decisionsHtml}
    ${actionItemsHtml}
  `;
  summaryContainer.style.display = 'block';
}

// Render meeting history
function renderHistoryUI(meetings) {
  const historySection = document.getElementById('historySection');
  const historyList = document.getElementById('historyList');

  if (!meetings || meetings.length === 0) {
    historyList.innerHTML = '<div class="history-item empty">No meetings recorded</div>';
    historySection.style.display = 'block';
    return;
  }

  historyList.innerHTML = meetings.map(m => `
    <div class="history-item" data-meeting-id="${m.id}" title="${m.title} on ${new Date(m.startTime).toLocaleString()}">
      ${m.title.substring(0, 30)}${m.title.length > 30 ? '...' : ''} — ${((m.endTime - m.startTime) / 60000).toFixed(1)}min
    </div>
  `).join('');

  historySection.style.display = 'block';

  // Add click handlers for restoring meetings
  document.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', () => {
      const meetingId = item.getAttribute('data-meeting-id');
      chrome.runtime.sendMessage({
        type: 'restore_meeting',
        meetingId: meetingId
      });
    });
  });
}

// Generate a session ID
function generateSessionId() {
  return 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// UI event handlers
document.addEventListener('DOMContentLoaded', () => {
  endMeetingBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'end_meeting' });
  });
});

// Export for testing/debugging
window.PanelUI = {
  connectPanel,
  handlePanelMessage,
  addTranscriptUI,
  renderSummaryUI,
  renderHistoryUI
};

// Initialization — called from background.js
window.initPanel = async () => {
  console.log('Panel initialized');
};