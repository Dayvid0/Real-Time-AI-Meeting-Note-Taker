import os
import re
from dataclasses import dataclass
from urllib.parse import urlsplit

EXTENSION_ORIGIN = re.compile(r"chrome-extension://[a-p]{32}")


@dataclass(frozen=True)
class Settings:
    token_secret: str
    deepgram_key: str
    environment: str = "development"
    deepgram_url: str = "wss://api.deepgram.com/v1/listen"
    allowed_origins: tuple[str, ...] = ()
    llm_key: str = ""
    llm_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai"
    llm_model: str = "gemini-3.5-flash-lite"
    llm_timeout_seconds: float = 12.0
    llm_token_budget: int = 120000
    summary_interval_seconds: float = 60.0
    token_ttl: int = 60
    token_rate_limit: int = 10
    audio_queue_frames: int = 10
    keepalive_seconds: float = 5.0
    provider_timeout_seconds: float = 10.0

    def __post_init__(self):
        url = urlsplit(self.llm_base_url)
        if (
            url.scheme not in ("http", "https")
            or not url.hostname
            or url.username
            or url.password
            or url.query
            or url.fragment
            or (url.scheme == "http" and url.hostname not in ("127.0.0.1", "localhost", "::1"))
        ):
            raise ValueError("LLM_BASE_URL requires HTTPS (HTTP allowed only on localhost)")
        if not 10000 <= self.llm_token_budget <= 1000000:
            raise ValueError("LLM_TOKEN_BUDGET must be between 10000 and 1000000")
        if len(self.token_secret.encode()) < 32:
            raise ValueError("TOKEN_SECRET must contain at least 32 bytes")
        if not self.deepgram_key:
            raise ValueError("DEEPGRAM_KEY is required")
        if self.environment not in ("development", "production", "test"):
            raise ValueError("APP_ENV must be development, production or test")
        if not 1 <= self.token_ttl <= 60:
            raise ValueError("TOKEN_TTL must be between 1 and 60 seconds")
        if not 1 <= self.token_rate_limit <= 60:
            raise ValueError("TOKEN_RATE_LIMIT must be between 1 and 60 per minute")
        if self.environment == "production" and (
            len(self.allowed_origins) != 1
            or EXTENSION_ORIGIN.fullmatch(self.allowed_origins[0]) is None
        ):
            raise ValueError("Production requires one exact chrome-extension origin")

    @classmethod
    def from_env(cls):
        return cls(
            environment=os.environ.get("APP_ENV", "development"),
            llm_key=os.environ.get("LLM_KEY", ""),
            llm_base_url=os.environ.get("LLM_BASE_URL")
            or "https://generativelanguage.googleapis.com/v1beta/openai",
            llm_model=os.environ.get("LLM_MODEL") or "gemini-3.5-flash-lite",
            llm_token_budget=int(os.environ.get("LLM_TOKEN_BUDGET", "120000")),
            token_secret=os.environ.get("TOKEN_SECRET", ""),
            deepgram_key=os.environ.get("DEEPGRAM_KEY", ""),
            token_ttl=int(os.environ.get("TOKEN_TTL", "60")),
            token_rate_limit=int(os.environ.get("TOKEN_RATE_LIMIT", "10")),
            allowed_origins=tuple(
                value.strip()
                for value in os.environ.get("ALLOWED_ORIGINS", "").split(",")
                if value.strip()
            ),
        )
