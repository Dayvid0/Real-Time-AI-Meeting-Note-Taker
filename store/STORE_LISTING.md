# Chrome Web Store listing — draft

Copy/paste the fields below into the Chrome Web Store developer dashboard.

## Basic info

| Field | Value |
| --- | --- |
| **Name** | Meeting Notes AI |
| **Version** | 1.0.0 |
| **Category** | Productivity |
| **Language** | English (United States) |
| **Homepage URL** | https://example.com/meeting-notes-ai |
| **Support URL** | https://example.com/meeting-notes-ai/support |
| **Privacy policy URL** | `https://example.com/meeting-notes-ai/privacy` _(placeholder — replace before publishing)_ |

## Short description (max 132 characters)

> Transcribe meetings in real time and get AI summaries, decisions and action
> items — right in your browser.

_(117 characters.)_

## Detailed description

> **Meeting Notes AI** turns any browser meeting into clean, structured notes.
>
> Start capture from the toolbar and the side panel shows a live transcript as
> people speak. While the meeting runs, an AI assistant keeps a rolling summary
> up to date. When you finish, you get final notes with a summary, the
> decisions that were made, and a checklist of action items with owners.
>
> **Highlights**
> - Live, speaker-tagged transcript in a side panel that stays out of your way.
> - Rolling summaries so you can catch up mid-meeting.
> - Final notes with decisions and action items.
> - Works with any tab audio — video calls, webinars and recorded meetings.
>
> **How it works**
> Audio is captured from the active tab and your microphone, converted to
> PCM16 in the browser, and streamed over a secure WebSocket to the Meeting
> Notes backend. The backend transcribes the audio with Deepgram and generates
> summaries with an LLM. Transcript text is treated as untrusted input and is
> never written to server logs.
>
> **Privacy**
> Audio is processed only to produce your transcript and notes. See the privacy
> policy for retention details.

## Permission justifications

| Permission | Justification |
| --- | --- |
| `storage` | Persists the backend URL, consent acknowledgement and session status. |
| `tabCapture` | Captures the audio of the active tab for transcription. |
| `offscreen` | Runs the audio-capture document needed by MV3 for tab/mic capture. |
| `sidePanel` | Hosts the live transcript and notes UI. |

## Data usage disclosures

- **Personally identifiable information:** No.
- **Health information:** No.
- **Financial information:** No.
- **Authentication information:** No.
- **Personal communications:** Yes — meeting audio/transcript is processed to
  provide the feature.
- **Location:** No.
- **Web history:** No.
- **User activity:** No.
- **Website content:** No.

Data is transferred over HTTPS/WSS and is not sold. See the privacy policy for
retention/deletion.

## Assets

- Icons: `store/icons/icon{16,32,48,128}.png` (source: `store/icon.svg`).
- Screenshots: see `store/SCREENSHOTS.md`.
