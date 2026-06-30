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


async def test_manual_creation_and_compaction(client: AsyncClient, registered_admin):
    # 1. Create a topic
    headers = {"Authorization": f"Bearer {registered_admin['token']}"}
    topic_res = await client.post("/admin/topics", json={
        "name": "Python Manual Topic", "description": "Python basics for manual test"
    }, headers=headers)
    assert topic_res.status_code == 200
    topic_id = topic_res.json()["id"]

    # 2. Mock compact_answer_with_llm
    with patch("utils.gemini.compact_answer_with_llm", return_value="Compacted: Dicts are insertion ordered."):
        payload = {
            "interview_type": "topic",
            "topic_id": topic_id,
            "question": "Are Python dicts ordered?",
            "original_answer": "Yes, starting from Python 3.7 dictionaries preserve insertion order as a language spec.",
            "difficulty": "easy"
        }

        res = await client.post("/admin/questions", json=payload, headers=headers)
        assert res.status_code == 200

        # Check database directly
        db = get_db()
        doc = await db[TOPIC_QUESTIONS].find_one({"topic_id": topic_id, "question": "Are Python dicts ordered?"})
        assert doc is not None
        assert doc["original_answer"] == "Yes, starting from Python 3.7 dictionaries preserve insertion order as a language spec."
        assert doc["compacted_answer"] == "Compacted: Dicts are insertion ordered."
        assert doc["expected_answer"] == "Compacted: Dicts are insertion ordered."


async def test_upload_pdf_questions_via_general_upload(client: AsyncClient, registered_admin):
    headers = {"Authorization": f"Bearer {registered_admin['token']}"}
    # Create topic
    topic_res = await client.post("/admin/topics", json={
        "name": "PDF Topic", "description": "Basics of PDF"
    }, headers=headers)
    assert topic_res.status_code == 200
    topic_id = topic_res.json()["id"]

    from unittest.mock import AsyncMock
    mock_ollama_resp = '{"questions": [{"question": "What is Django?", "subtopic": "Django", "difficulty": "medium", "original_answer": "Django is a Python web framework."}]}'
    with patch("services.admin_service.extract_resume_text", return_value="Dummy text that is long enough to bypass validation length checks."):
        with patch("services.admin_service.call_ollama", AsyncMock(return_value=mock_ollama_resp)):
            with patch("services.admin_service.compact_answer_with_llm", AsyncMock(return_value="Compacted: Django is a Python framework.")):
                pdf_data = b"%PDF-1.4 dummy pdf content that has enough bytes"
                files = {
                    "file": ("questions.pdf", pdf_data, "application/pdf")
                }
                data = {
                    "interview_type": "topic",
                    "topic_id": topic_id,
                }
                res = await client.post("/admin/questions/upload", data=data, files=files, headers=headers)
                assert res.status_code == 200
                res_data = res.json()
                assert len(res_data["questions"]) == 1
                q = res_data["questions"][0]
                assert q["question"] == "What is Django?"
                assert q["original_answer"] == "Django is a Python web framework."
                assert q["compacted_answer"] == "Compacted: Django is a Python framework."
                assert q["expected_answer"] == "Compacted: Django is a Python framework."


async def test_upload_csv_questions_via_general_upload(client: AsyncClient, registered_admin):
    headers = {"Authorization": f"Bearer {registered_admin['token']}"}
    # Create topic
    topic_res = await client.post("/admin/topics", json={
        "name": "General CSV Topic", "description": "CSV upload test"
    }, headers=headers)
    assert topic_res.status_code == 200
    topic_id = topic_res.json()["id"]

    with patch("utils.gemini.compact_answer_with_llm", return_value="Compacted: Pytest is a test runner."):
        csv_data = "Testing,What is Pytest?,Pytest is a testing framework for Python.,easy"
        files = {
            "file": ("questions.csv", csv_data, "text/csv")
        }
        data = {
            "interview_type": "topic",
            "topic_id": topic_id,
        }
        res = await client.post("/admin/questions/upload", data=data, files=files, headers=headers)
        assert res.status_code == 200
        res_data = res.json()
        assert len(res_data["questions"]) == 1
        q = res_data["questions"][0]
        assert q["question"] == "What is Pytest?"
        assert q["original_answer"] == "Pytest is a testing framework for Python."
        assert q["compacted_answer"] == "Compacted: Pytest is a test runner."
        assert q["expected_answer"] == "Compacted: Pytest is a test runner."


async def test_upload_excel_questions_via_general_upload(client: AsyncClient, registered_admin):
    headers = {"Authorization": f"Bearer {registered_admin['token']}"}
    # Create topic
    topic_res = await client.post("/admin/topics", json={
        "name": "Excel Topic", "description": "Excel upload test"
    }, headers=headers)
    assert topic_res.status_code == 200
    topic_id = topic_res.json()["id"]

    # Let's create a minimal Excel workbook using openpyxl
    import openpyxl
    import io
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Subtopic", "Question", "Answer", "Difficulty"])
    ws.append(["Basics", "What is OOP?", "Object-Oriented Programming", "easy"])
    
    excel_file = io.BytesIO()
    wb.save(excel_file)
    excel_bytes = excel_file.getvalue()

    with patch("utils.gemini.compact_answer_with_llm", return_value="Compacted: Object-oriented programming."):
        files = {
            "file": ("questions.xlsx", excel_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        }
        data = {
            "interview_type": "topic",
            "topic_id": topic_id,
        }
        res = await client.post("/admin/questions/upload", data=data, files=files, headers=headers)
        assert res.status_code == 200
        res_data = res.json()
        assert len(res_data["questions"]) == 1
        q = res_data["questions"][0]
        assert q["question"] == "What is OOP?"
        assert q["original_answer"] == "Object-Oriented Programming"
        assert q["compacted_answer"] == "Compacted: Object-oriented programming."
        assert q["expected_answer"] == "Compacted: Object-oriented programming."


async def test_batch_creation_endpoint(client: AsyncClient, registered_admin):
    headers = {"Authorization": f"Bearer {registered_admin['token']}"}
    # Create topic
    topic_res = await client.post("/admin/topics", json={
        "name": "Batch Topic", "description": "Batch creation test"
    }, headers=headers)
    assert topic_res.status_code == 200
    topic_id = topic_res.json()["id"]

    payload = {
        "questions": [
            {
                "topic_id": topic_id,
                "interview_type": "topic",
                "question": "What is Python list comprehension?",
                "original_answer": "A syntactic construct for creating a list based on existing lists.",
                "compacted_answer": "Syntactic construct for list creation.",
                "expected_answer": "Syntactic construct for list creation.",
                "difficulty": "medium",
                "subtopic": "Lists"
            }
        ]
    }
    res = await client.post("/admin/questions/batch", json=payload, headers=headers)
    assert res.status_code == 200
    assert res.json()["inserted_count"] == 1

    # Verify db entry
    db = get_db()
    doc = await db[TOPIC_QUESTIONS].find_one({"topic_id": topic_id})
    assert doc is not None
    assert doc["question"] == "What is Python list comprehension?"
    assert doc["original_answer"] == "A syntactic construct for creating a list based on existing lists."
    assert doc["compacted_answer"] == "Syntactic construct for list creation."
    assert doc["expected_answer"] == "Syntactic construct for list creation."
