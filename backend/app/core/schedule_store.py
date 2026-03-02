from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from app.models import UserTarget

LOGGER = logging.getLogger(__name__)


def _to_iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _from_iso(value: str | None) -> datetime | None:
    if not value:
        return None

    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


class ScheduleRecord:
    __slots__ = (
        "schedule_id",
        "name",
        "enabled",
        "cron_expr",
        "user_list",
        "created_at",
        "updated_at",
        "last_run_at",
        "last_task_id",
        "next_run_at",
    )

    def __init__(
        self,
        schedule_id: str,
        name: str,
        enabled: bool,
        cron_expr: str,
        user_list: list[UserTarget],
        created_at: datetime,
        updated_at: datetime,
        last_run_at: datetime | None = None,
        last_task_id: str | None = None,
        next_run_at: datetime | None = None,
    ) -> None:
        self.schedule_id = schedule_id
        self.name = name
        self.enabled = enabled
        self.cron_expr = cron_expr
        self.user_list = user_list
        self.created_at = created_at
        self.updated_at = updated_at
        self.last_run_at = last_run_at
        self.last_task_id = last_task_id
        self.next_run_at = next_run_at


class ScheduleStore:
    def __init__(self, db_file: str | Path) -> None:
        self._path = Path(db_file)
        self._lock = asyncio.Lock()

    async def ensure(self) -> None:
        async with self._lock:
            await asyncio.to_thread(self._sync_ensure)

    async def load_all(self) -> list[ScheduleRecord]:
        async with self._lock:
            return await asyncio.to_thread(self._sync_load_all)

    async def upsert(self, record: ScheduleRecord) -> None:
        async with self._lock:
            await asyncio.to_thread(self._sync_upsert, record)

    async def delete(self, schedule_id: str) -> None:
        async with self._lock:
            await asyncio.to_thread(self._sync_delete, schedule_id)

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
                CREATE TABLE IF NOT EXISTS schedules (
                    schedule_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    cron_expr TEXT NOT NULL,
                    user_list_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_run_at TEXT,
                    last_task_id TEXT,
                    next_run_at TEXT
                )
                """
            )
            conn.commit()

    def _sync_load_all(self) -> list[ScheduleRecord]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    schedule_id,
                    name,
                    enabled,
                    cron_expr,
                    user_list_json,
                    created_at,
                    updated_at,
                    last_run_at,
                    last_task_id,
                    next_run_at
                FROM schedules
                ORDER BY created_at DESC
                """
            ).fetchall()

        records: list[ScheduleRecord] = []
        for row in rows:
            try:
                user_list_raw = json.loads(row[4])
                user_list = [UserTarget.model_validate(item) for item in user_list_raw]

                records.append(
                    ScheduleRecord(
                        schedule_id=row[0],
                        name=row[1],
                        enabled=bool(row[2]),
                        cron_expr=row[3],
                        user_list=user_list,
                        created_at=_from_iso(row[5]) or datetime.now(timezone.utc),
                        updated_at=_from_iso(row[6]) or datetime.now(timezone.utc),
                        last_run_at=_from_iso(row[7]),
                        last_task_id=row[8],
                        next_run_at=_from_iso(row[9]),
                    )
                )
            except Exception:
                LOGGER.exception("skip invalid persisted schedule row: %s", row[0])

        return records

    def _sync_upsert(self, record: ScheduleRecord) -> None:
        user_list_json = json.dumps(
            [item.model_dump(mode="json") for item in record.user_list],
            ensure_ascii=False,
        )

        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO schedules (
                    schedule_id,
                    name,
                    enabled,
                    cron_expr,
                    user_list_json,
                    created_at,
                    updated_at,
                    last_run_at,
                    last_task_id,
                    next_run_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(schedule_id) DO UPDATE SET
                    name=excluded.name,
                    enabled=excluded.enabled,
                    cron_expr=excluded.cron_expr,
                    user_list_json=excluded.user_list_json,
                    updated_at=excluded.updated_at,
                    last_run_at=excluded.last_run_at,
                    last_task_id=excluded.last_task_id,
                    next_run_at=excluded.next_run_at
                """,
                (
                    record.schedule_id,
                    record.name,
                    int(record.enabled),
                    record.cron_expr,
                    user_list_json,
                    _to_iso(record.created_at),
                    _to_iso(record.updated_at),
                    _to_iso(record.last_run_at),
                    record.last_task_id,
                    _to_iso(record.next_run_at),
                ),
            )
            conn.commit()

    def _sync_delete(self, schedule_id: str) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM schedules WHERE schedule_id = ?", (schedule_id,))
            conn.commit()
