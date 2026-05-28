import logging
import secrets
from passlib.context import CryptContext
from database import get_db, get_redis
from models.collections import USERS
from utils.helpers import utc_now, str_objectid
from auth.jwt import create_access_token
from config import get_settings
from services.email_service import generate_otp, send_otp_email, send_password_reset_email

logger = logging.getLogger(__name__)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

_OTP_KEY = "otp:{email}"
_OTP_RESEND_KEY = "otp_resend:{email}"   # 60-second cooldown
_RESET_KEY = "pwd_reset:{token}"


async def signup_user(name: str, email: str, password: str, role: str = None) -> dict:
    """Register a new user and send an OTP for email verification."""
    db = get_db()
    settings = get_settings()

    existing = await db[USERS].find_one({"email": email})
    if existing:
        raise ValueError("User with this email already exists")

    admin_domain = (settings.ADMIN_EMAIL_DOMAIN or "").strip()
    determined_role = "admin" if (admin_domain and email.endswith(admin_domain)) else "student"

    hashed_password = pwd_context.hash(password)
    user_doc = {
        "name": name,
        "email": email,
        "password": hashed_password,
        "role": determined_role,
        "email_verified": True,
        "speech_settings": {"voice_gender": "female"},
        "created_at": utc_now(),
    }

    result = await db[USERS].insert_one(user_doc)
    user_doc["_id"] = result.inserted_id
    user = str_objectid(user_doc)
    del user["password"]

    token = create_access_token({
        "sub": user["id"],
        "email": user["email"],
        "role": user["role"],
        "name": user["name"],
    })

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": user,
        "email_verification_required": False,
    }


async def verify_email_otp(email: str, otp: str) -> dict:
    """Verify the OTP entered by the user and mark their email as verified."""
    redis = get_redis()
    db = get_db()

    stored = await redis.get(_OTP_KEY.format(email=email))
    if not stored:
        raise ValueError("OTP has expired. Please request a new one.")
    if stored != otp:
        raise ValueError("Invalid OTP.")

    await db[USERS].update_one({"email": email}, {"$set": {"email_verified": True}})
    await redis.delete(_OTP_KEY.format(email=email))
    return {"message": "Email verified successfully."}


async def resend_otp(email: str) -> dict:
    """Resend an OTP, enforcing a 60-second cooldown to prevent abuse."""
    redis = get_redis()
    db = get_db()
    settings = get_settings()

    user_doc = await db[USERS].find_one({"email": email})
    if not user_doc:
        # Return generic message to avoid user enumeration
        return {"message": "If that email exists, a new code has been sent."}
    if user_doc.get("email_verified"):
        return {"message": "Email is already verified."}

    # 60-second rate limit
    if await redis.exists(_OTP_RESEND_KEY.format(email=email)):
        raise ValueError("Please wait 60 seconds before requesting a new code.")

    otp = generate_otp()
    await redis.setex(_OTP_KEY.format(email=email), settings.OTP_TTL_SECONDS, otp)
    await redis.setex(_OTP_RESEND_KEY.format(email=email), 60, "1")

    try:
        await send_otp_email(email, otp, user_doc.get("name", ""))
    except Exception as exc:
        logger.error("Failed to resend OTP (reason: %s)", exc)

    return {"message": "If that email exists, a new code has been sent."}


async def forgot_password(email: str) -> dict:
    """Generate a password-reset token and email it. Generic response prevents user enumeration."""
    redis = get_redis()
    db = get_db()
    settings = get_settings()

    user_doc = await db[USERS].find_one({"email": email})
    if user_doc:
        token = secrets.token_urlsafe(32)
        await redis.setex(
            _RESET_KEY.format(token=token),
            settings.RESET_TOKEN_TTL_SECONDS,
            email,
        )
        try:
            await send_password_reset_email(email, token, user_doc.get("name", ""))
        except Exception as exc:
            logger.error("Failed to send password reset email (reason: %s)", exc)

    return {"message": "If that email is registered, a reset link has been sent."}


async def reset_password(token: str, new_password: str) -> dict:
    """Validate the reset token and update the user's password."""
    redis = get_redis()
    db = get_db()

    email = await redis.get(_RESET_KEY.format(token=token))
    if not email:
        raise ValueError("Reset link is invalid or has expired.")

    hashed = pwd_context.hash(new_password)
    result = await db[USERS].update_one({"email": email}, {"$set": {"password": hashed}})
    if result.matched_count == 0:
        raise ValueError("User not found.")

    await redis.delete(_RESET_KEY.format(token=token))
    return {"message": "Password updated successfully. You can now log in."}


async def login_user(email: str, password: str) -> dict:
    """Authenticate a user and return JWT."""
    db = get_db()

    user_doc = await db[USERS].find_one({"email": email})
    if not user_doc:
        raise ValueError("Invalid email or password")

    if not pwd_context.verify(password, user_doc["password"]):
        raise ValueError("Invalid email or password")

    user = str_objectid(user_doc)
    del user["password"]

    token = create_access_token({
        "sub": user["id"],
        "email": user["email"],
        "role": user["role"],
        "name": user["name"],
    })

    return {"access_token": token, "token_type": "bearer", "user": user}
