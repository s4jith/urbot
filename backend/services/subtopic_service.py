import json
import logging
from utils.ollama_client import call_ollama

logger = logging.getLogger(__name__)

def _extract_json_object(text: str) -> str:
    """Helper to extract a JSON object from text."""
    text = (text or "").strip()
    first_brace = text.find("{")
    last_brace = text.rfind("}")
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        return text[first_brace:last_brace+1]
    return text

async def evaluate_subtopics(qa_pairs: list, all_subtopics: list) -> dict:
    """
    Evaluate the candidate's answers against the list of all subtopics.
    Returns:
    {
        "strong_subtopics": [],
        "weak_subtopics": [],
        "unknown_subtopics": []
    }
    """
    if not all_subtopics:
        return {
            "strong_subtopics": [],
            "weak_subtopics": [],
            "unknown_subtopics": []
        }

    payload = {
        "all_subtopics": all_subtopics,
        "qa": [
            {
                "question": qa.get("question", ""),
                "answer": qa.get("answer", ""),
            }
            for qa in qa_pairs
        ]
    }

    prompt = f"""You are a technical evaluation assistant.
Given a list of Q&A pairs from an interview and a list of all possible subtopics, classify each Q&A pair into one of the subtopics, and evaluate the candidate's performance.

All Subtopics: {json.dumps(all_subtopics)}

Q&A Pairs:
{json.dumps(payload["qa"], indent=2)}

Task:
1. Classify each Q&A pair under one of the subtopics from the All Subtopics list.
2. Group the subtopics into three categories based on the candidate's answers:
   - "strong_subtopics": The candidate showed a good or master-level understanding of the subtopic (conceptual correctness, correct answers).
   - "weak_subtopics": The candidate struggled, gave incorrect answers, or stated they didn't know the subtopic.
   - "unknown_subtopics": Subtopics that were NOT tested by any of the questions in the Q&A pairs.

Return ONLY a valid JSON object in this exact format:
{{
  "strong_subtopics": ["subtopic1", "subtopic2"],
  "weak_subtopics": ["subtopic3"],
  "unknown_subtopics": ["subtopic4", "subtopic5"]
}}
"""
    try:
        raw_response = await call_ollama(
            prompt=prompt,
            max_attempts=3,
        )
        cleaned = _extract_json_object(raw_response)
        parsed = json.loads(cleaned)
        
        # Validate keys
        strong = parsed.get("strong_subtopics") or []
        weak = parsed.get("weak_subtopics") or []
        unknown = parsed.get("unknown_subtopics") or []
        
        # Ensure they are lists of strings
        strong = [str(x).strip() for x in strong if x]
        weak = [str(x).strip() for x in weak if x]
        unknown = [str(x).strip() for x in unknown if x]
        
        # Normalize and filter to known subtopics to avoid hallucination
        known_set = {s.lower(): s for s in all_subtopics}
        
        normalized_strong = []
        normalized_weak = []
        
        for s in strong:
            if s.lower() in known_set:
                normalized_strong.append(known_set[s.lower()])
        for s in weak:
            if s.lower() in known_set:
                normalized_weak.append(known_set[s.lower()])
                
        # Any subtopic not in strong/weak is unknown
        tested_lower = {s.lower() for s in normalized_strong + normalized_weak}
        normalized_unknown = [s for s in all_subtopics if s.lower() not in tested_lower]
        
        return {
            "strong_subtopics": list(set(normalized_strong)),
            "weak_subtopics": list(set(normalized_weak)),
            "unknown_subtopics": list(set(normalized_unknown)),
        }
    except Exception as e:
        logger.error(f"Failed to evaluate subtopics with Ollama: {str(e)}")
        # Fallback: everything is unknown
        return {
            "strong_subtopics": [],
            "weak_subtopics": [],
            "unknown_subtopics": all_subtopics
        }
