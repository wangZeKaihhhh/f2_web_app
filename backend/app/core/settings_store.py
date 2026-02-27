from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

from app.core.secret_box import SecretBox
from app.models import DownloaderSettings


class SettingsStore:
    def __init__(
        self,
        settings_file: str | Path,
        secret_key_file: str | Path | None = None,
    ) -> None:
        self._path = Path(settings_file)
        default_secret_file = self._path.parent / "settings.secret.key"
        resolved_secret_file = os.getenv("SETTINGS_SECRET_FILE") or secret_key_file
        self._secret_box = SecretBox(resolved_secret_file or default_secret_file)
        self._lock = asyncio.Lock()

    async def ensure(self) -> DownloaderSettings:
        async with self._lock:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            if not self._path.exists():
                defaults = DownloaderSettings()
                await self._write(defaults)
                return defaults
            return await self._read()

    async def load(self) -> DownloaderSettings:
        async with self._lock:
            if not self._path.exists():
                defaults = DownloaderSettings()
                await self._write(defaults)
                return defaults
            return await self._read()

    async def save(self, settings: DownloaderSettings) -> DownloaderSettings:
        async with self._lock:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            await self._write(settings)
            return settings

    async def _read(self) -> DownloaderSettings:
        def _sync_read() -> DownloaderSettings:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
            cookie = raw.get("douyin_cookie")
            if isinstance(cookie, str):
                raw["douyin_cookie"] = self._secret_box.decrypt(cookie)
            return DownloaderSettings.model_validate(raw)

        return await asyncio.to_thread(_sync_read)

    async def _write(self, settings: DownloaderSettings) -> None:
        payload = settings.model_dump(mode="json")
        cookie = payload.get("douyin_cookie")
        if isinstance(cookie, str) and cookie:
            payload["douyin_cookie"] = self._secret_box.encrypt(cookie)

        def _sync_write() -> None:
            tmp = self._path.with_suffix(self._path.suffix + ".tmp")
            tmp.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            tmp.replace(self._path)

        await asyncio.to_thread(_sync_write)
