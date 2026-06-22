# backend/tests/test_csv_compaction.py
"""Integration tests for CSV upload and LLM compaction."""

import pytest
from httpx import AsyncClient
from database import get_db
from unittest.mock import patch
from models.collections import TOPIC_QUESTIONS
from bson import ObjectId

pytestmark = pytest.mark.asyncio


async def test_csv_upload_and_compaction(client: AsyncClient, registered_admin):
    # 1. Create a topic
    headers = {"Authorization": f"Bearer {registered_admin['token']}"}
    topic_res = await client.post("/admin/topics", json={
        "name": "Python CSV Topic", "description": "Python basics for CSV test"
    }, headers=headers)
    assert topic_res.status_code == 200
    topic_id = topic_res.json()["id"]

    # 2. Mock compact_answer_with_llm
    with patch("utils.gemini.compact_answer_with_llm", return_value="Compacted: GIL is a mutex."):
        # Prepare CSV file contents
        # Columns: Subtopic, Question, Answer
        csv_data = "GIL,What is GIL?,The Global Interpreter Lock is a mutex that protects access to Python objects."
        files = {
            "file": ("test_questions.csv", csv_data, "text/csv")
        }
        data = {
            "topic_id": topic_id
        }

        res = await client.post("/admin/questions/upload-csv", data=data, files=files, headers=headers)
        assert res.status_code == 200
        assert res.json()["imported_count"] == 1

        # Check database directly
        db = get_db()
        doc = await db[TOPIC_QUESTIONS].find_one({"topic_id": topic_id})
        assert doc is not None
        assert doc["question"] == "What is GIL?"
        assert doc["original_answer"] == "The Global Interpreter Lock is a mutex that protects access to Python objects."
        assert doc["compacted_answer"] == "Compacted: GIL is a mutex."
        assert doc["expected_answer"] == "Compacted: GIL is a mutex."
