from typing import Any, Dict, List, Optional, TypedDict

from langgraph.graph import END, StateGraph

from utils.gemini import generate_interview_question


class InterviewGraphState(TypedDict, total=False):
    role_title: str
    skills: List[str]
    previous_questions: List[str]
    previous_answer: Optional[str]
    question_count: int
    max_questions: int
    current_difficulty: str
    next_difficulty: str
    question_stage: str
    is_complete: bool
    question_data: Dict[str, Any]


FOUNDATION_QUESTION_LIMIT = 3


def _difficulty_for_question_number(question_number: int, foundation_limit: int = FOUNDATION_QUESTION_LIMIT) -> str:
    """Return difficulty for a given question number.

    Q1-foundation_limit : easy   (warmup/definition questions)
    Next 4 questions    : medium (practical/applied questions)
    Remaining questions : hard   (scenario/debug/trade-off questions)
    """
    if question_number <= foundation_limit:
        return "easy"
    relative = question_number - foundation_limit
    if relative <= 4:
        return "medium"
    return "hard"


async def _check_completion(state: InterviewGraphState) -> InterviewGraphState:
    question_count = int(state.get("question_count", 0))
    max_questions = int(state.get("max_questions", 10))
    return {"is_complete": question_count >= max_questions}


def _route_after_completion(state: InterviewGraphState) -> str:
    return "end" if state.get("is_complete") else "difficulty"


async def _set_next_difficulty(state: InterviewGraphState) -> InterviewGraphState:
    question_count = int(state.get("question_count", 0))
    # We are generating the next question, so use question_count + 1.
    next_question_number = question_count + 1
    difficulty = _difficulty_for_question_number(next_question_number)
    if next_question_number <= FOUNDATION_QUESTION_LIMIT:
        stage = "foundation"
    elif difficulty == "medium":
        stage = "applied"
    else:
        stage = "deep"
    return {
        "next_difficulty": difficulty,
        "question_stage": stage,
    }


async def _generate_question(state: InterviewGraphState) -> InterviewGraphState:
    role_title = state.get("role_title", "Software Developer")
    skills = state.get("skills", ["general"])
    previous_questions = state.get("previous_questions", [])
    previous_answer = state.get("previous_answer")
    difficulty = state.get("next_difficulty", state.get("current_difficulty", "medium"))
    question_stage = state.get("question_stage", "deep")

    question_data = await generate_interview_question(
        skills=skills,
        role_title=role_title,
        previous_questions=previous_questions,
        previous_answer=previous_answer,
        difficulty=difficulty,
        question_stage=question_stage,
        foundation_limit=FOUNDATION_QUESTION_LIMIT,
    )

    return {
        "question_data": question_data,
        "current_difficulty": question_data.get("difficulty", difficulty),
    }


def _build_graph():
    graph = StateGraph(InterviewGraphState)

    graph.add_node("check", _check_completion)
    graph.add_node("difficulty", _set_next_difficulty)
    graph.add_node("generate", _generate_question)

    graph.set_entry_point("check")
    graph.add_conditional_edges(
        "check",
        _route_after_completion,
        {
            "end": END,
            "difficulty": "difficulty",
        },
    )
    graph.add_edge("difficulty", "generate")
    graph.add_edge("generate", END)

    return graph.compile()


_INTERVIEW_GRAPH = _build_graph()


async def run_interview_graph(state: InterviewGraphState) -> InterviewGraphState:
    result = await _INTERVIEW_GRAPH.ainvoke(state)
    return result
