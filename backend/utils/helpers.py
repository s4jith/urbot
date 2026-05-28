from bson import ObjectId
from datetime import datetime, timezone
import uuid


def generate_id() -> str:
    """Generate a unique string ID."""
    return str(uuid.uuid4())


def utc_now() -> str:
    """Get current UTC timestamp as ISO string."""
    return datetime.now(timezone.utc).isoformat()


def str_objectid(doc: dict) -> dict:
    """Convert MongoDB ObjectId to string in a document."""
    if doc and "_id" in doc:
        doc["id"] = str(doc["_id"])
        del doc["_id"]
    return doc


def str_objectids(docs: list) -> list:
    """Convert MongoDB ObjectIds to strings in a list of documents."""
    return [str_objectid(doc) for doc in docs]
