# Environment variable reference

| Variable | Required | Purpose |
| --- | --- | --- |
| `APP_ENV` | Production | `development`, `test` or `production`. Production fails startup unless one exact extension origin is configured. |
| `DEEPGRAM_KEY` | Yes | Server-only Deepgram credential for live transcription. |
| `LLM_KEY` | No | Server-only notes-model key. Empty disables summaries and final AI notes without stopping transcription. |
| `LLM_BASE_URL` | No | OpenAI-compatible notes endpoint. HTTPS is required except localhost. |
| `LLM_MODEL` | No | Model identifier; current free-tier setup uses `gemini-3.5-flash-lite`. |
| `LLM_TOKEN_BUDGET` | No | Conservative per-meeting usage guard, default `120000`; not a billing meter. |
| `TOKEN_SECRET` | Yes | At least 32 random bytes used to sign short-lived relay tokens. |
| `TOKEN_TTL` | No | Connection-token lifetime in seconds, 1–60; default `60`. |
| `TOKEN_RATE_LIMIT` | No | Token requests per client IP per minute, 1–60; default `10`. |
| `ALLOWED_ORIGINS` | Production | One exact `chrome-extension://<32-character-id>` origin in production. Development may leave it empty for local unpacked builds. |
| `RELAY_URL` | Extension build | Relay origin embedded at build time. Remote relays require HTTPS. |

Never commit `.env`, provider keys or `TOKEN_SECRET`. Fly secrets should hold private values; ordinary
deployment configuration may hold non-secret model/origin settings.
