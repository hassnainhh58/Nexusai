"""One-off migration: assign legacy conversations to their real owner.

Before multi-user support every conversation was stored with
``user_id = 'default'``. Once authentication fails closed, those rows are no
longer visible to anybody, so they are re-assigned to the Clerk account that
created them.

Usage:
    python scripts/claim_legacy_conversations.py --email you@example.com
    python scripts/claim_legacy_conversations.py --email you@example.com --apply

The script is dry-run by default: it prints what would change and only writes
with ``--apply``. A timestamped backup of the database is created first.
"""

import argparse
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.database.db import database_path  # noqa: E402


def _resolve_user_id(email: str) -> str | None:
    """Looks the Clerk user id up by e-mail (needs CLERK_SECRET_KEY)."""
    import json
    import os
    import urllib.request

    secret = os.getenv("CLERK_SECRET_KEY", "").strip()
    if not secret:
        return None

    request = urllib.request.Request(
        f"https://api.clerk.com/v1/users?email_address={email}",
    )
    request.add_header("Authorization", f"Bearer {secret}")
    request.add_header("User-Agent", "NexusAI-migration/1.0")
    request.add_header("Accept", "application/json")

    with urllib.request.urlopen(request, timeout=30) as response:
        users = json.load(response)

    for user in users:
        addresses = [entry.get("email_address") for entry in user.get("email_addresses", [])]
        if email.lower() in {address.lower() for address in addresses if address}:
            return user["id"]
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", help="E-mail of the account that should own the data")
    parser.add_argument("--user-id", help="Clerk user id (skips the API lookup)")
    parser.add_argument("--apply", action="store_true", help="Write the changes")
    args = parser.parse_args()

    if not args.user_id and not args.email:
        parser.error("provide --email and/or --user-id")

    user_id = args.user_id or _resolve_user_id(args.email or "")
    if not user_id:
        print(
            "Could not resolve the user id. Pass --user-id explicitly "
            "(Dashboard -> Users) or set CLERK_SECRET_KEY.",
            file=sys.stderr,
        )
        return 2

    db_path = database_path()
    if not db_path.exists():
        print(f"Database not found: {db_path}", file=sys.stderr)
        return 2

    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    legacy = connection.execute(
        "SELECT id, title FROM conversations WHERE user_id = 'default' ORDER BY id"
    ).fetchall()

    print(f"Database: {db_path}")
    print(f"Target owner: {user_id}" + (f" ({args.email})" if args.email else ""))
    print(f"Legacy conversations: {len(legacy)}")
    for row in legacy:
        print(f"  - #{row['id']}: {row['title']}")

    if not legacy:
        print("Nothing to migrate.")
        connection.close()
        return 0

    if not args.apply:
        print("\nDry run. Re-run with --apply to write the changes.")
        connection.close()
        return 0

    backup = db_path.with_name(f"{db_path.name}.bak-{datetime.now().strftime('%Y%m%d-%H%M%S')}")
    shutil.copy2(db_path, backup)
    print(f"\nBackup written to: {backup}")

    with connection:
        connection.execute(
            "UPDATE conversations SET user_id = ? WHERE user_id = 'default'",
            (user_id,),
        )

    remaining = connection.execute(
        "SELECT COUNT(*) FROM conversations WHERE user_id = 'default'"
    ).fetchone()[0]
    connection.close()

    print(f"Migrated {len(legacy)} conversation(s); remaining 'default' rows: {remaining}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
