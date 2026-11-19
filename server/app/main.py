import os
import re
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse

from app.auth.token import TokenLimiter, issue_token, validate_token
from app.config import Settings
from app.ws.session import relay_session

EXTENSION_ORIGIN = r"chrome-extension://[a-p]{32}"
PROTOCOL = "meeting-notes.v1"


def create_app(settings: Settings | None = None) -> FastAPI:
    configured_origins = (
        list(settings.allowed_origins)
        if settings
        else [
            value.strip()
            for value in os.environ.get("ALLOWED_ORIGINS", "").split(",")
            if value.strip()
        ]
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.settings = settings or Settings.from_env()
        app.state.limiter = TokenLimiter(app.state.settings.token_rate_limit)
        yield

    app = FastAPI(title="Meeting Notes relay", lifespan=lifespan)

    # Local P2 accepts Chrome extension origins; deployments should set ALLOWED_ORIGINS.
    @app.middleware("http")
    async def origin_check(request: Request, call_next):
        origin = request.headers.get("origin")
        config = request.app.state.settings
        if (config.environment == "production" and not origin) or (
            origin and not allowed_origin(origin, config)
        ):
            return JSONResponse({"detail": "Origin not allowed"}, status_code=403)
        return await call_next(request)

    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=None if configured_origins else EXTENSION_ORIGIN,
        allow_origins=configured_origins,
        allow_methods=["POST", "GET"],
        allow_headers=["Content-Type"],
    )

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.post("/v1/token")
    async def token(request: Request):
        config = request.app.state.settings
        ip = request.client.host if request.client else "unknown"
        if not request.app.state.limiter.allow(ip):
            raise HTTPException(429, "Too many token requests", headers={"Retry-After": "60"})
        return JSONResponse(
            {
                "token": issue_token(config.token_secret, config.token_ttl),
                "expiresIn": config.token_ttl,
            },
            headers={"Cache-Control": "no-store"},
        )

    @app.websocket("/v1/session")
    async def session(ws: WebSocket):
        config = ws.app.state.settings
        protocols = ws.scope.get("subprotocols", [])
        tokens = [p[5:] for p in protocols if p.startswith("auth.")]
        origin = ws.headers.get("origin")
        if (
            PROTOCOL not in protocols
            or len(tokens) != 1
            or not validate_token(tokens[0], config.token_secret, config.token_ttl)
            or (config.environment == "production" and not origin)
            or (origin and not allowed_origin(origin, config))
        ):
            # Before accept(): Starlette rejects the HTTP upgrade with 403.
            await ws.close(code=1008)
            return
        await ws.accept(subprotocol=PROTOCOL)
        await relay_session(ws, config)

    return app


def allowed_origin(origin: str, settings: Settings) -> bool:
    if settings.allowed_origins:
        return origin in settings.allowed_origins
    return re.fullmatch(EXTENSION_ORIGIN, origin) is not None


app = create_app()
