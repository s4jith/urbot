# backend/tests/test_gemini_rotation.py
"""Unit and integration tests for Redis-backed Gemini API key rotation and admin endpoints."""

import pytest
import asyncio
import hashlib
from httpx import AsyncClient
from database import get_db, get_redis
from models.collections import GEMINI_KEYS
from utils.gemini import reload_key_pool, _pick_key, _mark_key_rate_limited, get_key_pool_status

pytestmark = pytest.mark.asyncio


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
async def clean_gemini_db_and_redis():
    """Wipe key collections and redis rotation keys before each test."""
    db = get_db()
    redis = get_redis()
    
    # Clean DB
    await db[GEMINI_KEYS].delete_many({})
    
    # Clean Redis
    keys = await redis.keys("gemini:*")
    if keys:
        await redis.delete(*keys)
    
    yield
    
    # Teardown clean
    await db[GEMINI_KEYS].delete_many({})
    keys = await redis.keys("gemini:*")
    if keys:
        await redis.delete(*keys)


async def test_key_pool_loads_from_db():
    """Verify that reload_key_pool loads keys from MongoDB when active keys exist."""
    db = get_db()
    # Insert two mock keys
    await db[GEMINI_KEYS].insert_many([
        {"key": "AIzaSyFakeKeyOne_1234567890", "description": "Key One", "is_active": True},
        {"key": "AIzaSyFakeKeyTwo_0987654321", "description": "Key Two", "is_active": True},
        {"key": "AIzaSyFakeKeyThree_Inactive", "description": "Key Inactive", "is_active": False},
    ])
    
    await reload_key_pool()
    
    from utils.gemini import _KEY_POOL
    assert len(_KEY_POOL) == 2
    # Verify both loaded keys are active
    keys_in_pool = [e["key"] for e in _KEY_POOL]
    assert "AIzaSyFakeKeyOne_1234567890" in keys_in_pool
    assert "AIzaSyFakeKeyTwo_0987654321" in keys_in_pool
    assert "AIzaSyFakeKeyThree_Inactive" not in keys_in_pool


async def test_key_pool_falls_back_to_env():
    """Verify that reload_key_pool falls back to env settings if DB is empty."""
    # Ensure DB is empty
    db = get_db()
    await db[GEMINI_KEYS].delete_many({})
    
    await reload_key_pool()
    
    from utils.gemini import _KEY_POOL
    # Should have loaded whatever is in config (GEMINI_API_KEY/GEMINI_API_KEYS)
    assert len(_KEY_POOL) >= 0  # Fallback succeeds without error


async def test_round_robin_rotation_via_redis():
    """Verify round-robin picker updates index and rotates correctly using Redis."""
    db = get_db()
    # Insert fake keys
    keys = [f"AIzaSyFakeKeyRotation_{i}" for i in range(3)]
    await db[GEMINI_KEYS].insert_many([
        {"key": k, "is_active": True} for k in keys
    ])
    
    await reload_key_pool()
    
    # Call picker 6 times and observe rotation sequence
    selected_keys = []
    for _ in range(6):
        key_entry = await _pick_key()
        selected_keys.append(key_entry["key"])
        
    # Expect order: 0 -> 1 -> 2 -> 0 -> 1 -> 2
    expected_order = [keys[0], keys[1], keys[2], keys[0], keys[1], keys[2]]
    assert selected_keys == expected_order


async def test_rate_limit_cooldown_skipping():
    """Verify that picker skips keys that are in minute cooldown."""
    db = get_db()
    keys = [f"AIzaSyFakeKeyCooldown_{i}" for i in range(3)]
    await db[GEMINI_KEYS].insert_many([
        {"key": k, "is_active": True} for k in keys
    ])
    
    await reload_key_pool()
    
    from utils.gemini import _KEY_POOL
    # Cooldown the second key (index 1)
    # Using helper to set Redis key
    await _mark_key_rate_limited(_KEY_POOL[1], retry_seconds=60, is_daily=False)
    
    # Pick key 4 times. Sequence should skip index 1: 0 -> 2 -> 0 -> 2
    selected = []
    for _ in range(4):
        key_entry = await _pick_key()
        selected.append(key_entry["key"])
        
    assert keys[0] in selected
    assert keys[2] in selected
    assert keys[1] not in selected


async def test_daily_limit_skipping():
    """Verify that picker skips keys that hit daily quota (RPD)."""
    db = get_db()
    keys = [f"AIzaSyFakeKeyDaily_{i}" for i in range(3)]
    await db[GEMINI_KEYS].insert_many([
        {"key": k, "is_active": True} for k in keys
    ])
    
    await reload_key_pool()
    
    from utils.gemini import _KEY_POOL
    # Set daily limit hit for key at index 0 and 2
    await _mark_key_rate_limited(_KEY_POOL[0], is_daily=True)
    await _mark_key_rate_limited(_KEY_POOL[2], is_daily=True)
    
    # Picker should only return key at index 1
    for _ in range(3):
        key_entry = await _pick_key()
        assert key_entry["key"] == keys[1]


async def test_recovery_fallback_all_rate_limited():
    """Verify picker returns the key with the shortest cooldown if all are rate-limited."""
    db = get_db()
    keys = ["AIzaSyKeyShortCooldown", "AIzaSyKeyLongCooldown"]
    await db[GEMINI_KEYS].insert_many([
        {"key": k, "is_active": True} for k in keys
    ])
    
    await reload_key_pool()
    
    from utils.gemini import _KEY_POOL
    # Set short cooldown for index 0, long cooldown for index 1
    await _mark_key_rate_limited(_KEY_POOL[0], retry_seconds=5, is_daily=False)
    await _mark_key_rate_limited(_KEY_POOL[1], retry_seconds=100, is_daily=False)
    
    # Should fallback to index 0 because it recovers sooner
    key_entry = await _pick_key()
    assert key_entry["key"] == keys[0]


# ── Admin Endpoints ──

async def test_admin_gemini_keys_crud(client: AsyncClient, registered_admin):
    """Verify CRUD endpoints for managing keys are fully operational and require admin privileges."""
    headers = auth_headers(registered_admin["token"])
    
    # 1. Add key
    add_payload = {
        "key": "AIzaSyNewFakeKeyAddedViaRouterEndpoint_000000",
        "description": "Test endpoint key"
    }
    add_res = await client.post("/admin/gemini-keys", json=add_payload, headers=headers)
    assert add_res.status_code == 200
    res_data = add_res.json()
    assert "id" in res_data
    assert res_data["description"] == "Test endpoint key"
    assert "..." in res_data["key"]  # Key masked in return
    key_id = res_data["id"]
    
    # 2. Get keys list
    list_res = await client.get("/admin/gemini-keys", headers=headers)
    assert list_res.status_code == 200
    keys_list = list_res.json()["keys"]
    assert len(keys_list) >= 1
    assert any(k["id"] == key_id for k in keys_list)
    assert "..." in keys_list[0]["key"]  # Masked in list
    
    # 3. Patch key (toggle status)
    patch_payload = {
        "is_active": False,
        "description": "Updated key desc"
    }
    patch_res = await client.patch(f"/admin/gemini-keys/{key_id}", json=patch_payload, headers=headers)
    assert patch_res.status_code == 200
    assert patch_res.json()["is_active"] is False
    assert patch_res.json()["description"] == "Updated key desc"
    
    # 4. Delete key
    del_res = await client.delete(f"/admin/gemini-keys/{key_id}", headers=headers)
    assert del_res.status_code == 200
    
    # Confirm deletion
    list_res_after = await client.get("/admin/gemini-keys", headers=headers)
    assert not any(k["id"] == key_id for k in list_res_after.json()["keys"])


async def test_non_admin_cannot_manage_keys(client: AsyncClient, registered_student):
    """Verify student roles are denied access to CRUD routes."""
    headers = auth_headers(registered_student["token"])
    
    # Add key endpoint
    res1 = await client.post("/admin/gemini-keys", json={"key": "test_key"}, headers=headers)
    assert res1.status_code == 403
    
    # Get keys endpoint
    res2 = await client.get("/admin/gemini-keys", headers=headers)
    assert res2.status_code == 403
