from __future__ import annotations

import os
import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


TaskStatus = Literal["pending", "running", "success", "failed", "cancelled"]
ALLOWED_NAMING_PATTERN = re.compile(
    r"^\{(?:nickname|create|aweme_id|desc|uid)\}(?:[_-]\{(?:nickname|create|aweme_id|desc|uid)\})*$"
)


def normalize_user_list(raw: Any) -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []

    if not isinstance(raw, list):
        return normalized

    for item in raw:
        if isinstance(item, str):
            url = item.strip()
            if url:
                normalized.append({"name": "", "url": url})
            continue

        if isinstance(item, dict):
            name = str(item.get("name", "")).strip()
            url = str(item.get("url", "")).strip()
            if url:
                normalized.append({"name": name, "url": url})

    return normalized


class UserTarget(BaseModel):
    name: str = ""
    url: str = ""


class DownloaderSettings(BaseModel):
    user_list: list[UserTarget] = Field(default_factory=list)
    douyin_cookie: str = ""

    max_tasks: int = 3
    page_counts: int = 20
    max_counts: int | None = None

    timeout: int = 10
    max_retries: int = 5
    max_connections: int = 5

    mode: str = "post"
    music: bool = False
    cover: bool = False
    desc: bool = False
    folderize: bool = False
    naming: str = "{create}_{desc}"
    interval: str = "all"

    update_exif: bool = True
    incremental_mode: bool = True
    incremental_threshold: int = 20

    proxy_http: str = ""
    proxy_https: str = ""

    download_path: str = Field(
        default_factory=lambda: os.getenv("DOWNLOAD_PATH", "/data/downloads")
    )

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        if "user_list" in data:
            data["user_list"] = normalize_user_list(data.get("user_list"))
        return data

    @model_validator(mode="after")
    def _validate(self) -> DownloaderSettings:
        self.naming = self._validate_naming(self.naming)
        self.proxy_http = self._validate_proxy(self.proxy_http, "HTTP")
        self.proxy_https = self._validate_proxy(self.proxy_https, "HTTPS")
        return self

    @staticmethod
    def _validate_naming(raw: str) -> str:
        value = raw.strip()
        if not value:
            raise ValueError("命名模板不能为空")

        if not ALLOWED_NAMING_PATTERN.fullmatch(value):
            raise ValueError(
                "命名模板仅支持 {nickname}/{create}/{aweme_id}/{desc}/{uid}，分隔符仅支持 _ 或 -"
            )
        return value

    @staticmethod
    def _validate_proxy(raw: str, protocol_name: str) -> str:
        value = raw.strip()
        if not value:
            return ""

        if value.startswith(("http://", "https://")):
            return value

        raise ValueError(f"{protocol_name} 代理地址必须以 http:// 或 https:// 开头")


class TaskCreateRequest(BaseModel):
    user_list: list[UserTarget] | None = None

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, data: Any) -> Any:
        if not isinstance(data, dict) or "user_list" not in data:
            return data

        data["user_list"] = normalize_user_list(data.get("user_list"))
        return data


class AuthStatus(BaseModel):
    configured: bool
    allowed_download_roots: list[str] = Field(default_factory=list)


class AuthPasswordRequest(BaseModel):
    password: str = Field(min_length=6, max_length=256)


class AuthTokenResponse(BaseModel):
    token: str


class LogEntry(BaseModel):
    timestamp: datetime
    level: str = "info"
    message: str


class TaskEvent(BaseModel):
    task_id: str
    type: str
    timestamp: datetime
    message: str = ""
    data: dict[str, Any] = Field(default_factory=dict)


class UserStat(BaseModel):
    nickname: str
    success: bool
    new: int
    skipped: int
    status: str


class TaskResult(BaseModel):
    total: int = 0
    success: int = 0
    failed: int = 0
    total_new: int = 0
    total_skipped: int = 0
    users: list[UserStat] = Field(default_factory=list)


class TaskSummary(BaseModel):
    task_id: str
    status: TaskStatus
    created_at: datetime
    started_at: datetime | None = None
    ended_at: datetime | None = None
    error: str | None = None
    result: TaskResult | None = None


class TaskListResponse(BaseModel):
    items: list[TaskSummary] = Field(default_factory=list)
    total: int = 0
    offset: int = 0
    limit: int = 50
    has_more: bool = False


class TaskDetail(TaskSummary):
    settings: DownloaderSettings
    user_list: list[UserTarget] = Field(default_factory=list)
    result: TaskResult | None = None
    logs: list[LogEntry] = Field(default_factory=list)
