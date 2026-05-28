"""Email service — sends OTP and password-reset emails via SMTP.

If SMTP_HOST is not configured the email body is logged to the console
instead of being sent.  This lets the app run in development with no
email credentials while still exercising the full code path.
"""

import logging
import random
import string
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import aiosmtplib

from config import get_settings

logger = logging.getLogger(__name__)


def _is_smtp_configured() -> bool:
    s = get_settings()
    return bool(s.SMTP_HOST and s.SMTP_USERNAME and s.SMTP_PASSWORD and s.SMTP_FROM_EMAIL)


async def _send(to_email: str, subject: str, html_body: str, text_body: str) -> None:
    """Low-level send.  Falls back to console logging when SMTP is not configured."""
    settings = get_settings()

    if not _is_smtp_configured():
        logger.info(
            "SMTP not configured — email delivery skipped (subject: %s)",
            subject,
        )
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_FROM_EMAIL}>"
    msg["To"] = to_email
    msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))

    await aiosmtplib.send(
        msg,
        hostname=settings.SMTP_HOST,
        port=settings.SMTP_PORT,
        username=settings.SMTP_USERNAME,
        password=settings.SMTP_PASSWORD,
        start_tls=settings.SMTP_USE_TLS,
    )


def generate_otp(length: int = 6) -> str:
    """Return a numeric OTP of `length` digits."""
    return "".join(random.choices(string.digits, k=length))


async def send_otp_email(to_email: str, otp: str, name: str = "") -> None:
    """Send an email-verification OTP."""
    greeting = f"Hi {name}," if name else "Hello,"
    subject = "Your Interview Bot verification code"
    text_body = (
        f"{greeting}\n\n"
        f"Your verification code is: {otp}\n\n"
        "This code expires in 10 minutes.\n"
        "If you did not create an account, you can ignore this email.\n\n"
        "— Interview Bot"
    )
    html_body = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px">
      <h2 style="color:#1a1a2e">Verify your email</h2>
      <p>{greeting}</p>
      <p>Use the code below to verify your account:</p>
      <div style="font-size:36px;font-weight:bold;letter-spacing:8px;
                  text-align:center;padding:16px 0;color:#4f46e5">{otp}</div>
      <p style="color:#666;font-size:13px">
        This code expires in <strong>10 minutes</strong>.<br>
        If you did not create an account, you can safely ignore this email.
      </p>
    </div>
    """
    await _send(to_email, subject, html_body, text_body)


async def send_password_reset_email(to_email: str, reset_token: str, name: str = "") -> None:
    """Send a password-reset link."""
    settings = get_settings()
    reset_url = f"{settings.FRONTEND_URL}/reset-password?token={reset_token}"
    greeting = f"Hi {name}," if name else "Hello,"
    subject = "Reset your Interview Bot password"
    text_body = (
        f"{greeting}\n\n"
        f"Click the link below to reset your password (valid for 30 minutes):\n\n"
        f"{reset_url}\n\n"
        "If you did not request a password reset, you can ignore this email.\n\n"
        "— Interview Bot"
    )
    html_body = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px">
      <h2 style="color:#1a1a2e">Reset your password</h2>
      <p>{greeting}</p>
      <p>Click the button below to choose a new password. This link expires in
         <strong>30 minutes</strong>.</p>
      <a href="{reset_url}"
         style="display:inline-block;margin:16px 0;padding:12px 24px;
                background:#4f46e5;color:#fff;text-decoration:none;
                border-radius:6px;font-weight:bold">
        Reset Password
      </a>
      <p style="color:#666;font-size:13px">
        If the button does not work, copy and paste this URL into your browser:<br>
        <a href="{reset_url}" style="color:#4f46e5">{reset_url}</a>
      </p>
      <p style="color:#666;font-size:13px">
        If you did not request a password reset, you can safely ignore this email.
      </p>
    </div>
    """
    await _send(to_email, subject, html_body, text_body)
