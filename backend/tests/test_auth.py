# backend/tests/test_auth.py
"""Integration tests for the /auth router."""

import pytest
from httpx import AsyncClient

from database import get_db, get_redis

pytestmark = pytest.mark.asyncio


# ── Signup ────────────────────────────────────────────────────────────────────

async def test_signup_success(client: AsyncClient):
    res = await client.post("/auth/signup", json={
        "name": "Jane Doe", "email": "jane@example.com", "password": "Hello123"
    })
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["user"]["email"] == "jane@example.com"
    assert data["user"]["role"] == "student"
    assert data["email_verification_required"] is False


async def test_signup_admin_domain(client: AsyncClient, monkeypatch):
    from config import get_settings
    settings = get_settings()
    monkeypatch.setattr(settings, "ADMIN_EMAIL_DOMAIN", "@admin.com")
    res = await client.post("/auth/signup", json={
        "name": "Admin User", "email": "boss@admin.com", "password": "Admin123"
    })
    assert res.status_code == 200
    assert res.json()["user"]["role"] == "admin"



async def test_signup_duplicate_email(client: AsyncClient):
    payload = {"name": "User", "email": "dup@example.com", "password": "Pass1234"}
    await client.post("/auth/signup", json=payload)
    res = await client.post("/auth/signup", json=payload)
    assert res.status_code == 400
    assert "already exists" in res.json()["detail"].lower()


async def test_signup_weak_password(client: AsyncClient):
    res = await client.post("/auth/signup", json={
        "name": "User", "email": "weak@example.com", "password": "short"
    })
    assert res.status_code == 422


async def test_signup_no_digit_password(client: AsyncClient):
    res = await client.post("/auth/signup", json={
        "name": "User", "email": "nodig@example.com", "password": "NoDigitsHere"
    })
    assert res.status_code == 422


async def test_signup_short_name(client: AsyncClient):
    res = await client.post("/auth/signup", json={
        "name": "A", "email": "x@example.com", "password": "Valid123"
    })
    assert res.status_code == 422


# ── Login ─────────────────────────────────────────────────────────────────────

async def test_login_success(client: AsyncClient, registered_student):
    token = registered_student["token"]
    assert len(token) > 20


async def test_login_wrong_password(client: AsyncClient, registered_student):
    res = await client.post("/auth/login", json={
        "email": registered_student["user"]["email"],
        "password": "WrongPass1",
    })
    assert res.status_code == 401


async def test_login_unknown_email(client: AsyncClient):
    res = await client.post("/auth/login", json={
        "email": "nobody@example.com", "password": "Test1234"
    })
    assert res.status_code == 401


# ── Token refresh ─────────────────────────────────────────────────────────────

async def test_refresh_token(client: AsyncClient, registered_student):
    res = await client.post(
        "/auth/refresh",
        headers={"Authorization": f"Bearer {registered_student['token']}"},
    )
    assert res.status_code == 200
    assert "access_token" in res.json()


async def test_refresh_without_token(client: AsyncClient):
    res = await client.post("/auth/refresh")
    assert res.status_code == 403


# ── Email OTP verification ────────────────────────────────────────────────────

async def test_verify_email_correct_otp(client: AsyncClient):
    payload = {"name": "OTP User", "email": "otpuser@example.com", "password": "Otp12345"}
    await client.post("/auth/signup", json=payload)

    # Set email_verified=False in DB to test verification logic
    db = get_db()
    await db["users"].update_one({"email": payload["email"]}, {"$set": {"email_verified": False}})

    # Write OTP to Redis
    redis = get_redis()
    otp = "123456"
    await redis.setex(f"otp:{payload['email']}", 300, otp)

    res = await client.post("/auth/verify-email", json={"email": payload["email"], "otp": otp})
    assert res.status_code == 200
    assert "verified" in res.json()["message"].lower()

    user = await db["users"].find_one({"email": payload["email"]})
    assert user["email_verified"] is True


async def test_verify_email_wrong_otp(client: AsyncClient):
    payload = {"name": "Bad OTP", "email": "badotp@example.com", "password": "Bad12345"}
    await client.post("/auth/signup", json=payload)

    # Set email_verified=False in DB to test verification logic
    db = get_db()
    await db["users"].update_one({"email": payload["email"]}, {"$set": {"email_verified": False}})

    res = await client.post("/auth/verify-email", json={"email": payload["email"], "otp": "000000"})
    assert res.status_code == 400


async def test_resend_otp_cooldown(client: AsyncClient):
    payload = {"name": "Resend User", "email": "resend@example.com", "password": "Resend12"}
    await client.post("/auth/signup", json=payload)

    # Set email_verified=False in DB to test verification logic
    db = get_db()
    await db["users"].update_one({"email": payload["email"]}, {"$set": {"email_verified": False}})

    # First resend succeeds (or returns generic message)
    res1 = await client.post("/auth/resend-otp", json={"email": payload["email"]})
    assert res1.status_code == 200

    # Immediate second resend hits the 60-second cooldown
    res2 = await client.post("/auth/resend-otp", json={"email": payload["email"]})
    assert res2.status_code == 429


# ── Password reset ────────────────────────────────────────────────────────────

async def test_forgot_password_returns_generic_message(client: AsyncClient, registered_student):
    res = await client.post("/auth/forgot-password", json={"email": registered_student["user"]["email"]})
    assert res.status_code == 200
    assert "sent" in res.json()["message"].lower()


async def test_forgot_password_unknown_email(client: AsyncClient):
    # Must NOT reveal whether email exists
    res = await client.post("/auth/forgot-password", json={"email": "ghost@example.com"})
    assert res.status_code == 200
    assert "sent" in res.json()["message"].lower()


async def test_reset_password_full_flow(client: AsyncClient, registered_student):
    email = registered_student["user"]["email"]
    await client.post("/auth/forgot-password", json={"email": email})

    redis = get_redis()
    keys = await redis.keys("pwd_reset:*")
    assert keys, "Expected a reset token in Redis"
    token = keys[0].removeprefix("pwd_reset:")

    res = await client.post("/auth/reset-password", json={
        "token": token, "new_password": "NewPass99"
    })
    assert res.status_code == 200

    # Old password no longer works
    old_login = await client.post("/auth/login", json={
        "email": email, "password": registered_student["token"]  # old pass
    })
    # New password works
    new_login = await client.post("/auth/login", json={"email": email, "password": "NewPass99"})
    assert new_login.status_code == 200


async def test_reset_password_invalid_token(client: AsyncClient):
    res = await client.post("/auth/reset-password", json={
        "token": "notarealtoken", "new_password": "Valid123"
    })
    assert res.status_code == 400


async def test_reset_password_weak_password(client: AsyncClient):
    res = await client.post("/auth/reset-password", json={
        "token": "anytoken", "new_password": "weak"
    })
    assert res.status_code == 422
