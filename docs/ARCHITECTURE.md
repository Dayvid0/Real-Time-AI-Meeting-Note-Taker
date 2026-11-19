# Architecture

## Data flow

1. The user starts capture from the side panel on a selected meeting tab.
2. The MV3 service worker obtains a short-lived tab-capture stream ID and ensures the offscreen document exists.
3. The offscreen document owns tab/microphone streams, an AudioContext and AudioWorklet. It resamples and
   interleaves microphone as channel 0 and tab audio as channel 1 in PCM16 at 16 kHz.
4. The extension requests a short-lived signed token from the relay and opens the authenticated WebSocket.
5. The FastAPI relay streams audio to Deepgram and forwards transcripts. Final transcript batches are sent
   to the configured OpenAI-compatible notes model for rolling and final notes.
6. The offscreen document reduces events into one current-session snapshot and incrementally saves meetings,
   transcript rows, summaries and notes to IndexedDB. The side panel renders that snapshot and History.

## Trust and persistence boundaries

- Provider credentials and token-signing secret exist only on the relay.
- Raw audio is held only in bounded memory queues and is not persisted by the extension or relay.
- Meeting content is persisted only in the user's browser unless the user exports Markdown.
- Deepgram receives audio. The configured notes model receives finalized transcript text and prior notes.
- Relay operational logs contain allowlisted metrics only—never meeting content or credentials.

## Reliability boundaries

- The offscreen document, not the MV3 service worker, owns long-lived capture and WebSocket state.
- Reconnects obtain fresh tokens, drop rather than buffer unbounded audio, and create visible gap markers.
- Sleep/wake forces immediate reconnection. Microphone recovery is bounded; tab closure safely ends capture.
- Transcript storage and notes generation are isolated: model failure does not discard transcription.

## Deployment boundary

Local development binds the relay to `127.0.0.1:8001`. The persistent user service starts it at login.
Production uses Fly.io behind HTTPS/WSS. `APP_ENV=production` requires one exact extension origin, and
token requests without the browser Origin header are rejected. Origin checks limit browser callers but
are not user authentication; a public relay with material provider spend still needs accounts, quotas or
another abuse-control layer before broad release.
