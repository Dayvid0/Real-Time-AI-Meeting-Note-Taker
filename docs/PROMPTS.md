# Prompts for opencode

Paste ONE prompt per session. Verify each phase yourself before moving on. Tip: use opencode's plan
mode first so it states its plan, then switch to build mode.

---
## P0: Orient (run once)
Read AGENTS.md and the existing extension/ code. Do not change anything yet. Summarize back to me:
(1) how audio flows from tab+mic to PCM frames, (2) what each file does, (3) any bugs or risks you
see in P1. Then wait.

---
## P2: Streaming pipeline (F3)
Implement Phase 2 per AGENTS.md. First give me the pre-phase summary, then build.
Goal: PCM from the extension -> our WebSocket -> Deepgram -> raw transcript messages shown in a plain test page.

Server (server/, Python + FastAPI, deps pinned in pyproject/requirements):
- POST /v1/token: HMAC-signed short-lived token (stdlib hmac, expiry ~60s), rate limited per IP.
- wss /v1/session: validate token BEFORE upgrade, handle start/binary/end, validate every control
  message, cap frame size, bounded queue for backpressure.
- asr/deepgram_client.py: connect to Deepgram live (model nova-3, encoding linear16, sample_rate 16000,
  interim_results, smart_format, endpointing, multichannel for You-vs-Others), send keepalives, map results to
  transcript{seq,speaker,text,startMs,endMs,final}. Key comes from DEEPGRAM_KEY env var only.
- Dockerfile, .env.example.
Extension: convert to TypeScript with a minimal bundler (esbuild). lib/ws-client.ts with protocol types
and reconnect with backoff. Both channels must reach Deepgram: choose interleaving mic+tab into stereo
frames (channel 0 = local, 1 = remote) unless you find a better option; explain the choice.
Test page: extension page that shows incoming transcript JSON.
Tests: unit tests for framing/codec and token validation; integration test with a mock Deepgram WS
server (replayed messages). Acceptance: speak + play meeting audio -> final transcript lines appear in the
test page, labelled local/remote, within ~5s. Stop and report when done.

---
## P3: Live UI (F4, F5 display)
Implement Phase 3 per AGENTS.md (summary first, then build). Replace the debug panel with the real side panel:
- Live transcript with speaker labels ("You" / "Others") and timestamps; interim text replaced in place by final text; auto-scroll that pauses when the user scrolls up.
- Start/stop control, connection status, visible "recording" indicator.
- Rolling-summary area (placeholder "summary unavailable" for now).
- Clean MV3 message passing: offscreen owns the WS, service worker coordinates, panel only renders.
- Gap markers in the transcript when the WS drops and reconnects.
No React unless you justify it. Tests: unit tests for the transcript reducer (interim -> final, ordering by seq). Acceptance: a 5-minute real meeting renders correctly with no duplicated lines. Report when done.

---
## P4: Notes generation (F5, F6, F7, F8)
Implement Phase 4 per AGENTS.md (summary first, then build).
Server summarizer/: OpenAI-compatible client (base URL + model from env so GPT-4o-mini or Kimi K2 both work).
- Rolling summary every ~60s: send previous summary + new transcript only.
- Final notes on end: strict JSON {summary, decisions[], actionItems[{owner,task,due?}]}, validated and retried once on bad JSON.
- Prompts treat transcript as untrusted DATA, never instructions (prompt-injection defense); delimit it clearly.
- If the LLM fails, transcript is unaffected and the client gets a "summary unavailable" state. Per-session token budget guard.
Extension: lib/db.ts using idb with stores meetings/transcripts/summaries/notes (index meetingId+seq); save transcript incrementally so a crash loses nothing; final notes view; copy/export Markdown; searchable meeting history list.
Tests: prompt builder unit tests, mocked-LLM integration test, and an eval script with 10-15 sample transcripts scoring action-item recall. Acceptance: end a meeting -> notes appear, persist after reload, export to Markdown. Report when done.

---
## P5: Hardening
Implement Phase 5 per AGENTS.md (summary first, then build): first-run consent screen + periodic reminder in the UI; reconnect + sleep/wake tests for the MV3 offscreen/worker lifecycle; clear error states (token expired, mic denied, tab closed, server down); gap marking; structured JSON logs with no transcript content; a latency benchmark (capture -> caption, report p50/p95) and a cost-per-hour estimate from real usage. Fix issues found and list what you changed. Report numbers honestly against the <=5s and <$0.10/hr targets.

---
## P6: Ship prep
Implement Phase 6 per AGENTS.md: extension icons, Chrome Web Store listing text, privacy policy (no audio retained, what leaves the device, retention), harden POST /v1/token (rate limits, short expiry, CORS limited to the extension origin), Fly.io deploy config + GitHub Actions (ruff + eslint -> tests -> build extension -> build Docker; deploy backend on merge to main). Write README, env var reference, WS protocol doc, architecture.md. Report anything blocking store approval.
