#!/usr/bin/env python3
import argparse
import json
import os
import re
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "training.sqlite"
ENV_PATH = ROOT / ".env"


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
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(conn):
    conn.executescript(
        """
        create table if not exists import_runs (
          id integer primary key autoincrement,
          started_at text not null,
          finished_at text,
          status text not null,
          pages integer default 0,
          messages_seen integer default 0,
          error text
        );

        create table if not exists raw_import_pages (
          id integer primary key autoincrement,
          run_id integer not null,
          endpoint text not null,
          cursor text,
          response_json text not null,
          imported_at text not null,
          foreign key(run_id) references import_runs(id)
        );

        create table if not exists ghl_messages (
          message_id text primary key,
          location_id text,
          conversation_id text,
          contact_id text,
          phone text,
          direction text,
          channel text,
          message_type text,
          body text,
          source text,
          created_at text,
          raw_json text not null,
          imported_at text not null
        );

        create index if not exists idx_ghl_messages_conversation_time
          on ghl_messages(conversation_id, created_at);

        create index if not exists idx_ghl_messages_contact_time
          on ghl_messages(contact_id, created_at);

        create table if not exists training_examples (
          id integer primary key autoincrement,
          message_id text unique not null,
          contact_id text,
          conversation_id text,
          phone text,
          previous_outbound_message text,
          previous_outbound_at text,
          lead_message text not null,
          lead_message_at text,
          next_outbound_message text,
          next_outbound_at text,
          suggested_label text,
          llm_label text,
          llm_confidence real,
          llm_should_escalate integer,
          llm_normalized_value text,
          llm_reason text,
          llm_model text,
          llm_labeled_at text,
          label text,
          notes text,
          created_at text not null,
          updated_at text not null,
          foreign key(message_id) references ghl_messages(message_id)
        );
        """
    )
    conn.commit()


def first_value(item, keys):
    for key in keys:
        value = item
        ok = True
        for part in key.split("."):
            if isinstance(value, dict) and part in value:
                value = value[part]
            else:
                ok = False
                break
        if ok and value not in (None, ""):
            return value
    return None


def normalize_direction(item):
    raw = str(first_value(item, ["direction", "messageDirection", "type", "status"]) or "").lower()
    if "inbound" in raw or raw in {"incoming", "received"}:
        return "inbound"
    if "outbound" in raw or raw in {"outgoing", "sent"}:
        return "outbound"
    if first_value(item, ["inbound"]) is True:
        return "inbound"
    return raw or "unknown"


def normalize_message(item):
    body = first_value(item, ["body", "message", "text", "content", "messageBody", "body.text"])
    message_id = first_value(item, ["id", "_id", "messageId", "message_id"])
    created_at = first_value(item, ["createdAt", "dateAdded", "dateCreated", "timestamp", "created_at"])
    conversation_id = first_value(item, ["conversationId", "conversation_id", "conversation.id"])
    contact_id = first_value(item, ["contactId", "contact_id", "contact.id"])
    return {
        "message_id": str(message_id or f"generated-{abs(hash(json.dumps(item, sort_keys=True)))}"),
        "location_id": str(first_value(item, ["locationId", "location_id"]) or os.environ.get("GHL_LOCATION_ID", "")),
        "conversation_id": str(conversation_id or ""),
        "contact_id": str(contact_id or ""),
        "phone": str(first_value(item, ["phone", "phoneNumber", "contact.phone"]) or ""),
        "direction": normalize_direction(item),
        "channel": str(first_value(item, ["channel", "messageType", "type"]) or ""),
        "message_type": str(first_value(item, ["messageType", "type"]) or ""),
        "body": str(body or "").strip(),
        "source": str(first_value(item, ["source", "sourceName"]) or ""),
        "created_at": str(created_at or ""),
        "raw_json": json.dumps(item, separators=(",", ":")),
        "imported_at": now_iso(),
    }


def find_messages(payload):
    if isinstance(payload, list):
        return payload
    paths = [
        ["messages"],
        ["data", "messages"],
        ["data"],
        ["items"],
        ["conversations"],
        ["results"],
    ]
    for path in paths:
        value = payload
        for part in path:
            if isinstance(value, dict):
                value = value.get(part)
            else:
                value = None
                break
        if isinstance(value, list):
            return value
    return []


def find_next_cursor(payload):
    candidates = [
        "nextCursor",
        "nextPageCursor",
        "cursor",
        "nextPage",
        "meta.nextCursor",
        "data.nextCursor",
        "pagination.nextCursor",
    ]
    value = first_value(payload, candidates) if isinstance(payload, dict) else None
    return str(value) if value else ""


def ghl_get(path, params):
    token = os.environ.get("GHL_API_TOKEN")
    api_base = os.environ.get("GHL_API_BASE", "https://services.leadconnectorhq.com").rstrip("/")
    if not token:
        raise RuntimeError("GHL_API_TOKEN is required in .env")
    url = f"{api_base}/conversations/messages/export?{urllib.parse.urlencode(params)}"
    if path:
        url = f"{api_base}{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Version": "2023-02-21",
            "Accept": "application/json",
            "User-Agent": "AccidentSupportDeskSMSBot/0.1 (+https://local.accidentsupportdesk)",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HighLevel API {path or '/conversations/messages/export'} failed with HTTP {exc.code}: {body[:1000]}")


def request_export_page(cursor="", limit=100):
    location_id = os.environ.get("GHL_LOCATION_ID")
    if not location_id:
        raise RuntimeError("GHL_LOCATION_ID is required in .env")
    params = {
        "locationId": location_id,
        "channel": "SMS",
        "limit": str(limit),
    }
    if cursor:
        params["cursor"] = cursor
    return ghl_get("/conversations/messages/export", params)


def api_check():
    load_env()
    payload = request_export_page("", 10)
    messages = find_messages(payload)
    return {
        "ok": True,
        "locationIdConfigured": bool(os.environ.get("GHL_LOCATION_ID")),
        "messageExportReachable": True,
        "sampleMessageCount": len(messages),
        "hasNextCursor": bool(find_next_cursor(payload)),
    }


def upsert_messages(conn, messages):
    count = 0
    for item in messages:
        row = normalize_message(item)
        if not row["body"]:
            continue
        conn.execute(
            """
            insert into ghl_messages (
              message_id, location_id, conversation_id, contact_id, phone, direction,
              channel, message_type, body, source, created_at, raw_json, imported_at
            ) values (
              :message_id, :location_id, :conversation_id, :contact_id, :phone, :direction,
              :channel, :message_type, :body, :source, :created_at, :raw_json, :imported_at
            )
            on conflict(message_id) do update set
              location_id=excluded.location_id,
              conversation_id=excluded.conversation_id,
              contact_id=excluded.contact_id,
              phone=excluded.phone,
              direction=excluded.direction,
              channel=excluded.channel,
              message_type=excluded.message_type,
              body=excluded.body,
              source=excluded.source,
              created_at=excluded.created_at,
              raw_json=excluded.raw_json,
              imported_at=excluded.imported_at
            """,
            row,
        )
        count += 1
    conn.commit()
    return count


def suggest_label(text, previous_outbound=""):
    t = re.sub(r"\s+", " ", (text or "").lower()).strip()
    p = (previous_outbound or "").lower()
    if re.search(r"\b(stop|unsubscribe|remove me|wrong number|leave me alone|don't text|dont text|want out|i'm done|im done|take me off)\b", t):
        return "opt_out"
    if t in {"?", "??", "???"} or re.search(r"\b(confused|don't understand|dont understand|what do you mean)\b", t):
        return "confused"
    if re.search(r"\b(who is this|what company|why are you texting|where did you get)\b", t):
        return "asks_who_this_is"
    if re.search(r"\b(do you know any one|do you know anyone|can help me|need help|lawyer|attorney)\b", t):
        return "needs_escalation"
    if re.search(r"\b(call me|call now|right now|asap|available now)\b", t):
        return "call_now"
    if re.search(r"\b(not a good time|bad time|later|tomorrow|around\s+\d{1,2}\s*(am|pm)?|after\s+\d{1,2}\s*(am|pm)?|in about an hour|in an hour|in\s+\d+\s+mins?|in\s+\d+\s+minutes?|\d+\s+mins?|\d+\s+minutes?|after work)\b", t):
        return "call_later"
    if re.search(r"\b(yesterday|today|last week|last month|a week ago|few days ago|couple days ago|\d+\s+days?\s+ago|\d{1,2}[/-]\d{1,2})\b", t):
        return "accident_date"
    if re.search(r"\b(not at fault|not my fault|other driver|their fault|they hit me|car was parked|my car was parked)\b", t):
        return "fault_not_at_fault"
    if re.search(r"\b(my fault|i was at fault)\b", t):
        return "fault_at_fault"
    if re.search(r"\b(not sure|unsure|maybe|partial|both)\b", t):
        return "fault_unclear"
    if "fault" in p or "other driver" in p:
        if re.search(r"\b(no)\b", t):
            return "fault_not_at_fault"
        if re.search(r"\b(yes)\b", t):
            return "fault_at_fault"
    if "doctor" in p or "medical" in p or "treatment" in p:
        if re.search(r"\b(no|not yet|haven't|havent|none)\b", t):
            return "medical_no"
        if re.search(r"\b(yes|doctor|hospital|urgent care|chiro|therapy|treatment)\b", t):
            return "medical_yes"
    if "work" in p or "day-to-day" in p or "daily" in p:
        if re.search(r"\b(no|not really|fine|normal)\b", t):
            return "work_life_no"
        if re.search(r"\b(yes|missed work|pain|sore|sleep|anxiety|work|job)\b", t):
            return "work_life_yes"
    if re.search(r"\b(stressed|headaches|can't sleep|cant sleep|pain|sore|anxiety)\b", t):
        return "work_life_yes"
    return ""


def rebuild_examples(conn):
    conn.execute("delete from training_examples")
    groups = conn.execute(
        """
        select coalesce(nullif(conversation_id, ''), nullif(contact_id, ''), phone) as thread_key
        from ghl_messages
        group by thread_key
        """
    ).fetchall()
    inserted = 0
    for group in groups:
        thread_key = group["thread_key"]
        if not thread_key:
            continue
        messages = conn.execute(
            """
            select * from ghl_messages
            where coalesce(nullif(conversation_id, ''), nullif(contact_id, ''), phone) = ?
            order by created_at, message_id
            """,
            (thread_key,),
        ).fetchall()
        for index, msg in enumerate(messages):
            if msg["direction"] != "inbound":
                continue
            previous_outbound = None
            next_outbound = None
            for prev in reversed(messages[:index]):
                if prev["direction"] == "outbound":
                    previous_outbound = prev
                    break
            for nxt in messages[index + 1 :]:
                if nxt["direction"] == "outbound":
                    next_outbound = nxt
                    break
            suggested = suggest_label(msg["body"], previous_outbound["body"] if previous_outbound else "")
            conn.execute(
                """
                insert or ignore into training_examples (
                  message_id, contact_id, conversation_id, phone,
                  previous_outbound_message, previous_outbound_at,
                  lead_message, lead_message_at,
                  next_outbound_message, next_outbound_at,
                  suggested_label, created_at, updated_at
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    msg["message_id"],
                    msg["contact_id"],
                    msg["conversation_id"],
                    msg["phone"],
                    previous_outbound["body"] if previous_outbound else "",
                    previous_outbound["created_at"] if previous_outbound else "",
                    msg["body"],
                    msg["created_at"],
                    next_outbound["body"] if next_outbound else "",
                    next_outbound["created_at"] if next_outbound else "",
                    suggested,
                    now_iso(),
                    now_iso(),
                ),
            )
            inserted += 1
    conn.commit()
    return inserted


def import_messages(max_pages, page_size):
    load_env()
    conn = connect()
    init_db(conn)
    run_id = conn.execute(
        "insert into import_runs(started_at, status) values (?, ?)",
        (now_iso(), "running"),
    ).lastrowid
    conn.commit()
    cursor = ""
    pages = 0
    seen = 0
    try:
        while pages < max_pages:
            payload = request_export_page(cursor, page_size)
            pages += 1
            messages = find_messages(payload)
            seen += upsert_messages(conn, messages)
            conn.execute(
                """
                insert into raw_import_pages(run_id, endpoint, cursor, response_json, imported_at)
                values (?, ?, ?, ?, ?)
                """,
                (run_id, "/conversations/messages/export", cursor, json.dumps(payload), now_iso()),
            )
            conn.commit()
            next_cursor = find_next_cursor(payload)
            if not messages or not next_cursor:
                break
            cursor = next_cursor
            time.sleep(0.2)
        examples = rebuild_examples(conn)
        conn.execute(
            "update import_runs set finished_at=?, status=?, pages=?, messages_seen=? where id=?",
            (now_iso(), "done", pages, seen, run_id),
        )
        conn.commit()
        return {"ok": True, "runId": run_id, "pages": pages, "messagesSeen": seen, "examplesBuilt": examples}
    except Exception as exc:
        conn.execute(
            "update import_runs set finished_at=?, status=?, pages=?, messages_seen=?, error=? where id=?",
            (now_iso(), "failed", pages, seen, str(exc), run_id),
        )
        conn.commit()
        raise


def rows_to_dicts(rows):
    return [dict(row) for row in rows]


def summary():
    conn = connect()
    init_db(conn)
    data = {}
    for key, query in {
        "messages": "select count(*) as n from ghl_messages",
        "examples": "select count(*) as n from training_examples",
        "labeled": "select count(*) as n from training_examples where label is not null and label != ''",
        "unlabeled": "select count(*) as n from training_examples where label is null or label = ''",
    }.items():
        data[key] = conn.execute(query).fetchone()["n"]
    last_import = conn.execute("select * from import_runs order by id desc limit 1").fetchone()
    data["lastImport"] = dict(last_import) if last_import else {}
    data["labelCounts"] = rows_to_dicts(
        conn.execute(
            """
            select coalesce(nullif(label, ''), nullif(suggested_label, ''), 'unclassified') as label, count(*) as n
            from training_examples
            group by coalesce(nullif(label, ''), nullif(suggested_label, ''), 'unclassified')
            order by n desc
            limit 30
            """
        ).fetchall()
    )
    return data


def examples(limit=50, offset=0, mode="unlabeled"):
    conn = connect()
    init_db(conn)
    where = ""
    if mode == "unlabeled":
        where = "where label is null or label = ''"
    elif mode == "labeled":
        where = "where label is not null and label != ''"
    rows = conn.execute(
        f"""
        select * from training_examples
        {where}
        order by lead_message_at desc, id desc
        limit ? offset ?
        """,
        (limit, offset),
    ).fetchall()
    return rows_to_dicts(rows)


def label_example(example_id, label, notes=""):
    conn = connect()
    init_db(conn)
    conn.execute(
        "update training_examples set label=?, notes=?, updated_at=? where id=?",
        (label, notes, now_iso(), example_id),
    )
    conn.commit()
    return {"ok": True, "id": example_id, "label": label}


def phrases(limit=100):
    conn = connect()
    init_db(conn)
    rows = conn.execute(
        """
        select coalesce(nullif(label, ''), nullif(suggested_label, ''), 'unclassified') as label,
               lower(trim(lead_message)) as phrase,
               count(*) as n
        from training_examples
        where lead_message is not null and lead_message != ''
        group by label, phrase
        order by n desc
        limit ?
        """,
        (limit,),
    ).fetchall()
    return rows_to_dicts(rows)


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init")
    imp = sub.add_parser("import")
    imp.add_argument("--max-pages", type=int, default=1)
    imp.add_argument("--page-size", type=int, default=100)
    sub.add_parser("summary")
    sub.add_parser("api-check")
    ex = sub.add_parser("examples")
    ex.add_argument("--limit", type=int, default=50)
    ex.add_argument("--offset", type=int, default=0)
    ex.add_argument("--mode", choices=["all", "labeled", "unlabeled"], default="unlabeled")
    lab = sub.add_parser("label")
    lab.add_argument("--id", type=int, required=True)
    lab.add_argument("--label", required=True)
    lab.add_argument("--notes", default="")
    phr = sub.add_parser("phrases")
    phr.add_argument("--limit", type=int, default=100)
    args = parser.parse_args()

    if args.cmd == "init":
        conn = connect()
        init_db(conn)
        result = {"ok": True, "dbPath": str(DB_PATH)}
    elif args.cmd == "import":
        result = import_messages(args.max_pages, args.page_size)
    elif args.cmd == "summary":
        result = summary()
    elif args.cmd == "api-check":
        result = api_check()
    elif args.cmd == "examples":
        result = {"ok": True, "examples": examples(args.limit, args.offset, args.mode)}
    elif args.cmd == "label":
        result = label_example(args.id, args.label, args.notes)
    elif args.cmd == "phrases":
        result = {"ok": True, "phrases": phrases(args.limit)}
    else:
        result = {"ok": False, "error": "unknown command"}
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2), file=sys.stderr)
        sys.exit(1)
