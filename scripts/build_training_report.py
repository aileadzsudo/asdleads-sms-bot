#!/usr/bin/env python3
import sqlite3
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "training.sqlite"
REPORT_PATH = ROOT / "reports" / "training_report.md"


def rows(conn, query, params=()):
    conn.row_factory = sqlite3.Row
    return [dict(row) for row in conn.execute(query, params).fetchall()]


def scalar(conn, query, params=()):
    return conn.execute(query, params).fetchone()[0]


def table(items, headers):
    lines = ["| " + " | ".join(headers) + " |", "| " + " | ".join(["---"] * len(headers)) + " |"]
    for item in items:
        lines.append("| " + " | ".join(str(item.get(header, "")).replace("\n", " ") for header in headers) + " |")
    return "\n".join(lines)


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    total_messages = scalar(conn, "select count(*) from ghl_messages")
    total_examples = scalar(conn, "select count(*) from training_examples")
    llm_labeled = scalar(conn, "select count(*) from training_examples where llm_label is not null and llm_label != ''")
    high_conf = scalar(conn, "select count(*) from training_examples where llm_confidence >= 0.85")
    escalate = scalar(conn, "select count(*) from training_examples where llm_should_escalate = 1")
    signed_like = scalar(
        conn,
        """
        select count(*) from training_examples
        where lower(lead_message) like '%signed%'
           or lower(lead_message) like '%case manager%'
           or lower(lead_message) like '%docusign%'
           or lower(lead_message) like '%accident report%'
           or lower(lead_message) like '%police report%'
           or lower(lead_message) like '%too much ai%'
        """,
    )
    label_counts = rows(
        conn,
        """
        select coalesce(nullif(llm_label, ''), 'unlabeled') as label,
               count(*) as count,
               round(avg(coalesce(llm_confidence, 0)), 3) as avg_confidence
        from training_examples
        group by coalesce(nullif(llm_label, ''), 'unlabeled')
        order by count desc
        """,
    )
    suggested_vs_llm = rows(
        conn,
        """
        select suggested_label as suggested, llm_label as llm, count(*) as count
        from training_examples
        where suggested_label is not null and suggested_label != ''
          and llm_label is not null and llm_label != ''
        group by suggested_label, llm_label
        order by count desc
        limit 30
        """,
    )
    phrases = rows(
        conn,
        """
        select llm_label as label, lower(trim(lead_message)) as phrase, count(*) as count
        from training_examples
        where llm_label is not null and llm_label != ''
          and llm_confidence >= 0.85
          and length(trim(lead_message)) <= 90
        group by llm_label, lower(trim(lead_message))
        order by count desc
        limit 80
        """,
    )
    findings = [
        "The imported history contains both intake and post-intake/support conversations; post-#signed traffic should pause the bot and escalate to humans.",
        "Short replies like yes/no/ok/sure are not globally meaningful; they must be interpreted against the previous outbound message and current qualification progress.",
        "Call scheduling language is broad: tomorrow, morning, after 1pm, in 20 minutes, not a good time, at work, call me now.",
        "Document/report/email/Docusign messages are common enough to be their own escalation category.",
        "Language barriers, prior attorneys, settlement-value questions, complaints, and detailed insurance/medical facts should go straight to Slack escalation.",
        "The hard-coded parser should only auto-continue high-confidence intake answers; anything low-confidence should use LLM fallback, then human escalation.",
    ]
    content = [
        "# Accident Support Desk SMS Bot Training Report",
        "",
        f"Generated: {datetime.now().isoformat(timespec='seconds')}",
        "",
        "## Dataset",
        "",
        f"- SMS messages imported: {total_messages}",
        f"- Lead-reply examples built: {total_examples}",
        f"- LLM-labeled examples: {llm_labeled}",
        f"- High-confidence LLM labels: {high_conf}",
        f"- LLM escalation flags: {escalate}",
        f"- Signed/post-intake-like messages detected by keyword: {signed_like}",
        "",
        "## Key Findings",
        "",
        "\n".join(f"- {finding}" for finding in findings),
        "",
        "## LLM Label Counts",
        "",
        table(label_counts, ["label", "count", "avg_confidence"]),
        "",
        "## Existing Rule Suggestions vs LLM Labels",
        "",
        table(suggested_vs_llm, ["suggested", "llm", "count"]) if suggested_vs_llm else "No overlap yet.",
        "",
        "## High-Confidence Phrase Candidates",
        "",
        table(phrases, ["label", "phrase", "count"]) if phrases else "No phrase candidates yet.",
        "",
        "## Recommended Bot Policy",
        "",
        "- Rules run first for obvious intake answers.",
        "- LLM fallback runs only when rules cannot classify confidently.",
        "- If the contact has `#signed`, the bot does not continue automation and escalates to Slack.",
        "- Post-intake/support/document/complaint/missed-call/firm messages escalate to Slack.",
        "- LLM confidence >= 0.85 can continue only for normal intake labels.",
        "- LLM confidence 0.60-0.84 clarifies once when safe.",
        "- LLM confidence < 0.60 escalates.",
    ]
    REPORT_PATH.write_text("\n".join(content), encoding="utf-8")
    print(REPORT_PATH)


if __name__ == "__main__":
    main()
