#!/usr/bin/env python3
from pathlib import Path
import html
import re
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
HANDOFF = ROOT / "docs" / "handoff"
SOURCE = HANDOFF / "COMPLETE_HANDOFF_GUIDE.md"
HTML_OUTPUT = HANDOFF / "Complete_Handoff_Guide.html"
PDF_OUTPUT = HANDOFF / "Accident_Support_Desk_Complete_Handoff_Guide.pdf"

REPO_URL = "https://github.com/aileadzsudo/asdleads-sms-bot"
PRODUCTION_URL = "https://asdleads-sms-bot.onrender.com/"
DATABASE_EXPORT_PLACEHOLDER = "SECURE_DB_EXPORT_LINK_TO_BE_FILLED_BY_OWNER"

SECTIONS = [
    ("Quick Start", "QUICK_START_FOR_NEW_OPERATOR.md"),
    ("Implementation Manifest", "IMPLEMENTATION_MANIFEST.md"),
    ("Owner Export Checklist", "OWNER_EXPORT_CHECKLIST.md"),
    ("Recipient Setup Checklist", "RECIPIENT_SETUP_CHECKLIST.md"),
    ("Environment Variables", "ENVIRONMENT_VARIABLES.md"),
    ("GoHighLevel Workflows And Webhooks", "GHL_WORKFLOWS_AND_WEBHOOKS.md"),
    ("Database Transfer", "DATABASE_TRANSFER.md"),
    ("Validation Test Plan", "VALIDATION_TEST_PLAN.md"),
    ("Repo Update Strategy", "REPO_UPDATE_STRATEGY.md"),
    ("Export Package Checklist", "EXPORT_PACKAGE_CHECKLIST.md"),
]


def slugify(text):
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-") or "section"


def read(path):
    return path.read_text(encoding="utf-8").strip()


def build_markdown():
    toc = "\n".join(f"- [{title}](#{slugify(title)})" for title, _ in SECTIONS)
    parts = [
        "# Accident Support Desk Complete Handoff Guide",
        "",
        "This is the centralized handoff guide for cloning or transferring the Accident Support Desk SMS bot into another GoHighLevel account that is running the same personal-injury intake model.",
        "",
        "The smaller Markdown files in this folder remain the editable source references. This file and the PDF are the one-file handoff version.",
        "",
        "## Master Links",
        "",
        f"- GitHub repo: {REPO_URL}",
        f"- Current production URL: {PRODUCTION_URL}",
        f"- Secure database export link: {DATABASE_EXPORT_PLACEHOLDER}",
        "- Local handoff folder: docs/handoff/",
        "- Sanitized env template: docs/handoff/HANDOFF_ENV_TEMPLATE.env",
        "",
        "## Critical Security Rule",
        "",
        "Do not put live API keys, Slack tokens, GoHighLevel tokens, database URLs, Render secrets, or full customer/contact exports inside GitHub or this PDF.",
        "",
        "The PDF explains how to transfer the system. The live contacts/messages database should be transferred separately as an encrypted Postgres dump through a secure link or password manager.",
        "",
        "## What To Hand To Another Operator",
        "",
        "1. Access to the private GitHub repo or a private fork.",
        "2. This PDF and the docs/handoff folder.",
        "3. The sanitized env template.",
        "4. A secure encrypted database dump link, if cloning historical data is required.",
        "5. Their own GHL token, Slack token, OpenAI key, hosting account, Postgres database, calendar ID, and webhook secret.",
        "6. The validation test plan, completed before DRY_RUN is turned off.",
        "",
        "## Update Strategy Summary",
        "",
        "Best option: give the recipient a private fork of this repo and keep your repo as upstream. They can pull new tagged releases from you without sharing your production secrets or database.",
        "",
        "Do not give a recipient automatic live deploys from your main branch unless they are part of your same internal company and you trust every change to hit their production immediately.",
        "",
        "## Table Of Contents",
        "",
        toc,
        "",
    ]

    for title, filename in SECTIONS:
        path = HANDOFF / filename
        parts.extend([
            f"## {title}",
            "",
            f"Source file: docs/handoff/{filename}",
            "",
            read(path),
            "",
        ])

    env_template = read(HANDOFF / "HANDOFF_ENV_TEMPLATE.env")
    parts.extend([
        "## Sanitized Environment Template",
        "",
        "Copy this into the recipient hosting service and fill in their own values. Never reuse Collins' live secrets.",
        "",
        "```env",
        env_template,
        "```",
        "",
        "## Final Handoff Checklist",
        "",
        "- Repo access granted or private fork created.",
        "- Recipient hosting and Postgres created.",
        "- Recipient env vars entered with their own secrets.",
        "- GHL workflows created and tested.",
        "- Slack channels/app installed and tested.",
        "- OpenAI API key added if LLM gate is enabled.",
        "- Database restored only if needed and legally approved.",
        "- DRY_RUN=true for all tests.",
        "- Validation plan passed.",
        "- DRY_RUN=false only after old automation conflicts are disabled.",
        "- Uptime monitoring enabled on /health.",
        "",
    ])
    SOURCE.write_text("\n".join(parts), encoding="utf-8")


def inline_markdown(text):
    text = html.escape(text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', text)
    url_pattern = r"(?<![\"'=])(https?://[^\s<]+)"
    text = re.sub(url_pattern, r'<a href="\1">\1</a>', text)
    return text


def render_table(lines):
    rows = []
    for line in lines:
        cells = [inline_markdown(cell.strip()) for cell in line.strip().strip("|").split("|")]
        rows.append(cells)
    if len(rows) < 2:
        return ""
    header = rows[0]
    body = rows[2:] if re.match(r"^\s*\|?\s*:?-{3,}:?\s*\|", lines[1]) else rows[1:]
    out = ["<table>", "<thead><tr>"]
    out.extend(f"<th>{cell}</th>" for cell in header)
    out.append("</tr></thead><tbody>")
    for row in body:
        out.append("<tr>")
        out.extend(f"<td>{cell}</td>" for cell in row)
        out.append("</tr>")
    out.append("</tbody></table>")
    return "\n".join(out)


def markdown_to_html(markdown):
    html_lines = []
    lines = markdown.splitlines()
    i = 0
    in_ul = False
    in_ol = False
    in_code = False
    code_lang = ""
    code_lines = []

    def close_lists():
        nonlocal in_ul, in_ol
        if in_ul:
            html_lines.append("</ul>")
            in_ul = False
        if in_ol:
            html_lines.append("</ol>")
            in_ol = False

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if stripped.startswith("```"):
            if in_code:
                html_lines.append(f'<pre><code class="language-{html.escape(code_lang)}">{html.escape(chr(10).join(code_lines))}</code></pre>')
                in_code = False
                code_lines = []
                code_lang = ""
            else:
                close_lists()
                in_code = True
                code_lang = stripped[3:].strip()
            i += 1
            continue

        if in_code:
            code_lines.append(line)
            i += 1
            continue

        if stripped.startswith("|") and i + 1 < len(lines) and lines[i + 1].strip().startswith("|"):
            close_lists()
            table_lines = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                table_lines.append(lines[i])
                i += 1
            html_lines.append(render_table(table_lines))
            continue

        if not stripped:
            close_lists()
            i += 1
            continue

        heading = re.match(r"^(#{1,6})\s+(.+)$", stripped)
        if heading:
            close_lists()
            level = len(heading.group(1))
            title = heading.group(2)
            tag = f"h{level}"
            anchor = slugify(title)
            html_lines.append(f'<{tag} id="{anchor}">{inline_markdown(title)}</{tag}>')
            i += 1
            continue

        numbered = re.match(r"^\d+\.\s+(.+)$", stripped)
        if numbered:
            if in_ul:
                html_lines.append("</ul>")
                in_ul = False
            if not in_ol:
                html_lines.append("<ol>")
                in_ol = True
            html_lines.append(f"<li>{inline_markdown(numbered.group(1))}</li>")
            i += 1
            continue

        if stripped.startswith("- "):
            if in_ol:
                html_lines.append("</ol>")
                in_ol = False
            if not in_ul:
                html_lines.append("<ul>")
                in_ul = True
            html_lines.append(f"<li>{inline_markdown(stripped[2:])}</li>")
            i += 1
            continue

        close_lists()
        html_lines.append(f"<p>{inline_markdown(stripped)}</p>")
        i += 1

    close_lists()
    return "\n".join(html_lines)


def build_html():
    body = markdown_to_html(read(SOURCE))
    css = """
    @page { margin: 0.55in 0.55in 0.65in; }
    body {
      color: #172033;
      font-family: -apple-system, BlinkMacSystemFont, "Inter", "Helvetica Neue", Arial, sans-serif;
      font-size: 10.5px;
      line-height: 1.42;
    }
    h1 {
      color: #235e54;
      font-size: 28px;
      line-height: 1.1;
      margin: 0 0 18px;
      border-bottom: 6px solid #b6500b;
      padding-bottom: 14px;
    }
    h2 {
      break-before: page;
      color: #235e54;
      font-size: 21px;
      line-height: 1.15;
      margin: 0 0 12px;
      border-bottom: 3px solid #d7dfdc;
      padding-bottom: 8px;
    }
    h3 {
      color: #b6500b;
      font-size: 15px;
      margin: 18px 0 7px;
    }
    h4, h5, h6 { color: #235e54; margin: 13px 0 6px; }
    p { margin: 6px 0; }
    ul, ol { margin: 6px 0 10px 22px; padding: 0; }
    li { margin: 3px 0; }
    code {
      background: #eef3f2;
      border-radius: 3px;
      color: #172033;
      font-family: "IBM Plex Mono", Menlo, Consolas, monospace;
      font-size: 9.5px;
      padding: 1px 3px;
    }
    pre {
      background: #f6f8f8;
      border: 1px solid #d7dfdc;
      border-radius: 6px;
      overflow-wrap: anywhere;
      padding: 10px;
      white-space: pre-wrap;
    }
    pre code {
      background: transparent;
      padding: 0;
      white-space: pre-wrap;
    }
    table {
      border-collapse: collapse;
      margin: 8px 0 14px;
      width: 100%;
      table-layout: fixed;
    }
    th {
      background: #235e54;
      color: white;
      font-weight: 700;
    }
    th, td {
      border: 1px solid #d7dfdc;
      padding: 5px 6px;
      text-align: left;
      vertical-align: top;
      word-break: break-word;
    }
    a { color: #0b5cab; text-decoration: none; }
    """
    document = f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Accident Support Desk Complete Handoff Guide</title>
  <style>{css}</style>
</head>
<body>
{body}
</body>
</html>
"""
    HTML_OUTPUT.write_text(document, encoding="utf-8")


def build_pdf():
    chrome = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    if not chrome.exists():
        raise RuntimeError("Google Chrome was not found, so the PDF could not be rendered.")
    cmd = [
        str(chrome),
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        f"--print-to-pdf={PDF_OUTPUT}",
        HTML_OUTPUT.resolve().as_uri(),
    ]
    subprocess.run(cmd, check=True)


def main():
    HANDOFF.mkdir(parents=True, exist_ok=True)
    build_markdown()
    build_html()
    build_pdf()
    print(f"Wrote {SOURCE}")
    print(f"Wrote {HTML_OUTPUT}")
    print(f"Wrote {PDF_OUTPUT}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"failed to build complete handoff PDF: {exc}", file=sys.stderr)
        sys.exit(1)
