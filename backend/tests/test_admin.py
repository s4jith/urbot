# backend/tests/test_admin.py
"""Integration tests for /admin router."""

import pytest
from httpx import AsyncClient
from database import get_db

pytestmark = pytest.mark.asyncio


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── Role guard ────────────────────────────────────────────────────────────────

async def test_student_cannot_access_admin(client: AsyncClient, registered_student):
    res = await client.get("/admin/users", headers=auth_headers(registered_student["token"]))
    assert res.status_code == 403


async def test_admin_can_access_user_list(client: AsyncClient, registered_admin):
    res = await client.get("/admin/users", headers=auth_headers(registered_admin["token"]))
    assert res.status_code == 200
    assert "items" in res.json()


# ── Pagination ────────────────────────────────────────────────────────────────

async def test_user_list_pagination(client: AsyncClient, registered_admin):
    """Create 5 students then verify limit/skip works."""
    for i in range(5):
        await client.post("/auth/signup", json={
            "name": f"Student {i}", "email": f"stud{i}@example.com", "password": f"Pass{i}123"
        })

    headers = auth_headers(registered_admin["token"])
    page1 = await client.get("/admin/users?limit=3&skip=0", headers=headers)
    page2 = await client.get("/admin/users?limit=3&skip=3", headers=headers)

    assert page1.status_code == 200
    assert page2.status_code == 200
    ids1 = {u["id"] for u in page1.json()["items"]}
    ids2 = {u["id"] for u in page2.json()["items"]}
    # Pages must not overlap
    assert ids1.isdisjoint(ids2)


# ── Job Roles CRUD ────────────────────────────────────────────────────────────

async def test_create_role(client: AsyncClient, registered_admin):
    res = await client.post("/admin/roles", json={
        "title": "Software Engineer",
        "description": "Full-stack development",
        "department": "Engineering",
    }, headers=auth_headers(registered_admin["token"]))
    assert res.status_code == 200
    assert res.json()["title"] == "Software Engineer"


async def test_update_role(client: AsyncClient, registered_admin):
    headers = auth_headers(registered_admin["token"])
    created = await client.post("/admin/roles", json={
        "title": "Old Title", "description": "desc",
    }, headers=headers)
    role_id = created.json()["id"]

    updated = await client.put(f"/admin/roles/{role_id}", json={
        "title": "New Title", "description": "updated",
    }, headers=headers)
    assert updated.status_code == 200
    assert updated.json()["title"] == "New Title"


async def test_delete_role(client: AsyncClient, registered_admin):
    headers = auth_headers(registered_admin["token"])
    created = await client.post("/admin/roles", json={"title": "To Delete", "description": "x"}, headers=headers)
    role_id = created.json()["id"]

    del_res = await client.delete(f"/admin/roles/{role_id}", headers=headers)
    assert del_res.status_code == 200

    roles = await client.get("/admin/roles", headers=headers)
    assert not any(r["id"] == role_id for r in roles.json()["roles"])


# ── Topics ────────────────────────────────────────────────────────────────────

async def test_create_and_publish_topic(client: AsyncClient, registered_admin):
    headers = auth_headers(registered_admin["token"])

    created = await client.post("/admin/topics", json={
        "name": "Data Structures", "description": "Arrays, trees, graphs"
    }, headers=headers)
    assert created.status_code == 200
    topic_id = created.json()["id"]

    pub = await client.put(f"/admin/topics/{topic_id}/publish", json={"is_published": True}, headers=headers)
    assert pub.status_code == 200


# ── Analytics ─────────────────────────────────────────────────────────────────

async def test_analytics_returns_expected_keys(client: AsyncClient, registered_admin):
    res = await client.get("/admin/analytics", headers=auth_headers(registered_admin["token"]))
    assert res.status_code == 200
    data = res.json()
    for key in ("total_students", "average_score", "top_performers", "common_weak_areas"):
        assert key in data, f"Missing key: {key}"


# ── Delete user ───────────────────────────────────────────────────────────────

async def test_admin_can_delete_student(client: AsyncClient, registered_admin, registered_student):
    headers = auth_headers(registered_admin["token"])
    student_id = registered_student["user"]["id"]

    res = await client.delete(f"/admin/users/{student_id}", headers=headers)
    assert res.status_code == 200

    users = await client.get("/admin/users", headers=headers)
    assert not any(u["id"] == student_id for u in users.json()["items"])


async def test_admin_cannot_delete_self(client: AsyncClient, registered_admin):
    admin_id = registered_admin["user"]["id"]
    res = await client.delete(
        f"/admin/users/{admin_id}",
        headers=auth_headers(registered_admin["token"]),
    )
    assert res.status_code in (400, 403)


# ── Health endpoints ──────────────────────────────────────────────────────────

async def test_health_fast(client: AsyncClient):
    res = await client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


async def test_health_services(client: AsyncClient):
    res = await client.get("/health/services")
    assert res.status_code == 200
    data = res.json()
    assert "services" in data
    assert "mongodb" in data["services"]
    assert "redis" in data["services"]


# ── Student Filter ────────────────────────────────────────────────────────────

async def test_student_filter(client: AsyncClient, registered_admin, registered_student):
    headers = auth_headers(registered_admin["token"])
    
    # 1. Create a Topic
    topic_res = await client.post("/admin/topics", json={
        "name": "Maths", "description": "Basic arithmetic"
    }, headers=headers)
    assert topic_res.status_code == 200
    topic_id = topic_res.json()["id"]

    # 2. Create a Group Test
    gt_res = await client.post("/admin/group-tests", json={
        "name": "General Aptitude",
        "description": "Basic questions",
        "topic_ids": [topic_id],
        "max_attempts": 2
    }, headers=headers)
    assert gt_res.status_code == 200
    gt_id = gt_res.json()["id"]

    # 3. Create a Group Test Result directly in DB for registered student
    db = get_db()
    await db["group_test_results"].insert_one({
        "group_test_id": gt_id,
        "group_test_name": "General Aptitude",
        "user_id": registered_student["user"]["id"],
        "user_name": registered_student["user"]["name"],
        "user_email": registered_student["user"]["email"],
        "attempt_number": 1,
        "topic_results": [
            {
                "topic_id": topic_id,
                "topic_name": "Maths",
                "session_id": "sess-123",
                "status": "completed",
                "overall_score": 85.0,
                "total_questions": 10,
                "completed_at": "2026-05-28T00:00:00Z"
            }
        ],
        "overall_score": 85.0,
        "status": "completed",
        "started_at": "2026-05-28T00:00:00Z",
        "completed_at": "2026-05-28T00:10:00Z",
        "time_limit_minutes": 30
    })

    # 4. Call /admin/students/filter endpoint
    filter_res = await client.post("/admin/students/filter", json={
        "group_test_ids": [gt_id],
        "jd_id": None,
        "start_date": "2026-05-27",
        "end_date": "2026-05-29",
        "top_k": None,
        "min_score": None,
        "sort_fields": ["time"],
        "sort_orders": ["desc"]
    }, headers=headers)

    assert filter_res.status_code == 200, f"Failed: {filter_res.text}"
    res_data = filter_res.json()
    assert res_data["group_test_name"] == "General Aptitude"
    assert len(res_data["rows"]) == 1
    assert res_data["rows"][0]["overall_score"] == 85.0
    assert res_data["rows"][0]["user_id"] == registered_student["user"]["id"]

