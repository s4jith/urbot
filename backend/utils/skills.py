import re
from typing import Iterable, List, Set


_SKILL_ALIASES = {
    "node": "Node.js",
    "nodejs": "Node.js",
    "node.js": "Node.js",
    "express": "Express.js",
    "expressjs": "Express.js",
    "express.js": "Express.js",
    "react": "React",
    "reactjs": "React",
    "react.js": "React",
    "next": "Next.js",
    "nextjs": "Next.js",
    "next.js": "Next.js",
    "js": "JavaScript",
    "javascript": "JavaScript",
    "ts": "TypeScript",
    "typescript": "TypeScript",
    "py": "Python",
    "mongo": "MongoDB",
    "mongodb": "MongoDB",
    "postgres": "PostgreSQL",
    "postgresql": "PostgreSQL",
    "mysql": "MySQL",
    "aws": "AWS",
    "gcp": "GCP",
    "azure": "Azure",
    "ci/cd": "CI/CD",
    "ci cd": "CI/CD",
    "rest": "REST API",
    "rest api": "REST API",
    "fastapi": "FastAPI",
    "langchain": "LangChain",
    "langgraph": "LangGraph",
    "langsmith": "LangSmith",
    "rag": "RAG",
    "rag pipeline": "RAG Pipelines",
    "rag pipelines": "RAG Pipelines",
    "chromadb": "ChromaDB",
    "scikit learn": "Scikit-learn",
    "scikit-learn": "Scikit-learn",
    "pytorch": "PyTorch",
    "llama": "Llama",
    "llama 4": "Llama 4",
    "gemini api": "Gemini API",
    "sentence transformers": "Sentence Transformers",
    "e5 multilingual embeddings": "E5 Multilingual Embeddings",
    "cnn": "CNN",
    "cnns": "CNN",
    "rnn": "RNN",
    "rnns": "RNN",
    "gan": "GAN",
    "gans": "GAN",
    "bert": "BERT",
    "bert fine tuning": "BERT Fine-tuning",
    "ocr": "OCR",
    "ocr based extraction": "OCR Based Extraction",
    "k means": "K-Means",
    "cross validation": "Cross-validation",
    "oop": "OOP",
    "ml": "Machine Learning",
}


_SKILL_CLUSTER_RULES = [
    (
        "Deep Learning",
        ["cnn", "rnn", "lstm", "gru", "gan", "transformers", "bert", "pytorch", "tensorflow", "encoder decoder"],
    ),
    (
        "Machine Learning",
        [
            "machine learning",
            "random forest",
            "svm",
            "logistic regression",
            "linear regression",
            "k means",
            "model evaluation",
            "cross validation",
            "scikit learn",
        ],
    ),
    (
        "LLM and GenAI",
        [
            "langchain",
            "langgraph",
            "langsmith",
            "prompt engineering",
            "rag",
            "rag pipeline",
            "rag pipelines",
            "semantic search",
            "gemini api",
            "llama",
            "embedding models",
            "e5 multilingual embeddings",
            "sentence transformers",
        ],
    ),
    (
        "Data and Databases",
        ["sql", "mysql", "postgresql", "mongodb", "pinecone", "chromadb", "vector similarity search"],
    ),
    (
        "Backend and APIs",
        ["python", "java", "javascript", "typescript", "fastapi", "django", "flask", "node", "express", "rest api"],
    ),
    (
        "Cloud and DevOps",
        ["docker", "kubernetes", "aws", "gcp", "azure", "git", "github", "ci cd"],
    ),
    (
        "Document AI and OCR",
        ["ocr", "ocr based extraction", "document extraction"],
    ),
]


def _normalize_key(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[\u2010-\u2015]", "-", value)
    value = value.replace("&", " and ")
    value = re.sub(r"[^a-z0-9+#.\-/ ]+", " ", value)
    value = value.replace("/", " ")
    value = value.replace("-", " ")
    value = re.sub(r"\s+", " ", value).strip()
    return value


def canonicalize_skill(skill: str) -> str:
    if not isinstance(skill, str):
        return ""

    cleaned = skill.strip()
    if not cleaned:
        return ""

    normalized = _normalize_key(cleaned)
    if normalized in _SKILL_ALIASES:
        return _SKILL_ALIASES[normalized]

    # Keep all-caps acronyms readable (e.g., SQL, API, OOP).
    if cleaned.isupper() and len(cleaned) <= 6:
        return cleaned

    return " ".join(part.capitalize() for part in normalized.split(" "))


def _split_skill_chunks(skill: str) -> List[str]:
    if not isinstance(skill, str):
        return []

    parts = re.split(r",|\||;", skill)
    chunks = []
    for part in parts:
        candidate = part.strip()
        if not candidate:
            continue
        chunks.append(candidate)
    return chunks


def normalize_skill_list(skills: Iterable[str], limit: int = 80) -> List[str]:
    unique: List[str] = []
    seen: Set[str] = set()

    for raw in skills or []:
        for token in _split_skill_chunks(raw):
            canon = canonicalize_skill(token)
            if not canon:
                continue
            key = _normalize_key(canon)
            if key in seen:
                continue
            seen.add(key)
            unique.append(canon)
            if len(unique) >= limit:
                return unique

    return unique


def _classify_cluster(skill: str) -> str | None:
    key = _normalize_key(skill)
    if not key:
        return None

    for cluster_name, rules in _SKILL_CLUSTER_RULES:
        for rule in rules:
            if rule in key or key in rule:
                return cluster_name
    return None


def cluster_skills(skills: Iterable[str], max_members_per_cluster: int = 4) -> List[dict]:
    """Return grouped skills with compact labels for UI and prompting."""
    normalized = normalize_skill_list(skills)
    grouped: dict[str, list[str]] = {}

    for skill in normalized:
        cluster_name = _classify_cluster(skill)
        if not cluster_name:
            continue
        grouped.setdefault(cluster_name, [])
        if skill not in grouped[cluster_name]:
            grouped[cluster_name].append(skill)

    # Prefer denser clusters first for cleaner UX.
    ordered = sorted(grouped.items(), key=lambda item: len(item[1]), reverse=True)

    result = []
    for cluster_name, members in ordered:
        sampled = members[:max_members_per_cluster]
        label = f"{cluster_name} ({', '.join(sampled)})"
        result.append(
            {
                "cluster": cluster_name,
                "members": members,
                "label": label,
                "count": len(members),
            }
        )

    return result


def build_interview_focus_skills(skills: Iterable[str], max_clusters: int = 6, max_extras: int = 2) -> List[str]:
    """Build a compact, cluster-aware skill list for interview question generation."""
    normalized = normalize_skill_list(skills)
    grouped = cluster_skills(normalized)

    focus = [g["label"] for g in grouped[:max_clusters]]

    # Add a couple of non-clustered items so niche tools are not ignored.
    extras = []
    clustered_members = {m for g in grouped for m in g["members"]}
    for skill in normalized:
        if skill in clustered_members:
            continue
        extras.append(skill)
        if len(extras) >= max_extras:
            break

    combined = focus + extras
    return combined if combined else normalized[: max_clusters + max_extras]


def skill_match(candidate_skill: str, required_skill: str) -> bool:
    c_key = _normalize_key(canonicalize_skill(candidate_skill))
    r_key = _normalize_key(canonicalize_skill(required_skill))
    if not c_key or not r_key:
        return False
    if c_key == r_key:
        return True

    # Soft phrase matching for related forms like "rest api" vs "restful api".
    if c_key in r_key or r_key in c_key:
        return True

    return False


def find_matching_skills(candidate_skills: Iterable[str], required_skills: Iterable[str]) -> List[str]:
    matched: List[str] = []
    for req in required_skills or []:
        for cand in candidate_skills or []:
            if skill_match(cand, req):
                matched.append(canonicalize_skill(req))
                break
    return normalize_skill_list(matched)


def find_missing_skills(candidate_skills: Iterable[str], required_skills: Iterable[str]) -> List[str]:
    missing: List[str] = []
    for req in required_skills or []:
        has_match = False
        for cand in candidate_skills or []:
            if skill_match(cand, req):
                has_match = True
                break
        if not has_match:
            missing.append(canonicalize_skill(req))
    return normalize_skill_list(missing)