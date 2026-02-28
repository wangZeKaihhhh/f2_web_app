from __future__ import annotations

import json
import os
import re
from pathlib import Path
from uuid import uuid4


class DownloadPathPolicy:
    def __init__(
        self,
        app_env: str,
        default_download_dir: Path,
        accessible_paths_file: str | Path | None = None,
    ) -> None:
        self._app_env = app_env
        self._default_download_dir = default_download_dir.resolve(strict=False)
        file_from_env = os.getenv("TRIM_DATA_ACCESSIBLE_PATHS_FILE", "").strip()
        file_path = file_from_env or accessible_paths_file
        self._accessible_paths_file = (
            Path(file_path).expanduser().resolve(strict=False) if file_path else None
        )

    @property
    def allowed_roots(self) -> list[str]:
        return [str(item) for item in self._collect_allowed_roots()]

    def normalize(self, raw_path: str) -> str:
        candidate = self._resolve_candidate(raw_path)
        return str(candidate)

    def ensure_writable(self, raw_path: str) -> str:
        candidate = Path(self.normalize(raw_path))

        try:
            candidate.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise ValueError(
                f"下载目录不可写：{candidate}。请确认目录存在且授权为读写。系统错误：{exc}"
            ) from exc

        probe_file = candidate / f".f2_write_probe_{uuid4().hex}.tmp"
        try:
            probe_file.write_text("probe", encoding="utf-8")
        except OSError as exc:
            raise ValueError(
                f"下载目录不可写：{candidate}。请在飞牛中授予读写权限并检查目录 ACL。系统错误：{exc}"
            ) from exc
        finally:
            try:
                probe_file.unlink()
            except OSError:
                pass

        return str(candidate)

    def _collect_allowed_roots(self) -> list[Path]:
        roots: list[Path] = [self._default_download_dir]

        for env_key in ("TRIM_DATA_ACCESSIBLE_PATHS", "TRIM_DATA_SHARE_PATHS"):
            raw_value = os.getenv(env_key, "")
            for raw_item in self._split_env_paths(raw_value):
                item = raw_item.strip()
                if not item:
                    continue
                candidate = Path(item).expanduser()
                if not candidate.is_absolute():
                    continue
                roots.append(candidate.resolve(strict=False))

            for raw_item in self._extract_json_paths(raw_value):
                item = raw_item.strip()
                if not item:
                    continue
                candidate = Path(item).expanduser()
                if not candidate.is_absolute():
                    continue
                roots.append(candidate.resolve(strict=False))

        if self._accessible_paths_file and self._accessible_paths_file.exists():
            try:
                raw_value = self._accessible_paths_file.read_text(encoding="utf-8")
            except OSError:
                raw_value = ""

            for raw_item in self._split_env_paths(raw_value):
                item = raw_item.strip()
                if not item:
                    continue
                candidate = Path(item).expanduser()
                if not candidate.is_absolute():
                    continue
                roots.append(candidate.resolve(strict=False))

            for raw_item in self._extract_json_paths(raw_value):
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

    @staticmethod
    def _extract_json_paths(raw: str) -> list[str]:
        text = raw.strip()
        if not text:
            return []

        if not (
            (text.startswith("{") and text.endswith("}"))
            or (text.startswith("[") and text.endswith("]"))
        ):
            return []

        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            return []

        paths: list[str] = []

        def walk(value: object) -> None:
            if isinstance(value, str):
                token = value.strip()
                if token.startswith("/"):
                    paths.append(token)
                return

            if isinstance(value, list):
                for item in value:
                    walk(item)
                return

            if isinstance(value, dict):
                for item in value.values():
                    walk(item)

        walk(payload)
        return paths

    def _resolve_candidate(self, raw_path: str) -> Path:
        path_text = raw_path.strip()
        if not path_text:
            raise ValueError("下载目录不能为空")

        candidate = Path(path_text).expanduser()
        if not candidate.is_absolute():
            candidate = (self._default_download_dir / candidate).resolve(strict=False)
        else:
            candidate = candidate.resolve(strict=False)

        return candidate
