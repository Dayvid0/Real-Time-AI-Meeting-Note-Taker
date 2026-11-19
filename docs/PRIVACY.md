# Meeting Notes privacy policy

Effective date: 9 November 2026

Meeting Notes transcribes meeting audio and creates meeting notes at the user's request. The user must
tell participants that transcription is active, obtain any consent required by law or policy, and use
the extension only for meetings they are permitted to record or transcribe.

## Data processed

- Live microphone audio and audio from the selected browser tab are sent through the configured Meeting
  Notes relay to Deepgram for transcription.
- Finalized transcript text is sent through the relay to the configured notes model provider to create
  summaries, decisions and action items.
- Meeting titles, transcripts, summaries and final notes are saved locally in the extension's browser
  storage so History and Markdown export work.
- Operational logs contain random session identifiers, durations, outcomes and event counts only. They
  do not contain audio, transcript text, meeting titles, credentials or upstream provider responses.

## Retention and deletion

Meeting Notes does not save raw audio. The relay keeps active audio and summary context in memory only
and does not persist meeting content. Deepgram and the configured model provider process data under
their own terms and retention policies. Meetings stored by the extension remain in the user's browser
profile until browser data or the extension is removed. Exported Markdown files remain wherever the
user saves them.

To delete locally stored meetings, remove the Meeting Notes extension or clear its site/extension data
in the browser. Removing browser data cannot delete copies already exported or retained by third-party
providers under their policies.

## Sharing and sale

Meeting Notes does not sell personal information. Meeting content is shared only with the configured
relay, Deepgram and the configured notes model as necessary to provide transcription and notes.

## Security

Provider keys stay on the relay and are never placed in the extension. The extension uses short-lived
signed connection tokens. Production relays accept token and WebSocket requests only from the exact
configured extension origin. No internet transmission or storage system can be guaranteed perfectly
secure.

## Children and sensitive meetings

Meeting Notes is not designed for children. Users should not process highly sensitive, regulated or
confidential meetings unless their organization has approved the configured providers and deployment.

## Changes and contact

Material policy changes should update the effective date and extension/store disclosures. Before public
distribution, the publisher must add a monitored privacy-contact email and host this policy at a stable
public HTTPS URL.
