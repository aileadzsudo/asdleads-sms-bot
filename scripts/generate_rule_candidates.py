#!/usr/bin/env python3
import json
import re
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "training.sqlite"
OUT_PATH = ROOT / "reports" / "rule_candidates.json"

STOPWORDS = {
    "the", "and", "for", "you", "that", "this", "with", "was", "were", "are", "have", "has",
    "had", "but", "not", "now", "can", "call", "text", "me", "my", "your", "yes", "no", "ok",
    "okay", "thanks", "thank", "will", "would", "could", "should", "about", "from", "they",
    "them", "then", "than", "just", "what", "when", "where", "there", "here", "been", "time"
}


def tokens(text):
    return [t for t in re.findall(r"[a-z0-9']+", (text or "").lower()) if len(t) > 2 and t not in STOPWORDS]


def ngrams(words, max_n=4):
    for n in range(1, max_n + 1):
        for index in range(0, len(words) - n + 1):
            yield " ".join(words[index : index + n])


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        select llm_label, lead_message, llm_confidence, llm_should_escalate
        from training_examples
        where llm_label is not null and llm_label != ''
          and llm_confidence >= 0.85
        """
    ).fetchall()
    counts_by_label = defaultdict(Counter)
    total_counts = Counter()
    examples_by_phrase = defaultdict(list)
    for row in rows:
        words = tokens(row["lead_message"])
        seen = set(ngrams(words))
        for phrase in seen:
            counts_by_label[row["llm_label"]][phrase] += 1
            total_counts[phrase] += 1
            if len(examples_by_phrase[phrase]) < 3:
                examples_by_phrase[phrase].append(row["lead_message"])

    candidates = []
    for label, counter in counts_by_label.items():
        for phrase, count in counter.most_common(80):
            if count < 2:
                continue
            purity = count / total_counts[phrase]
            if purity < 0.75:
                continue
            candidates.append(
                {
                    "label": label,
                    "phrase": phrase,
                    "count": count,
                    "purity": round(purity, 3),
                    "examples": examples_by_phrase[phrase],
                }
            )
    candidates.sort(key=lambda item: (item["count"], item["purity"]), reverse=True)
    OUT_PATH.write_text(json.dumps({"candidates": candidates[:250]}, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "count": len(candidates[:250]), "path": str(OUT_PATH)}, indent=2))


if __name__ == "__main__":
    main()
