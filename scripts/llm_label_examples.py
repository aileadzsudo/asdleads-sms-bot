#!/usr/bin/env python3
import argparse
import json
import os
import sqlite3
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "training.sqlite"
ENV_PATH = ROOT / ".env"

LABELS = [
    "accident_date",
    "fault_not_at_fault",
    "fault_at_fault",
    "fault_unclear",
    "medical_yes",
    "medical_no",
    "work_life_yes",
    "work_life_no",
    "call_now",
    "call_later",
    "opt_out",
    "wrong_number",
    "asks_who_this_is",
    "human_request",
    "prefers_text",
    "document_or_report",
    "confused",
    "needs_escalation",
    "off_topic",
    "acknowledgement",
    "unknown",
]


def load_env():
    if not ENV_PATH.exists():
        return
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_columns(conn):
    existing = {row["name"] for row in conn.execute("pragma table_info(training_examples)").fetchall()}
    columns = {
        "llm_label": "text",
        "llm_confidence": "real",
        "llm_should_escalate": "integer",
        "llm_normalized_value": "text",
        "llm_reason": "text",
        "llm_model": "text",
        "llm_labeled_at": "text",
    }
    for name, col_type in columns.items():
        if name not in existing:
            conn.execute(f"alter table training_examples add column {name} {col_type}")
    conn.commit()


def fetch_examples(conn, limit, only_unlabeled=True):
    where = "where llm_label is null or llm_label = ''" if only_unlabeled else ""
    return conn.execute(
        f"""
        select *
        from training_examples
        {where}
        order by id
        limit ?
        """,
        (limit,),
    ).fetchall()


def system_prompt():
    return f"""
You classify inbound SMS replies from accident leads.

Return only JSON matching the requested schema.

Use the previous outbound text as context. The same reply can mean different things depending on what was asked.

Labels:
{", ".join(LABELS)}

Guidance:
- accident_date: lead gives date/timing of accident, including relative timing like yesterday, last week, 3 days ago.
- fault_not_at_fault: lead says they were not at fault, other driver hit them, car was parked, etc.
- fault_at_fault: lead says they were at fault.
- fault_unclear: lead is unsure, partial fault, both drivers, unclear fault answer.
- medical_yes/no: lead answers whether they saw or need doctor/medical treatment.
- work_life_yes/no: lead answers whether accident affected work, daily life, pain, sleep, stress, driving, etc.
- call_now: lead wants a call now or is available now.
- call_later: lead gives a later time, says not a good time, tomorrow, after work, in 20 minutes, etc.
- opt_out/wrong_number: lead wants messages stopped or says wrong number.
- asks_who_this_is: lead asks identity/source/company.
- human_request: lead asks for a person, attorney, specialist, manager, or callback from human.
- prefers_text: lead asks to continue by text instead of a phone call.
- document_or_report: lead wants to send documents, photos, accident report, police report, license, insurance card, or similar material.
- confused: lead is confused, sends only '?', or says they do not understand.
- needs_escalation: sensitive legal/medical/insurance detail, anger, complaint, complex question, or outside normal flow.
- acknowledgement: ok/thanks/yes/sure when it does not answer a qualification question by itself.
- off_topic: irrelevant reply.
- unknown: cannot determine.

Escalate when the reply is angry, complicated, legal/medical/insurance heavy, asks for a human/professional, includes document/report handling, or confidence is low.
""".strip()


def user_prompt(example):
    payload = {
        "previous_outbound_message": example["previous_outbound_message"] or "",
        "lead_reply": example["lead_message"] or "",
        "next_human_message_for_context_only": example["next_outbound_message"] or "",
        "suggested_rule_label": example["suggested_label"] or "",
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def extract_output_text(response):
    if "output_text" in response:
        return response["output_text"]
    chunks = []
    for item in response.get("output", []):
        for content in item.get("content", []):
            if content.get("type") in {"output_text", "text"} and "text" in content:
                chunks.append(content["text"])
    return "\n".join(chunks)


def call_openai(example, model):
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key or "put_your" in api_key:
        raise RuntimeError("OPENAI_API_KEY is missing in .env")

    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "label": {"type": "string", "enum": LABELS},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            "should_escalate": {"type": "boolean"},
            "normalized_value": {"type": "string"},
            "reason": {"type": "string"},
        },
        "required": ["label", "confidence", "should_escalate", "normalized_value", "reason"],
    }
    body = {
        "model": model,
        "instructions": system_prompt(),
        "input": user_prompt(example),
        "text": {
            "format": {
                "type": "json_schema",
                "name": "sms_reply_classification",
                "schema": schema,
                "strict": True,
            }
        },
    }
    req = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI HTTP {exc.code}: {error_body[:1200]}")
    text = extract_output_text(data)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Could not parse OpenAI JSON: {exc}: {text[:500]}")
    return parsed


def save_label(conn, example_id, model, result):
    conn.execute(
        """
        update training_examples
        set llm_label=?,
            llm_confidence=?,
            llm_should_escalate=?,
            llm_normalized_value=?,
            llm_reason=?,
            llm_model=?,
            llm_labeled_at=?,
            updated_at=?
        where id=?
        """,
        (
            result["label"],
            float(result["confidence"]),
            1 if result["should_escalate"] else 0,
            result.get("normalized_value", ""),
            result.get("reason", ""),
            model,
            now_iso(),
            now_iso(),
            example_id,
        ),
    )
    conn.commit()


def run(limit, sleep_seconds, dry_run=False):
    load_env()
    conn = connect()
    ensure_columns(conn)
    model = os.environ.get("OPENAI_CLASSIFIER_MODEL", "gpt-5-mini")
    rows = fetch_examples(conn, limit)
    results = []
    for index, row in enumerate(rows, start=1):
        if dry_run:
            result = {"label": "unknown", "confidence": 0, "should_escalate": True, "normalized_value": "", "reason": "dry run"}
        else:
            result = call_openai(row, model)
            save_label(conn, row["id"], model, result)
            time.sleep(sleep_seconds)
        results.append({"id": row["id"], "lead_reply": row["lead_message"], **result})
        print(json.dumps({"progress": f"{index}/{len(rows)}", "id": row["id"], **result}), flush=True)
    return {"ok": True, "model": model, "count": len(results), "results": results}


def summary():
    conn = connect()
    ensure_columns(conn)
    rows = conn.execute(
        """
        select coalesce(nullif(llm_label, ''), 'unlabeled') as label,
               count(*) as n,
               round(avg(coalesce(llm_confidence, 0)), 3) as avg_confidence
        from training_examples
        group by coalesce(nullif(llm_label, ''), 'unlabeled')
        order by n desc
        """
    ).fetchall()
    return {"ok": True, "counts": [dict(row) for row in rows]}


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    label = sub.add_parser("label")
    label.add_argument("--limit", type=int, default=10)
    label.add_argument("--sleep", type=float, default=0.1)
    label.add_argument("--dry-run", action="store_true")
    sub.add_parser("summary")
    args = parser.parse_args()
    if args.cmd == "label":
        result = run(args.limit, args.sleep, args.dry_run)
    else:
        result = summary()
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2), file=sys.stderr)
        sys.exit(1)
