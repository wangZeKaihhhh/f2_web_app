from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from app.models import DownloaderSettings, LogEntry, TaskResult, TaskStatus, UserTarget

LOGGER = logging.getLogger(__name__)


@dataclass(slots=True)
class StoredTask:
    task_id: str
    status: TaskStatus
    created_at: datetime
    started_at: datetime | None
    ended_at: datetime | None
    error: str | None
    settings: DownloaderSettings
    user_list: list[UserTarget]
    result: TaskResult | None
    logs: list[LogEntry]


def _to_iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _from_iso(value: str | None) -> datetime | None:
    if not value:
        return None

    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


class TaskStore:
    def __init__(self, db_file: str | Path, max_tasks: int = 200) -> None:
        self._path = Path(db_file)
        self._max_tasks = max(1, max_tasks)
        self._lock = asyncio.Lock()

    async def ensure(self) -> None:
        async with self._lock:
            await asyncio.to_thread(self._sync_ensure)

    async def load_all(self) -> list[StoredTask]:
        async with self._lock:
            return await asyncio.to_thread(self._sync_load_all)

    async def upsert(self, task: StoredTask) -> None:
        async with self._lock:
            await asyncio.to_thread(self._sync_upsert, task)

    def _connect(self) -> sqlite3.Connection:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self._path)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        return conn

    def _sync_ensure(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS tasks (
                    task_id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    started_at TEXT,
                    ended_at TEXT,
                    error TEXT,
                    settings_json TEXT NOT NULL,
                    user_list_json TEXT NOT NULL,
                    result_json TEXT,
                    logs_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC)"
            )
            conn.commit()

    def _sync_load_all(self) -> list[StoredTask]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    task_id,
                    status,
                    created_at,
                    started_at,
                    ended_at,
                    error,
                    settings_json,
                    user_list_json,
                    result_json,
                    logs_json
                FROM tasks
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (self._max_tasks,),
            ).fetchall()

        tasks: list[StoredTask] = []
        for row in rows:
            try:
                settings = DownloaderSettings.model_validate(json.loads(row[6]))
                settings.douyin_cookie = ""
                user_list_raw = json.loads(row[7])
                user_list = [UserTarget.model_validate(item) for item in user_list_raw]

                result: TaskResult | None = None
                if row[8]:
                    result = TaskResult.model_validate(json.loads(row[8]))

                logs_raw = json.loads(row[9])
                logs = [LogEntry.model_validate(item) for item in logs_raw]

                tasks.append(
                    StoredTask(
                        task_id=row[0],
                        status=row[1],
                        created_at=_from_iso(row[2]) or datetime.now(timezone.utc),
                        started_at=_from_iso(row[3]),
                        ended_at=_from_iso(row[4]),
                        error=row[5],
                        settings=settings,
                        user_list=user_list,
                        result=result,
                        logs=logs,
                    )
                )
            except Exception:
                LOGGER.exception("skip invalid persisted task row: %s", row[0])

        return tasks

    def _sync_upsert(self, task: StoredTask) -> None:
        settings_payload = task.settings.model_dump(mode="json")
        settings_payload["douyin_cookie"] = ""
        settings_json = json.dumps(settings_payload, ensure_ascii=False)
        user_list_json = json.dumps(
            [item.model_dump(mode="json") for item in task.user_list],
            ensure_ascii=False,
        )
        result_json = (
            json.dumps(task.result.model_dump(mode="json"), ensure_ascii=False)
            if task.result is not None
            else None
        )
        logs_json = json.dumps(
            [item.model_dump(mode="json") for item in task.logs],
            ensure_ascii=False,
        )

        now = datetime.now(timezone.utc).isoformat()

        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO tasks (
                    task_id,
                    status,
                    created_at,
                    started_at,
                    ended_at,
                    error,
                    settings_json,
                    user_list_json,
                    result_json,
                    logs_json,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(task_id) DO UPDATE SET
                    status=excluded.status,
                    created_at=excluded.created_at,
                    started_at=excluded.started_at,
                    ended_at=excluded.ended_at,
                    error=excluded.error,
                    settings_json=excluded.settings_json,
                    user_list_json=excluded.user_list_json,
                    result_json=excluded.result_json,
                    logs_json=excluded.logs_json,
                    updated_at=excluded.updated_at
                """,
                (
                    task.task_id,
                    task.status,
                    _to_iso(task.created_at),
                    _to_iso(task.started_at),
                    _to_iso(task.ended_at),
                    task.error,
                    settings_json,
                    user_list_json,
                    result_json,
                    logs_json,
                    now,
                ),
            )
            conn.execute(
                """
                DELETE FROM tasks
                WHERE task_id NOT IN (
                    SELECT task_id FROM tasks ORDER BY created_at DESC LIMIT ?
                )
                """,
                (self._max_tasks,),
            )
            conn.commit()
