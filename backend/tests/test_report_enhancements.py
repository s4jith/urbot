import pytest
import re
from datetime import datetime
from database import get_db
from models.collections import RESULTS, SESSIONS
from services.evaluation_service import generate_report
from schemas.interview import InterviewReport

@pytest.mark.asyncio
async def test_report_metric_computation():
    db = get_db()
    
    # Let's mock a session in DB
    session_id = "test_report_sess"
    user_id = "test_user_id"
    
    await db[SESSIONS].delete_many({"session_id": session_id})
    await db[RESULTS].delete_many({"session_id": session_id})
    
    await db[SESSIONS].insert_one({
        "session_id": session_id,
        "user_id": user_id,
        "role_title": "Backend Developer",
        "status": "completed",
        "started_at": datetime.now().isoformat(),
        "topic_id": "test_topic_id"
    })
    
    # We will mock evaluate_interview and lrange redis calls or similar in a patch
    from unittest.mock import patch, AsyncMock
    mock_eval = {
        "overall_score": 85,
        "technical_score": 88,
        "grammatical_score": 82,
        "detailed_scores": [
            {"question": "What is ACID?", "answer": "um well ACID is Atomicity, Consistency, Isolation, and Durability.", "score": 90, "feedback": "Good"},
            {"question": "Explain inheritance.", "answer": "basically like you inherit a class.", "score": 80, "feedback": "Okay"}
        ],
        "strengths": ["Clear understanding of ACID properties"],
        "weaknesses": ["Minor filler words in OOP concepts"],
        "recommendations": ["Reduce filler words"]
    }
    
    with patch("services.evaluation_service.evaluate_interview", new_callable=AsyncMock) as mock_evaluate, \
         patch("services.evaluation_service.get_session_qa", new_callable=AsyncMock) as mock_qa, \
         patch("services.evaluation_service.get_redis") as mock_redis_func:
        
        mock_evaluate.return_value = mock_eval
        # return matching QA pairs
        mock_qa.return_value = [
            {"question": "What is ACID?", "answer": "um well ACID is Atomicity, Consistency, Isolation, and Durability.", "difficulty": "medium", "category": "DBMS"},
            {"question": "Explain inheritance.", "answer": "basically like you inherit a class.", "difficulty": "easy", "category": "OOP"}
        ]
        
        mock_redis = AsyncMock()
        mock_redis.lrange.return_value = []
        mock_redis.hgetall.return_value = {}
        mock_redis_func.return_value = mock_redis
        
        report_dict = await generate_report(session_id, user_id)
        
        # Verify the structure satisfies Pydantic InterviewReport schema
        report = InterviewReport(**report_dict)
        
        assert report.session_id == session_id
        assert report.performance_level == "Advanced"
        assert report.hiring_recommendation == "Strong Hire"
        assert "DBMS" in report.topic_scores
        assert report.topic_scores["DBMS"] == 90
        assert report.topic_scores["OOP"] == 80
        
        # Communication metrics
        comm = report.communication_analysis
        assert comm is not None
        assert comm["speaking_speed_wpm"] > 100
        assert comm["filler_word_count"] >= 2 # "um", "basically"
        
        # Timeline progression
        prog = report.progression
        assert prog is not None
        assert len(prog["score_trend"]) == 2
        assert prog["score_trend"][0] == 90
        assert prog["score_trend"][1] == 85
        
        # Hiring simulation
        sim = report.hiring_simulation
        assert sim is not None
        assert sim["recommendation"] == "Hire"
        assert sim["confidence"] > 70
        
    await db[SESSIONS].delete_many({"session_id": session_id})
    await db[RESULTS].delete_many({"session_id": session_id})


@pytest.mark.asyncio
async def test_tab_switches_persistence():
    db = get_db()
    session_id = "test_tab_sess"
    user_id = "test_user_id"

    await db[SESSIONS].delete_many({"session_id": session_id})
    await db[RESULTS].delete_many({"session_id": session_id})

    # Insert mock session
    await db[SESSIONS].insert_one({
        "session_id": session_id,
        "user_id": user_id,
        "role_title": "Frontend Developer",
        "status": "completed",
        "started_at": datetime.now().isoformat()
    })

    # Call update_tab_switches
    from services.interview_service import update_tab_switches
    success = await update_tab_switches(session_id, 3)
    assert success is True

    # Verify session has it
    session_doc = await db[SESSIONS].find_one({"session_id": session_id})
    assert session_doc is not None
    assert session_doc.get("tab_switches") == 3

    # Generate report and verify report copies it
    from unittest.mock import patch, AsyncMock
    mock_eval = {
        "overall_score": 85,
        "technical_score": 88,
        "grammatical_score": 82,
        "detailed_scores": [{"question": "Q1", "answer": "Ans1", "score": 80, "feedback": "Ok"}],
        "strengths": [], "weaknesses": [], "recommendations": []
    }
    with patch("services.evaluation_service.evaluate_interview", new_callable=AsyncMock) as mock_evaluate, \
         patch("services.evaluation_service.get_session_qa", new_callable=AsyncMock) as mock_qa, \
         patch("services.evaluation_service.get_redis") as mock_redis_func:
        mock_evaluate.return_value = mock_eval
        mock_qa.return_value = [{"question": "Q1", "answer": "Ans1", "difficulty": "medium", "category": "General"}]
        
        mock_redis = AsyncMock()
        mock_redis.lrange.return_value = []
        mock_redis.hgetall.return_value = {}
        mock_redis_func.return_value = mock_redis

        report_dict = await generate_report(session_id, user_id)
        assert report_dict.get("tab_switches") == 3

    # Verify in results DB
    result_doc = await db[RESULTS].find_one({"session_id": session_id})
    assert result_doc is not None
    assert result_doc.get("tab_switches") == 3

    await db[SESSIONS].delete_many({"session_id": session_id})
    await db[RESULTS].delete_many({"session_id": session_id})
