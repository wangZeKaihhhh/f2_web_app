from __future__ import annotations

import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

ENCRYPTED_PREFIX = "enc:v1:"


class SecretBox:
    def __init__(self, key_file: str | Path, env_key: str = "SETTINGS_ENCRYPTION_KEY") -> None:
        self._key_file = Path(key_file)
        self._env_key = env_key
        self._fernet: Fernet | None = None

    def encrypt(self, plain_text: str) -> str:
        if not plain_text:
            return ""

        if plain_text.startswith(ENCRYPTED_PREFIX):
            return plain_text

        token = self._get_fernet().encrypt(plain_text.encode("utf-8")).decode("utf-8")
        return f"{ENCRYPTED_PREFIX}{token}"

    def decrypt(self, cipher_text: str) -> str:
        if not cipher_text:
            return ""

        if not cipher_text.startswith(ENCRYPTED_PREFIX):
            return cipher_text

        token = cipher_text[len(ENCRYPTED_PREFIX) :]
        try:
            plain = self._get_fernet().decrypt(token.encode("utf-8"))
            return plain.decode("utf-8")
        except InvalidToken as exc:
            raise ValueError("Cookie 解密失败，请检查加密密钥配置") from exc

    def _get_fernet(self) -> Fernet:
        if self._fernet is not None:
            return self._fernet

        key_text = os.getenv(self._env_key, "").strip()
        if key_text:
            key = key_text.encode("utf-8")
        else:
            key = self._load_or_create_file_key()
        self._fernet = Fernet(key)
        return self._fernet

    def _load_or_create_file_key(self) -> bytes:
        self._key_file.parent.mkdir(parents=True, exist_ok=True)
        if self._key_file.exists():
            return self._key_file.read_text(encoding="utf-8").strip().encode("utf-8")

        key = Fernet.generate_key()
        tmp = self._key_file.with_suffix(self._key_file.suffix + ".tmp")
        tmp.write_text(key.decode("utf-8"), encoding="utf-8")
        tmp.replace(self._key_file)
        return key
