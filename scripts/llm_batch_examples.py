#!/usr/bin/env python3
import argparse
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from llm_label_examples import (
    DB_PATH,
    LABELS,
    connect,
    ensure_columns,
    extract_output_text,
    load_env,
    now_iso,
    save_label,
    system_prompt,
    user_prompt,
)

ROOT = Path(__file__).resolve().parents[1]
BATCH_DIR = ROOT / "data" / "batches"


def api_key():
    key = os.environ.get("OPENAI_API_KEY")
    if not key or "put_your" in key:
        raise RuntimeError("OPENAI_API_KEY is missing in .env")
    return key


def json_schema():
    return {
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


def openai_json(method, path, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        f"https://api.openai.com{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {api_key()}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI HTTP {exc.code}: {error_body[:1200]}")


def openai_file_content(file_id):
    req = urllib.request.Request(
        f"https://api.openai.com/v1/files/{file_id}/content",
        headers={"Authorization": f"Bearer {api_key()}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as response:
            return response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI file download HTTP {exc.code}: {error_body[:1200]}")


def upload_file(file_path):
    boundary = f"----asdleads{uuid.uuid4().hex}"
    body = bytearray()
    body.extend(f"--{boundary}\r\n".encode())
    body.extend(b'Content-Disposition: form-data; name="purpose"\r\n\r\n')
    body.extend(b"batch\r\n")
    body.extend(f"--{boundary}\r\n".encode())
    body.extend(
        f'Content-Disposition: form-data; name="file"; filename="{file_path.name}"\r\n'
        "Content-Type: application/jsonl\r\n\r\n".encode()
    )
    body.extend(file_path.read_bytes())
    body.extend(f"\r\n--{boundary}--\r\n".encode())
    req = urllib.request.Request(
        "https://api.openai.com/v1/files",
        data=bytes(body),
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key()}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI file upload HTTP {exc.code}: {error_body[:1200]}")


def ensure_batch_table(conn):
    conn.execute(
        """
        create table if not exists llm_batch_jobs (
          id integer primary key autoincrement,
          batch_id text unique,
          input_file_id text,
          output_file_id text,
          status text,
          model text,
          example_count integer,
          jsonl_path text,
          created_at text,
          updated_at text,
          applied_at text,
          raw_json text
        )
        """
    )
    conn.commit()


def fetch_unlabeled(conn, limit):
    return conn.execute(
        """
        select * from training_examples
        where llm_label is null or llm_label = ''
        order by id
        limit ?
        """,
        (limit,),
    ).fetchall()


def create_jsonl(conn, limit):
    BATCH_DIR.mkdir(parents=True, exist_ok=True)
    model = os.environ.get("OPENAI_CLASSIFIER_MODEL", "gpt-5-mini")
    rows = fetch_unlabeled(conn, limit)
    path = BATCH_DIR / f"llm_label_batch_{int(time.time())}.jsonl"
    with path.open("w", encoding="utf-8") as fh:
        for row in rows:
            body = {
                "model": model,
                "instructions": system_prompt(),
                "input": user_prompt(row),
                "text": {
                    "format": {
                        "type": "json_schema",
                        "name": "sms_reply_classification",
                        "schema": json_schema(),
                        "strict": True,
                    }
                },
            }
            fh.write(
                json.dumps(
                    {
                        "custom_id": f"example_{row['id']}",
                        "method": "POST",
                        "url": "/v1/responses",
                        "body": body,
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
    return path, model, len(rows)


def submit(limit):
    load_env()
    conn = connect()
    ensure_columns(conn)
    ensure_batch_table(conn)
    path, model, count = create_jsonl(conn, limit)
    if count == 0:
        return {"ok": True, "message": "No unlabeled examples remain."}
    uploaded = upload_file(path)
    batch = openai_json(
        "POST",
        "/v1/batches",
        {
            "input_file_id": uploaded["id"],
            "endpoint": "/v1/responses",
            "completion_window": "24h",
            "metadata": {"project": "asdleads-sms-bot", "task": "historical-reply-labeling", "model": model},
        },
    )
    conn.execute(
        """
        insert into llm_batch_jobs (
          batch_id, input_file_id, status, model, example_count, jsonl_path, created_at, updated_at, raw_json
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            batch["id"],
            uploaded["id"],
            batch["status"],
            model,
            count,
            str(path),
            now_iso(),
            now_iso(),
            json.dumps(batch),
        ),
    )
    conn.commit()
    return {"ok": True, "batch": batch, "inputFile": uploaded["id"], "count": count, "jsonlPath": str(path)}


def latest_batch_id(conn, batch_id=None):
    if batch_id:
        return batch_id
    row = conn.execute("select batch_id from llm_batch_jobs order by id desc limit 1").fetchone()
    if not row:
        raise RuntimeError("No batch job found.")
    return row["batch_id"]


def status(batch_id=None):
    load_env()
    conn = connect()
    ensure_batch_table(conn)
    bid = latest_batch_id(conn, batch_id)
    batch = openai_json("GET", f"/v1/batches/{bid}")
    conn.execute(
        """
        update llm_batch_jobs
        set status=?, output_file_id=?, updated_at=?, raw_json=?
        where batch_id=?
        """,
        (batch["status"], batch.get("output_file_id"), now_iso(), json.dumps(batch), bid),
    )
    conn.commit()
    return {"ok": True, "batch": batch}


def apply(batch_id=None):
    load_env()
    conn = connect()
    ensure_columns(conn)
    ensure_batch_table(conn)
    bid = latest_batch_id(conn, batch_id)
    batch = status(bid)["batch"]
    if batch["status"] != "completed":
        return {"ok": False, "status": batch["status"], "message": "Batch is not completed yet."}
    if not batch.get("output_file_id"):
        return {"ok": False, "status": batch["status"], "message": "Batch has no output_file_id."}
    content = openai_file_content(batch["output_file_id"])
    job = conn.execute("select model from llm_batch_jobs where batch_id=?", (bid,)).fetchone()
    model = job["model"] if job else batch.get("metadata", {}).get("model", "")
    applied = 0
    failed = 0
    output_path = BATCH_DIR / f"{bid}_output.jsonl"
    output_path.write_text(content, encoding="utf-8")
    for line in content.splitlines():
        if not line.strip():
            continue
        item = json.loads(line)
        custom_id = item.get("custom_id", "")
        if not custom_id.startswith("example_"):
            failed += 1
            continue
        example_id = int(custom_id.split("_", 1)[1])
        if item.get("error"):
            failed += 1
            continue
        body = item.get("response", {}).get("body", {})
        try:
            result = json.loads(extract_output_text(body))
            save_label(conn, example_id, model, result)
            applied += 1
        except Exception:
            failed += 1
    conn.execute(
        """
        update llm_batch_jobs
        set applied_at=?, updated_at=?
        where batch_id=?
        """,
        (now_iso(), now_iso(), bid),
    )
    conn.commit()
    return {"ok": True, "batchId": bid, "applied": applied, "failed": failed, "outputPath": str(output_path)}


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    submit_cmd = sub.add_parser("submit")
    submit_cmd.add_argument("--limit", type=int, default=5000)
    status_cmd = sub.add_parser("status")
    status_cmd.add_argument("--batch-id", default="")
    apply_cmd = sub.add_parser("apply")
    apply_cmd.add_argument("--batch-id", default="")
    args = parser.parse_args()
    if args.cmd == "submit":
        result = submit(args.limit)
    elif args.cmd == "status":
        result = status(args.batch_id)
    else:
        result = apply(args.batch_id)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2), file=sys.stderr)
        sys.exit(1)
