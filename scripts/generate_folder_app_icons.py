#!/usr/bin/env python3
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]


def draw_folder_icon(size: int, rounded_bg: bool = True) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    gold = (217, 163, 38, 255)
    bg = (250, 247, 238, 255)

    pad = int(size * 0.08)
    radius = int(size * 0.16)

    if rounded_bg:
        d.rounded_rectangle([pad, pad, size - pad, size - pad], radius=radius, fill=bg)

    stroke = max(2, int(size * 0.055))
    left = int(size * 0.22)
    top = int(size * 0.34)
    right = int(size * 0.78)
    bottom = int(size * 0.72)

    tab_w = int(size * 0.20)
    tab_h = int(size * 0.08)

    # Folder path-like shape (outline)
    path = [
        (left, top + tab_h),
        (left + tab_w, top + tab_h),
        (left + tab_w + int(size * 0.06), top),
        (right, top),
        (right, bottom),
        (left, bottom),
        (left, top + tab_h),
    ]
    d.line(path, fill=gold, width=stroke, joint="curve")

    return img


def ensure_dir(p: Path):
    p.mkdir(parents=True, exist_ok=True)


def save_android_icons(base_img: Image.Image):
    android_res = ROOT / "android" / "app" / "src" / "main" / "res"
    sizes = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }

    fg_sizes = {
        "mipmap-mdpi": 108,
        "mipmap-hdpi": 162,
        "mipmap-xhdpi": 216,
        "mipmap-xxhdpi": 324,
        "mipmap-xxxhdpi": 432,
    }

    for folder, px in sizes.items():
        p = android_res / folder
        ensure_dir(p)
        icon = base_img.resize((px, px), Image.Resampling.LANCZOS)
        icon.save(p / "ic_launcher.png")
        icon.save(p / "ic_launcher_round.png")

    for folder, px in fg_sizes.items():
        p = android_res / folder
        ensure_dir(p)
        fg = draw_folder_icon(px, rounded_bg=False)
        fg.save(p / "ic_launcher_foreground.png")


def save_electron_icons(base_img: Image.Image):
    build_dir = ROOT / "electron" / "build"
    ensure_dir(build_dir)

    png_512 = base_img.resize((512, 512), Image.Resampling.LANCZOS)
    png_512.save(build_dir / "icon.png")

    ico_source = base_img.resize((256, 256), Image.Resampling.LANCZOS)
    ico_source.save(
        build_dir / "icon.ico",
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )


def save_web_favicon(base_img: Image.Image):
    public_dir = ROOT / "public"
    ensure_dir(public_dir)
    fav = base_img.resize((64, 64), Image.Resampling.LANCZOS)
    fav.save(public_dir / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])


if __name__ == "__main__":
    base = draw_folder_icon(1024, rounded_bg=True)
    save_android_icons(base)
    save_electron_icons(base)
    save_web_favicon(base)
    print("Generated folder app icons for Android, Electron, and favicon.")
