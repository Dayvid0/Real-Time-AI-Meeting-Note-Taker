# Meeting Notes: real-time AI note-taker (Chrome extension)

Captures meeting audio live from the browser tab (no bot joins the call), streams it to a small
FastAPI relay -> Deepgram (live transcript) and an LLM (rolling + final notes).

## Layout
- extension/: Chrome MV3 extension (P1 audio capture is done)
- server/: FastAPI relay (starts in P2)
- docs/PROMPTS.md: per-phase prompts for the coding agent
- AGENTS.md: project rules and status for the coding agent

## Run P1
chrome://extensions -> Developer mode -> Load unpacked -> select extension/.
Click the icon on a tab playing audio, speak, press Stop in the side panel, download the WAVs.

## Secrets
Copy .env.example to .env. Never commit .env.
