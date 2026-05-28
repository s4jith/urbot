# backend/tests/test_profile.py
"""Integration tests for /profile and /resume routers."""

import io
import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── Profile ───────────────────────────────────────────────────────────────────

async def test_get_profile_authenticated(client: AsyncClient, registered_student):
    res = await client.get("/profile", headers=auth_headers(registered_student["token"]))
    assert res.status_code == 200
    data = res.json()
    assert data["email"] == registered_student["user"]["email"]


async def test_get_profile_unauthenticated(client: AsyncClient):
    res = await client.get("/profile")
    assert res.status_code == 403


async def test_update_speech_settings(client: AsyncClient, registered_student):
    res = await client.put(
        "/profile/speech-settings",
        json={"voice_gender": "male"},
        headers=auth_headers(registered_student["token"]),
    )
    assert res.status_code == 200

    profile = await client.get("/profile", headers=auth_headers(registered_student["token"]))
    assert profile.json()["speech_settings"]["voice_gender"] == "male"


async def test_update_speech_settings_invalid_gender(client: AsyncClient, registered_student):
    res = await client.put(
        "/profile/speech-settings",
        json={"voice_gender": "robot"},
        headers=auth_headers(registered_student["token"]),
    )
    # Should reject unknown gender values
    assert res.status_code in (400, 422)


# ── Job Descriptions ──────────────────────────────────────────────────────────

async def test_create_and_list_job_description(client: AsyncClient, registered_student):
    # Student cannot create JDs anymore, check that it returns 403 Forbidden
    headers = auth_headers(registered_student["token"])
    create_res = await client.post("/profile/job-descriptions", json={
        "title": "Backend Engineer",
        "description": "Python, FastAPI, MongoDB",
        "required_skills": ["Python", "FastAPI"],
        "company": "Acme Corp",
    }, headers=headers)
    assert create_res.status_code == 403

    # But student can list JDs (which now returns admin-created JDs)
    list_res = await client.get("/profile/job-descriptions", headers=headers)
    assert list_res.status_code == 200


async def test_delete_job_description(client: AsyncClient, registered_student):
    # Student cannot delete JDs anymore, check that it returns 403 Forbidden
    headers = auth_headers(registered_student["token"])
    del_res = await client.delete("/profile/job-descriptions/66042971279a0b1234567890", headers=headers)
    assert del_res.status_code == 403


# ── Resume upload ─────────────────────────────────────────────────────────────

async def test_resume_upload_wrong_type(client: AsyncClient, registered_student):
    """Upload a non-PDF file (e.g. .docx or .exe) — should be rejected."""
    # Test docx file (which was previously allowed but is now forbidden)
    res_docx = await client.post(
        "/resume/upload",
        files={"file": ("resume.docx", b"PK\x03\x04", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        headers=auth_headers(registered_student["token"]),
    )
    assert res_docx.status_code == 400

    # Test exe file
    res = await client.post(
        "/resume/upload",
        files={"file": ("resume.exe", b"MZ\x90\x00", "application/octet-stream")},
        headers=auth_headers(registered_student["token"]),
    )
    assert res.status_code == 400


async def test_resume_upload_too_large(client: AsyncClient, registered_student):
    """Upload a file over 5MB — should be rejected."""
    big_content = b"x" * (5 * 1024 * 1024 + 1)
    res = await client.post(
        "/resume/upload",
        files={"file": ("big.pdf", big_content, "application/pdf")},
        headers=auth_headers(registered_student["token"]),
    )
    assert res.status_code == 400
    assert "large" in res.json()["detail"].lower()


async def test_resume_upload_unauthenticated(client: AsyncClient):
    res = await client.post(
        "/resume/upload",
        files={"file": ("r.pdf", b"%PDF-1.4", "application/pdf")},
    )
    assert res.status_code == 403
