#!/usr/bin/env python3
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import re
import textwrap


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "bot-logic-audit.md"
OUTPUT = ROOT / "docs" / "Accident_Support_Desk_Bot_Logic_Audit.pdf"

PAGE_W, PAGE_H = 1654, 2339
MARGIN_X = 105
MARGIN_Y = 105
FOOTER_Y = PAGE_H - 76
CONTENT_W = PAGE_W - (MARGIN_X * 2)
LINE_SPACING = 8

COLORS = {
    "ink": "#172033",
    "muted": "#5d6778",
    "soft": "#eef3f2",
    "line": "#d7dfdc",
    "green": "#235e54",
    "amber": "#b6500b",
    "red": "#9f2f24",
}


def load_font(size, bold=False):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Helvetica.ttf",
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
    "title": load_font(40, True),
    "h2": load_font(27, True),
    "h3": load_font(23, True),
    "body": load_font(19),
    "body_bold": load_font(19, True),
    "small": load_font(16),
    "tiny": load_font(14),
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
            continue
        if current:
            lines.append(current)
        if text_width(draw, word, font) > max_width:
            chunks = textwrap.wrap(word, width=32, break_long_words=True, break_on_hyphens=False)
            lines.extend(chunks[:-1])
            current = chunks[-1] if chunks else ""
        else:
            current = word
    if current:
        lines.append(current)
    return lines


def draw_header(draw):
    draw.rectangle((0, 0, PAGE_W, 46), fill=COLORS["green"])
    draw.text((MARGIN_X, 13), "Accident Support Desk Bot Logic Audit", font=FONTS["small"], fill="#ffffff")
    draw.text((PAGE_W - MARGIN_X - 265, 13), "Internal Ops Source Of Truth", font=FONTS["small"], fill="#ffffff")


def draw_footer(draw, page_num):
    draw.line((MARGIN_X, FOOTER_Y - 14, PAGE_W - MARGIN_X, FOOTER_Y - 14), fill=COLORS["line"], width=2)
    draw.text((MARGIN_X, FOOTER_Y), "Editable master: docs/bot-logic-audit.md", font=FONTS["tiny"], fill=COLORS["muted"])
    page_label = f"Page {page_num}"
    draw.text((PAGE_W - MARGIN_X - text_width(draw, page_label, FONTS["tiny"]), FOOTER_Y), page_label, font=FONTS["tiny"], fill=COLORS["muted"])


def new_page(page_num):
    page = Image.new("RGB", (PAGE_W, PAGE_H), "#ffffff")
    draw = ImageDraw.Draw(page)
    draw_header(draw)
    return page, draw, MARGIN_Y


def finish_page(page, page_num):
    draw = ImageDraw.Draw(page)
    draw_footer(draw, page_num)


def markdown_inline(text):
    text = text.replace("**", "")
    text = text.replace("`", "")
    return text


def ensure_page(pages, page, draw, y, page_num, needed):
    if y + needed <= FOOTER_Y - 24:
        return page, draw, y, page_num
    finish_page(page, page_num)
    pages.append(page)
    page_num += 1
    return (*new_page(page_num), page_num)


def add_block(pages, page, draw, y, page_num, text, font, fill=None, indent=0, gap_after=10, leading=None):
    fill = fill or COLORS["ink"]
    leading = leading if leading is not None else font.size + LINE_SPACING
    text = markdown_inline(text)
    lines = wrap_text(draw, text, font, CONTENT_W - indent)
    needed = len(lines) * leading + gap_after
    page, draw, y, page_num = ensure_page(pages, page, draw, y, page_num, needed)
    for line in lines:
        draw.text((MARGIN_X + indent, y), line, font=font, fill=fill)
        y += leading
    y += gap_after
    return page, draw, y, page_num


def add_rule_bar(draw, y, color):
    draw.rounded_rectangle((MARGIN_X, y, PAGE_W - MARGIN_X, y + 8), radius=4, fill=color)


def line_style(line):
    stripped = line.strip()
    if not stripped:
        return "blank", stripped
    if stripped.startswith("# "):
        return "title", stripped[2:]
    if stripped.startswith("## "):
        return "h2", stripped[3:]
    if stripped.startswith("### "):
        return "h3", stripped[4:]
    if stripped.startswith("- "):
        return "bullet", f"- {stripped[2:]}"
    if re.match(r"^\d+\.\s", stripped):
        return "numbered", stripped
    if re.match(r"^GAP-\d{3}:", stripped):
        return "gap", stripped
    if stripped.startswith("Priority:"):
        return "priority", stripped
    if stripped.startswith("Current:") or stripped.startswith("Expected:") or stripped.startswith("Risk:") or stripped.startswith("Example:") or stripped.startswith("Required fix/test:"):
        return "field", stripped
    if stripped in {"Must Never Happen", "Must Always Happen", "Highest-Risk Failure Points"}:
        return "h3", stripped
    return "body", stripped


def render_pdf():
    source = SOURCE.read_text(encoding="utf-8")
    pages = []
    page_num = 1
    page, draw, y = new_page(page_num)

    for raw in source.splitlines():
        style, text = line_style(raw)
        if style == "blank":
            y += 8
            continue
        if style == "title":
            page, draw, y, page_num = ensure_page(pages, page, draw, y, page_num, 110)
            add_rule_bar(draw, y, COLORS["amber"])
            y += 26
            page, draw, y, page_num = add_block(pages, page, draw, y, page_num, text, FONTS["title"], COLORS["green"], gap_after=18, leading=50)
            continue
        if style == "h2":
            page, draw, y, page_num = ensure_page(pages, page, draw, y, page_num, 72)
            y += 10
            add_rule_bar(draw, y, COLORS["green"])
            y += 20
            page, draw, y, page_num = add_block(pages, page, draw, y, page_num, text, FONTS["h2"], COLORS["green"], gap_after=12, leading=36)
            continue
        if style == "h3":
            page, draw, y, page_num = add_block(pages, page, draw, y + 8, page_num, text, FONTS["h3"], COLORS["amber"], gap_after=8, leading=31)
            continue
        if style == "gap":
            page, draw, y, page_num = ensure_page(pages, page, draw, y, page_num, 80)
            draw.rounded_rectangle((MARGIN_X - 8, y - 6, PAGE_W - MARGIN_X, y + 31), radius=8, fill=COLORS["soft"])
            page, draw, y, page_num = add_block(pages, page, draw, y, page_num, text, FONTS["body_bold"], COLORS["red"], gap_after=7, leading=27)
            continue
        if style == "priority":
            color = COLORS["red"] if "P0" in text or "P1" in text else COLORS["amber"]
            page, draw, y, page_num = add_block(pages, page, draw, y, page_num, text, FONTS["body_bold"], color, indent=28, gap_after=5, leading=26)
            continue
        if style == "field":
            page, draw, y, page_num = add_block(pages, page, draw, y, page_num, text, FONTS["body"], COLORS["ink"], indent=28, gap_after=5, leading=26)
            continue
        if style == "bullet":
            page, draw, y, page_num = add_block(pages, page, draw, y, page_num, text, FONTS["body"], COLORS["ink"], indent=22, gap_after=5, leading=26)
            continue
        if style == "numbered":
            page, draw, y, page_num = add_block(pages, page, draw, y, page_num, text, FONTS["body"], COLORS["ink"], indent=18, gap_after=5, leading=26)
            continue
        page, draw, y, page_num = add_block(pages, page, draw, y, page_num, text, FONTS["body"], COLORS["ink"], gap_after=9, leading=27)

    finish_page(page, page_num)
    pages.append(page)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    pages[0].save(OUTPUT, "PDF", resolution=150.0, save_all=True, append_images=pages[1:])
    print(f"Wrote {OUTPUT}")
    print(f"Pages: {len(pages)}")


if __name__ == "__main__":
    render_pdf()
