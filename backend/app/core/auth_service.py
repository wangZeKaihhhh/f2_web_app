from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import secrets
import time
from pathlib import Path
from typing import Any

PBKDF2_ITERATIONS = 390000
MIN_PASSWORD_LENGTH = 6


def _b64_url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64_url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode((data + padding).encode("ascii"))


def extract_bearer_token(raw_authorization: str | None) -> str | None:
    if not raw_authorization:
        return None

    parts = raw_authorization.strip().split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip() or None


class AuthService:
    def __init__(
        self,
        auth_file: str | Path,
        token_ttl_seconds: int = 12 * 60 * 60,
        bootstrap_password: str | None = None,
    ) -> None:
        self._path = Path(auth_file)
        self._token_ttl_seconds = max(300, int(token_ttl_seconds))
        self._lock = asyncio.Lock()
        self._password_hash: str | None = None
        self._salt: str | None = None
        self._iterations = PBKDF2_ITERATIONS
        self._bootstrap_password = (bootstrap_password or "").strip()

    async def ensure(self) -> None:
        async with self._lock:
            await asyncio.to_thread(self._sync_ensure_and_load)

    async def is_configured(self) -> bool:
        async with self._lock:
            return self._password_hash is not None

    async def setup_password(self, password: str) -> str:
        normalized = password.strip()
        self._validate_password(normalized)

        async with self._lock:
            if self._password_hash is not None:
                raise ValueError("访问密码已设置，请直接登录")

            await asyncio.to_thread(self._sync_set_password, normalized)
            return self._issue_token_locked()

    async def login(self, password: str) -> str:
        normalized = password.strip()
        if not normalized:
            raise ValueError("密码不能为空")

        async with self._lock:
            if self._password_hash is None:
                raise ValueError("请先设置访问密码")
            if not self._verify_password_locked(normalized):
                raise PermissionError("密码错误")
            return self._issue_token_locked()

    async def verify_token(self, token: str | None) -> bool:
        if not token:
            return False

        async with self._lock:
            if self._password_hash is None:
                return False
            return self._verify_token_locked(token)

    @staticmethod
    def _validate_password(password: str) -> None:
        if len(password) < MIN_PASSWORD_LENGTH:
            raise ValueError(f"密码长度不能少于 {MIN_PASSWORD_LENGTH} 位")

    def _sync_ensure_and_load(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        if not self._path.exists():
            if self._bootstrap_password:
                self._validate_password(self._bootstrap_password)
                self._sync_set_password(self._bootstrap_password)
                return
            self._password_hash = None
            self._salt = None
            self._iterations = PBKDF2_ITERATIONS
            return

        raw = json.loads(self._path.read_text(encoding="utf-8"))
        password_hash = str(raw.get("password_hash", "")).strip().lower()
        salt = str(raw.get("salt", "")).strip().lower()
        iterations = int(raw.get("iterations", PBKDF2_ITERATIONS))

        if not password_hash or not salt:
            self._password_hash = None
            self._salt = None
            self._iterations = PBKDF2_ITERATIONS
            return

        self._password_hash = password_hash
        self._salt = salt
        self._iterations = max(100_000, iterations)

    def _sync_set_password(self, password: str) -> None:
        salt_bytes = secrets.token_bytes(16)
        salt_hex = salt_bytes.hex()
        password_hash = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt_bytes,
            self._iterations,
        ).hex()

        payload: dict[str, Any] = {
            "salt": salt_hex,
            "password_hash": password_hash,
            "iterations": self._iterations,
            "updated_at": int(time.time()),
        }
        temp_path = self._path.with_suffix(".tmp")
        temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        temp_path.replace(self._path)

        self._password_hash = password_hash
        self._salt = salt_hex

    def _verify_password_locked(self, password: str) -> bool:
        if self._password_hash is None or self._salt is None:
            return False

        candidate_hash = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            bytes.fromhex(self._salt),
            self._iterations,
        ).hex()
        return hmac.compare_digest(candidate_hash, self._password_hash)

    def _issue_token_locked(self) -> str:
        if self._password_hash is None:
            raise RuntimeError("password hash missing")

        payload = {
            "exp": int(time.time()) + self._token_ttl_seconds,
            "v": self._password_hash[:16],
        }
        payload_encoded = _b64_url_encode(
            json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        )
        signature = _b64_url_encode(self._sign_payload(payload_encoded))
        return f"{payload_encoded}.{signature}"

    def _verify_token_locked(self, token: str) -> bool:
        if self._password_hash is None:
            return False

        parts = token.split(".", 1)
        if len(parts) != 2:
            return False

        payload_encoded, signature_encoded = parts
        if not payload_encoded or not signature_encoded:
            return False

        try:
            signature = _b64_url_decode(signature_encoded)
        except Exception:
            return False

        expected_signature = self._sign_payload(payload_encoded)
        if not hmac.compare_digest(signature, expected_signature):
            return False

        try:
            payload = json.loads(_b64_url_decode(payload_encoded).decode("utf-8"))
        except Exception:
            return False

        try:
            expires_at = int(payload.get("exp", 0))
        except (TypeError, ValueError):
            return False

        if expires_at <= int(time.time()):
            return False

        version = str(payload.get("v", ""))
        return hmac.compare_digest(version, self._password_hash[:16])

    def _sign_payload(self, payload_encoded: str) -> bytes:
        if self._password_hash is None:
            raise RuntimeError("password hash missing")
        secret = bytes.fromhex(self._password_hash)
        return hmac.new(secret, payload_encoded.encode("utf-8"), hashlib.sha256).digest()
