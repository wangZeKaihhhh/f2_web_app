from __future__ import annotations

import os
import re
from pathlib import Path


class DownloadPathPolicy:
    def __init__(self, app_env: str, default_download_dir: Path) -> None:
        self._app_env = app_env
        self._default_download_dir = default_download_dir.resolve(strict=False)
        self._allowed_roots = self._collect_allowed_roots()

    @property
    def allowed_roots(self) -> list[str]:
        return [str(item) for item in self._allowed_roots]

    def normalize(self, raw_path: str) -> str:
        path_text = raw_path.strip()
        if not path_text:
            raise ValueError("下载目录不能为空")

        candidate = Path(path_text).expanduser()
        if not candidate.is_absolute():
            candidate = (self._default_download_dir / candidate).resolve(strict=False)
        else:
            candidate = candidate.resolve(strict=False)

        if self._app_env == "package" and not self._is_in_allowed_roots(candidate):
            roots = "、".join(self.allowed_roots)
            raise ValueError(f"下载目录必须位于授权目录内：{roots}")

        return str(candidate)

    def _collect_allowed_roots(self) -> list[Path]:
        roots: list[Path] = [self._default_download_dir]

        for env_key in ("TRIM_DATA_ACCESSIBLE_PATHS", "TRIM_DATA_SHARE_PATHS"):
            for raw_item in self._split_env_paths(os.getenv(env_key, "")):
                item = raw_item.strip()
                if not item:
                    continue
                candidate = Path(item).expanduser()
                if not candidate.is_absolute():
                    continue
                roots.append(candidate.resolve(strict=False))

        unique_roots: list[Path] = []
        for root in roots:
            if root not in unique_roots:
                unique_roots.append(root)
        return unique_roots

    @staticmethod
    def _split_env_paths(raw: str) -> list[str]:
        if not raw.strip():
            return []

        first_pass = re.split(r"[,\n;]", raw)
        all_paths: list[str] = []
        for item in first_pass:
            token = item.strip()
            if not token:
                continue
            if os.pathsep in token:
                all_paths.extend(part.strip() for part in token.split(os.pathsep) if part.strip())
            else:
                all_paths.append(token)
        return all_paths

    def _is_in_allowed_roots(self, candidate: Path) -> bool:
        for root in self._allowed_roots:
            if candidate == root or root in candidate.parents:
                return True
        return False
