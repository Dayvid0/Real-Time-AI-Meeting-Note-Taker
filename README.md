# Meeting Notes AI

Real-time meeting transcription in the browser with AI-generated rolling
summaries, decisions and action items.

- **Extension** — Chrome MV3 (side panel UI, tab + microphone capture, PCM16
  audio worklet).
- **Backend** — FastAPI service that streams audio to Deepgram and summarizes
  with an LLM.

> Status: release candidate (`v1.0.0`).

---

## Architecture

```
 Browser (Chrome MV3)                                                           
 ┌────────────────────────────────────────────────────────────────────────────┐
 │  Toolbar click                                                             │
 │      │                                                                     │
 │      ▼                                                                     │
 │  background.js (service worker)                                            │
 │      │  chrome.tabCapture.getMediaStreamId({ targetTabId })                │
 │      │  chrome.offscreen.createDocument({ reasons: ['USER_MEDIA'] })       │
 │      ▼                                                                     │
 │  offscreen.html ──► worklet.js  (float32 ─► PCM16 LE 16 kHz frames)        │
 │      │  chrome.runtime message: { type: 'pcm-frame', source }              │
 │      ▼                                                                     │
 │  panel/panel.ts (side panel)  ── WebSocket ──┐                            │
 └──────────────────────────────────────────────┼────────────────────────────┘
                                                 │ binary PCM + JSON control
                                                 ▼
 Backend (FastAPI)                                                             
 ┌────────────────────────────────────────────────────────────────────────────┐
 │  POST /v1/token        → short-lived JWT                                   │
 │  GET  /health          → { "status": "ok" }                                │
 │  WS   /ws/{meeting_id} → PCM binary  ─► Deepgram Live ASR                  │
 │                          final text  ─► client (transcript)                │
 │                          every 60 s  ─► OpenAI ─► client (rolling summary) │
 │                          stop        ─► OpenAI ─► client (final notes)     │
 └────────────────────────────────────────────────────────────────────────────┘
```

Directory layout:

```
backend/            FastAPI service (main.py, tests, requirements)
extension/          Chrome MV3 extension
  background.js       service worker
  offscreen.html      offscreen audio-capture document
  worklet.js           AudioWorklet PCM16 processor
  logger.js            leveled logger shared by all contexts
  panel/               side panel (panel.ts/html/css)
  icons/              16/32/48/128 action + store icons
  manifest.json       MV3 manifest
store/              Chrome Web Store listing assets (listing, screenshots, icons)
scripts/            developer utilities (icon generation)
.github/workflows/  CI
Dockerfile          backend image
fly.toml            fly.io deploy config
```

---

## Local development

### Prerequisites

- Python 3.12+
- Node.js 18+ (20 recommended)
- Chrome/Chromium 116+

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt

cp .env.example .env          # then fill in DEEPGRAM_API_KEY / OPENAI_API_KEY
uvicorn main:app --reload --port 8000
```

The API is then available at `http://localhost:8000`; `GET /health` should
return `{"status":"ok"}`.

### Extension

```bash
npm ci
npm run build                 # outputs dist/extension/
```

Load it in Chrome:

1. Open `chrome://extensions` and enable **Developer mode**.
2. **Load unpacked** → select `dist/extension`.
3. The side panel opens from the toolbar; set the backend URL via
   `chrome.storage.local` key `backendUrl` (defaults to `ws://localhost:8000`).

### Verify everything

```bash
# Backend
cd backend && ruff check . && mypy . && pytest

# Extension
npm run lint && npm run typecheck && npm run build
```

`npm run verify` runs the extension lint/type-check/build in one step.

---

## Environment variables

All backend configuration is read from the environment (and `backend/.env` for
local development). See `backend/.env.example`.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `JWT_SECRET` | production | `dev-secret-please-change-me-32bytes` | Signs short-lived WebSocket tokens. Use 32+ random bytes. |
| `DEEPGRAM_API_KEY` | for transcription | _(empty)_ | Deepgram live-ASR key. Empty → control-only mode. |
| `OPENAI_API_KEY` | for summaries | _(empty)_ | OpenAI key. Empty → summaries disabled. |
| `OPENAI_MODEL` | no | `gpt-4o-mini` | Summarization model. |
| `JWT_TTL_SECONDS` | no | `300` | Token lifetime. |
| `SUMMARY_TOKEN_BUDGET` | no | `100000` | Per-session summarization token cap. |
| `MAX_FRAME_BYTES` | no | `65536` | Max accepted WebSocket frame size. |
| `MAX_MESSAGES_PER_MIN` | no | `100` | Per-connection message rate limit. |
| `IDLE_TIMEOUT_SECONDS` | no | `600` | Close idle sockets after this. |
| `ROLLING_SUMMARY_INTERVAL` | no | `60` | Rolling summary cadence (seconds). |

**Deploy wiring (fly.io):** non-secret values are set in `fly.toml` `[env]`;
secrets are set with `fly secrets set`:

```bash
fly secrets set \
  JWT_SECRET="$(openssl rand -hex 32)" \
  DEEPGRAM_API_KEY="..." \
  OPENAI_API_KEY="..."
```

---

## WebSocket protocol

Endpoint: `WS /ws/{meeting_id}`. Authentication tokens are issued by
`POST /v1/token`; the server treats `meeting_id` as the session key.

**Client → server**

| Payload | Description |
| --- | --- |
| binary frame | PCM16 LE mono 16 kHz audio. |
| `{"type":"start_meeting","meeting_title":"..."}` | Marks the session recording. |
| `{"type":"stop_meeting"}` | Flushes ASR and returns final notes. |
| `{"type":"generate_summary"}` | Requests an on-demand rolling summary. |
| `{"type":"set_title","title":"..."}` | Renames the session. |

**Server → client**

| Payload | Description |
| --- | --- |
| `{"type":"status_update","status":"recording"}` | Recording state changed. |
| `{"type":"transcript","text":"...","speaker":"you"}` | Final ASR segment. |
| `{"type":"summary","kind":"rolling","summary":"...","keyPoints":[]}` | Rolling summary. |
| `{"type":"notes","summary":"...","decisions":[...],"action_items":[...]}` | Final notes. |

Limits: 64 KB max frame, 100 messages/min, 10-minute idle timeout. Transcript
content is never written to logs.

---

## Security & privacy

- Transcript text is treated as **untrusted input**; LLM system prompts
  explicitly instruct the model to ignore embedded instructions
  (prompt-injection defense).
- Transcript content is **never logged**.
- The container runs as a non-root user and ships a `/health` healthcheck.
- Report vulnerabilities per the Chrome Web Store listing contact.

---

## Manual test plan

Run before each release.

**Backend**

1. `cd backend && ruff check . && mypy . && pytest` → all green.
2. Start the server with no `DEEPGRAM_API_KEY`; `curl localhost:8000/health`
   returns `{"status":"ok"}`.
3. `curl -s localhost:8000/v1/token -H 'content-type: application/json' -d '{"meeting_id":"demo"}'`
   returns a JWT.
4. Open a WebSocket to `/ws/demo`, send `{"type":"start_meeting"}` and expect
   `{"type":"status_update","status":"recording"}`.
5. Send `{"type":"stop_meeting"}` and expect a `notes` message, then close.
6. With keys configured, speak into the mic and confirm `transcript` messages
   arrive and a `summary` appears after ~60 s.

**Extension**

1. `npm run verify` → lint, typecheck and build all pass.
2. Load `dist/extension` unpacked; the toolbar action and side panel appear.
3. Click the toolbar action on a tab playing audio → panel status becomes
   `connected`/`recording` and a live timer starts.
4. Confirm transcript lines render newest-first and partials are dimmed.
5. End the meeting → final notes (summary/decisions/action items) render.
6. Disconnect the backend → panel shows a disconnected status and retries.

**Docker**

1. `docker build -t meeting-notes-backend .`
2. `docker run --rm -p 8000:8000 meeting-notes-backend`
3. `docker inspect --format '{{.State.Health.Status}}' <id>` → `healthy`.

---

## License

MIT
