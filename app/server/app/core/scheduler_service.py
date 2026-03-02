from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from croniter import croniter

from app.core.schedule_store import ScheduleRecord, ScheduleStore
from app.core.settings_store import SettingsStore
from app.core.task_manager import TaskManager
from app.models import ScheduleSummary, UserTarget

LOGGER = logging.getLogger(__name__)

CHECK_INTERVAL_SECONDS = 30


class SchedulerService:
    def __init__(
        self,
        schedule_store: ScheduleStore,
        settings_store: SettingsStore,
        task_manager: TaskManager,
    ) -> None:
        self._store = schedule_store
        self._settings_store = settings_store
        self._task_manager = task_manager
        self._schedules: dict[str, ScheduleRecord] = {}
        self._lock = asyncio.Lock()
        self._ticker: asyncio.Task[None] | None = None

    async def startup(self) -> None:
        await self._store.ensure()
        records = await self._store.load_all()

        async with self._lock:
            for record in records:
                if record.enabled:
                    record.next_run_at = self._calc_next_run(record.cron_expr)
                    await self._store.upsert(record)
                self._schedules[record.schedule_id] = record

        self._ticker = asyncio.create_task(self._tick_loop(), name="scheduler-tick")

    async def shutdown(self) -> None:
        if self._ticker and not self._ticker.done():
            self._ticker.cancel()
            try:
                await self._ticker
            except asyncio.CancelledError:
                pass
            self._ticker = None

    async def list_schedules(self) -> list[ScheduleSummary]:
        async with self._lock:
            records = list(self._schedules.values())
        records.sort(key=lambda r: r.created_at, reverse=True)
        return [self._to_summary(r) for r in records]

    async def get_schedule(self, schedule_id: str) -> ScheduleSummary:
        record = await self._get_record(schedule_id)
        return self._to_summary(record)

    async def create_schedule(
        self,
        name: str,
        cron_expr: str,
        user_list: list[UserTarget],
        enabled: bool = True,
    ) -> ScheduleSummary:
        self._validate_cron(cron_expr)

        now = datetime.now(timezone.utc)
        record = ScheduleRecord(
            schedule_id=uuid.uuid4().hex,
            name=name,
            enabled=enabled,
            cron_expr=cron_expr,
            user_list=user_list,
            created_at=now,
            updated_at=now,
            next_run_at=self._calc_next_run(cron_expr) if enabled else None,
        )

        await self._store.upsert(record)
        async with self._lock:
            self._schedules[record.schedule_id] = record

        return self._to_summary(record)

    async def update_schedule(
        self,
        schedule_id: str,
        name: str | None = None,
        cron_expr: str | None = None,
        user_list: list[UserTarget] | None = None,
        enabled: bool | None = None,
    ) -> ScheduleSummary:
        record = await self._get_record(schedule_id)

        if cron_expr is not None:
            self._validate_cron(cron_expr)
            record.cron_expr = cron_expr

        if name is not None:
            record.name = name

        if user_list is not None:
            record.user_list = user_list

        if enabled is not None:
            record.enabled = enabled

        if record.enabled:
            record.next_run_at = self._calc_next_run(record.cron_expr)
        else:
            record.next_run_at = None

        record.updated_at = datetime.now(timezone.utc)
        await self._store.upsert(record)
        return self._to_summary(record)

    async def delete_schedule(self, schedule_id: str) -> None:
        await self._get_record(schedule_id)
        async with self._lock:
            self._schedules.pop(schedule_id, None)
        await self._store.delete(schedule_id)

    async def toggle_schedule(self, schedule_id: str) -> ScheduleSummary:
        record = await self._get_record(schedule_id)
        record.enabled = not record.enabled

        if record.enabled:
            record.next_run_at = self._calc_next_run(record.cron_expr)
        else:
            record.next_run_at = None

        record.updated_at = datetime.now(timezone.utc)
        await self._store.upsert(record)
        return self._to_summary(record)

    async def run_now(self, schedule_id: str) -> str:
        record = await self._get_record(schedule_id)
        task_id = await self._execute_schedule(record)
        return task_id

    async def _get_record(self, schedule_id: str) -> ScheduleRecord:
        async with self._lock:
            record = self._schedules.get(schedule_id)
        if not record:
            raise KeyError(schedule_id)
        return record

    async def _tick_loop(self) -> None:
        while True:
            try:
                await asyncio.sleep(CHECK_INTERVAL_SECONDS)
                await self._check_due_schedules()
            except asyncio.CancelledError:
                break
            except Exception:
                LOGGER.exception("scheduler tick error")

    async def _check_due_schedules(self) -> None:
        now = datetime.now(timezone.utc)

        async with self._lock:
            due_records = [
                r
                for r in self._schedules.values()
                if r.enabled and r.next_run_at and r.next_run_at <= now
            ]

        for record in due_records:
            try:
                await self._execute_schedule(record)
                record.next_run_at = self._calc_next_run(record.cron_expr)
                await self._store.upsert(record)
            except Exception:
                LOGGER.exception("failed to execute schedule: %s", record.schedule_id)

    async def _execute_schedule(self, record: ScheduleRecord) -> str:
        settings = await self._settings_store.load()
        task_summary = await self._task_manager.create_task(
            settings=settings,
            user_list=record.user_list,
        )

        record.last_run_at = datetime.now(timezone.utc)
        record.last_task_id = task_summary.task_id
        record.updated_at = record.last_run_at
        await self._store.upsert(record)

        LOGGER.info(
            "schedule %s (%s) triggered task %s",
            record.schedule_id,
            record.name,
            task_summary.task_id,
        )
        return task_summary.task_id

    @staticmethod
    def _validate_cron(cron_expr: str) -> None:
        if not croniter.is_valid(cron_expr):
            raise ValueError(f"无效的 Cron 表达式: {cron_expr}")

    @staticmethod
    def _calc_next_run(cron_expr: str) -> datetime:
        now = datetime.now(timezone.utc)
        cron = croniter(cron_expr, now)
        next_dt = cron.get_next(datetime)
        if next_dt.tzinfo is None:
            next_dt = next_dt.replace(tzinfo=timezone.utc)
        return next_dt

    @staticmethod
    def _to_summary(record: ScheduleRecord) -> ScheduleSummary:
        return ScheduleSummary(
            schedule_id=record.schedule_id,
            name=record.name,
            enabled=record.enabled,
            cron_expr=record.cron_expr,
            user_list=record.user_list,
            created_at=record.created_at,
            updated_at=record.updated_at,
            last_run_at=record.last_run_at,
            last_task_id=record.last_task_id,
            next_run_at=record.next_run_at,
        )
