from datetime import datetime, timezone

from database import get_db
from models.collections import RESULTS, SESSIONS, USERS
from utils.helpers import str_objectid, str_objectids


async def get_student_history(user_id: str) -> list:
    """Get all interview reports for a student."""
    db = get_db()
    cursor = db[RESULTS].find({"user_id": user_id}).sort("completed_at", -1)
    docs = await cursor.to_list(length=50)
    results = []
    for doc in docs:
        results.append({
            "session_id": doc.get("session_id"),
            "overall_score": doc.get("overall_score", 0),
            "total_questions": doc.get("total_questions", 0),
            "completed_at": doc.get("completed_at", ""),
            "role_title": doc.get("role_title", ""),
        })
    return results


async def get_admin_analytics() -> dict:
    """Get aggregated analytics for admin dashboard."""
    db = get_db()

    # Total students
    total_students = await db[USERS].count_documents({"role": "student"})

    # Users with in-progress interview sessions.
    active_user_ids = await db[SESSIONS].distinct("user_id", {"status": "in_progress"})
    live_users = len([uid for uid in active_user_ids if uid])

    # New students created since start of current UTC day.
    day_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    new_users_today = await db[USERS].count_documents({"role": "student", "created_at": {"$gte": day_start}})

    # Total interviews
    total_interviews = await db[RESULTS].count_documents({})

    # Average score
    pipeline = [
        {"$group": {"_id": None, "avg_score": {"$avg": "$overall_score"}}},
    ]
    avg_result = await db[RESULTS].aggregate(pipeline).to_list(length=1)
    avg_score = round(avg_result[0]["avg_score"], 1) if avg_result else 0

    # Top performers
    top_pipeline = [
        {"$group": {
            "_id": "$user_id",
            "avg_score": {"$avg": "$overall_score"},
            "interview_count": {"$sum": 1},
        }},
        {"$sort": {"avg_score": -1}},
        {"$limit": 10},
    ]
    top_results = await db[RESULTS].aggregate(top_pipeline).to_list(length=10)

    top_performers = []
    for r in top_results:
        user = None
        try:
            user = await db[USERS].find_one({"_id": __import__("bson").ObjectId(r["_id"])})
        except Exception:
            pass
        if not user:
            # user_id may be stored as a plain string instead of ObjectId.
            user = await db[USERS].find_one({"user_id": r["_id"]})
        top_performers.append({
            "user_id": r["_id"],
            "name": user.get("name", "Unknown") if user else "Unknown",
            "avg_score": round(r["avg_score"], 1),
            "interview_count": r["interview_count"],
        })

    # Common weak areas
    weakness_pipeline = [
        {"$unwind": "$weaknesses"},
        {"$group": {"_id": "$weaknesses", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 10},
    ]
    weakness_results = await db[RESULTS].aggregate(weakness_pipeline).to_list(length=10)
    common_weak = [w["_id"] for w in weakness_results]

    return {
        "total_students": total_students,
        "live_users": live_users,
        "new_users_today": new_users_today,
        "total_interviews": total_interviews,
        "average_score": avg_score,
        "top_performers": top_performers,
        "common_weak_areas": common_weak,
    }


async def get_student_analytics(user_id: str) -> dict:
    """Get analytics for a specific student."""
    db = get_db()

    results = await db[RESULTS].find({"user_id": user_id}).to_list(length=100)
    if not results:
        return {
            "total_interviews": 0,
            "average_score": 0,
            "best_score": 0,
            "worst_score": 0,
            "weak_topics": [],
            "strong_topics": [],
        }

    scores = [r.get("overall_score", 0) for r in results]
    all_weaknesses = []
    all_strengths = []
    for r in results:
        all_weaknesses.extend(r.get("weaknesses", []))
        all_strengths.extend(r.get("strengths", []))

    # Count frequencies
    from collections import Counter
    weak_counts = Counter(all_weaknesses)
    strong_counts = Counter(all_strengths)

    return {
        "total_interviews": len(results),
        "average_score": round(sum(scores) / len(scores), 1),
        "best_score": max(scores),
        "worst_score": min(scores),
        "weak_topics": [w for w, _ in weak_counts.most_common(5)],
        "strong_topics": [s for s, _ in strong_counts.most_common(5)],
    }
