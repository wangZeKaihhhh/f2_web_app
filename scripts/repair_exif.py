#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.core.crawler_service import DouyinCrawlerService


def collect_files_by_timestamp(root: Path) -> tuple[dict[float, list[Path]], dict[str, int]]:
    grouped: dict[float, list[Path]] = defaultdict(list)
    stats = {"files_scanned": 0, "matched_files": 0}

    for file_path in root.rglob("*"):
        if not file_path.is_file():
            continue

        stats["files_scanned"] += 1
        match = DouyinCrawlerService.FILE_TIME_PATTERN.search(file_path.name)
        if not match:
            continue

        timestamp = DouyinCrawlerService._parse_create_time_timestamp(match.group(1))
        if timestamp is None:
            continue

        grouped[timestamp].append(file_path)
        stats["matched_files"] += 1

    return grouped, stats


def apply_updates(
    grouped_files: dict[float, list[Path]],
    *,
    workers: int,
    chunk_size: int,
) -> tuple[int, list[str]]:
    updated = 0
    failed_files: list[str] = []

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(
                DouyinCrawlerService.update_media_exif_batch,
                paths,
                timestamp,
                chunk_size,
            ): timestamp
            for timestamp, paths in grouped_files.items()
        }
        for future in as_completed(futures):
            ok_count, fail_names = future.result()
            updated += ok_count
            failed_files.extend(fail_names)

    return updated, failed_files


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="按文件名中的创建时间批量回填媒体 EXIF。默认只预览，不写入。"
    )
    parser.add_argument(
        "root",
        type=Path,
        help="要扫描的目录，例如 backend/.runtime/downloads/douyin/post",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="实际写入 EXIF；不传时只做统计预览",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=8,
        help="并行 worker 数，默认 8",
    )
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=50,
        help="单次 exiftool 批处理文件数，默认 50",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = args.root.expanduser().resolve()

    if not root.exists() or not root.is_dir():
        print(f"目录不存在或不可读: {root}", file=sys.stderr)
        return 1

    grouped_files, scan_stats = collect_files_by_timestamp(root)
    candidate_files = sum(len(paths) for paths in grouped_files.values())

    print(f"扫描目录: {root}")
    print(f"扫描文件: {scan_stats['files_scanned']}")
    print(f"匹配文件: {scan_stats['matched_files']}")
    print(f"时间分组: {len(grouped_files)}")

    if not args.apply:
        print("当前为预览模式。追加 --apply 后才会实际写入 EXIF。")
        return 0

    if shutil.which("exiftool") is None:
        print("未找到 exiftool，无法执行写入。", file=sys.stderr)
        return 1

    updated, failed_files = apply_updates(
        grouped_files,
        workers=max(1, args.workers),
        chunk_size=max(1, args.chunk_size),
    )

    print(f"写入成功: {updated}")
    print(f"写入失败: {len(failed_files)}")
    if failed_files:
        preview = ", ".join(failed_files[:20])
        suffix = "" if len(failed_files) <= 20 else f" ...等共 {len(failed_files)} 个"
        print(f"失败文件: {preview}{suffix}")

    if updated + len(failed_files) != candidate_files:
        print(
            "警告: 成功数与失败数之和少于候选文件数，请检查 exiftool 输出或文件访问权限。",
            file=sys.stderr,
        )

    return 0 if not failed_files else 2


if __name__ == "__main__":
    raise SystemExit(main())
