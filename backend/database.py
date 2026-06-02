import logging
from motor.motor_asyncio import AsyncIOMotorClient
import redis.asyncio as aioredis
from config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

# MongoDB
mongo_client: AsyncIOMotorClient = None
db = None

# Redis
redis_client: aioredis.Redis = None


async def connect_db():
    """Initialize MongoDB and Redis connections."""
    global mongo_client, db, redis_client

    # MongoDB — explicit pool for 30 concurrent users.
    # maxPoolSize=50 allows up to 50 simultaneous DB operations.
    # minPoolSize=5 keeps warm connections ready at startup.
    mongo_client = AsyncIOMotorClient(
        settings.MONGO_URI,
        maxPoolSize=50,
        minPoolSize=5,
        serverSelectionTimeoutMS=5000,
        connectTimeoutMS=10000,
        socketTimeoutMS=30000,
        maxIdleTimeMS=600000,
        retryWrites=True,
        retryReads=True,
        heartbeatFrequencyMS=10000,
    )
    db = mongo_client[settings.MONGO_DB_NAME]

    # Create indexes
    await db.users.create_index("email", unique=True)
    await db.resumes.create_index("user_id", unique=True)
    await db.skills.create_index("user_id")
    await db.sessions.create_index("user_id")
    await db.results.create_index("session_id")
    await db.results.create_index("user_id")
    await db.answers.create_index("user_id")
    await db.answers.create_index("session_id")
    await db.questions.create_index("role_id")
    await db.jd_verifications.create_index([("user_id", 1), ("cache_key", 1)])
    from models.collections import GEMINI_KEYS
    await db[GEMINI_KEYS].create_index("key", unique=True)


    # Redis — explicit connection pool (max_connections=30 covers all workers).
    redis_client = aioredis.from_url(
        settings.REDIS_URL,
        decode_responses=True,
        max_connections=30,
        socket_connect_timeout=5,
        socket_timeout=10,
        retry_on_timeout=True,
    )

    # Test connections
    try:
        await mongo_client.admin.command("ping")
        logger.info("Connected to MongoDB")
    except Exception as e:
        logger.error("Failed to connect to MongoDB: %s", e)

    try:
        await redis_client.ping()
        logger.info("Connected to Redis")
    except Exception as e:
        logger.warning("Failed to connect to Redis: %s", e)


async def close_db():
    """Close database connections."""
    global mongo_client, redis_client
    if mongo_client:
        mongo_client.close()
    if redis_client:
        await redis_client.close()
    logger.info("Database connections closed")


async def ping_services() -> dict:
    """Probe MongoDB and Redis reachability. Used by /health/services."""
    import asyncio
    results = {}

    try:
        await asyncio.wait_for(mongo_client.admin.command("ping"), timeout=3.0)
        results["mongodb"] = {"status": "ok"}
    except Exception as exc:
        results["mongodb"] = {"status": "error", "detail": str(exc)[:120]}

    try:
        await asyncio.wait_for(redis_client.ping(), timeout=3.0)
        results["redis"] = {"status": "ok"}
    except Exception as exc:
        results["redis"] = {"status": "error", "detail": str(exc)[:120]}

    return results


def get_db():
    return db


def get_redis():
    return redis_client
