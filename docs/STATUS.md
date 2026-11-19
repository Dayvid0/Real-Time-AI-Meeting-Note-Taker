# Resume status — 7 November 2026

## Recovered stopping point

The original working folder `/mnt/data/workspace/meeting-notes` contains the finished P1 audio
capture code. It is not a Git repository. Its missing README, AGENTS.md and phase prompts were found
in `/mnt/data/workspace/match-predictor/meeting-notes`, whose Git history contains the same P1
`offscreen.js` as the chosen project. The other repository's existing deletions were left untouched.

The next planned phase is P2 / F3 (streaming pipeline). P3–P6 have not been started.

## Applied P2 work

- Recovered project instructions and phase prompts, plus an updated README with setup and resume steps.
- TypeScript/esbuild extension, one stereo worklet (local microphone + remote tab), raw JSON test panel.
- Offscreen-owned connection with fresh-token reconnect/backoff, bounded audio buffer and visible gaps.
- Partial-frame flush and final-transcript drain on stop; original P1 root files preserved.
- FastAPI token endpoint (HMAC, 60-second expiry, per-IP limit), pre-upgrade validation, strict controls,
  frame size/alignment checks and bounded audio queue.
- Deepgram live adapter with the planned nova-3/stereo settings, keepalives and local/remote mapping.
- Dockerfile, pinned direct dependencies, environment example, protocol reference and tests.

## Verified

- 14 Python tests passed, including a real local mock Deepgram WebSocket, final-result draining,
  invalid-token rejection, origin/rate limits, keepalives, frame checks and slow-provider backpressure.
- 10 extension tests passed: PCM conversion, channel alignment, absent microphone silence, partial
  flush, protocol validation, reconnect/timestamps, bounded buffering and stop completion/timeout.
- TypeScript checks, ESLint, Ruff lint/format, and extension production build passed.
- All 24 tests and the extension build were rerun successfully from the original project folder
  after application and a fresh dependency install. Starlette emits a non-failing warning about the
  test client's future migration from httpx to httpx2; current tests pass.
- npm audit reported **0 vulnerabilities**. An explicit minimatch 11.0.1 override patches the development
  linter's dependency; it is not bundled into the extension.
- Docker image built successfully; its smoke check passed for non-root startup, health, token
  issuance and HTTP 403 rejection before an invalid WebSocket upgrade. No live provider was called.
- Before applying, every original file matched the initial backup. Application preserved all P1
  source files and unrelated files; only .gitignore and .env.example were updated in place.
- Project-folder write access was granted for this turn. A write check succeeded without remounting
  the drive or changing filesystem ownership/permissions. The prepared 48 files were applied and
  checksum-verified in the original location. A private .env was created with a generated TOKEN_SECRET.

## Not yet accepted

A real browser tab + microphone + Deepgram session has not been verified. The credentials and a synthetic stereo provider check now pass. It still needs Brave microphone
permission and actual meeting-tab audio; see the latest follow-up below. The <=5-second
caption latency and <$0.10/hour cost targets are unverified. Live UI is P3; persistence and notes are P4.

## Current working location and next step

Continue project commands in `/mnt/data/workspace/meeting-notes`. The changes are now applied there.
The staging copy at `/home/dayvid/Documents/Codex/2026-11-07/meeting-notes/work/p2` and initial
`work/p1-backup` snapshot remain available for recovery, but are not the active project.

A private `.env` file exists with a generated TOKEN_SECRET. DEEPGRAM_KEY is now populated and verified by a live provider test.
Follow README's current port-8001 setup and real-audio acceptance check in Brave. Record the live observations here. Do not start P3 until P2 acceptance is verified.

If a later chat turn loses write access, request filesystem write permission specifically for
`/mnt/data/workspace/meeting-notes`. The parent `/mnt/data` may appear read-only inside the restricted
execution environment while the specifically granted project folder is writable. Do not remount the
drive or change broad permissions to solve this.


## Follow-up verification — 7 November 2026

- Reviewed the active P2 source, relay protocol, tests, and prior acceptance notes.
- All 14 Python tests passed after allowing their local mock WebSocket connection. The first
  restricted run failed to open sockets; that was an environment restriction, not an app regression.
- All 10 extension test cases passed; TypeScript, ESLint, Ruff lint/format, and the production
  extension build passed. The Starlette/httpx deprecation warning remains non-failing.
- Required credential presence was checked without printing values. TOKEN_SECRET passed local
  validation; DEEPGRAM_KEY was defined but empty. The .env file retained mode 0600. No real Deepgram
  call has been made in this follow-up session.
- The user uses Brave. Start with brave://extensions and load extension/dist/; Brave supports Chrome
  extensions, but this app's tabCapture/offscreen/sidePanel behavior still requires live verification.
  Installing Chrome is not a prerequisite to attempting that test.
- Browser automation was unavailable because local browser use is disabled in Work settings.
- A temporary 14.1-second synthetic stereo smoke check was prepared in the current chat's work folder.
  It keeps generated audio and transcript text in memory and reports counts, channel checks, timing,
  and completion only. This checks the relay/provider, not real microphone/tab capture.

P2 acceptance remains PENDING. Save the real DEEPGRAM_KEY locally, start the relay, then verify local
microphone and remote tab final events in Brave, latency near or below five seconds, and complete
on Stop. Record results here before starting P3. Never paste keys or real transcript content into logs.


## Live provider result — 7 November 2026

- The user saved DEEPGRAM_KEY privately. They reported accidentally using the same value for
  TOKEN_SECRET. Replaced TOKEN_SECRET with fresh 32-byte random data (64 hex characters), verified
  it differs from the provider key, preserved DEEPGRAM_KEY, and kept .env permissions at 0600.
  No credential values were displayed or copied to documentation.
- Port 8000 belongs to another Uvicorn service running from player-value-predictor. That service was
  left running. Meeting-notes was started at http://127.0.0.1:8001 with access logging disabled.
  The extension was rebuilt with RELAY_URL=http://127.0.0.1:8001; production build passed.
- Sent 14.1 seconds of generated stereo PCM at real-time speed through the production token endpoint,
  WebSocket relay, and Deepgram nova-3. No microphone was captured during this smoke check. Generated
  audio and transcript text stayed in process memory; only counts and timing were reported.
- Local channel: 3 interim and 1 final event; 3/3 expected-word checks matched. The final arrived
  approximately 390 ms after the generated local speech ended (342 ms after its provider end time).
- Remote channel: 4 interim and 2 final events; 3/3 expected-word checks matched. The last final arrived
  approximately 782 ms after the generated remote speech ended (351 ms after its provider end time).
- All final events arrived before Stop. Complete arrived 340 ms after end, with normal close code
  1000 and no errors. These are single-run synthetic observations, not a browser latency benchmark.

Next: reload extension/dist in Brave at brave://extensions, open a speech-playing tab, start capture,
allow the microphone if needed, and verify both local and remote final events in the side panel. After
microphone permission is first granted, return to the speech tab, stop and start capture again. Confirm
finals arrive within roughly five seconds and complete follows Stop. Browser UI/capture acceptance and
cost targets remain unverified; P2 remains PENDING and P3 has not started.


## Brave panel follow-up — 7 November 2026

- The user reported seeing `{"type":"complete"}` in Brave, confirming the browser session reached
  normal relay completion. Both local/remote final lines and browser latency are not yet confirmed.
- The user could not find Stop and had trouble navigating the transcript. The P2 panel previously
  auto-scrolled the whole document, allowing the header and controls to move out of view.
- Updated extension/static/panel.html to keep the header/controls separate from an independently
  scrollable, keyboard-focusable transcript region. Stop and Clear display now sit below the title.
- TypeScript, ESLint, all 10 extension tests, and the production build passed. Verified matching source
  and built panel markup plus the preserved port-8001 setting. Browser rendering remains to be checked
  by reloading the extension in Brave; reloading clears this P2 version's in-memory transcript history.
- P2/F3 acceptance remains pending. P3 has not started.


## Icon and microphone check — 7 November 2026

- Added the user-requested teal note/audio-waveform icon: editable SVG source plus 16/32/48/128 PNGs
  in extension/static/icons. build.mjs copies the assets and declares both manifest icons and toolbar
  default_icon. The side-panel heading uses the same mark. This is an explicitly requested visual
  addition; it does not start the remaining shipping phase or change P2 acceptance status.
- TypeScript, ESLint, all 10 extension tests, and the port-8001 production build passed. Inspected the
  icon at multiple sizes on light/dark backgrounds. Verified all manifest image paths/dimensions,
  matching source/build assets and panel reference. User must reload in Brave to see the new icon.
- User-shared panel output confirms Stop/Clear controls, remote interim transcript events, mic_denied,
  and a 1200 ms initial unsent-audio gap. No transcript text was saved to these notes.
- Microphone remains unavailable; directed user to Stop, grant access in the Allow microphone tab,
  and restart capture. Both-channel finals and observed browser latency still need confirmation.


## Microphone setup follow-up — 7 November 2026

- User-provided panel output now confirms multiple remote final events, as well as mic_denied and
  an initial 1100 ms audio gap. Local finals and capture-to-display latency remain unverified. Only
  these observations are recorded; no user transcript text is retained in the project notes.
- Added a Set up microphone link beside Stop/Clear, opening the extension's permission page in a
  normal tab. The permission page now distinguishes blocked access, no device, and device-open
  failures using known error names; raw browser/device errors are never displayed.
- Added Brave microphone-settings guidance and clearer success/restart instructions. The permission
  check still starts only after a user click and immediately stops every acquired track.
- TypeScript, ESLint, all 12 extension tests (including two microphone permission tests), and the
  port-8001 production build passed. Verified the built setup link and page, icon and relay setting.
- User must reload the extension to use the new setup link; reloading clears in-memory test history.
  Browser permission and local-channel acceptance still require live confirmation. P3 has not started.


## Both audio sources verified in Brave — 7 November 2026

- After microphone permission and a fresh capture, user-provided events confirm both audio sources:
  6 local final events and 11 remote final events, plus 28 local and 35 remote interim events.
- The supplied extract contains 81 valid events (80 transcripts and one gap), no error events, and
  audio timestamps extending to 121200 ms. The initial gap reports 1400 ms of unsent startup audio.
- No transcript text was copied into these notes. Only event counts and diagnostic observations are
  recorded. The pasted extract contains no complete event; clean Stop was observed in an earlier
  browser test, but completion for this combined-source session remains to be confirmed.
- Both-source transcription is now verified. End-to-end display latency cannot be derived from audio
  timestamps alone and still needs the user's observation. P2 acceptance remains pending only that
  latency confirmation and clean Stop for this session; P3 has not started.


## Phase 3 implemented — 7 November 2026

The user explicitly requested NEXT PHASE after both-source Brave transcription was verified. P3
proceeded on that authorization. Browser latency and clean completion of the most recent combined-
source sample remain unconfirmed; earlier browser Stop and synthetic provider completion passed.

- Replaced raw JSON with You / Others transcript rows, timestamps, interim replacement, clear draft
  and unconfirmed states, audio-gap markers, recording/connection indicators, and an elapsed timer.
- Toolbar now only opens the panel; explicit Start/New meeting and Stop buttons control capture.
  Start targets the active tab in the panel's window. Browser capture failures explain the toolbar
  permission step. Existing microphone setup and note/audio icon are preserved.
- The transcript scrolls independently from controls. User upward scroll pauses following;
  Jump to latest resumes it. A rolling-summary placeholder makes no LLM requests.
- Offscreen remains the capture/WebSocket owner. Compact in-memory transcript snapshots and increasing
  event revisions replace the 500-raw-event history, preserving completed rows across panel reopen
  and preventing snapshot/live overlap duplicates. A new meeting clears old transcript and warnings.
- Memory grows with transcript rows for the current meeting. Nothing is persisted to disk; reload,
  browser exit, or offscreen destruction can lose it. Durable storage remains P4.
- TypeScript, ESLint, 25 extension test cases and production build passed in staging. New coverage
  includes eight reducer/session cases, three background-control cases, and two offscreen lifecycle
  cases. Five-minute synthetic replay: 1200 updates -> 200 distinct final rows, preserved on snapshot.
- A temporary offline DOM check verified in-place text, safe rendering, labels, snapshot overlap,
  scroll pause/jump, Start/Stop commands, finishing, and new-session reset. It is not browser rendering.
- Browser preview access was rejected because Work settings still disable local browser use. No
  browser-control workaround was attempted. Real Brave layout and five-minute meeting acceptance
  remain PENDING. P4 has not started.

Next: reload Meeting Notes (version 0.3.0) at brave://extensions; on the meeting tab open the toolbar
icon and press Start meeting. Test for five minutes, scroll up/reopen the panel, then Stop. Check no
repeated final rows, both labels, visible controls, scroll pause and Finished status. Record actual
latency observations and acceptance here. Build remains configured for http://127.0.0.1:8001.


P3 application verification: all 19 changed source/document files were checked against the reviewed
baseline before copying into the active project. All 25 extension tests, TypeScript, ESLint, and the
production build passed again from the active project folder. Built version is 0.3.0; panel assets,
icons, unique control IDs, existing permissions, and the port-8001 relay setting were verified.
The original P1 files and private .env were preserved. The live five-minute Brave check is still pending.


## Phase 3 acceptance and Phase 4 — 7 November 2026

The user reported the P3 live UI works perfectly and explicitly requested Phase 4. P3 UI acceptance
is now user-confirmed; numerical capture latency remains unmeasured. OpenAI with API credits was
selected for notes; LLM_BASE_URL and LLM_MODEL remain OpenAI/gpt-4o-mini. Private keys were not copied.

P4 implements rolling summaries (~60s), strict final notes with decisions/actions, one malformed-output
retry, prompt data delimiting, bounded context and conservative token budget, and failure isolation.
The server uses an OpenAI-compatible HTTP client and persists no meeting data. Final transcripts drain
before note generation; notes failure still permits complete/normal Stop.

The extension saves revised transcript rows incrementally via idb/IndexedDB, along with metadata,
summary and final notes. History searches titles/transcript/notes, saved meetings reopen after database
close/reload, and Markdown copy/export includes notes and transcript. Raw audio is not stored.
A save failure is visible. Transactions are durable when committed; in-flight writes can still be lost
on a crash. Saved drafts recovered after interruption remain marked unconfirmed.

Reconnects send bounded prior final text and remaining notes budget. Context omissions/audio gaps mark
notes partial. The browser keeps the complete received transcript independent of model limits. The
model budget is a local resource guard, not a precise billing meter or multi-user quota system.

Staging checks: 26 Python tests and 31 extension test cases passed, plus Ruff, TypeScript, ESLint,
production build, and offline panel behavior checks. Server integration covers failed model calls
without transcript loss and final notes arriving before complete. Storage tests cover close/reopen,
draft replacement, multiple meetings, search, export escaping, interrupted recovery and partial notes.
12 synthetic evaluation fixtures and a live scorer are included; the mock scorer self-check passed.
No live model-quality score is claimed from the mock run. Browser preview remains unavailable; no
attempt was made to bypass the prior browser-access rejection.

P4 acceptance pending: working LLM_KEY, real model generation, and a Brave test that ends a meeting,
shows notes, reloads into History and exports Markdown. P5 has not started.


P4 applied verification: all 37 changed files were checked against the current baseline before
application. Private .env and original P1 sources were preserved. Fresh npm dependency installation,
31 extension cases, TypeScript, ESLint and build passed in the active project. All 26 server tests,
Ruff lint/format and pip dependency check passed there too. Built version 0.4.0 keeps the existing
permissions and port-8001 setting. The verified meeting-notes relay was restarted on port 8001;
player-value-predictor on port 8000 was not changed. LLM_KEY was still empty at the last check, so
real note generation remains pending a private key save and another relay restart. No real model
calls or model-quality scores have been claimed. Brave reload/History/export acceptance remains.


## OpenAI key saved; API credit pending — 7 November 2026

- Checked credential presence without displaying values. LLM_KEY, DEEPGRAM_KEY and TOKEN_SECRET are
  present and distinct; TOKEN_SECRET meets the minimum length; .env retains mode 0600.
- Verified the old relay process belonged to this project and stopped only that process. Restarted
  meeting-notes at http://127.0.0.1:8001 with the saved environment. Latest PID: 119320, exec session
  51278. Recheck process identity before any future stop; these identifiers are temporary.
- A synthetic real NotesClient request timed out. A later request received HTTP 429. Follow-up
  attempts to distinguish quota from rate limiting hit connection timeouts, so no specific provider
  error category is confirmed and no live notes result or quality score is claimed.
- The user confirmed they created the OpenAI key but have not added API credit. Next action is to add
  credit through OpenAI API billing, then retry a small synthetic notes request with the existing key.
- Network probes also observed intermittent provider connectivity: OpenAI name resolution succeeded
  once, while Deepgram name resolution timed out. Relay logs showed temporary name-resolution failures.
  Restore/verify provider connectivity before treating the next browser test as an app regression.
- Prepared work/live-check/notes-smoke.py in the current chat workspace to validate both final audio
  channels, final notes before complete, and normal closure. It has not run: automatic approval review
  timed out on both the initial attempt and the permitted retry. Browser automation remains unavailable.
- No application code or credentials changed in this follow-up. Prior 26 Python / 31 extension test
  results still describe the implementation; they are not live-provider acceptance. Real summaries,
  the 12-fixture live evaluation and Brave Notes/History/export acceptance remain pending. P5 not started.


## Free summaries required — 7 November 2026

The user clarified that they do not intend to buy credits and originally wanted a free tool. This
supersedes the earlier OpenAI selection and the instruction above to add credits. Do not resume paid
OpenAI calls or ask for billing.

- This machine has approximately 7.5 GiB RAM, 1.3 GiB available at inspection, 4 CPU threads, no visible
  GPU device and no installed Ollama/llama-server. Local summaries would compete with the browser for
  limited memory, so Gemini's free API tier is the selected setup path.
- Google's official pricing and compatibility documentation fetched earlier in this task lists
  gemini-2.5-flash-lite free-tier text input/output and the OpenAI-compatible endpoint. Fresh fetches
  failed because of network errors; model/account availability still needs a live check. Quotas apply
  and Google may use free-tier content to improve products. Use synthetic meeting data for testing.
- Updated default model/endpoint, .env.example and README for Gemini. The private .env no longer uses
  the OpenAI summary credential and awaits a Gemini key. Deepgram and token-secret settings remain.
  No paid fallback exists. Deepgram transcription still has separate service costs.
- A temporary setup helper in the current chat outputs folder opens Google AI Studio and privately
  writes only LLM_KEY/LLM_BASE_URL/LLM_MODEL. It instructs the user to use a Free-tier project without
  enabling billing. Shell syntax and the unchanged helper library were checked; the interactive flow
  was not run by the agent.
- Next: user creates the Gemini key and saves it locally, then verify private configuration, restart
  the verified project relay on port 8001, test a small synthetic notes request and resume the audio
  and Brave Notes/History/export checks. P4 live model acceptance remains pending; P5 not started.

Free-provider application verification: all five public files matched their reviewed baseline before
application and the staged result after application. Private settings now use the Gemini endpoint and
model with an empty LLM_KEY; unrelated values were compared privately and preserved, mode 0600. The
10 summarizer tests, Ruff lint and formatting passed from the active project. No port-8001 Uvicorn
process was found at the final check; start the relay after the Gemini key is saved. No Gemini request
has been made, and no live model result is claimed.


## Gemini live summaries verified — 7 November 2026

- LLM_KEY is now populated and accepted by Gemini. Keys were never displayed. Presence, separation
  from the Deepgram/token credentials, expected provider URL and mode 0600 were checked privately.
  Do not reject the user's working credential based on an assumed AIza prefix; the temporary setup
  helper now checks only empty/whitespace input and relies on live provider verification.
- The models endpoint listed gemini-2.5-flash-lite, but generation returned HTTP 404 with Google's
  explicit message that this model is no longer available to new users. Google recommended
  gemini-3.5-flash-lite. The previously fetched official pricing lists its standard text input/output
  as Free of charge on the Free tier. Model listing alone does not prove generation access.
- Tested the replacement through the existing NotesClient, preserving the compatible endpoint and
  JSON validation. HTTP 200 in 2.30 seconds; the synthetic launch decision and both named actions with
  due dates matched. Updated LLM_MODEL in private .env and public defaults/docs/helper to the verified
  model; all other private values were compared and preserved. No new key or paid fallback is needed.
- Ten summarizer tests plus Ruff lint/format passed from the active project after the change.
- Restricted process inspection missed the old relay; elevated port-owner inspection found PID
  119320, verified its meeting-notes cwd/entrypoint, and stopped only it. The new relay is running on
  http://127.0.0.1:8001, PID 139941, exec session 21658. These IDs are temporary: verify the port owner
  and project identity before future restarts. The unrelated port-8000 service was not touched.
- First synthetic stereo session stopped at 66 seconds: both transcript channels and final notes
  passed, but the rolling summary had not arrived, so its combined check failed. Repeated with a
  90-second session and timing diagnostics. This complete run passed with no errors/unavailable status:
  one rolling summary arrived at 66.63 seconds, final notes preceded complete, and close code was 1000.
  Stop-to-complete took 1847 ms. The generated report action appeared in final notes.
- Audio fixture: 14.1 seconds of in-memory synthetic speech with silence padded to 90 seconds, streamed
  at real time. Local: 3 interims, 1 final, 3/3 expected words, last-final lag 395 ms after provider end.
  Remote: 4 interims, 2 finals, 3/3 expected words, last-final lag 406 ms. These are single synthetic
  observations, not browser latency measurements. No raw audio or transcript content was saved/logged.
- The 12-fixture live model evaluation has not run; no aggregate recall score is claimed. Prior mock
  and storage checks remain valid. To avoid consuming more free quota after targeted checks passed,
  continue with user acceptance: reload extension 0.4.0 in Brave, title/start a meeting, state an action
  and decision, wait at least 75 seconds for a rolling summary, Stop and inspect Notes. Wait for Saved
  on this browser, reload, find the meeting in History and export Markdown. Browser automation remains
  unavailable under the existing Work setting; no bypass was attempted. P5 has not started.


## Close button and microphone setup — 8 November 2026

The user reported no visible close button and confirmed microphone setup opens another tab, causing
them to lose their place. This is an explicit usability fix within the current implementation; it
does not start all of P5 or mark P4 browser acceptance complete.

- Added a persistent top-right Close control. While a meeting is active it reads Stop & close, stops
  capture, waits for final notes/completion and committed local saves, then requests panel close.
  Failed storage keeps the panel open with an export instruction. Start stays disabled while closing.
- Use sidePanel.close with the global panel's window ID on Chromium 141+. Older browsers fall back
  to disabling and re-enabling the panel, which can hide panels in other windows too; availability is
  restored for the next toolbar click. Browser source: developer.chrome.com/docs/extensions/reference/api/sidePanel.
- Replaced the microphone link and automatic failure tab with an explicit Enable microphone button.
  It opens a small same-browser popup preserving the captured tab/window, reuses that popup when
  already open, and returns focus to the original tab after Allow. The browser permission prompt
  remains required. No new permissions, external browser or per-meeting restart are introduced.
- Permission success asks the offscreen capture owner to attach the microphone to input 0 of the
  existing worklet. Remote tab audio stays on input 1 and the current transcript/notes session remains.
  The request carries a session ID to reject stale setup; concurrent acquisition is deduplicated.
  Late microphone streams after Stop are released, and device disconnect makes Enable microphone
  available again. Successful attachment clears only microphone warnings.
- Initial microphone acquisition now runs independently of capture startup, so an unanswered request
  cannot block Stop. A missing/denied microphone leaves tab transcription running and never opens
  an unsolicited tab. The setup page retains sanitized blocked/missing/busy device guidance.
- Version 0.4.1. TypeScript, ESLint, all 9 extension test files (38 cases) and the port-8001 production
  build passed in staging. New checks cover popup tab retention/reuse, existing-session attachment,
  stale setup, Stop during initial/recovery acquisition, permission return and close API fallback.
  An offline DOM check verifies visible Close, Stop & close waits for storage, saving failures stay
  open and notes remain safely rendered. This does not prove native Brave popup/close rendering.
- Real Brave acceptance remains: Stop any current meeting and wait for Saved on this browser, reload
  extension 0.4.1 at brave://extensions, reopen it and check Close. Start a meeting and, if needed,
  Enable microphone -> Allow; confirm return to the same tab and You lines without a restart.
  Stop & close should close after saving; reopen History and verify notes/export. No browser-control
  workaround was attempted. Server behavior and private keys were not changed.

Application verification for 0.4.1: all 14 extension files and 3 documentation files were applied
after baseline checks. From the active project, all 38 tests, TypeScript, ESLint and production build
passed. Verified built controls/assets, manifest version 0.4.1, unchanged permissions and port 8001.
The user must reload the installed extension to see the new controls; actual Brave confirmation is
still pending. No relay restart, credential change or saved-meeting deletion was performed.


## Later microphone dropouts and stopped relay — 8 November 2026

The user reported the microphone-disconnected message after granting access and reduced note-taking.
They clarified that the dropout occurs later in the meeting, not as the permission window closes.

- Elevated health/port inspection confirmed no listener on 8001 and connection refused. Restarted
  the existing relay command with private .env on 8001: PID 154193, exec session 79549. Re-verify
  ownership before future signaling. The server must remain running; no persistent service was installed.
- A 14.1-second synthetic stereo test through Deepgram and Gemini passed after restart: both channels
  finalized (local 1, remote 2), 3/3 expected-word matches each, validated final notes with report action,
  notes before complete, no errors, normal close 1000. Stop drain was 7469 ms; provider final lag was
  316/337 ms. All audio/text remained in memory. This verifies the relay, not real browser microphone.
- The OS audio service currently reports two input sources, neither muted (one RUNNING, one SUSPENDED).
  No audio was recorded for this check. This snapshot does not establish why Brave ended the track.
- Reproduced the app's handling failure by driving a later real track-ended handler in the offscreen
  test harness: the 0.4.1 code stayed unavailable and never reacquired. Underlying device/Brave cause
  remains unconfirmed; no claim is made that it was a hardware or popup-close fault.
- Added bounded automatic reacquisition after an already-connected microphone ends: delays 500/1000/
  3000 ms, same session/client/worklet, no setup popup or stream restart. Repeated immediate dropouts
  consume the same three-attempt budget; 30 seconds of stable capture resets it. Permission-denied
  failure halts automatic retries, and blocked/missing/busy/other failures get sanitized instructions.
- The owner retains the microphone source node, releases ended streams and marks the interruption as
  a transcript gap so final notes are marked partial. Stop clears recovery timers and late streams
  are stopped before they can connect. Successful recovery clears only microphone warnings.
- Panel shows Reconnecting mic while recovery is in progress. Network reconnection separately shows
  Connection lost and explains that new words/notes are paused. README now gives this machine's
  actual port-8001 launch command and explains the need for a running local relay.
- Version 0.4.2. Staging TypeScript, ESLint, all 42 tests in 9 files and production build passed.
  Added deterministic tests for later dropout recovery, bounded failure/permission handling, Stop
  during scheduled and in-flight recovery, repeated quick dropouts and stable-budget reset. Offline
  panel checks passed for microphone/connection messages and existing save-before-close behavior.
- Native Brave access remains unavailable; no workaround attempted. The user must Stop/save, reload
  extension 0.4.2 and verify later microphone stability and final notes. Existing meetings and all keys
  are preserved. P4 Brave persistence/export acceptance and the rest of P5 remain pending.

0.4.2 application verification: seven changed extension files and three documentation files matched
the reviewed baseline before application. All 42 extension tests, TypeScript, ESLint and the
port-8001 production build passed from the active project. Built version/recovery strings, existing
permissions and relay address were verified. Private .env and saved browser data were not edited.


## User confirms recovery — 8 November 2026

After reloading the 0.4.2 microphone-recovery update and restarting the relay, the user reported
"WORKING NOW". The reported microphone/note-taking regression is user-confirmed resolved. This does
not establish the original device/Brave dropout cause or measured browser latency. Notes persistence
after reload and Markdown export were not separately confirmed by this response; retain those P4
acceptance caveats. No new phase was requested.


## Persistent relay startup — 8 November 2026

The user later saw “Cannot reach the transcription service. Reconnecting automatically; new words
and notes are paused.” The exact port-8001 health check returned connection refused, and no relay
process was running. The extension's reconnect behavior was correct; its local relay had disappeared
because earlier launches were attached to temporary execution sessions.

- Installed and enabled `~/.config/systemd/user/meeting-notes.service` for the existing local relay.
  It runs the project virtual environment from `server/`, reads the private `.env` without exposing
  values, binds only to `127.0.0.1:8001`, starts with the user session and uses `Restart=on-failure`
  with a three-second delay. Port 8000 and its unrelated process were not touched.
- Verified the service was active and enabled. The health endpoint returned `{"status":"ok"}` both
  before and after a controlled `systemctl --user restart`, proving the configured command returns
  cleanly under the service manager.
- Do not run the README's manual Uvicorn command at the same time as this service. Use
  `systemctl --user status meeting-notes.service` to inspect it and
  `systemctl --user restart meeting-notes.service` if a manual restart is needed.
- This fixes local relay availability, not external provider outages. Deepgram or Gemini network and
  quota errors can still interrupt their respective features and should show a different error.


## Phase 5 hardening implementation — 9 November 2026

The user explicitly requested the next development stage. Phase 5 was implemented as version 0.5.0.

- First use is blocked by a clear recording/data notice until acknowledged. It says audio goes to
  Deepgram, finalized transcript goes to the configured notes model, meetings stay in browser storage,
  raw audio is not saved, and participants must be told and consent. A reminder returns every 30 days.
- The offscreen capture owner detects long timer/visibility pauses consistent with computer sleep or
  browser suspension, marks an audio gap and immediately obtains a fresh relay connection. Existing
  tab/microphone capture and meeting state stay owned by the same offscreen document.
- Added deterministic coverage for relay reconnect, sleep/wake, service-worker restart with a missing
  offscreen document, Stop during recovery, and existing bounded microphone recovery.
- Token rejection/expiry, local relay unavailable, microphone denied/unavailable, captured tab closure,
  provider failure and protocol failure now have distinct sanitized states. Temporary relay/token
  warnings clear after a successful reconnect. Closing the captured tab stops and saves the meeting.
- Relay session logs are structured JSON produced from an explicit metric allowlist. They contain only
  a random session ID, outcome/code, duration and counts; no transcript/audio, credentials, provider
  errors or meeting title are accepted by the logger.
- Added `python -m benchmarks.report` to calculate capture-to-caption p50/p95 and observed cost per audio
  hour from supplied measurements, with honest comparisons to <=5 seconds and <$0.10/hour. Automated
  tests prove the calculations. No price was hard-coded and no billing API was called.
- Real Brave consent rendering and measured capture-to-caption p50/p95 are pending. Cost/hour also
  remains pending until the provider account supplies real billed usage for a timed test. Prior synthetic
  timings are not relabeled as browser measurements, so neither target is claimed passed.


## Phase 5 acceptance and Phase 6 ship preparation — 9 November 2026

The user reported the Phase 5 Brave tests done and confirmed, then explicitly requested the next phase.
Phase 5 user acceptance is recorded. Phase 6 ship-prep was implemented as extension version 0.6.0.

- Production settings require exactly one `chrome-extension://<id>` origin. Token requests and
  WebSocket upgrades reject missing/wrong origins in production. Tokens remain HMAC-signed, nonced,
  rate-limited and configurable only from 1–60 seconds. Development keeps unpacked-extension support.
- Added Fly.io service/health configuration and GitHub Actions for Ruff, Python tests, TypeScript,
  ESLint, extension tests/build/package, Docker build and optional main-branch Fly deployment.
- Added store listing, permissions justification, privacy policy, environment reference and architecture
  documents, plus a deterministic ZIP packager for the built extension.
- No Fly app was created and nothing was submitted to a store. Remaining publisher-owned inputs are a
  unique Fly app/public relay URL, published extension ID, support email/URL, hosted privacy-policy URL,
  store screenshots, Fly API token and GitHub repository secret configuration.
- Origin checks restrict normal browser callers but are not per-user authentication. A publisher-funded
  public relay still needs accounts/quotas or another abuse-control layer before broad distribution.
