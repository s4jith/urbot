import pytest
import json
from unittest.mock import patch, AsyncMock
from database import get_db, get_redis
from models.collections import TOPIC_QUESTIONS
from services.queue_service import are_questions_similar
from services.interview_service import (
    _sample_topic_questions,
    _sample_adaptive_questions,
    _get_target_difficulty_counts,
)

@pytest.mark.asyncio
async def test_semantic_similarity():
    assert are_questions_similar("What is ACID?", "Explain the ACID properties.") is True
    assert are_questions_similar("What is a database transaction?", "Explain database transactions.") is True
    assert are_questions_similar("What is database normalization?", "Explain database normalization.") is True
    
    assert are_questions_similar("What is ACID?", "Explain database joins.") is False
    assert are_questions_similar("How does indexing work?", "What is a primary key?") is False


@pytest.mark.asyncio
async def test_difficulty_distribution_targeting():
    d_easy = _get_target_difficulty_counts("easy", 10)
    assert d_easy == {"easy": 6, "medium": 3, "hard": 1}

    d_hard = _get_target_difficulty_counts("hard", 10)
    assert d_hard == {"easy": 1, "medium": 3, "hard": 6}

    d_med = _get_target_difficulty_counts("medium", 10)
    assert d_med == {"easy": 2, "medium": 6, "hard": 2}


@pytest.mark.asyncio
async def test_adaptive_sampling_with_reinforcement_limits():
    db = get_db()
    redis = get_redis()
    
    session_id = "test_sess_reinf"
    await redis.delete(f"session:{session_id}")
    await redis.delete(f"session:{session_id}:questions")
    await db[TOPIC_QUESTIONS].delete_many({"topic_id": "test_topic_reinf"})
    
    test_questions = [
        {"topic_id": "test_topic_reinf", "question": f"Q{i}", "subtopic": "Transactions", "difficulty": "medium", "category": "topic", "usage_count": 0}
        for i in range(1, 6)
    ]
    await db[TOPIC_QUESTIONS].insert_many(test_questions)
    
    selected = await _sample_adaptive_questions(
        db=db,
        topic_id="test_topic_reinf",
        excluded_questions=[],
        limit=4,
        strong_subtopics=[],
        weak_subtopics=["Transactions"],
        unknown_subtopics=[],
        interview_difficulty="medium",
        session_id=session_id,
        redis=redis,
    )
    
    assert len(selected) == 2
    
    await redis.delete(f"session:{session_id}")
    await redis.delete(f"session:{session_id}:questions")
    await db[TOPIC_QUESTIONS].delete_many({"topic_id": "test_topic_reinf"})


@pytest.mark.asyncio
async def test_smart_question_rotation():
    db = get_db()
    
    topic_id = "test_topic_rotation"
    await db[TOPIC_QUESTIONS].delete_many({"topic_id": topic_id})
    
    test_questions = [
        {"topic_id": topic_id, "question": "Q1", "subtopic": "General", "difficulty": "medium", "category": "topic", "usage_count": 10},
        {"topic_id": topic_id, "question": "Q2", "subtopic": "General", "difficulty": "medium", "category": "topic", "usage_count": 2},
        {"topic_id": topic_id, "question": "Q3", "subtopic": "General", "difficulty": "medium", "category": "topic", "usage_count": 5},
    ]
    await db[TOPIC_QUESTIONS].insert_many(test_questions)
    
    selected = await _sample_topic_questions(
        db=db,
        topic_id=topic_id,
        excluded_questions=[],
        limit=2,
        interview_difficulty="medium",
    )
    
    questions_selected = [q["question"] for q in selected]
    assert "Q2" in questions_selected
    assert "Q3" in questions_selected
    assert "Q1" not in questions_selected
    
    await db[TOPIC_QUESTIONS].delete_many({"topic_id": topic_id})
