from bson import ObjectId
from database import get_db
from models.collections import GROUP_TESTS, GROUP_TEST_RESULTS, TOPICS, USERS, RESULTS
from utils.helpers import utc_now, str_objectid, str_objectids


def _parse_reg_no(reg_no: str | None) -> dict | None:
    """Parse a 12-digit reg number: CCCCYYDDDIII
    CCCC = college code, YY = year, DDD = dept code, III = student id.
    Returns None if reg_no is absent or wrong length.
    """
    if not reg_no or len(reg_no) != 12:
        return None
    return {
        "college_code": reg_no[0:4],
        "year": reg_no[4:6],
        "dept_code": reg_no[6:9],
        "student_id": reg_no[9:12],
    }


# ─── helpers ─────────────────────────────────────────────────────────────────

async def _enrich_group_test(doc: dict, db) -> dict:
    """Attach topic names to a group test document."""
    enriched = str_objectid(doc)
    topics = []
    for tid in (doc.get("topic_ids") or []):
        try:
            t = await db[TOPICS].find_one({"_id": ObjectId(tid)})
        except Exception:
            t = None
        if t:
            topics.append({"id": str(t["_id"]), "name": t.get("name", "")})
    enriched["topics"] = topics
    return enriched


async def _refresh_topic_statuses(result: dict, db) -> dict:
    """Check RESULTS collection for each topic session and update statuses in-place."""
    topic_results = result.get("topic_results") or []
    updated = False
    for tr in topic_results:
        if tr.get("status") == "completed":
            continue
        session_id = tr.get("session_id")
        if not session_id:
            continue
        report = await db[RESULTS].find_one({"session_id": session_id})
        if report:
            tr["status"] = "completed"
            tr["overall_score"] = report.get("overall_score", 0)
            tr["total_questions"] = report.get("total_questions", 0)
            tr["completed_at"] = report.get("completed_at")
            updated = True

    if updated:
        result_id = str(result.get("_id") or result.get("id", ""))
        all_done = all(tr.get("status") == "completed" for tr in topic_results)
        if all_done:
            scores = [tr.get("overall_score") or 0 for tr in topic_results]
            overall = round(sum(scores) / len(scores), 1) if scores else 0.0
            await db[GROUP_TEST_RESULTS].update_one(
                {"_id": ObjectId(result_id)},
                {
                    "$set": {
                        "topic_results": topic_results,
                        "status": "completed",
                        "overall_score": overall,
                        "completed_at": utc_now(),
                    }
                },
            )
            result["status"] = "completed"
            result["overall_score"] = overall
        else:
            await db[GROUP_TEST_RESULTS].update_one(
                {"_id": ObjectId(result_id)},
                {"$set": {"topic_results": topic_results}},
            )
        result["topic_results"] = topic_results
    return result


# ─── Admin CRUD ───────────────────────────────────────────────────────────────

async def create_group_test(
    name: str,
    description: str | None,
    topic_ids: list[str],
    time_limit_minutes: int | None,
    max_attempts: int,
    created_by: str,
    jd_id: str | None = None,
    allowed_college_codes: list[str] | None = None,
    allowed_years: list[str] | None = None,
    allowed_dept_codes: list[str] | None = None,
    allowed_user_ids: list[str] | None = None,
) -> dict:
    db = get_db()

    if not topic_ids:
        raise ValueError("At least one topic is required")

    # Validate every topic exists
    for tid in topic_ids:
        try:
            t = await db[TOPICS].find_one({"_id": ObjectId(tid)})
        except Exception:
            raise ValueError(f"Invalid topic ID: {tid}")
        if not t:
            raise ValueError(
                f"Topic with ID '{tid}' does not exist. Create it in Topics before adding here."
            )

    doc = {
        "name": name.strip(),
        "description": (description or "").strip() or None,
        "jd_id": jd_id or None,
        "topic_ids": topic_ids,
        "time_limit_minutes": time_limit_minutes,
        "max_attempts": max(1, int(max_attempts)),
        "is_published": False,
        "created_by": created_by,
        "created_at": utc_now(),
        "allowed_college_codes": [c.strip().upper() for c in (allowed_college_codes or []) if c.strip()] or None,
        "allowed_years": [y.strip() for y in (allowed_years or []) if y.strip()] or None,
        "allowed_dept_codes": [d.strip().upper() for d in (allowed_dept_codes or []) if d.strip()] or None,
        "allowed_user_ids": [str(u).strip() for u in (allowed_user_ids or []) if str(u).strip()] or None,
    }
    result = await db[GROUP_TESTS].insert_one(doc)
    doc["_id"] = result.inserted_id
    return await _enrich_group_test(doc, db)


async def list_group_tests(only_published: bool = False, user_reg_no: str | None = None, user_id: str | None = None) -> list:
    db = get_db()
    query = {"is_published": True} if only_published else {}
    cursor = db[GROUP_TESTS].find(query).sort("created_at", -1)
    docs = await cursor.to_list(length=200)
    enriched = [await _enrich_group_test(d, db) for d in docs]

    # When listing for a student, filter by reg_no restrictions
    if only_published and (user_reg_no or user_id):
        parsed = _parse_reg_no(user_reg_no) if user_reg_no else None
        filtered = []
        for gt in enriched:
            allowed_uids = gt.get("allowed_user_ids") or []
            # If this student is explicitly in allowed_user_ids, always include
            if user_id and user_id in allowed_uids:
                filtered.append(gt)
                continue
            # Otherwise check dept/year restrictions (college codes no longer used)
            yy = gt.get("allowed_years") or []
            dd = gt.get("allowed_dept_codes") or []
            has_restrictions = bool(yy or dd or allowed_uids)
            if not has_restrictions:
                filtered.append(gt)
                continue
            if parsed:
                if yy and parsed["year"] not in yy:
                    continue
                if dd and parsed["dept_code"] not in dd:
                    continue
                filtered.append(gt)
        return filtered

    return enriched


async def get_group_test(group_test_id: str) -> dict:
    db = get_db()
    doc = await db[GROUP_TESTS].find_one({"_id": ObjectId(group_test_id)})
    if not doc:
        raise ValueError("Group test not found")
    return await _enrich_group_test(doc, db)


async def update_group_test(group_test_id: str, data: dict) -> dict:
    db = get_db()

    # Validate topic IDs if provided
    if "topic_ids" in data and data["topic_ids"] is not None:
        if not data["topic_ids"]:
            raise ValueError("At least one topic is required")
        for tid in data["topic_ids"]:
            try:
                t = await db[TOPICS].find_one({"_id": ObjectId(tid)})
            except Exception:
                raise ValueError(f"Invalid topic ID: {tid}")
            if not t:
                raise ValueError(
                    f"Topic with ID '{tid}' does not exist. Create it in Topics before adding here."
                )

    update_data = {k: v for k, v in data.items() if v is not None}
    if "max_attempts" in update_data:
        update_data["max_attempts"] = max(1, int(update_data["max_attempts"]))
    # Allow clearing filter fields explicitly (empty list = clear restriction)
    for fld in ("allowed_college_codes", "allowed_years", "allowed_dept_codes", "allowed_user_ids"):
        if fld in data:
            raw = data[fld]
            if raw is None or raw == []:
                update_data[fld] = None
            else:
                if fld == "allowed_years" or fld == "allowed_user_ids":
                    update_data[fld] = [str(v).strip() for v in raw if str(v).strip()]
                else:
                    update_data[fld] = [str(v).strip().upper() for v in raw if str(v).strip()]
    update_data["updated_at"] = utc_now()

    await db[GROUP_TESTS].update_one(
        {"_id": ObjectId(group_test_id)}, {"$set": update_data}
    )
    return await get_group_test(group_test_id)


async def delete_group_test(group_test_id: str) -> bool:
    db = get_db()
    result = await db[GROUP_TESTS].delete_one({"_id": ObjectId(group_test_id)})
    return result.deleted_count > 0


async def set_group_test_publish(group_test_id: str, is_published: bool) -> dict:
    db = get_db()
    await db[GROUP_TESTS].update_one(
        {"_id": ObjectId(group_test_id)},
        {"$set": {"is_published": is_published, "updated_at": utc_now()}},
    )
    return await get_group_test(group_test_id)


async def get_group_test_results_admin(group_test_id: str) -> list:
    """All student results for a given group test (admin view)."""
    db = get_db()
    cursor = db[GROUP_TEST_RESULTS].find({"group_test_id": group_test_id}).sort(
        "started_at", -1
    )
    docs = await cursor.to_list(length=500)
    return str_objectids(docs)


# ─── Student ──────────────────────────────────────────────────────────────────

async def start_group_test_attempt(group_test_id: str, user_id: str) -> dict:
    db = get_db()

    group_test = await db[GROUP_TESTS].find_one({"_id": ObjectId(group_test_id)})
    if not group_test:
        raise ValueError("Group test not found")
    if not group_test.get("is_published"):
        raise ValueError("This group test is not available")

    max_attempts = int(group_test.get("max_attempts") or 1)
    attempt_count = await db[GROUP_TEST_RESULTS].count_documents(
        {"group_test_id": group_test_id, "user_id": user_id}
    )
    if attempt_count >= max_attempts:
        raise ValueError(
            f"You have reached the maximum number of attempts ({max_attempts}) for this group test."
        )

    user = await db[USERS].find_one({"_id": ObjectId(user_id)})

    topic_results = []
    for tid in (group_test.get("topic_ids") or []):
        t = await db[TOPICS].find_one({"_id": ObjectId(tid)})
        topic_results.append(
            {
                "topic_id": tid,
                "topic_name": t.get("name", "") if t else "",
                "session_id": None,
                "status": "pending",
                "overall_score": None,
                "total_questions": None,
                "completed_at": None,
            }
        )

    doc = {
        "group_test_id": group_test_id,
        "group_test_name": group_test.get("name", ""),
        "user_id": user_id,
        "user_name": (user or {}).get("name", ""),
        "user_email": (user or {}).get("email", ""),
        "attempt_number": attempt_count + 1,
        "topic_results": topic_results,
        "overall_score": None,
        "status": "in_progress",
        "started_at": utc_now(),
        "completed_at": None,
        "time_limit_minutes": group_test.get("time_limit_minutes"),
    }
    result = await db[GROUP_TEST_RESULTS].insert_one(doc)
    doc["_id"] = result.inserted_id
    return str_objectid(doc)


async def get_group_test_result(result_id: str, user_id: str) -> dict:
    db = get_db()
    result = await db[GROUP_TEST_RESULTS].find_one({"_id": ObjectId(result_id)})
    if not result:
        raise ValueError("Group test result not found")
    if result.get("user_id") != user_id:
        raise ValueError("Unauthorized")
    result = await _refresh_topic_statuses(result, db)
    return str_objectid(result)


async def link_topic_session(
    result_id: str, user_id: str, topic_id: str, session_id: str
) -> dict:
    """Store session_id for a topic so its completion can be tracked."""
    db = get_db()
    result = await db[GROUP_TEST_RESULTS].find_one({"_id": ObjectId(result_id)})
    if not result:
        raise ValueError("Group test result not found")
    if result.get("user_id") != user_id:
        raise ValueError("Unauthorized")

    topic_results = result.get("topic_results") or []
    found = False
    for tr in topic_results:
        if tr.get("topic_id") == topic_id:
            tr["session_id"] = session_id
            if tr.get("status") == "pending":
                tr["status"] = "in_progress"
            found = True
            break

    if not found:
        raise ValueError("Topic not found in this group test")

    await db[GROUP_TEST_RESULTS].update_one(
        {"_id": ObjectId(result_id)},
        {"$set": {"topic_results": topic_results}},
    )
    return await get_group_test_result(result_id, user_id)


async def get_my_group_test_results(user_id: str) -> list:
    db = get_db()
    cursor = db[GROUP_TEST_RESULTS].find({"user_id": user_id}).sort("started_at", -1)
    docs = await cursor.to_list(length=100)
    return str_objectids(docs)


async def get_my_group_test_attempt(group_test_id: str, user_id: str) -> dict | None:
    """Return latest attempt result for a group test, or None."""
    db = get_db()
    doc = await db[GROUP_TEST_RESULTS].find_one(
        {"group_test_id": group_test_id, "user_id": user_id},
        sort=[("attempt_number", -1)],
    )
    if not doc:
        return None
    doc = await _refresh_topic_statuses(doc, db)
    return str_objectid(doc)
