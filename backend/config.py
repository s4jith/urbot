from pydantic_settings import BaseSettings
from pydantic import field_validator, model_validator
from functools import lru_cache
import logging
import os
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# Load .env from backend directory
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))


class Settings(BaseSettings):
    # App
    APP_ENV: str = "production"
    APP_HOST: str = "0.0.0.0"
    APP_PORT: int = 8000

    # Gemini
    GEMINI_API_KEY: str
    # Comma-separated list of extra Gemini API keys for round-robin load balancing.
    # Example: GEMINI_API_KEYS=key2,key3,key4
    # The primary GEMINI_API_KEY is always included automatically.
    GEMINI_API_KEYS: str = ""
    GEMINI_MODEL: str = "gemini-2.5-flash"
    GEMINI_FALLBACK_MODELS: str = ""

    # Ollama
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "mistral-nemo"

    # MongoDB Atlas
    MONGO_URI: str
    MONGO_DB_NAME: str = "interview_bot"

    # Redis
    REDIS_URL: str

    # JWT
    JWT_SECRET: str
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRY: int = 3600

    # File Storage
    UPLOAD_DIR: str = "./uploads"

    # Frontend / CORS
    # Comma-separated list of allowed origins, or "*" to allow all.
    # In production set this to the exact frontend URL, e.g. "https://app.example.com".
    CORS_ALLOWED_ORIGINS: str = "*"

    # Frontend URL — used in password reset email links.
    FRONTEND_URL: str = "http://localhost:3000"

    # Auth — role assignment
    # Only emails ending with this domain are granted the admin role on signup.
    # Set via ADMIN_EMAIL_DOMAIN env var (e.g. "@college.edu").
    # Leave empty to disable automatic admin promotion — admins must be set manually.
    ADMIN_EMAIL_DOMAIN: str = ""


    # Email / SMTP
    # Leave SMTP_HOST empty to run without email (OTP will be logged to console instead).
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM_EMAIL: str = "noreply@example.com"
    SMTP_FROM_NAME: str = "Interview Bot"
    # True = STARTTLS (port 587, Gmail default); False = plain / SSL-wrapped
    SMTP_USE_TLS: bool = True

    # OTP / verification
    # How long (seconds) before an OTP or password-reset token expires.
    OTP_TTL_SECONDS: int = 600          # 10 minutes
    RESET_TOKEN_TTL_SECONDS: int = 1800 # 30 minutes

    class Config:
        env_file = ".env"
        extra = "ignore"

    @field_validator("MONGO_URI")
    @classmethod
    def validate_mongo_uri(cls, value: str) -> str:
        v = (value or "").strip().lower()
        is_dev = os.getenv("APP_ENV", "production").lower() != "production"
        if not is_dev:
            if "localhost" in v or "127.0.0.1" in v:
                raise ValueError("MONGO_URI must point to MongoDB Atlas, not localhost")
            if not v.startswith("mongodb+srv://"):
                raise ValueError("MONGO_URI must use mongodb+srv:// for cloud deployment")
        return value

    @field_validator("REDIS_URL")
    @classmethod
    def validate_redis_url(cls, value: str) -> str:
        v = (value or "").strip().lower()
        is_dev = os.getenv("APP_ENV", "production").lower() != "production"
        if not is_dev:
            if "localhost" in v or "127.0.0.1" in v:
                raise ValueError("REDIS_URL must point to a cloud Redis instance, not localhost")
        if not (v.startswith("redis://") or v.startswith("rediss://")):
            raise ValueError("REDIS_URL must start with redis:// or rediss://")
        return value

    @model_validator(mode="after")
    def warn_insecure_defaults(self) -> "Settings":
        is_production = self.APP_ENV.lower() == "production"
        if is_production and self.CORS_ALLOWED_ORIGINS.strip() == "*":
            logger.warning(
                "SECURITY: CORS_ALLOWED_ORIGINS is set to '*' in production. "
                "Set it to your frontend URL to restrict cross-origin access."
            )
        return self


@lru_cache()
def get_settings() -> Settings:
    return Settings()
