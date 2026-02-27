#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]


def _lerp(a: int, b: int, t: float) -> int:
    return int(a + (b - a) * t)


def _vertical_gradient(size: int, top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    image = Image.new("RGBA", (size, size))
    draw = ImageDraw.Draw(image)
    for y in range(size):
        t = y / max(size - 1, 1)
        r = _lerp(top[0], bottom[0], t)
        g = _lerp(top[1], bottom[1], t)
        b = _lerp(top[2], bottom[2], t)
        draw.line((0, y, size, y), fill=(r, g, b, 255))
    return image


def _add_glow(
    image: Image.Image,
    center: tuple[int, int],
    radius: int,
    color: tuple[int, int, int],
    alpha: int,
) -> Image.Image:
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    cx, cy = center
    step = 6
    for r in range(radius, 0, -step):
        t = r / radius
        a = int(alpha * (t**2))
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(*color, a))
    overlay = overlay.filter(ImageFilter.GaussianBlur(18))
    return Image.alpha_composite(image, overlay)


def _build_icon(size: int = 1024) -> Image.Image:
    icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    bg = _vertical_gradient(size, (20, 115, 255), (44, 211, 191))
    bg = _add_glow(bg, (size * 18 // 100, size * 16 // 100), size * 46 // 100, (255, 255, 255), 140)
    bg = _add_glow(bg, (size * 85 // 100, size * 92 // 100), size * 44 // 100, (0, 35, 110), 96)

    corner = size * 22 // 100
    inset = size * 3 // 100
    mask = Image.new("L", (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle(
        (inset, inset, size - inset, size - inset),
        radius=corner,
        fill=255,
    )
    icon.paste(bg, (0, 0), mask)

    border = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    border_draw = ImageDraw.Draw(border)
    border_draw.rounded_rectangle(
        (inset + 2, inset + 2, size - inset - 2, size - inset - 2),
        radius=corner - 2,
        outline=(255, 255, 255, 145),
        width=max(3, size // 220),
    )
    icon = Image.alpha_composite(icon, border)

    panel = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    panel_draw = ImageDraw.Draw(panel)
    panel_box = (
        size * 18 // 100,
        size * 20 // 100,
        size * 82 // 100,
        size * 78 // 100,
    )
    panel_radius = size * 15 // 100
    panel_draw.rounded_rectangle(
        panel_box,
        radius=panel_radius,
        fill=(255, 255, 255, 76),
        outline=(255, 255, 255, 145),
        width=max(2, size // 340),
    )
    panel = panel.filter(ImageFilter.GaussianBlur(size // 220))
    icon = Image.alpha_composite(icon, panel)

    glyph = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glyph)
    cx = size // 2
    shaft_top = size * 31 // 100
    shaft_bottom = size * 50 // 100
    line_w = max(12, size // 22)
    gdraw.line((cx, shaft_top, cx, shaft_bottom), fill=(255, 255, 255, 246), width=line_w)
    gdraw.polygon(
        [
            (cx - size * 8 // 100, shaft_bottom - size * 2 // 100),
            (cx + size * 8 // 100, shaft_bottom - size * 2 // 100),
            (cx, size * 61 // 100),
        ],
        fill=(255, 255, 255, 246),
    )

    tray_left = size * 30 // 100
    tray_top = size * 61 // 100
    tray_right = size * 70 // 100
    tray_bottom = size * 71 // 100
    gdraw.rounded_rectangle(
        (tray_left, tray_top, tray_right, tray_bottom),
        radius=size * 4 // 100,
        outline=(255, 255, 255, 246),
        width=max(8, size // 30),
    )
    icon = Image.alpha_composite(icon, glyph)

    return icon


def _write_icons(base: Image.Image) -> None:
    outputs: dict[int, list[Path]] = {
        1024: [ROOT / "ICON.PNG"],
        256: [
            ROOT / "ICON_256.PNG",
            ROOT / "app" / "ui" / "images" / "icon_256.png",
            ROOT / "app" / "ui" / "images" / "icon-256.png",
        ],
        64: [
            ROOT / "app" / "ui" / "images" / "icon_64.png",
            ROOT / "app" / "ui" / "images" / "icon-64.png",
        ],
    }

    for size, files in outputs.items():
        icon = base if size == base.width else base.resize((size, size), Image.Resampling.LANCZOS)
        for file in files:
            file.parent.mkdir(parents=True, exist_ok=True)
            icon.save(file, format="PNG", optimize=True)


def main() -> None:
    base = _build_icon(1024)
    _write_icons(base)
    preview_file = ROOT / "app" / "ui" / "images" / "icon-preview.png"
    base.resize((512, 512), Image.Resampling.LANCZOS).save(preview_file, format="PNG", optimize=True)
    print(f"Generated icon assets at: {ROOT}")


if __name__ == "__main__":
    main()
