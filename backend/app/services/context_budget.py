"""Fits long chat messages into the model's context window.

Messages are never rejected for being long. When the composed prompt is larger
than the context budget, the attachment body is split into chunks, the chunks
that overlap most with the user's question are kept, and the transcript records
that excerpts were used. That way the model still answers from the parts that
matter instead of an arbitrary prefix.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Sequence

ATTACHMENT_MARKER = "\n\nAttached file: "
TRIM_NOTE = (
    "[Note: the attached content is very long. The excerpts below are the parts "
    "most relevant to the request; ask about a specific section to see more of it.]"
)
CHUNK_SIZE = 4000
CHUNK_OVERLAP = 200
MAX_CHUNKS = 500
EXCERPT_SEPARATOR = "\n\n[...]\n\n"

_WORD_RE = re.compile(r"[A-Za-z0-9_]{3,}")

STOPWORDS = frozenset(
    [
        "about",
        "above",
        "after",
        "again",
        "against",
        "all",
        "also",
        "and",
        "any",
        "are",
        "because",
        "been",
        "before",
        "being",
        "below",
        "between",
        "both",
        "but",
        "can",
        "could",
        "did",
        "does",
        "doing",
        "down",
        "during",
        "each",
        "few",
        "for",
        "from",
        "further",
        "had",
        "has",
        "have",
        "having",
        "here",
        "how",
        "into",
        "its",
        "itself",
        "just",
        "more",
        "most",
        "not",
        "now",
        "off",
        "once",
        "only",
        "other",
        "our",
        "out",
        "over",
        "own",
        "same",
        "should",
        "some",
        "such",
        "than",
        "that",
        "the",
        "their",
        "them",
        "then",
        "there",
        "these",
        "they",
        "this",
        "those",
        "through",
        "too",
        "under",
        "until",
        "very",
        "was",
        "were",
        "what",
        "when",
        "where",
        "which",
        "while",
        "who",
        "whom",
        "why",
        "will",
        "with",
        "would",
        "you",
        "your",
        "file",
        "attached",
        "image",
        "document",
        "please",
        "help",
        "explain",
    ]
)


def _terms(text: str) -> Counter[str]:
    """Counts meaningful words for a cheap lexical relevance score."""
    return Counter(word for word in _WORD_RE.findall(text.lower()) if word not in STOPWORDS)


def _split_attachment(message: str) -> tuple[str, str, str]:
    """Splits a composed message into (question, filename, attachment body)."""
    index = message.rfind(ATTACHMENT_MARKER)
    if index < 0:
        return message, "", ""
    question = message[:index].strip()
    remainder = message[index + len(ATTACHMENT_MARKER) :]
    filename, _, body = remainder.partition("\n")
    return question, filename.strip(), body


def _chunks(text: str) -> list[str]:
    if len(text) <= CHUNK_SIZE:
        return [text]
    step = CHUNK_SIZE - CHUNK_OVERLAP
    return [text[start : start + CHUNK_SIZE] for start in range(0, len(text), step)][:MAX_CHUNKS]


def _head_and_tail(text: str, limit: int) -> str:
    """Keeps the opening and the closing of a long plain message."""
    note_cost = len(TRIM_NOTE) + 4
    if limit <= note_cost + 200:
        return text[:limit]
    head = int((limit - note_cost) * 0.45)
    tail = limit - note_cost - head
    return f"{text[:head]}\n\n{TRIM_NOTE}\n\n{text[-tail:]}"


def fit_message_to_context(message: str, limit: int) -> tuple[str, bool]:
    """Returns ``(message, was_trimmed)``, never exceeding ``limit`` characters.

    ``limit <= 0`` disables trimming.
    """
    if limit <= 0 or len(message) <= limit:
        return message, False

    question, filename, body = _split_attachment(message)
    if not body:
        return _head_and_tail(message, limit), True

    header = f"Attached file: {filename}\n" if filename else "Attached file:\n"
    prefix = f"{question}\n\n{header}" if question else header
    budget = limit - len(prefix) - len(TRIM_NOTE) - 32
    if budget <= CHUNK_SIZE // 2:
        return (prefix + TRIM_NOTE + "\n\n" + body[: max(0, budget)])[:limit], True

    chunks = _chunks(body)
    query_terms = _terms(question)

    if query_terms:
        scored = sorted(
            enumerate(chunks),
            key=lambda item: sum(
                count for term, count in _terms(item[1]).items() if term in query_terms
            ),
            reverse=True,
        )
    else:
        scored = list(enumerate(chunks))

    picked: list[tuple[int, str]] = []
    used = 0
    for index, chunk in scored:
        cost = len(chunk) + len(EXCERPT_SEPARATOR)
        if used + cost > budget:
            continue
        picked.append((index, chunk))
        used += cost
        if used >= budget - CHUNK_SIZE:
            break

    if not picked:
        return (prefix + TRIM_NOTE + "\n\n" + body[:budget])[:limit], True

    picked.sort(key=lambda item: item[0])
    excerpt = EXCERPT_SEPARATOR.join(chunk for _, chunk in picked)
    fitted = f"{prefix}{TRIM_NOTE}\n\n{excerpt}"
    return fitted[:limit], True


def fit_history_to_context(rows: Sequence[dict], limit: int) -> list[dict]:
    """Keeps the newest conversation rows that fit in the context budget."""
    if limit <= 0 or not rows:
        return list(rows)

    kept: list[dict] = []
    total = 0
    for row in reversed(rows):
        size = len(row.get("content") or "")
        if kept and total + size > limit:
            break
        kept.append(row)
        total += size
    return list(reversed(kept))
