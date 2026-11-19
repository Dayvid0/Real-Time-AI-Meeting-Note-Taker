# Streaming and notes protocol

1. `POST /v1/token` returns `{token, expiresIn: 60}` with `Cache-Control: no-store`.
   Tokens are rate-limited per client IP. Production rejects missing or non-matching Origin headers
   and requires exactly one configured `chrome-extension://<id>` origin.
2. Connect `/v1/session` using WebSocket protocols `meeting-notes.v1` and `auth.<token>`. The server
   validates HMAC signature, issue time, expiry and origin **before** accepting the upgrade. It
   selects `meeting-notes.v1`. Use WSS outside localhost. Tokens contain no transcript data.
3. Client sends `{"type":"start","sampleRate":16000,"channels":2,"meetingTitle":"optional"}`.
   Only the declared fields are allowed; title length is limited to 200. `channels` defaults to 2.
4. Server opens Deepgram and sends `{"type":"ready","sampleRate":16000,"channels":2}`.
5. After ready, client sends binary PCM16 LE: channel 0 local microphone, channel 1 remote tab;
   4–6400 bytes per frame, always a multiple of 4. No WAV header. The usual frame is 100 ms.
6. Server sends transcript objects:

   ```json
   {"type":"transcript","seq":1,"speaker":"local","text":"Example","startMs":0,"endMs":400,"final":false}
   ```

   `seq` increases per relay connection and includes interim events. The extension rewrites it to a
   meeting-wide increasing sequence and offsets timestamps by captured sample time on reconnect.
   An interim line is not yet final. The P3 panel replaces revisions in place per speaker/segment start;
   reconnect gaps separate generations and unfinished segments remain explicitly unconfirmed.
7. Client sends `{"type":"end"}` after its last binary frame. The relay drains audio, sends Deepgram
   `CloseStream`, forwards the last final results, generates notes (or notes-unavailable), emits
   `{"type":"complete"}`, and closes normally. Final notes may take up to 30 additional seconds.

Unknown controls, extra fields, invalid sample rates, repeated start, and malformed binary frames
are rejected. Control messages are capped at 32768 bytes; start must arrive within 10 seconds. An
application queue of ten frames bounds pending audio, with a one-second enqueue timeout.

Failures use `{"type":"error","code":"...","message":"..."}` and a connection close.
Codes include `invalid_message`, `asr_unavailable`, and `session_failed`. Public messages never echo
provider responses or transcript content. The extension also reports connection states and gap events.
Deepgram uses `nova-3`, linear16/16 kHz/stereo, multichannel, diarization, interim results,
smart formatting and 300 ms endpointing. Idle streams get keepalive messages every five seconds.

P4 adds optional start fields: notesContext (up to 300 {speaker,text} rows, per-row text <=8000),
notesPartial (boolean), and notesBudget (0–1000000). The extension sends at most 20 KB of prior final
text and flags truncation. Provider transcript sequence numbering remains unchanged.

Additional server messages:
- summary {kind:"rolling", content, atMs, partial}
- notes {kind:"final", summary, decisions[], actionItems[{owner,task,due?}], partial}
- summary_status {kind:"rolling"|"final", status:"unavailable", reason}
- notes_budget {remaining}: emitted before model attempts and after updates, carried across reconnects.

Reason codes: not_configured, budget_exhausted, invalid_response, provider_failed, timeout. These
messages do not interrupt transcription. Notes JSON is strictly validated; only malformed output is
retried once. The client renders model output as text, not HTML.


## P3 extension view messages

The relay protocol is unchanged. The offscreen document reduces client events into a compact current-
meeting snapshot and broadcasts `{target:"panel", revision, event}`. Revisions increase across meetings
within that document. Panel startup subscribes first, requests `{target:"offscreen", type:"snapshot"}`,
then applies only queued revisions newer than the returned snapshot. This avoids duplicate rows/gaps.

Local view events additionally include session-start (id/time), session-stop (end time), and microphone
availability. Only the offscreen owner captures audio or holds the WebSocket. The panel requests Start
with the active tab id or Stop through the background worker. The toolbar opens the panel and grants
activeTab; it does not toggle capture. A new meeting resets transcript state and old warnings.

P4 stores meeting/transcript/summary/notes records in IndexedDB after each view event. Storage status
is local-only. Transcript rows use meetingId+row id keys and a meetingId+sequence index. New meetings
reset the live view, while older records remain searchable in History. No raw audio is saved.

## Production security boundary

`APP_ENV=production` fails startup unless `ALLOWED_ORIGINS` contains one exact Chrome-extension
origin. The HTTP token endpoint and WebSocket upgrade both require that Origin. Tokens expire within
60 seconds, carry a random nonce and are signed with HMAC-SHA256; authentication data travels in the
WebSocket subprotocol rather than the URL. Production relays must use HTTPS/WSS.

Browser Origin enforcement prevents ordinary websites and other extensions from using the relay, but
it is not user authentication and does not create per-user provider quotas. Add accounts or another
abuse-control boundary before offering a public relay whose provider costs are paid by the publisher.
