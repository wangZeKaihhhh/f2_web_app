"""安卓 Motion Photo 合成模块。

将抖音 live 图（_image_N.webp + _live_N.mp4）合成为安卓 Motion Photo 格式（_motion_N.jpg）。
原理：JPG 字节 + MP4 字节直接拼接，通过 XMP-GCamera 元数据标识视频偏移量。
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)


def _has_command(cmd: str) -> bool:
    return shutil.which(cmd) is not None


def _run(args: list[str], timeout: int = 60) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args, capture_output=True, text=True, timeout=timeout, check=True
    )


def compose_motion_photo(
    image_path: Path, video_path: Path, output_path: Path
) -> list[str]:
    """将一张 webp 图片和一个 mp4 视频合成为安卓 Motion Photo。

    Returns:
        warnings: 合成过程中的警告列表（空列表表示完全成功）
    """
    warnings: list[str] = []
    has_exiftool = _has_command("exiftool")

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp = Path(tmp_dir)
        normalized_jpg = tmp / "normalized.jpg"
        normalized_mp4 = tmp / "normalized.mp4"

        # webp → jpg
        _run([
            "ffmpeg", "-y", "-i", str(image_path),
            "-q:v", "1", str(normalized_jpg),
        ])

        # mp4 标准化（仅 remux，不重编码）
        _run([
            "ffmpeg", "-y", "-i", str(video_path),
            "-c", "copy", "-movflags", "+faststart", str(normalized_mp4),
        ])

        video_size = normalized_mp4.stat().st_size

        # 写 XMP-GCamera 元数据
        if has_exiftool:
            try:
                _run([
                    "exiftool", "-overwrite_original",
                    "-XMP-GCamera:MotionPhoto=1",
                    "-XMP-GCamera:MotionPhotoVersion=1",
                    "-XMP-GCamera:MicroVideo=1",
                    f"-XMP-GCamera:MicroVideoOffset={video_size}",
                    "-XMP-GCamera:MotionPhotoPresentationTimestampUs=1500000",
                    str(normalized_jpg),
                ])
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
                warnings.append(f"exiftool 写入元数据失败，退化为裸拼接: {e}")
        else:
            warnings.append("exiftool 未安装，跳过元数据写入，部分安卓系统可能不识别")

        # 拼接 jpg + mp4
        jpg_bytes = normalized_jpg.read_bytes()
        mp4_bytes = normalized_mp4.read_bytes()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(jpg_bytes + mp4_bytes)

    return warnings


def process_live_photos(
    user_path: Path,
    aweme_data_list: list[dict],
    naming: str | None,
    folderize: bool = False,
) -> dict:
    """批量处理 live 图合成。

    遍历作品列表，将 live 图（aweme_type=68 且 images_video 非空）合成为 Motion Photo，
    删除原始分离文件。

    Returns:
        {"composed": int, "failed": int, "skipped": int, "warnings": list[str]}
    """
    # 延迟导入，避免顶层依赖 f2
    from f2.apps.douyin.utils import format_file_name

    if not _has_command("ffmpeg"):
        logger.warning("ffmpeg 未安装，跳过 live 图合成")
        return {"composed": 0, "failed": 0, "skipped": 0, "warnings": ["ffmpeg 未安装"]}

    stats = {"composed": 0, "failed": 0, "skipped": 0, "warnings": []}
    naming_tmpl = naming or "{create}_{desc}"

    for aweme_data in aweme_data_list:
        if aweme_data.get("aweme_type") != 68:
            continue

        images = aweme_data.get("images", [])
        images_video = aweme_data.get("images_video", [])
        if not images_video:
            continue

        if len(images) != len(images_video):
            stats["skipped"] += 1
            stats["warnings"].append(
                f"作品 {aweme_data.get('aweme_id')} 图片数({len(images)})≠视频数({len(images_video)})，跳过"
            )
            continue

        prefix = format_file_name(naming_tmpl, aweme_data)
        base_path = user_path / prefix if folderize else user_path

        for i in range(len(images)):
            idx = i + 1
            image_file = base_path / f"{prefix}_image_{idx}.webp"
            video_file = base_path / f"{prefix}_live_{idx}.mp4"
            motion_file = base_path / f"{prefix}_motion_{idx}.jpg"

            if not image_file.exists() or not video_file.exists():
                logger.debug("跳过不存在的配对: %s / %s", image_file.name, video_file.name)
                continue

            try:
                warnings = compose_motion_photo(image_file, video_file, motion_file)
                stats["warnings"].extend(warnings)

                # 合成成功后删除原始文件
                os.remove(image_file)
                os.remove(video_file)
                stats["composed"] += 1
                logger.info("合成 Motion Photo: %s", motion_file.name)
            except Exception as e:
                stats["failed"] += 1
                stats["warnings"].append(f"合成失败 {image_file.name}: {e}")
                logger.error("合成失败 %s: %s", image_file.name, e)

    return stats
