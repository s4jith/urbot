import pytest
from unittest.mock import patch, AsyncMock
from database import get_db
from models.collections import TOPIC_QUESTIONS
from services.interview_service import _sample_topic_questions, _sample_adaptive_questions
from services.subtopic_service import evaluate_subtopics

@pytest.mark.asyncio
async def test_sample_topic_questions_round_robin():
    db = get_db()
    # Clean up topic questions
    await db[TOPIC_QUESTIONS].delete_many({"topic_id": "test_topic_rr"})

    # Insert test questions with subtopics
    test_questions = [
        {"topic_id": "test_topic_rr", "question": "Q1", "subtopic": "Transactions", "difficulty": "easy", "category": "topic"},
        {"topic_id": "test_topic_rr", "question": "Q2", "subtopic": "Transactions", "difficulty": "medium", "category": "topic"},
        {"topic_id": "test_topic_rr", "question": "Q3", "subtopic": "Joins", "difficulty": "easy", "category": "topic"},
        {"topic_id": "test_topic_rr", "question": "Q4", "subtopic": "Joins", "difficulty": "hard", "category": "topic"},
        {"topic_id": "test_topic_rr", "question": "Q5", "subtopic": "Indexing", "difficulty": "medium", "category": "topic"},
    ]
    await db[TOPIC_QUESTIONS].insert_many(test_questions)

    # We want 3 questions. Round-robin should pick 1 from each subtopic: Indexing, Joins, Transactions.
    selected = await _sample_topic_questions(db, "test_topic_rr", [], 3)
    assert len(selected) == 3

    subtopics_selected = [q["subtopic"] for q in selected]
    # Should have exactly one from each of the three subtopics since they are round-robined
    assert set(subtopics_selected) == {"Transactions", "Joins", "Indexing"}

    # Clean up
    await db[TOPIC_QUESTIONS].delete_many({"topic_id": "test_topic_rr"})


@pytest.mark.asyncio
async def test_sample_adaptive_questions():
    db = get_db()
    await db[TOPIC_QUESTIONS].delete_many({"topic_id": "test_topic_adaptive"})

    test_questions = [
        {"topic_id": "test_topic_adaptive", "question": "Q1", "subtopic": "Transactions", "difficulty": "easy", "category": "topic"},
        {"topic_id": "test_topic_adaptive", "question": "Q2", "subtopic": "Joins", "difficulty": "medium", "category": "topic"},
        {"topic_id": "test_topic_adaptive", "question": "Q3", "subtopic": "Normalization", "difficulty": "easy", "category": "topic"},
        {"topic_id": "test_topic_adaptive", "question": "Q4", "subtopic": "Indexing", "difficulty": "hard", "category": "topic"},
        {"topic_id": "test_topic_adaptive", "question": "Q5", "subtopic": "Replication", "difficulty": "medium", "category": "topic"},
    ]
    await db[TOPIC_QUESTIONS].insert_many(test_questions)

    # Case 1: Prioritize weak subtopics ("Joins", "Normalization")
    # Limit = 3. Should pick:
    # - Up to 2 from weak subtopics: "Joins" (Q2), "Normalization" (Q3)
    # - Remaining 1 from unknown: "Transactions" (Q1), "Indexing" (Q4), "Replication" (Q5)
    selected = await _sample_adaptive_questions(
        db=db,
        topic_id="test_topic_adaptive",
        excluded_questions=[],
        limit=3,
        strong_subtopics=["Indexing"],
        weak_subtopics=["Joins", "Normalization"],
        unknown_subtopics=["Transactions", "Replication"],
    )

    assert len(selected) == 3
    subtopics = [q["subtopic"] for q in selected]
    
    # Must contain "Joins" and "Normalization"
    assert "Joins" in subtopics
    assert "Normalization" in subtopics
    # And one of the unknown subtopics (not Indexing which is strong, so Transactions or Replication)
    assert any(sub in subtopics for sub in ["Transactions", "Replication"])

    # Clean up
    await db[TOPIC_QUESTIONS].delete_many({"topic_id": "test_topic_adaptive"})


@pytest.mark.asyncio
async def test_evaluate_subtopics_ollama_mock():
    all_subtopics = ["Transactions", "Joins", "Normalization", "Indexing"]
    qa_pairs = [
        {"question": "What is ACID?", "answer": "ACID stands for Atomicity, Consistency, Isolation, and Durability in database transactions."},
        {"question": "What is normalization?", "answer": "I do not know what normalization is."},
    ]

    mock_ollama_response = """
    {
      "strong_subtopics": ["Transactions"],
      "weak_subtopics": ["Normalization"],
      "unknown_subtopics": ["Joins", "Indexing"]
    }
    """

    with patch("services.subtopic_service.call_ollama", new_callable=AsyncMock) as mock_call:
        mock_call.return_value = mock_ollama_response

        evaluation = await evaluate_subtopics(qa_pairs, all_subtopics)

        assert evaluation["strong_subtopics"] == ["Transactions"]
        assert evaluation["weak_subtopics"] == ["Normalization"]
        # Joins and Indexing are unknown
        assert set(evaluation["unknown_subtopics"]) == {"Joins", "Indexing"}
