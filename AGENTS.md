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
- P2-P6 NOT started.

## Phases
P1 Audio capture | P2 Streaming pipeline | P3 Live UI | P4 Notes generation | P5 Hardening | P6 Ship prep
