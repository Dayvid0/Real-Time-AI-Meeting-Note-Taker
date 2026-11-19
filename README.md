# Meeting Notes: real-time AI note-taker

A Chrome extension that captures meeting-tab and microphone audio without joining as a bot.
Audio streams through a FastAPI relay to Deepgram. Phase 3 displays a live transcript with You / Others
labels, timestamps, draft replacement, Start/Stop controls, and scroll-pause behavior. Phase 4 adds
rolling summaries, final decisions/action items, saved meeting history, and Markdown export.

Phase 6 ship-prep files include store/privacy drafts, production origin enforcement, Fly.io
configuration, CI/deploy automation, architecture/environment references and a store ZIP packager.
Public deployment and store submission remain intentionally unperformed pending publisher details.

## Where to resume

- **P1: completed previously.** Original JavaScript audio-capture files remain in `extension/`.
- **P2 / F3: both microphone and tab finals verified in Brave.** Provider smoke tests and clean Stop
  passed. Browser caption latency remains unmeasured.
- **P3 / F4/F5 display: accepted by the user in Brave.** The user reported the five-minute UI test works.
- **P4 / F5–F8: live Gemini summaries/notes verified; Brave reload/export acceptance pending.**
  Automated tests cover storage, notes validation/retry, summary failure isolation, export and reconnect.
  A 90-second synthetic audio session verified both transcript channels, rolling summary and final notes.
- **P5 / hardening: implemented and user-accepted; numerical latency/cost measurement remains.**
  Version 0.5.0 adds first-run recording consent, a 30-day reminder, sleep/wake recovery, clearer
  token/server/tab failure states, privacy-safe structured relay metrics and a benchmark reporter.
- **P6 / ship prep: implemented as version 0.6.0; not publicly deployed or submitted.** Production
  requires one exact extension origin. CI verifies/packages the extension, builds the relay image and
  can deploy after repository secrets are configured.
- **Next step:** supply the publisher-owned release details listed in docs/STORE_LISTING.md. The Gemini key is saved;
  direct summary/decisions/actions and end-to-end audio/notes checks passed with Gemini 3.5 Flash-Lite.
  The user requires free summaries; keep the Google project on the Free tier and do not request paid credits.
  Reload version 0.6.0 for the final local regression check below.
- [AGENTS.md](AGENTS.md) contains project rules; [docs/STATUS.md](docs/STATUS.md) records verification.

The recovered plan came from `/mnt/data/workspace/match-predictor/meeting-notes/`.
The intended project directory remains `/mnt/data/workspace/meeting-notes`.

## Current live-test setup (7 November 2026)

This machine already has another project on port 8000. The current extension/dist build therefore
uses **http://127.0.0.1:8001**. Start the relay with the command below using `--port 8001`, and preserve
that setting on rebuild with `RELAY_URL=http://127.0.0.1:8001 npm run build`. The general defaults below
remain 8000 for other machines; the extension build and relay must always use the same port.

A 14.1-second real Deepgram test with generated stereo speech passed: both channel labels, expected
word checks, final results before Stop, and clean completion. This did not capture a real browser tab
or microphone. Subsequent Brave tests confirmed both local and remote final events. P3 live UI was accepted by the user; P4 acceptance remains pending. See docs/STATUS.md for measurements.

The local relay must remain running for new transcripts and notes. If the panel says **Connection lost**,
check `http://127.0.0.1:8001/health`; a working relay replies with status ok. On this machine,
`meeting-notes.service` starts the relay automatically with the user session and restarts it after a
failure. Check it with `systemctl --user status meeting-notes.service` and restart it with
`systemctl --user restart meeting-notes.service`. The manual setup command below remains useful on
other machines. Saved browser history is separate.

## Run locally

Requires Python 3.12+, Node.js 20+, npm, Chrome 116+ or a recent Brave release, and a Deepgram API key with transcription access. Brave supports Chrome extensions; both audio sources have been verified. The Phase 3 interface was accepted by the user.
The P4 changes are applied in `/mnt/data/workspace/meeting-notes`. Dependencies and the built extension
are installed there; add your Deepgram key to `.env` before starting the relay.

1. On a new installation only, copy `.env.example` to `.env`. This machine already has a configured
   private `.env`; preserve it. Put your key in `DEEPGRAM_KEY` and set `TOKEN_SECRET` to a random
   value of at least 32 bytes. Generate one with:

   ```sh
   python3 -c 'import secrets; print(secrets.token_hex(32))'
   ```

   Create a Gemini API key at [Google AI Studio](https://aistudio.google.com/apikey) using a project
   on the **Free tier**, with billing disabled. Put it in `LLM_KEY` (separate from Deepgram), with
   `LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai` and
   `LLM_MODEL=gemini-3.5-flash-lite`. Do not reuse an OpenAI key with the Gemini endpoint.
   Gemini free-tier quotas apply; reaching a limit leaves notes unavailable. There is no paid fallback.
   Google may use free-tier inputs/outputs to improve products; use synthetic meeting content for tests.
   Check [Google pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite) and the
   account's current tier and limits. Free summaries do not make Deepgram transcription free.
   The relay supports compatible chat-completions endpoints; changing providers is configuration.
   Missing/failed model access leaves transcription working and shows notes unavailable.
   Never put credentials in extension code. Restart the relay after editing `.env`.

2. Install and run the relay:

   ```sh
   cd /mnt/data/workspace/meeting-notes/server
   python3 -m venv .venv
   .venv/bin/python -m pip install -r requirements-dev.txt
   .venv/bin/uvicorn app.main:app --env-file ../.env --host 127.0.0.1 --port 8001 --ws-max-size 65536 --ws-max-queue 16 --no-access-log --no-proxy-headers
   ```

3. In another terminal, build the extension:

   ```sh
   cd /mnt/data/workspace/meeting-notes/extension
   npm ci
   npm run check
   npm run lint
   npm test
   npm run build
   ```

4. In Brave open `brave://extensions` (in Chrome, `chrome://extensions`), enable Developer mode, choose **Load unpacked**, and select
   **`/mnt/data/workspace/meeting-notes/extension/dist`**. The root `extension/` folder is the old P1
   version; load `dist/` for P4. After rebuilding, click Reload on the extension card.

5. On a normal meeting or speech-playing tab, click the Meeting Notes toolbar icon to open the
   panel. On first use, review and accept the recording notice. Tell participants transcription is
   active and obtain consent before every meeting. A reminder returns about every 30 days.
   **Opening it no longer starts or stops recording.** Press **Start meeting** in the panel.
   If the browser has not granted capture access for this tab, click the toolbar icon on that tab
   once and retry Start. Begin speaking when the status shows **Live**.

6. If your microphone needs permission, click **Enable microphone**. A small setup window opens in
   the same Brave browser; your meeting tab stays open. Click **Allow microphone** and approve the
   browser prompt. Setup returns to your meeting automatically and attaches your voice to the same
   recording. **Back to meeting** cancels setup without changing capture. Once permission is saved,
   later meetings use it automatically. Temporary microphone dropouts trigger up to three reconnect
   attempts in the same meeting; interrupted speech is marked as a gap. If access is blocked, input
   is missing or the device stays busy, the panel explains what to check. **You** means microphone
   and **Others** means tab audio.

7. Give the meeting a title and speak a short test containing a decision, an assigned action, and
   a due date. Open Rolling summary after about a minute. Press Stop and wait for Finished. The
   Notes tab should show a summary, decisions, and action items. Review them for accuracy.

8. Wait for “Saved on this browser”, then reload the extension. Open History, search for the meeting,
   and open it. Notes and transcript should still be present. Copy Markdown or Export .md from Notes.
   When viewing a saved meeting, Transcript shows its transcript; Back to current returns to capture.

Use **× Close** at the top of the panel when finished. During recording this button becomes
**Stop & close**: it waits for final notes and saved meeting data, then closes. A save failure keeps
the panel open so you can export. Click the toolbar icon to reopen and find saved meetings in History.
Older Brave versions without the panel-close API use a disable/re-enable fallback; this can also hide
Meeting Notes panels in other browser windows, while their capture/storage remain managed separately.

Meetings are saved incrementally in IndexedDB in the same browser profile: metadata, revised transcript
rows, latest rolling summary, and final notes. A new meeting does not erase older meetings. Reloading
interrupts recording, but committed rows remain in History; a recovered draft stays unconfirmed.
Writes use strict durability where supported. A crash before a transaction commits, disk/quota errors,
clearing browser data or removing the extension can still lose data. Watch the save-status message and
export important meetings. History search is a local scan suitable for MVP-sized collections.

Audio goes to Deepgram; finalized transcript text goes to the configured LLM. No raw audio is stored.
The relay keeps only in-memory summary context and persists nothing. Rolling updates send the prior
structured notes plus new final segments. Final notes get one retry on malformed model output.

The model budget defaults to 120000 conservative token units per meeting (input UTF-8 bytes + reserved
output + overhead); failed requests and retries consume budget too. This limits use, not exact cost.
A reserve is kept for final notes. The client carries remaining budget across reconnects; this is a local
MVP guard rather than a public service billing control. Context buffers are bounded; overflow and audio
gaps mark notes partial. On reconnect, up to 20 KB of recent final text is re-sent to the relay; omitted
history is flagged. Full transcripts remain in local storage even when notes are unavailable or partial.

The relay emits structured operational events with session identifiers, durations and event counts only.
The logger uses an allowlist and does not include audio, transcript text, credentials or upstream error
details. Computer sleep/wake forces an immediate reconnect and creates an audio-gap marker. If the
captured tab closes, capture stops and the meeting remains saved.

## Automated checks

```sh
cd /mnt/data/workspace/meeting-notes/server
.venv/bin/ruff check app tests
.venv/bin/ruff format --check app tests
.venv/bin/python -m unittest discover -s tests -v
```

The server tests use an actual local mock WebSocket transcription server. They need no paid key and
make no requests to Deepgram. Extension test commands are shown above.

## Configuration and deployment boundary

- `DEEPGRAM_KEY`: required by the relay, never delivered to the extension.
- `TOKEN_SECRET`: required, at least 32 bytes. Tokens expire after 60 seconds; expiration is checked
  at connection time, so it does not cut an active meeting off after a minute.
- `ALLOWED_ORIGINS`: comma-separated exact browser origins. Local P2 defaults to Chrome extension
  origins; set this to your extension's `chrome-extension://<id>` before sharing a relay.
- `RELAY_URL`: build-time extension setting, default `http://127.0.0.1:8000`. For a hosted relay:
  `RELAY_URL=https://your-relay.example npm run build`. Remote relays require HTTPS/WSS.
- `LLM_KEY`: server-only model API key; empty disables note generation gracefully.
- `LLM_BASE_URL`, `LLM_MODEL`: compatible endpoint and model. Defaults use Gemini 3.5 Flash-Lite;
  the account must stay on the Free tier for free summaries. Do not switch to paid providers without
  the user's explicit request.
- `LLM_TOKEN_BUDGET`: optional conservative per-meeting guard, default 120000 (10000–1000000).
- Model requests time out after 12 seconds each. Final notes have a 30-second deadline after ASR drains;
  the extension allows 45 seconds for the complete stop operation.

To build the supplied container from the project root, run
`docker build -f server/Dockerfile -t meeting-notes-relay .`. Run it with
`docker run --rm --env-file .env -p 127.0.0.1:8000:8000 meeting-notes-relay`.

Production uses [fly.toml](fly.toml), `APP_ENV=production`, an exact
`ALLOWED_ORIGINS=chrome-extension://<published-id>`, and Fly secrets for private values. Configure
repository secrets `FLY_API_TOKEN` and `FLY_APP` before enabling main-branch deployment. Build the
store bundle only after the public HTTPS relay URL is known:

```sh
cd /mnt/data/workspace/meeting-notes/extension
RELAY_URL=https://your-relay.example npm run build
npm run package
```

See [store listing](docs/STORE_LISTING.md), [privacy policy](docs/PRIVACY.md),
[environment reference](docs/ENVIRONMENT.md) and [architecture](docs/ARCHITECTURE.md).

Token rate limits are held in memory per relay process (10 per IP per minute). The supplied launch
commands disable forwarded-IP trust. The unauthenticated token endpoint is intended for local
development at this stage, not a public paid transcription service. Production exact-origin checks
limit normal browser callers but do not replace user accounts or per-user provider quotas.

## P2 audio and protocol decisions

One worklet samples both sources on the same audio clock. Each source is mixed to mono, then
interleaved as **local, remote, local, remote…** PCM16 little-endian samples at 16 kHz. A normal frame
is 100 ms / 6400 bytes. This keeps the channels aligned without trying to pair messages from two
independent worklets. A missing microphone is encoded as silence; the tab is still audible locally.

The offscreen document owns capture and the network connection; the service worker only coordinates
start/stop. Connection tokens travel in a WebSocket subprotocol rather than the URL to avoid normal
URL access logs. The server selects only `meeting-notes.v1` in its upgrade response.

Both ends bound pending audio (about one second in the application queue; transport buffers are
also bounded). On disconnect, unsent audio is dropped and reported as a gap. This limits memory and
avoids saving raw audio, at the cost of missing speech during outages. Reconnect uses a fresh token
and backoff. Stop flushes the final partial frame, drains the queue, asks Deepgram to close the
stream, and waits for final results. Transcript events contain no provider error details or secrets.

See [docs/PROTOCOL.md](docs/PROTOCOL.md) for message fields. Deepgram usage costs money; the project's
<$0.10/hour target remains unverified until actual account usage is measured. Record capture-to-caption
observations and the provider's billed amount, then generate a privacy-safe report with:

```sh
cd /mnt/data/workspace/meeting-notes/server
.venv/bin/python -m benchmarks.report --latency-ms 850 920 1100 --audio-seconds 600 --transcription-cost-usd 0.01 --notes-cost-usd 0
```

The report calculates p50/p95 and normalizes observed cost to one audio hour. Synthetic provider timing
does not count as real browser capture-to-caption acceptance.


## Notes evaluation

`cd server && .venv/bin/python -m evals.evaluate --mock` checks the scorer using 12 synthetic fixtures;
this is not evidence of model quality. Load the private environment into the process and run
`python -m evals.evaluate --live` to score the configured model (consumes the provider's quota and may
cost money on a paid tier). The report contains fixture
IDs, matched/expected action counts, extra items, and aggregate recall; it does not log transcript text.
The keyword scorer is a basic regression aid, not a semantic-quality guarantee.
