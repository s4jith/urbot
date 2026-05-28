#!/usr/bin/env python3
"""
Interview Bot — Superadmin Setup Script
========================================
Run this once (or any time you want to change the admin account):

    ./venv/bin/python3 create_superadmin.py

The script will:
  1. Ask for name, email and password interactively
  2. Validate email format and password strength
  3. Check the database — reject if the email belongs to a non-admin user
  4. Hash the password with bcrypt and upsert the admin in MongoDB

No credentials are stored in source files or environment variables.
"""

import sys
import os

# ── Venv guard ────────────────────────────────────────────────────────────────
# Make sure we are running inside the project's virtual environment so that
# motor, passlib, etc. are available.

_venv = os.path.join(os.path.dirname(__file__), "venv")
_running_in_venv = (
    hasattr(sys, "real_prefix")                        # virtualenv
    or (
        hasattr(sys, "base_prefix")
        and sys.base_prefix != sys.prefix              # venv / pyvenv
    )
)

if not _running_in_venv:
    print()
    print("  ERROR: Please run this script with the project's virtual environment:")
    print()
    print("    ./venv/bin/python3 create_superadmin.py")
    print()
    sys.exit(1)

# ── Bootstrap: read .env using stdlib only (no dotenv dependency) ─────────────

os.environ.setdefault("APP_ENV", "development")  # allow local URIs

_env_path = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(_env_path):
    with open(_env_path) as _f:
        for _line in _f:
            _line = _line.strip()
            if not _line or _line.startswith("#") or "=" not in _line:
                continue
            _key, _, _val = _line.partition("=")
            _key = _key.strip()
            _val = _val.strip().strip('"').strip("'")
            os.environ.setdefault(_key, _val)

# ── Imports (all from venv) ───────────────────────────────────────────────────

import asyncio
import re
import getpass


# ── Validation ────────────────────────────────────────────────────────────────

_EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$")


def _validate_email(raw: str) -> str:
    email = raw.strip().lower()
    if not email:
        raise ValueError("Email cannot be empty.")
    if not _EMAIL_RE.match(email):
        raise ValueError(f"'{email}' is not a valid email address.")
    return email


def _validate_password(password: str) -> None:
    errors = []
    if len(password) < 8:
        errors.append("at least 8 characters long")
    if not any(c.isdigit() for c in password):
        errors.append("contain at least 1 digit")
    if not any(c.isalpha() for c in password):
        errors.append("contain at least 1 letter")
    if errors:
        raise ValueError("Password must " + " AND ".join(errors) + ".")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _prompt(label: str, secret: bool = False) -> str:
    """Read a line from the terminal, masking input when secret=True."""
    try:
        return (getpass.getpass(label) if secret else input(label)).strip()
    except (KeyboardInterrupt, EOFError):
        print("\nAborted.")
        sys.exit(0)


# ── Main flow ─────────────────────────────────────────────────────────────────

async def main() -> None:
    from config import get_settings
    settings = get_settings()

    print()
    print("=" * 52)
    print("  Interview Bot — Superadmin Setup")
    print("=" * 52)
    print()

    # ── Step 1: Name ──────────────────────────────────────────────────────────
    name = _prompt("Admin name  : ")
    if not name:
        print("  Name cannot be empty.")
        sys.exit(1)

    # ── Step 2: Email ─────────────────────────────────────────────────────────
    while True:
        raw = _prompt("Admin email : ")
        try:
            email = _validate_email(raw)
            break
        except ValueError as e:
            print(f"  {e}  Please try again.\n")

    # ── Step 3: Password ──────────────────────────────────────────────────────
    while True:
        password = _prompt("Password    : ", secret=True)
        try:
            _validate_password(password)
        except ValueError as e:
            print(f"  {e}  Please try again.\n")
            continue

        confirm = _prompt("Confirm pwd : ", secret=True)
        if password != confirm:
            print("  Passwords do not match. Please try again.\n")
            continue
        break

    # ── Step 4: Connect to MongoDB ────────────────────────────────────────────
    print("\nConnecting to database...")
    from motor.motor_asyncio import AsyncIOMotorClient

    client = AsyncIOMotorClient(settings.MONGO_URI, serverSelectionTimeoutMS=5000)
    db = client[settings.MONGO_DB_NAME]

    try:
        await client.admin.command("ping")
        print("  Connected to MongoDB.")
    except Exception as exc:
        print(f"  Cannot connect to MongoDB: {exc}")
        sys.exit(1)

    # ── Step 5: Uniqueness / conflict check ───────────────────────────────────
    existing = await db.users.find_one({"email": email})

    if existing and existing.get("role") != "admin":
        print(
            f"\n  A non-admin account already exists with this email.\n"
            f"  Choose a different email address, or promote that user to admin\n"
            f"  via the admin panel first."
        )
        client.close()
        sys.exit(1)

    # ── Step 6: Hash password & upsert ───────────────────────────────────────
    from passlib.context import CryptContext
    from datetime import datetime, timezone

    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
    hashed = pwd_context.hash(password)
    password = None  # clear plaintext from memory immediately

    now = datetime.now(timezone.utc).isoformat()

    if existing:
        await db.users.update_one(
            {"email": email},
            {
                "$set": {
                    "name": name,
                    "password": hashed,
                    "role": "admin",
                    "email_verified": True,
                }
            },
        )
        print(f"\n  Admin account updated successfully.")
    else:
        await db.users.insert_one(
            {
                "name": name,
                "email": email,
                "password": hashed,
                "role": "admin",
                "email_verified": True,
                "speech_settings": {"voice_gender": "female"},
                "created_at": now,
            }
        )
        print(f"\n  Admin account created successfully.")

    print(f"   Name  : {name}")
    print(f"   Email : {email}")
    print(f"   Role  : admin")
    print()
    print("  You can now log in at the frontend with these credentials.")
    print()

    client.close()


if __name__ == "__main__":
    asyncio.run(main())
