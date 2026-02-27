from __future__ import annotations

import asyncio
import logging
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from app.core.crawler_service import DouyinCrawlerService
from app.core.task_store import StoredTask, TaskStore
from app.models import (
    DownloaderSettings,
    LogEntry,
    TaskDetail,
    TaskEvent,
    TaskResult,
    TaskStatus,
    TaskSummary,
    UserTarget,
)

LOGGER = logging.getLogger(__name__)


@dataclass
class TaskRecord:
    task_id: str
    settings: DownloaderSettings
    user_list: list[UserTarget]
    status: TaskStatus = "pending"
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    started_at: datetime | None = None
    ended_at: datetime | None = None
    error: str | None = None
    result: TaskResult | None = None
    logs: deque[LogEntry] = field(default_factory=lambda: deque(maxlen=2000))
    subscribers: set[asyncio.Queue[TaskEvent]] = field(default_factory=set)
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    worker: asyncio.Task[None] | None = None
    persist_dirty: bool = False
    persist_urgent: bool = False
    persist_worker: asyncio.Task[None] | None = None


class TaskManager:
    URGENT_PERSIST_EVENTS = {
        "task_started",
        "task_completed",
        "task_failed",
        "task_cancelled",
        "task_cancel_requested",
        "user_completed",
        "user_failed",
    }

    def __init__(
        self,
        crawler_service: DouyinCrawlerService,
        task_store: TaskStore,
        max_logs: int = 2000,
        persisted_logs_max: int = 600,
        persist_debounce_seconds: float = 1.5,
    ) -> None:
        self._crawler_service = crawler_service
        self._task_store = task_store
        self._max_logs = max(1, max_logs)
        self._persisted_logs_max = max(100, min(self._max_logs, persisted_logs_max))
        self._persist_debounce_seconds = max(0.2, persist_debounce_seconds)
        self._tasks: dict[str, TaskRecord] = {}
        self._lock = asyncio.Lock()
        self._persist_lock = asyncio.Lock()

    async def startup(self) -> None:
        await self._task_store.ensure()
        stored_tasks = await self._task_store.load_all()

        restored: dict[str, TaskRecord] = {}
        needs_rewrite: list[TaskRecord] = []

        for item in stored_tasks:
            logs = deque(item.logs, maxlen=self._max_logs)
            status = item.status
            error = item.error
            ended_at = item.ended_at

            if status in {"pending", "running"}:
                now = datetime.now(timezone.utc)
                status = "cancelled"
                ended_at = ended_at or now
                resume_message = "服务重启，未完成任务已标记为取消"
                logs.append(LogEntry(timestamp=now, level="warning", message=resume_message))
                error = error or resume_message

            record = TaskRecord(
                task_id=item.task_id,
                settings=item.settings,
                user_list=item.user_list,
                status=status,
                created_at=item.created_at,
                started_at=item.started_at,
                ended_at=ended_at,
                error=error,
                result=item.result,
                logs=logs,
            )
            restored[record.task_id] = record

            if status != item.status or error != item.error or ended_at != item.ended_at:
                needs_rewrite.append(record)

        async with self._lock:
            self._tasks = restored

        for record in needs_rewrite:
            await self._persist_now(record)

    async def shutdown(self) -> None:
        async with self._lock:
            workers = [
                record.persist_worker
                for record in self._tasks.values()
                if record.persist_worker is not None
            ]

        if workers:
            await asyncio.gather(*workers, return_exceptions=True)

    async def create_task(
        self,
        settings: DownloaderSettings,
        user_list: list[UserTarget],
    ) -> TaskSummary:
        task_id = uuid.uuid4().hex
        record = TaskRecord(task_id=task_id, settings=settings, user_list=user_list)

        async with self._lock:
            self._tasks[task_id] = record

        await self._persist_now(record)
        record.worker = asyncio.create_task(self._run_task(record), name=f"task-{task_id}")
        return self._to_summary(record)

    async def list_tasks(self) -> list[TaskSummary]:
        async with self._lock:
            records = list(self._tasks.values())

        records.sort(key=lambda x: x.created_at, reverse=True)
        return [self._to_summary(record) for record in records]

    async def get_task_detail(self, task_id: str) -> TaskDetail:
        record = await self._get_record(task_id)
        return self._to_detail(record)

    async def get_logs(self, task_id: str) -> list[LogEntry]:
        record = await self._get_record(task_id)
        return list(record.logs)

    async def cancel_task(self, task_id: str) -> TaskSummary:
        record = await self._get_record(task_id)
        if record.status in {"success", "failed", "cancelled"}:
            return self._to_summary(record)

        record.cancel_event.set()
        await self._emit(record, "task_cancel_requested", "任务已请求取消", {})
        await self._persist_now(record)
        return self._to_summary(record)

    async def subscribe(self, task_id: str) -> asyncio.Queue[TaskEvent]:
        record = await self._get_record(task_id)
        queue: asyncio.Queue[TaskEvent] = asyncio.Queue(maxsize=2000)
        record.subscribers.add(queue)
        return queue

    async def unsubscribe(self, task_id: str, queue: asyncio.Queue[TaskEvent]) -> None:
        record = await self._get_record(task_id)
        if queue in record.subscribers:
            record.subscribers.remove(queue)

    async def _get_record(self, task_id: str) -> TaskRecord:
        async with self._lock:
            record = self._tasks.get(task_id)
        if not record:
            raise KeyError(task_id)
        return record

    async def _run_task(self, record: TaskRecord) -> None:
        record.status = "running"
        record.started_at = datetime.now(timezone.utc)
        await self._persist_now(record)
        await self._emit(record, "task_started", "任务开始执行", {})

        async def _emit_event(event_type: str, message: str, data: dict[str, Any]) -> None:
            await self._emit(record, event_type, message, data)

        try:
            result = await self._crawler_service.run(
                settings=record.settings,
                user_list=record.user_list,
                emit=_emit_event,
                cancel_event=record.cancel_event,
                stream_id=record.task_id,
            )
            record.result = result

            if record.cancel_event.is_set():
                record.status = "cancelled"
                await self._emit(record, "task_cancelled", "任务已取消", {})
            else:
                record.status = "success"
                await self._emit(
                    record,
                    "task_completed",
                    "任务执行完成",
                    {"result": result.model_dump(mode="json")},
                )
        except Exception as exc:
            record.status = "failed"
            record.error = str(exc)
            await self._emit(record, "task_failed", f"任务失败: {exc}", {"error": str(exc)})
        finally:
            record.ended_at = datetime.now(timezone.utc)
            await self._persist_now(record)

    async def _emit(
        self,
        record: TaskRecord,
        event_type: str,
        message: str,
        data: dict[str, Any],
    ) -> None:
        now = datetime.now(timezone.utc)
        event = TaskEvent(
            task_id=record.task_id,
            type=event_type,
            timestamp=now,
            message=message,
            data=data,
        )

        if message:
            level = str(data.get("level", "")).lower() if data else ""
            if not level:
                level = "error" if event_type.endswith("failed") else "info"
            record.logs.append(LogEntry(timestamp=now, level=level, message=message))

        for queue in record.subscribers:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                try:
                    queue.get_nowait()
                    queue.put_nowait(event)
                except asyncio.QueueEmpty:
                    pass

        self._schedule_persist(
            record,
            urgent=event_type in self.URGENT_PERSIST_EVENTS,
        )

    def _schedule_persist(self, record: TaskRecord, urgent: bool = False) -> None:
        record.persist_dirty = True
        if urgent:
            record.persist_urgent = True

        if record.persist_worker and not record.persist_worker.done():
            return

        record.persist_worker = asyncio.create_task(
            self._persist_worker(record),
            name=f"persist-{record.task_id}",
        )

    async def _persist_worker(self, record: TaskRecord) -> None:
        try:
            while True:
                if record.persist_urgent:
                    await asyncio.sleep(0)
                else:
                    await asyncio.sleep(self._persist_debounce_seconds)
                record.persist_dirty = False
                record.persist_urgent = False
                await self._persist_record(record)
                if not record.persist_dirty:
                    break
        except Exception:
            LOGGER.exception("task persist worker failed: %s", record.task_id)
        finally:
            record.persist_worker = None
            if record.persist_dirty:
                self._schedule_persist(record)

    async def _persist_now(self, record: TaskRecord) -> None:
        record.persist_dirty = False
        record.persist_urgent = False
        await self._persist_record(record)

    async def _persist_record(self, record: TaskRecord) -> None:
        stored = self._to_stored(record)
        async with self._persist_lock:
            await self._task_store.upsert(stored)

    def _to_stored(self, record: TaskRecord) -> StoredTask:
        settings_snapshot = record.settings.model_copy(deep=True)
        settings_snapshot.douyin_cookie = ""
        logs = list(record.logs)
        if len(logs) > self._persisted_logs_max:
            logs = logs[-self._persisted_logs_max :]

        return StoredTask(
            task_id=record.task_id,
            status=record.status,
            created_at=record.created_at,
            started_at=record.started_at,
            ended_at=record.ended_at,
            error=record.error,
            settings=settings_snapshot,
            user_list=record.user_list,
            result=record.result,
            logs=logs,
        )

    @staticmethod
    def _to_summary(record: TaskRecord) -> TaskSummary:
        return TaskSummary(
            task_id=record.task_id,
            status=record.status,
            created_at=record.created_at,
            started_at=record.started_at,
            ended_at=record.ended_at,
            error=record.error,
        )

    @staticmethod
    def _to_detail(record: TaskRecord) -> TaskDetail:
        return TaskDetail(
            task_id=record.task_id,
            status=record.status,
            created_at=record.created_at,
            started_at=record.started_at,
            ended_at=record.ended_at,
            error=record.error,
            settings=record.settings,
            user_list=record.user_list,
            result=record.result,
            logs=list(record.logs),
        )
