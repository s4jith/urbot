from fastapi import APIRouter, HTTPException, Depends
from auth.jwt import get_current_user, create_access_token
from schemas.auth import (
    SignupRequest, LoginRequest, AuthResponse,
    VerifyEmailRequest, ResendOtpRequest,
    ForgotPasswordRequest, ResetPasswordRequest,
)
from services.auth_service import (
    signup_user, login_user,
    verify_email_otp, resend_otp,
    forgot_password, reset_password,
)

router = APIRouter()


@router.post("/signup")
async def signup(request: SignupRequest):
    """Register a new user. An OTP is sent to the provided email for verification."""
    try:
        result = await signup_user(
            name=request.name,
            email=request.email,
            password=request.password,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/login", response_model=AuthResponse)
async def login(request: LoginRequest):
    """Authenticate and get JWT token."""
    try:
        result = await login_user(email=request.email, password=request.password)
        return result
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))


@router.post("/refresh")
async def refresh_token(current_user: dict = Depends(get_current_user)):
    """Re-issue a fresh access token from a still-valid token.
    Prevents mid-interview session expiry without needing a separate refresh-token store.
    """
    token = create_access_token({
        "sub": current_user["user_id"],
        "email": current_user["email"],
        "role": current_user["role"],
        "name": current_user["name"],
    })
    return {"access_token": token, "token_type": "bearer"}


@router.post("/verify-email")
async def verify_email(request: VerifyEmailRequest):
    """Verify an account using the 6-digit OTP sent to the user's email."""
    try:
        return await verify_email_otp(request.email, request.otp)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/resend-otp")
async def resend_verification_otp(request: ResendOtpRequest):
    """Resend the email verification OTP (60-second cooldown)."""
    try:
        return await resend_otp(request.email)
    except ValueError as e:
        raise HTTPException(status_code=429, detail=str(e))


@router.post("/forgot-password")
async def forgot_password_endpoint(request: ForgotPasswordRequest):
    """Send a password-reset link to the given email address."""
    return await forgot_password(request.email)


@router.post("/reset-password")
async def reset_password_endpoint(request: ResetPasswordRequest):
    """Reset the password using the token from the reset email."""
    try:
        return await reset_password(request.token, request.new_password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
