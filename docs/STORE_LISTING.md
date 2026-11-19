# Chrome Web Store listing draft

## Name

Meeting Notes

The final name must be checked for Chrome Web Store availability and trademark conflicts before submission.

## Short description

Live meeting transcription, summaries and action items from your tab and microphone—without a meeting bot.

## Detailed description

Stay in the conversation while Meeting Notes captures audio from the meeting tab and your microphone,
shows a live You/Others transcript, and creates summaries, decisions and action items.

Key features:

- No bot joins the meeting.
- Live transcript with separate You and Others labels.
- Rolling summaries and final meeting notes.
- Automatic reconnection with visible audio-gap markers.
- Searchable meeting history stored in your browser.
- Copy or export notes as Markdown.
- Clear first-use recording notice and periodic consent reminder.

Meeting Notes sends live audio to Deepgram for transcription. Finalized transcript text goes to the
configured notes model. Raw audio is not saved by the extension or relay. Tell participants that
transcription is active and obtain any consent required for your meeting.

## Category

Productivity

## Permissions justification

- `tabCapture`: captures audio only from the tab the user explicitly starts.
- `activeTab`: identifies the user-selected meeting tab after a toolbar interaction.
- `offscreen`: keeps the browser audio pipeline and live connection running while the side panel closes.
- `sidePanel`: displays the transcript, notes and saved meeting history.
- Relay host access: requests short-lived connection permission and streams audio to the configured relay.

The extension does not request browsing history, cookies, all-sites access, camera, downloads or identity.

## Store assets still required

- At least one 1280×800 or 640×400 screenshot of the live transcript.
- A screenshot of final Notes and History/export.
- Optional 440×280 promotional tile.
- Public privacy-policy HTTPS URL.
- Publisher support email and support URL.
