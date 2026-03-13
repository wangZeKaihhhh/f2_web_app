from __future__ import annotations

import asyncio
import contextvars
import datetime as dt_mod
import logging
import logging.handlers
import os
import re
import subprocess
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections.abc import Awaitable, Callable
from pathlib import Path
from time import perf_counter
from typing import Any

_TZ_CN = dt_mod.timezone(dt_mod.timedelta(hours=8))

logger = logging.getLogger(__name__)


def _setup_exif_logger() -> logging.Logger:
    """创建写入文件的 EXIF 专用 logger，用于事后排查。"""
    exif_logger = logging.getLogger("exif_update")
    if exif_logger.handlers:
        return exif_logger

    log_dir = Path(os.getenv("STATE_DIR", "/data/state"))
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        log_dir = Path.cwd() / ".runtime" / "state"
        log_dir.mkdir(parents=True, exist_ok=True)

    handler = logging.handlers.RotatingFileHandler(
        log_dir / "exif_update.log",
        maxBytes=5 * 1024 * 1024,  # 5MB
        backupCount=3,
        encoding="utf-8",
    )
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    )
    exif_logger.addHandler(handler)
    exif_logger.setLevel(logging.DEBUG)
    exif_logger.propagate = False
    return exif_logger


exif_logger = _setup_exif_logger()

from app.models import (
    DownloaderSettings,
    TaskResult,
    UserStat,
    UserTarget,
    ensure_time_based_features_support_naming,
)

EventEmitter = Callable[[str, str, dict[str, Any]], Awaitable[None]]
CURRENT_LOG_STREAM_ID: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "current_log_stream_id",
    default=None,
)


class EmitBridgeLogHandler(logging.Handler):
    """Bridge f2 logger records into websocket task events."""

    def __init__(
        self,
        loop: asyncio.AbstractEventLoop,
        emit: EventEmitter,
        stream_id: str | None,
    ) -> None:
        super().__init__(level=logging.INFO)
        self._loop = loop
        self._emit = emit
        self._stream_id = stream_id
        self.setFormatter(logging.Formatter("%(message)s"))

    def emit(self, record: logging.LogRecord) -> None:
        if self._stream_id and CURRENT_LOG_STREAM_ID.get() != self._stream_id:
            return

        message = self.format(record).strip()
        if not message:
            return

        level = record.levelname.lower()
        try:
            asyncio.run_coroutine_threadsafe(
                self._emit(
                    "crawler_log",
                    message,
                    {"level": level, "logger": record.name},
                ),
                self._loop,
            )
        except RuntimeError:
            return


class DouyinCrawlerService:
    FILE_TIME_PATTERN = re.compile(r"(\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2})")

    def __init__(self) -> None:
        requested_state_dir = Path(os.getenv("STATE_DIR", "/data/state"))
        self._state_dir = self._ensure_writable_dir(
            requested_state_dir,
            Path.cwd() / ".runtime" / "state",
        )

    @staticmethod
    def _ensure_writable_dir(preferred: Path, fallback: Path) -> Path:
        try:
            preferred.mkdir(parents=True, exist_ok=True)
            return preferred
        except OSError:
            fallback.mkdir(parents=True, exist_ok=True)
            return fallback

    @staticmethod
    def _build_f2_config(settings: DownloaderSettings) -> dict[str, Any]:
        return {
            "headers": {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
                ),
                "Referer": "https://www.douyin.com/",
            },
            "proxies": {
                "http://": settings.proxy_http or None,
                "https://": settings.proxy_https or None,
            },
            "timeout": settings.timeout,
            "max_retries": settings.max_retries,
            "max_connections": settings.max_connections,
            "max_tasks": settings.max_tasks,
            "page_counts": settings.page_counts,
            "max_counts": settings.max_counts,
            "mode": "post",
            "music": settings.music,
            "cover": settings.cover,
            "desc": settings.desc,
            "folderize": settings.folderize,
            "naming": settings.naming,
            "path": settings.download_path,
            "interval": settings.interval,
            "cookie": settings.douyin_cookie,
            "update_exif": settings.update_exif,
            "live_compose": settings.live_compose,
            "incremental_mode": settings.incremental_mode,
            "incremental_threshold": settings.incremental_threshold,
        }

    @staticmethod
    def get_existing_video_times(user_path: Path) -> set[str]:
        existing_times: set[str] = set()
        if not user_path.exists():
            return existing_times

        time_pattern = re.compile(r"(\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2})")
        try:
            for file_path in user_path.iterdir():
                if file_path.is_file():
                    match = time_pattern.search(file_path.name)
                    if match:
                        existing_times.add(match.group(1))
        except Exception:
            return existing_times

        return existing_times

    @staticmethod
    def update_media_exif(file_path: Path, create_time_timestamp: float) -> bool:
        try:
            aware_dt = dt_mod.datetime.fromtimestamp(create_time_timestamp, tz=_TZ_CN)
            exif_time = aware_dt.strftime("%Y:%m:%d %H:%M:%S+08:00")
            cmd = [
                "exiftool",
                "-overwrite_original",
                "-CreateDate=" + exif_time,
                "-ModifyDate=" + exif_time,
                "-DateTimeOriginal=" + exif_time,
                "-CreationDate=" + exif_time,
                "-TrackCreateDate=" + exif_time,
                "-TrackModifyDate=" + exif_time,
                "-MediaCreateDate=" + exif_time,
                "-MediaModifyDate=" + exif_time,
                str(file_path),
            ]
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            if result.returncode != 0:
                msg = result.stderr.strip()
                logger.warning("EXIF 更新失败 %s: %s", file_path.name, msg)
                exif_logger.warning("FAIL %s | returncode=%d | %s", file_path, result.returncode, msg)
            else:
                exif_logger.debug("OK %s", file_path.name)
            return result.returncode == 0
        except Exception as exc:
            logger.warning("EXIF 更新异常 %s: %s", file_path.name, exc)
            exif_logger.error("ERROR %s | %s", file_path, exc)
            return False

    @classmethod
    def update_media_exif_batch(
        cls,
        file_paths: list[Path],
        create_time_timestamp: float,
        chunk_size: int = 50,
    ) -> tuple[int, list[str]]:
        """返回 (成功数, 失败文件名列表)。"""
        if not file_paths:
            return 0, []

        aware_dt = dt_mod.datetime.fromtimestamp(create_time_timestamp, tz=_TZ_CN)
        exif_time = aware_dt.strftime("%Y:%m:%d %H:%M:%S+08:00")
        base_cmd = [
            "exiftool",
            "-overwrite_original",
            "-CreateDate=" + exif_time,
            "-ModifyDate=" + exif_time,
            "-DateTimeOriginal=" + exif_time,
            "-CreationDate=" + exif_time,
            "-TrackCreateDate=" + exif_time,
            "-TrackModifyDate=" + exif_time,
            "-MediaCreateDate=" + exif_time,
            "-MediaModifyDate=" + exif_time,
        ]

        updated = 0
        failed_files: list[str] = []
        for i in range(0, len(file_paths), chunk_size):
            chunk = file_paths[i : i + chunk_size]
            try:
                cmd = [*base_cmd, *[str(path) for path in chunk]]
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=200)
                if result.returncode == 0:
                    updated += len(chunk)
                    continue

                msg = result.stderr.strip()
                logger.warning("EXIF 批量更新部分失败 (chunk %d-%d): %s", i, i + len(chunk), msg)
                exif_logger.warning("BATCH FAIL chunk %d-%d | %s", i, i + len(chunk), msg)
            except Exception as exc:
                logger.warning("EXIF 批量更新异常 (chunk %d-%d): %s", i, i + len(chunk), exc)
                exif_logger.error("BATCH ERROR chunk %d-%d | %s", i, i + len(chunk), exc)

            # Fallback per-file update when a chunk fails.
            for file_path in chunk:
                if cls.update_media_exif(file_path, create_time_timestamp):
                    updated += 1
                else:
                    failed_files.append(file_path.name)

        return updated, failed_files

    @staticmethod
    def _parse_create_time_timestamp(create_time: Any) -> float | None:
        if create_time is None:
            return None

        try:
            if isinstance(create_time, str):
                if "-" in create_time and " " in create_time:
                    # f2 用 +08:00 时区格式化，解析时也按 +08:00 还原
                    naive = dt_mod.datetime.strptime(create_time, "%Y-%m-%d %H-%M-%S")
                    aware = naive.replace(tzinfo=_TZ_CN)
                    timestamp = aware.timestamp()
                else:
                    timestamp = float(create_time)
            else:
                timestamp = float(create_time)

            if timestamp > 1e10:
                timestamp /= 1000
            return timestamp
        except Exception:
            return None

    @classmethod
    def process_downloaded_files(
        cls,
        user_path: Path,
        aweme_data_list: list[dict[str, Any]],
    ) -> dict[str, int | float]:
        start_time = perf_counter()
        stats: dict[str, Any] = {
            "aweme_items": len(aweme_data_list),
            "files_scanned": 0,
            "matched_files": 0,
            "updated_files": 0,
            "failed_files": 0,
            "skipped_files": 0,
            "failed_list": [],
            "time_groups": 0,
            "elapsed_seconds": 0.0,
        }

        if not aweme_data_list or not user_path.exists():
            return stats

        timestamp_by_time_str: dict[str, float] = {}
        for aweme_data in aweme_data_list:
            create_time = aweme_data.get("create_time")
            timestamp = cls._parse_create_time_timestamp(create_time)
            if timestamp is None:
                continue

            if create_time:
                timestamp_by_time_str[str(create_time)] = timestamp
            formatted_time = dt_mod.datetime.fromtimestamp(
                timestamp, tz=_TZ_CN
            ).strftime("%Y-%m-%d %H-%M-%S")
            timestamp_by_time_str[formatted_time] = timestamp

        if not timestamp_by_time_str:
            return stats

        grouped_files: dict[float, list[Path]] = defaultdict(list)
        for file_path in user_path.rglob("*"):
            if not file_path.is_file():
                continue

            stats["files_scanned"] += 1
            match = cls.FILE_TIME_PATTERN.search(file_path.name)
            if not match:
                continue

            file_time = match.group(1)
            timestamp = timestamp_by_time_str.get(file_time)
            if timestamp is None:
                continue

            grouped_files[timestamp].append(file_path)
            stats["matched_files"] += 1

        stats["time_groups"] = len(grouped_files)
        stats["skipped_files"] = stats["files_scanned"] - stats["matched_files"]

        if stats["matched_files"] == 0:
            exif_logger.warning(
                "NO MATCH path=%s | aweme_items=%d | naming may not contain {create}",
                user_path,
                stats["aweme_items"],
            )

        max_workers = min(8, os.cpu_count() or 4)
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {
                executor.submit(cls.update_media_exif_batch, paths, ts): ts
                for ts, paths in grouped_files.items()
            }
            for future in as_completed(futures):
                ok_count, fail_names = future.result()
                stats["updated_files"] += ok_count
                stats["failed_files"] += len(fail_names)
                stats["failed_list"].extend(fail_names)

        stats["elapsed_seconds"] = round(perf_counter() - start_time, 2)

        exif_logger.info(
            "SUMMARY path=%s | scanned=%d skipped=%d success=%d failed=%d elapsed=%.2fs",
            user_path,
            stats["files_scanned"],
            stats["skipped_files"],
            stats["updated_files"],
            stats["failed_files"],
            stats["elapsed_seconds"],
        )
        if stats["failed_list"]:
            exif_logger.info("FAILED FILES: %s", ", ".join(stats["failed_list"]))

        return stats

    async def _download_user_videos(
        self,
        handler: Any,
        downloader: Any,
        config: dict[str, Any],
        sec_user_id: str,
        users_db_path: Path,
        emit: EventEmitter,
        cancel_event: asyncio.Event,
        async_user_db_cls: Any,
    ) -> tuple[bool, int, int, str, dict[str, Any], str | None]:
        try:
            async with async_user_db_cls(str(users_db_path)) as audb:
                user_profile = await handler.fetch_user_profile(sec_user_id)
                user_nickname = user_profile.nickname if user_profile else "未知用户"
                user_path = await handler.get_or_add_user_data(config, sec_user_id, audb)

            await emit(
                "user_started",
                f"开始下载用户: {user_nickname}",
                {"sec_user_id": sec_user_id, "nickname": user_nickname},
            )

            existing_times: set[str] = set()
            incremental_mode = bool(config.get("incremental_mode", False))
            incremental_threshold = int(config.get("incremental_threshold", 3))
            consecutive_existing_count = 0

            if incremental_mode:
                existing_times = self.get_existing_video_times(user_path)

            video_count = 0
            new_video_count = 0
            skipped_count = 0
            exif_stats: dict[str, Any] = {
                "files_scanned": 0,
                "updated_files": 0,
                "failed_files": 0,
            }

            exif_aweme_data: list[dict[str, Any]] = []

            async for aweme_list in handler.fetch_user_post_videos(
                sec_user_id=sec_user_id,
                min_cursor=0,
                max_cursor=0,
                page_counts=config.get("page_counts", 20),
                max_counts=config.get("max_counts"),
            ):
                if cancel_event.is_set():
                    break

                if not aweme_list:
                    continue

                aweme_data_list = aweme_list._to_list()
                page_skipped_count = 0
                stop_after_page = False

                if incremental_mode:
                    filtered_list: list[dict[str, Any]] = []
                    for aweme_data in aweme_data_list:
                        create_time = aweme_data.get("create_time", "")
                        if create_time in existing_times:
                            skipped_count += 1
                            page_skipped_count += 1
                            consecutive_existing_count += 1
                            await emit(
                                "item_skipped",
                                f"跳过已存在作品: {create_time}",
                                {"create_time": create_time, "nickname": user_nickname},
                            )
                        else:
                            filtered_list.append(aweme_data)
                            consecutive_existing_count = 0

                    if consecutive_existing_count >= incremental_threshold:
                        await emit(
                            "user_info",
                            (
                                f"用户 {user_nickname} 连续遇到 "
                                f"{consecutive_existing_count} 个已存在作品，停止增量抓取"
                            ),
                            {
                                "nickname": user_nickname,
                                "threshold": incremental_threshold,
                                "consecutive_existing_count": consecutive_existing_count,
                            },
                        )
                        stop_after_page = True

                    aweme_data_list = filtered_list

                if aweme_data_list:
                    await downloader.create_download_tasks(config, aweme_data_list, user_path)
                    if config.get("update_exif", False):
                        exif_aweme_data.extend(list(aweme_data_list))

                    # 合成 live 图为安卓 Motion Photo
                    if config.get("live_compose", False):
                        from app.core.live_composer import process_live_photos

                        compose_stats = await asyncio.to_thread(
                            process_live_photos,
                            user_path,
                            aweme_data_list,
                            config.get("naming"),
                            config.get("folderize", False),
                        )
                        if compose_stats["composed"] > 0:
                            await emit(
                                "live_composed",
                                f"合成 {compose_stats['composed']} 个实况照片为 Motion Photo",
                                {
                                    "nickname": user_nickname,
                                    "composed": compose_stats["composed"],
                                    "failed": compose_stats["failed"],
                                },
                            )

                    new_video_count += len(aweme_data_list)
                    await emit(
                        "item_downloaded",
                        f"用户 {user_nickname} 下载 {len(aweme_data_list)} 个作品",
                        {
                            "nickname": user_nickname,
                            "batch_downloaded": len(aweme_data_list),
                            "new_total": new_video_count,
                            "skipped_total": skipped_count,
                        },
                    )

                video_count += len(aweme_data_list) + page_skipped_count

                await emit(
                    "user_progress",
                    f"用户 {user_nickname} 已处理 {video_count} 个作品",
                    {
                        "nickname": user_nickname,
                        "processed": video_count,
                        "new": new_video_count,
                        "skipped": skipped_count,
                    },
                )

                if stop_after_page:
                    break

            if config.get("update_exif", False) and exif_aweme_data:
                exif_stats = await asyncio.to_thread(
                    self.process_downloaded_files,
                    user_path,
                    exif_aweme_data,
                )
                failed_list = exif_stats.get("failed_list", [])
                failed_detail = ""
                if failed_list:
                    # 最多列出 20 个失败文件名
                    shown = failed_list[:20]
                    failed_detail = "，失败文件: " + ", ".join(shown)
                    if len(failed_list) > 20:
                        failed_detail += f" ...等共 {len(failed_list)} 个"

                await emit(
                    "user_info",
                    (
                        f"用户 {user_nickname} 媒体 EXIF 更新完成 | "
                        f"扫描 {int(exif_stats['files_scanned'])}，"
                        f"跳过 {int(exif_stats.get('skipped_files', 0))}，"
                        f"成功 {int(exif_stats['updated_files'])}，"
                        f"失败 {int(exif_stats.get('failed_files', 0))}，"
                        f"耗时 {exif_stats['elapsed_seconds']} 秒"
                        f"{failed_detail}"
                    ),
                    {"nickname": user_nickname, "exif_stats": exif_stats},
                )
            elif config.get("update_exif", False):
                await emit(
                    "user_info",
                    f"用户 {user_nickname} 本轮无新下载作品，跳过 EXIF 更新",
                    {
                        "nickname": user_nickname,
                        "exif_stats": exif_stats,
                    },
                )

            await emit(
                "user_completed",
                f"用户 {user_nickname} 下载完成，新增 {new_video_count}，跳过 {skipped_count}",
                {
                    "nickname": user_nickname,
                    "new": new_video_count,
                    "skipped": skipped_count,
                    "success": True,
                },
            )
            return True, new_video_count, skipped_count, user_nickname, exif_stats, None
        except Exception as exc:
            short_id = sec_user_id[:15]
            await emit(
                "user_failed",
                f"用户 {short_id} 下载失败: {exc}",
                {"sec_user_id": sec_user_id, "error": str(exc)},
            )
            return (
                False,
                0,
                0,
                short_id,
                {"files_scanned": 0, "updated_files": 0, "failed_files": 0},
                str(exc),
            )

    async def run(
        self,
        settings: DownloaderSettings,
        user_list: list[UserTarget],
        emit: EventEmitter,
        cancel_event: asyncio.Event,
        stream_id: str | None = None,
    ) -> TaskResult:
        # Lazy import: avoid heavy/side-effect imports during API startup.
        from f2.apps.douyin.db import AsyncUserDB
        from f2.apps.douyin.dl import DouyinDownloader
        from f2.apps.douyin.handler import DouyinHandler
        from f2.apps.douyin.utils import SecUserIdFetcher
        from f2.log.logger import logger as f2_logger
        from f2.utils.utils import extract_valid_urls

        if not settings.douyin_cookie.strip():
            raise ValueError("Cookie 为空，请先在设置页填写后再启动任务")

        if not user_list:
            raise ValueError("用户列表为空，请至少配置一个用户链接或 sec_user_id")

        ensure_time_based_features_support_naming(
            settings.naming,
            update_exif=settings.update_exif,
            incremental_mode=settings.incremental_mode,
        )

        Path(settings.download_path).mkdir(parents=True, exist_ok=True)
        self._state_dir.mkdir(parents=True, exist_ok=True)
        users_db_path = self._state_dir / "douyin_users.db"

        config = self._build_f2_config(settings)
        handler = DouyinHandler(config)
        downloader = DouyinDownloader(config)
        loop = asyncio.get_running_loop()
        bridge_handler = EmitBridgeLogHandler(loop, emit, stream_id=stream_id)
        f2_logger.addHandler(bridge_handler)
        stream_token: contextvars.Token[str | None] | None = None
        if stream_id:
            stream_token = CURRENT_LOG_STREAM_ID.set(stream_id)

        try:
            user_ids: list[str] = []
            user_urls: list[str] = []

            for user_target in user_list:
                item = user_target.url.strip()
                if not item:
                    continue
                if item.startswith(("http://", "https://")):
                    user_urls.append(item)
                else:
                    user_ids.append(item)

            if user_urls:
                valid_urls = extract_valid_urls(user_urls) or []
                url_user_ids = await SecUserIdFetcher.get_all_sec_user_id(valid_urls)
                user_ids.extend([uid for uid in url_user_ids if uid])

            user_ids = list(dict.fromkeys(user_ids))
            if not user_ids:
                raise ValueError("未找到有效用户 ID，请检查输入")

            stats = {
                "total": len(user_ids),
                "success": 0,
                "failed": 0,
                "total_new": 0,
                "total_skipped": 0,
                "total_exif_scanned": 0,
                "total_exif_updated": 0,
                "total_exif_failed": 0,
                "users": [],
            }

            semaphore = asyncio.Semaphore(settings.max_tasks)

            async def limited_download(user_id: str) -> None:
                if cancel_event.is_set():
                    return

                async with semaphore:
                    if cancel_event.is_set():
                        return

                    try:
                        success, new_count, skipped_count, nickname, exif_stats, error_message = (
                            await self._download_user_videos(
                                handler,
                                downloader,
                                config,
                                user_id,
                                users_db_path,
                                emit,
                                cancel_event,
                                AsyncUserDB,
                            )
                        )
                    except Exception as exc:
                        short_id = user_id[:15]
                        await emit(
                            "user_failed",
                            f"用户 {short_id} 下载失败: {exc}",
                            {"sec_user_id": user_id, "error": str(exc)},
                        )
                        success, new_count, skipped_count, nickname, exif_stats, error_message = (
                            False,
                            0,
                            0,
                            short_id,
                            {"files_scanned": 0, "updated_files": 0, "failed_files": 0},
                            str(exc),
                        )

                    user_stat = UserStat(
                        nickname=nickname,
                        success=success,
                        new=new_count,
                        skipped=skipped_count,
                        status="✅" if success else "❌",
                        exif_scanned=int(exif_stats.get("files_scanned", 0)),
                        exif_updated=int(exif_stats.get("updated_files", 0)),
                        exif_failed=int(exif_stats.get("failed_files", 0)),
                        error=error_message,
                    )
                    stats["users"].append(user_stat)
                    stats["total_exif_scanned"] += user_stat.exif_scanned
                    stats["total_exif_updated"] += user_stat.exif_updated
                    stats["total_exif_failed"] += user_stat.exif_failed

                    if success:
                        stats["success"] += 1
                        stats["total_new"] += new_count
                        stats["total_skipped"] += skipped_count
                    else:
                        stats["failed"] += 1

            tasks = [asyncio.create_task(limited_download(uid)) for uid in user_ids]
            await asyncio.gather(*tasks)

            return TaskResult(
                total=stats["total"],
                success=stats["success"],
                failed=stats["failed"],
                total_new=stats["total_new"],
                total_skipped=stats["total_skipped"],
                total_exif_scanned=stats["total_exif_scanned"],
                total_exif_updated=stats["total_exif_updated"],
                total_exif_failed=stats["total_exif_failed"],
                users=stats["users"],
            )
        finally:
            if stream_token is not None:
                CURRENT_LOG_STREAM_ID.reset(stream_token)
            f2_logger.removeHandler(bridge_handler)
            bridge_handler.close()
