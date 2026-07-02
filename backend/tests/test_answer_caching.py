import pytest
from httpx import AsyncClient
from database import get_db
from unittest.mock import patch, AsyncMock
from bson import ObjectId
from utils.gemini import evaluate_interview

pytestmark = pytest.mark.asyncio


async def test_stored_matching_settings(client: AsyncClient, registered_admin):
    headers = {"Authorization": f"Bearer {registered_admin['token']}"}

    # 1. Get initial setting status (defaults to False)
    res = await client.get("/admin/settings/stored-matching", headers=headers)
    assert res.status_code == 200
    assert res.json() == {"enabled": False}

    # 2. Toggle setting to True
    res = await client.patch("/admin/settings/stored-matching", json={"enabled": True}, headers=headers)
    assert res.status_code == 200
    assert res.json() == {"enabled": True}

    # 3. Verify it is persisted
    res = await client.get("/admin/settings/stored-matching", headers=headers)
    assert res.status_code == 200
    assert res.json() == {"enabled": True}

    # 4. Toggle setting back to False
    res = await client.patch("/admin/settings/stored-matching", json={"enabled": False}, headers=headers)
    assert res.status_code == 200
    assert res.json() == {"enabled": False}


async def test_evaluate_interview_stored_matching_workflow(client: AsyncClient, registered_admin):
    headers = {"Authorization": f"Bearer {registered_admin['token']}"}
    db = get_db()

    # Clear old data
    await db["approved_evaluations"].delete_many({})
    await db["pending_evaluations"].delete_many({})

    # Enable stored matching
    await client.patch("/admin/settings/stored-matching", json={"enabled": True}, headers=headers)

    question_id = str(ObjectId())

    # Insert a pre-approved evaluation
    await db["approved_evaluations"].insert_one({
        "question_id": question_id,
        "user_answer": "This is the correct answer.",
        "user_answer_normalized": "this is the correct answer.",
        "score": 95,
        "feedback": "Perfect pre-approved explanation."
    })

    # Case A: User gives exactly the matched answer
    qa_list_matched = [{
        "question_id": question_id,
        "question": "What is Python?",
        "answer": "  This is the CORRECT answer.  ",  # with spaces & different case
        "category": "oops",
        "subtopic": "inheritance"
    }]

    with patch("utils.gemini.call_ollama", new_callable=AsyncMock) as mock_ollama:
        # Evaluate: should match pre-approved evaluation and NOT call LLM
        eval_result = await evaluate_interview(qa_list_matched, "Python Developer")
        assert mock_ollama.call_count == 0
        assert eval_result["overall_score"] == 95
        assert eval_result["detailed_scores"][0]["score"] == 95
        assert eval_result["detailed_scores"][0]["feedback"] == "Perfect pre-approved explanation."

    # Case B: User gives a different answer (needs LLM grading)
    qa_list_unmatched = [{
        "question_id": question_id,
        "question": "What is Python?",
        "answer": "It is a programming language.",
        "category": "oops",
        "subtopic": "inheritance"
    }]

    llm_mock_response = """
    {
      "overall_score": 70,
      "technical_score": 70,
      "grammatical_score": 75,
      "per_question": [
        {"index": 1, "score": 70, "feedback": "Decent basic explanation."}
      ],
      "strengths": ["Basic conceptual match"],
      "weaknesses": ["Needs more detail"],
      "recommendations": ["Expand on OOP details"]
    }
    """

    with patch("utils.gemini.call_ollama", return_value=llm_mock_response) as mock_ollama:
        eval_result = await evaluate_interview(qa_list_unmatched, "Python Developer")
        assert mock_ollama.call_count == 1
        assert eval_result["overall_score"] == 70
        assert eval_result["detailed_scores"][0]["score"] == 70
        assert eval_result["detailed_scores"][0]["feedback"] == "Decent basic explanation."

        # Verify that it created a pending_evaluations entry
        pending_doc = await db["pending_evaluations"].find_one({
            "question_id": question_id,
            "user_answer_normalized": "it is a programming language."
        })
        assert pending_doc is not None
        assert pending_doc["llm_suggested_score"] == 70
        assert pending_doc["llm_suggested_feedback"] == "Decent basic explanation."
        assert pending_doc["category"] == "oops"


async def test_pending_evaluation_endpoints(client: AsyncClient, registered_admin):
    headers = {"Authorization": f"Bearer {registered_admin['token']}"}
    db = get_db()

    # Clear old data
    await db["approved_evaluations"].delete_many({})
    await db["pending_evaluations"].delete_many({})

    question_id = str(ObjectId())

    # Insert a dummy pending evaluation
    pending_insert = await db["pending_evaluations"].insert_one({
        "question_id": question_id,
        "question_text": "What is Python?",
        "category": "Python",
        "subtopic": "basics",
        "user_answer": "It is a language.",
        "user_answer_normalized": "it is a language.",
        "llm_suggested_score": 60,
        "llm_suggested_feedback": "A bit too short.",
        "original_answer": "A high-level language.",
        "compacted_answer": "High-level language."
    })
    pending_id = str(pending_insert.inserted_id)

    # 1. GET pending evaluations
    res = await client.get("/admin/pending-evaluations", headers=headers)
    assert res.status_code == 200
    topics = res.json()["topics"]
    assert "Python" in topics
    assert len(topics["Python"]["questions"]) == 1
    assert topics["Python"]["questions"][0]["question_id"] == question_id
    assert len(topics["Python"]["questions"][0]["answers"]) == 1
    assert topics["Python"]["questions"][0]["answers"][0]["id"] == pending_id

    # 2. Approve the pending evaluation with modified score/feedback
    approve_res = await client.post(
        f"/admin/pending-evaluations/{pending_id}/approve",
        json={"score": 85, "feedback": "Good description."},
        headers=headers
    )
    assert approve_res.status_code == 200
    assert approve_res.json() == {"message": "Approved and stored successfully"}

    # 3. Verify it was moved to approved_evaluations
    approved_doc = await db["approved_evaluations"].find_one({
        "question_id": question_id,
        "user_answer_normalized": "it is a language."
    })
    assert approved_doc is not None
    assert approved_doc["score"] == 85
    assert approved_doc["feedback"] == "Good description."

    # 4. Verify it was deleted from pending_evaluations
    pending_doc = await db["pending_evaluations"].find_one({"_id": ObjectId(pending_id)})
    assert pending_doc is None

    # 5. Insert another pending evaluation to test DELETE
    pending_insert2 = await db["pending_evaluations"].insert_one({
        "question_id": question_id,
        "question_text": "What is Python?",
        "category": "Python",
        "user_answer": "Delete me.",
        "user_answer_normalized": "delete me."
    })
    pending_id2 = str(pending_insert2.inserted_id)

    # Delete/Dismiss pending answer
    del_res = await client.delete(f"/admin/pending-evaluations/{pending_id2}", headers=headers)
    assert del_res.status_code == 200
    assert del_res.json() == {"message": "Pending answer dismissed"}

    # Verify it is deleted
    pending_doc2 = await db["pending_evaluations"].find_one({"_id": ObjectId(pending_id2)})
    assert pending_doc2 is None


async def test_approved_evaluation_endpoints(client: AsyncClient, registered_admin):
    headers = {"Authorization": f"Bearer {registered_admin['token']}"}
    db = get_db()

    # Clear old data
    await db["approved_evaluations"].delete_many({})
    await db["questions"].delete_many({})

    question_id = str(ObjectId())

    # Insert a dummy question in DB to link with approved evaluation
    await db["questions"].insert_one({
        "_id": ObjectId(question_id),
        "question": "What is Django?",
        "category": "Django",
        "original_answer": "Web framework.",
        "compacted_answer": "Python Web framework."
    })

    # Insert approved evaluation
    approved_insert = await db["approved_evaluations"].insert_one({
        "question_id": question_id,
        "user_answer": "It is a python framework.",
        "user_answer_normalized": "it is a python framework.",
        "score": 90,
        "feedback": "Accurate."
    })
    approved_id = str(approved_insert.inserted_id)

    # 1. GET approved evaluations
    res = await client.get("/admin/approved-evaluations", headers=headers)
    assert res.status_code == 200
    topics = res.json()["topics"]
    assert "Django" in topics
    assert len(topics["Django"]["questions"]) == 1
    assert topics["Django"]["questions"][0]["question_id"] == question_id
    assert len(topics["Django"]["questions"][0]["answers"]) == 1
    assert topics["Django"]["questions"][0]["answers"][0]["id"] == approved_id

    # 2. PUT to update approved evaluation
    update_res = await client.put(
        f"/admin/approved-evaluations/{approved_id}",
        json={"score": 95, "feedback": "Super accurate!"},
        headers=headers
    )
    assert update_res.status_code == 200
    assert update_res.json() == {"message": "Approved evaluation updated successfully"}

    # Verify update in DB
    doc_updated = await db["approved_evaluations"].find_one({"_id": ObjectId(approved_id)})
    assert doc_updated is not None
    assert doc_updated["score"] == 95
    assert doc_updated["feedback"] == "Super accurate!"

    # 3. DELETE approved evaluation
    del_res = await client.delete(f"/admin/approved-evaluations/{approved_id}", headers=headers)
    assert del_res.status_code == 200
    assert del_res.json() == {"message": "Approved evaluation deleted successfully"}

    # Verify deleted
    doc_deleted = await db["approved_evaluations"].find_one({"_id": ObjectId(approved_id)})
    assert doc_deleted is None

