# backend/tests/conftest.py
"""
Shared pytest fixtures for integration tests.

The test suite uses a real MongoDB Atlas connection (test DB: interview_bot_test)
and a real Redis connection from your .env.  All test data is cleaned up after
each test session.

Set TEST_MONGO_DB_NAME in .env to override the test database name
(default: interview_bot_test).
"""

import asyncio
import os
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

# Point at the test database before importing anything that calls get_settings()
os.environ.setdefault("MONGO_DB_NAME", os.getenv("TEST_MONGO_DB_NAME", "interview_bot_test"))
os.environ.setdefault("APP_ENV", "development")  # relaxes cloud-URL validators

# Now import the app
from main import app  # noqa: E402
from database import connect_db, close_db, get_db, get_redis  # noqa: E402

# The event loop is now managed directly by pytest-asyncio settings in pytest.ini


# ── Database setup / teardown ─────────────────────────────────────────────────

@pytest_asyncio.fixture(scope="session", autouse=True)
async def setup_db():
    """Connect once per session; drop the test DB after the session ends."""
    await connect_db()
    yield
    # Teardown: drop all test collections
    db = get_db()
    for coll in await db.list_collection_names():
        await db[coll].drop()
    await close_db()


@pytest_asyncio.fixture(autouse=True)
async def clean_collections():
    """Wipe user-generated data before each test for isolation."""
    db = get_db()
    redis = get_redis()
    for coll in ["users", "resumes", "skills", "sessions", "answers", "results",
                 "job_descriptions", "jd_verifications"]:
        await db[coll].delete_many({})
    # Flush test-related Redis keys (OTPs, reset tokens, session state)
    keys = await redis.keys("otp:*")
    keys += await redis.keys("otp_resend:*")
    keys += await redis.keys("pwd_reset:*")
    keys += await redis.keys("session:*")
    if keys:
        await redis.delete(*keys)
    yield



# ── HTTP client ───────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def client():
    """Async HTTP client backed by the FastAPI app (no real network calls)."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as ac:
        yield ac


# ── Convenience fixtures ──────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def registered_student(client: AsyncClient):
    """Create and return a verified student user + token."""
    payload = {"name": "Test Student", "email": "student@test.com", "password": "Test1234"}
    res = await client.post("/auth/signup", json=payload)
    assert res.status_code == 200

    # Mark email as verified directly in DB (bypass OTP in tests)
    db = get_db()
    await db["users"].update_one({"email": payload["email"]}, {"$set": {"email_verified": True}})

    login_res = await client.post("/auth/login", json={"email": payload["email"], "password": payload["password"]})
    assert login_res.status_code == 200
    return {"user": login_res.json()["user"], "token": login_res.json()["access_token"]}


@pytest_asyncio.fixture
async def registered_admin(client: AsyncClient):
    """Create a test-only admin user directly in DB and return a token."""
    from passlib.context import CryptContext
    from utils.helpers import utc_now
    from auth.jwt import create_access_token

    db = get_db()
    email = "testadmin@ci.example.com"
    password = "CIAdmin123"

    # Remove any leftover from a previous test run
    await db["users"].delete_many({"email": email})

    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
    user_doc = {
        "name": "Test Admin",
        "email": email,
        "password": pwd_context.hash(password),
        "role": "admin",
        "email_verified": True,
        "speech_settings": {"voice_gender": "female"},
        "created_at": utc_now(),
    }
    result = await db["users"].insert_one(user_doc)
    user_id = str(result.inserted_id)

    token = create_access_token({
        "sub": user_id,
        "email": email,
        "role": "admin",
        "name": "Test Admin",
    })

    login_res = await client.post("/auth/login", json={"email": email, "password": password})
    assert login_res.status_code == 200
    return {"user": login_res.json()["user"], "token": login_res.json()["access_token"]}

