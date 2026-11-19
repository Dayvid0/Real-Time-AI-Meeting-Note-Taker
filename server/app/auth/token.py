import base64
import hashlib
import hmac
import json
import secrets
import time
from collections import OrderedDict


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def issue_token(secret: str, ttl: int = 60, *, now: int | None = None) -> str:
    issued = int(time.time()) if now is None else now
    payload = _encode(
        json.dumps(
            {"iat": issued, "exp": issued + ttl, "nonce": secrets.token_hex(16)},
            separators=(",", ":"),
        ).encode()
    )
    signature = _encode(hmac.digest(secret.encode(), payload.encode(), hashlib.sha256))
    return f"{payload}.{signature}"


def validate_token(token: str, secret: str, ttl: int = 60, *, now: int | None = None) -> bool:
    if not isinstance(token, str) or len(token) > 512:
        return False
    try:
        payload, signature = token.split(".")
        expected = _encode(hmac.digest(secret.encode(), payload.encode("ascii"), hashlib.sha256))
        if not hmac.compare_digest(expected, signature):
            return False
        data = json.loads(
            base64.b64decode(payload + "=" * (-len(payload) % 4), altchars=b"-_", validate=True)
        )
        current = int(time.time()) if now is None else now
        return (
            isinstance(data, dict)
            and set(data) == {"iat", "exp", "nonce"}
            and type(data["iat"]) is int
            and type(data["exp"]) is int
            and isinstance(data["nonce"], str)
            and len(data["nonce"]) == 32
            and data["iat"] <= current < data["exp"]
            and 0 < data["exp"] - data["iat"] <= ttl
        )
    except (ValueError, TypeError, UnicodeError):
        return False


class TokenLimiter:
    """Bounded sliding-window IP limiter for one relay process."""

    def __init__(self, limit: int, window: float = 60, max_clients: int = 10_000):
        self.limit = limit
        self.window = window
        self.max_clients = max_clients
        self.clients: OrderedDict[str, list[float]] = OrderedDict()

    def allow(self, ip: str, *, now: float | None = None) -> bool:
        current = time.monotonic() if now is None else now
        cutoff = current - self.window
        while self.clients and next(iter(self.clients.values()))[-1] <= cutoff:
            self.clients.popitem(last=False)
        history = [at for at in self.clients.get(ip, []) if at > cutoff]
        if len(history) >= self.limit:
            return False
        if ip not in self.clients and len(self.clients) >= self.max_clients:
            return False
        self.clients[ip] = history + [current]
        self.clients.move_to_end(ip)
        return True
