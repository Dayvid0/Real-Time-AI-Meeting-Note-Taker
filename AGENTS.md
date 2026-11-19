# AGENTS.md: Real-Time AI Meeting Note-Taker

Chrome MV3 extension that captures meeting audio live from the tab (no bot), streams it to a
FastAPI relay, which pipes it to Deepgram (ASR) and an LLM (summaries). Developer is learning:
explain engineering decisions ("use X because...") and mention tradeoffs.

## Rules
- Work on ONE phase at a time (P1-P6 below). Before coding, summarize: what you'll build, which
  requirement IDs it satisfies, files you'll touch, tests that should pass. Then implement.
- Run tests/linters after changes. Report failures honestly; never claim a test passed if it didn't.
- Do NOT make major architectural changes silently. If the design is insufficient, STOP and explain
  (what you found, why, proposed change, alternatives, impact) and wait for approval.
- No features outside the approved scope. Prefer simplicity, no DDD layers, no repository pattern.
- Secrets only via env vars (DEEPGRAM_KEY, LLM_KEY, TOKEN_SECRET). Never commit them. Never log transcript content.

## Architecture (approved)
- extension/: Side panel UI, Offscreen document (AudioContext + AudioWorklet -> PCM16 16k mono),
  Service worker (lifecycle only; MV3 workers can't hold an AudioContext).
- server/: FastAPI stateless relay. wss /v1/session (JSON control + binary PCM) -> Deepgram Live
  (nova-3, diarization); summarizer -> LLM (rolling every ~60s, final strict JSON at end).
  POST /v1/token issues short-lived tokens.
- Storage: IndexedDB in the extension (meetings, transcripts, summaries, notes). Server persists nothing. No accounts in MVP.
- WS messages: C->S start{sampleRate,meetingTitle?}, binary PCM16 LE, end;
  S->C transcript{seq,speaker:'local'|'remote',text,startMs,endMs,final},
  summary{kind:'rolling',content,atMs}, notes{kind:'final',summary,decisions[],actionItems[{owner,task,due?}]}, error{code,message}.
- Non-functional: captions <=5s behind speech; transcript never lost if summarizer fails; WS auto-reconnect;
  no raw audio stored; target <$0.10/hour.

## Repo layout (keep flat)
meeting-notes/{extension/{manifest.json,src/{background,offscreen,panel,lib/{db.ts,ws-client.ts}},assets},
server/{app/{ws/session.py,asr/deepgram_client.py,summarizer/,auth/token.py},tests,Dockerfile}}

## Status
- P1 DONE (plain JS, no build step): extension/ has manifest.json, background.js, offscreen.{html,js},
  pcm-worklet.js, panel.{html,js}, mic-permission.{html,js}. Captures tab + mic as separate PCM16 16k
  mono channels, shows levels, downloads WAVs. Details already handled: tab stream ID is used
  immediately; tab audio is routed back to destination (capture mutes it); mic permission is requested
  from a normal tab because offscreen docs can't prompt.
- P2 (F3) implementation applied in /mnt/data/workspace/meeting-notes: TypeScript/esbuild sources in extension/src/, load extension/dist/
  after npm run build. FastAPI relay, token endpoint, stereo PCM streaming, Deepgram adapter, reconnect
  client and raw transcript test page are implemented. Automated tests use a mock Deepgram WebSocket.
  Both local/remote finals are verified in Brave. Browser latency remains unmeasured. The user
  explicitly requested P3 next; proceed with P3 while retaining the remaining P2 measurement caveats.
  See docs/STATUS.md and README.md; do not relabel unmeasured acceptance criteria as passed.
- Original P1 files at extension/ root are preserved for reference; P2 builds from src/ and static/.
- P3 (F4/F5 display) implemented: readable live panel, in-place transcript reducer, explicit Start/Stop,
  scroll pause/Jump to latest, connection/capture indicators, summary placeholder, and compact
  in-memory snapshots. Automated checks pass; the user accepted the real Brave UI test.
- P4 (F5–F8) implemented: configured model summaries/notes, incremental IndexedDB saves, searchable
  History, and Markdown export. User requires FREE summaries; earlier OpenAI selection is superseded.
  Gemini 3.5 Flash-Lite is configured; the saved key passed a synthetic live notes request.
  Google rejects 2.5 Flash-Lite for new users despite listing it; use the verified replacement.
  Free-tier limits apply. Synthetic stereo audio, rolling summary and final notes passed end to end.
  Brave Notes/History/reload/export still need user acceptance. No full live evaluation score is claimed.
  Do not request paid credits or add a paid fallback. Deepgram audio remains separately metered.
  See docs/STATUS.md before resuming provider tests or Brave reload/export acceptance.
- User-requested panel/microphone UX fixes are applied in 0.4.2: Close / Stop & close waits for saved
  notes; microphone setup uses a small same-browser window, returns to the meeting, and can attach
  the microphone to the active session without restarting. Later mic dropouts now trigger bounded
  automatic recovery; Stop cancels it. A stopped relay caused the latest notes outage and was restarted.
  Tests and synthetic relay/notes checks pass; the user confirmed microphone/note-taking recovery in Brave.
  The original dropout cause remains unknown; persistence/export acceptance is still separately pending.
- The recurring 8 November connection outage was traced to the port-8001 relay exiting with no
  persistent process manager. A user service at `~/.config/systemd/user/meeting-notes.service` is
  enabled for login startup and `Restart=on-failure`; health passed before and after a controlled
  service restart. Do not start a duplicate manual relay while this service is active.
- P5 implemented in 0.5.0: first-use consent plus 30-day reminder, immediate sleep/wake reconnect with
  gaps, service-worker/offscreen lifecycle tests, distinct token/server/mic/tab errors, allowlisted JSON
  operational logs without transcript content, and a p50/p95 + observed-cost benchmark reporter.
  Real Brave consent rendering, browser capture-to-caption p50/p95 and account-derived cost/hour remain
  acceptance work; do not claim the <=5s or <$0.10/hour targets until measured.
- P6 ship-prep implemented in 0.6.0: production exact-origin enforcement for token + WebSocket,
  short configurable tokens/rate limits, Fly config, CI/package/deploy workflow, store listing and
  privacy drafts, env/protocol/architecture docs, and a deterministic store ZIP packager. Public relay
  deployment/store submission are blocked on publisher-owned app name, HTTPS relay URL, published
  extension ID, support email/URL, privacy-policy URL, store screenshots, and Fly/GitHub secrets.

## Phases
P1 Audio capture | P2 Streaming pipeline | P3 Live UI | P4 Notes generation | P5 Hardening | P6 Ship prep
