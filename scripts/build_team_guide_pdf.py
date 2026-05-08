#!/usr/bin/env python3
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import textwrap


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "team-guide.md"
OUTPUT = ROOT / "docs" / "Accident_Support_Desk_SMS_Bot_Team_Guide.pdf"

PAGE_W, PAGE_H = 1654, 2339
MARGIN_X = 130
MARGIN_Y = 120
CONTENT_W = PAGE_W - (MARGIN_X * 2)
LINE_SPACING = 10


def load_font(size, bold=False):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial.ttf",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size=size)
        except Exception:
            continue
    return ImageFont.load_default()


FONTS = {
    "title": load_font(42, True),
    "h2": load_font(30, True),
    "body": load_font(24),
    "body_bold": load_font(24, True),
    "small": load_font(20),
}


def text_width(draw, text, font):
    box = draw.textbbox((0, 0), text, font=font)
    return box[2] - box[0]


def wrap_text(draw, text, font, max_width):
    if not text:
        return [""]
    words = text.split()
    lines = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if text_width(draw, candidate, font) <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            if text_width(draw, word, font) > max_width:
                lines.extend(textwrap.wrap(word, width=28))
                current = ""
            else:
                current = word
    if current:
        lines.append(current)
    return lines


def new_page():
    page = Image.new("RGB", (PAGE_W, PAGE_H), "#ffffff")
    draw = ImageDraw.Draw(page)
    draw.rectangle((0, 0, PAGE_W, 32), fill="#2f7468")
    return page, draw, MARGIN_Y


def add_wrapped(pages, page, draw, y, text, font, fill="#1f2933", indent=0, gap_after=16):
    lines = wrap_text(draw, text, font, CONTENT_W - indent)
    line_h = font.size + LINE_SPACING
    needed = len(lines) * line_h + gap_after
    if y + needed > PAGE_H - MARGIN_Y:
        pages.append(page)
        page, draw, y = new_page()
    for line in lines:
        draw.text((MARGIN_X + indent, y), line, font=font, fill=fill)
        y += line_h
    y += gap_after
    return page, draw, y


def render_pdf():
    source = SOURCE.read_text(encoding="utf-8")
    pages = []
    page, draw, y = new_page()

    for raw in source.splitlines():
        line = raw.rstrip()
        if not line:
            y += 14
            continue
        if line.startswith("# "):
            page, draw, y = add_wrapped(pages, page, draw, y, line[2:], FONTS["title"], "#12352f", gap_after=18)
            continue
        if line.startswith("## "):
            y += 10
            page, draw, y = add_wrapped(pages, page, draw, y, line[3:], FONTS["h2"], "#2f7468", gap_after=12)
            continue
        if line.startswith("- "):
            page, draw, y = add_wrapped(pages, page, draw, y, f"- {line[2:]}", FONTS["body"], indent=24, gap_after=6)
            continue
        if line[:2].isdigit() and ". " in line[:5]:
            page, draw, y = add_wrapped(pages, page, draw, y, line, FONTS["body"], indent=20, gap_after=6)
            continue
        if line.startswith("Example:") or line.startswith("Lead:") or line.startswith("Bot:"):
            page, draw, y = add_wrapped(pages, page, draw, y, line, FONTS["body_bold"], "#374151", gap_after=8)
            continue
        page, draw, y = add_wrapped(pages, page, draw, y, line, FONTS["body"], gap_after=10)

    pages.append(page)
    pages[0].save(OUTPUT, "PDF", resolution=150.0, save_all=True, append_images=pages[1:])
    print(OUTPUT)


if __name__ == "__main__":
    render_pdf()
