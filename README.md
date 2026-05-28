# URBot — AI Mock Interview Trainer

URBot is a production-ready, full-stack AI-powered mock interview platform. It helps candidates prepare for interviews by conducting dynamic, adaptive voice-based sessions tailored to their resumes and target job descriptions, followed by comprehensive AI evaluation reports.

---

## 🚀 Key Features

* **AI Resume & JD Alignment**: Upload resume (PDF/Docx), extract skills, and check compatibility against target job descriptions using Gemini.
* **Dual Interview Modes**: 
  - *Resume Mode*: Custom, adaptive questioning tailored to user's resume skills.
  - *Topic Mode*: Timed interviews on specific role question banks published by admins.
* **Voice-First Interaction**: High-fidelity Text-to-Speech (Coqui XTTS v2 with Tammie Ema & Royston Min voices) and local speech-to-text transcription (faster-whisper).
* **Detailed Analytics & Reports**: Section-by-section breakdown of answers with scores, feedback, and improvement areas.
* **Cascading Admin Dashboard**: Admin CRUD management for roles, topics, bulk PDF question imports, and user management.

---

## 🛠️ Architecture & Routing

```
               +--------------------------------------+
               |          Cloudflare Tunnel           |
               |     (interviewbot.nerdlab.co.in)     |
               +------------------+-------------------+
                                  |
                 +----------------+----------------+
                 | /api/*                          | /*
                 v                                 v
      +----------------------+          +----------------------+
      |   FastAPI Backend    |          |   Next.js Frontend   |
      |     (Port 8000)      |          |     (Port 3000)      |
      +----------+-----------+          +----------+-----------+
                 |                                 |
        MongoDB, Redis, Gemini                     |
        XTTS & Whisper                             |
                 |                                 |
                 +----------------<----------------+
                           Local Dev Proxy
```

* **Production URL**: Both frontend (`/`) and API (`/api/*`) are routed through **one single Cloudflare Tunnel** to eliminate CORS issues.
* **Local Proxy**: In development, Next.js routes `/api/*` requests to the FastAPI backend dynamically.

---

## 💻 Quick Setup & Installation

### 1. Prerequisites
Ensure you have the following installed:
* Node.js v20+ and npm
* Python 3.10+
* MongoDB (Atlas or local) and Redis (local or Upstash)
* Gemini API Key (from Google AI Studio)

---

### 2. Backend Setup
1. Open a terminal and navigate to the backend folder:
   ```bash
   cd backend
   ```
2. Create and activate a virtual environment:
   ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```
3. Install PyTorch first (for GPU acceleration or CPU fallback):
   ```bash
   pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
   ```
4. Install all dependencies:
   ```bash
   pip install TTS==0.22.0
   pip install -r requirements.txt
   ```
5. Configure your environment. Copy `.env.example` to `.env`:
   ```bash
   cp ../.env.example .env
   ```
   Open `backend/.env` and update the key variables:
   ```env
   APP_ENV=development
   GEMINI_API_KEY=your_gemini_api_key
   MONGO_URI=mongodb://127.0.0.1:27017/interview_bot
   REDIS_URL=redis://127.0.0.1:6379
   JWT_SECRET=your_jwt_secret_key
   COQUI_TOS_AGREED=1
   ```

---

### 3. Create Superadmin User
Run the secure CLI script to seed your admin account in the database:
```bash
./venv/bin/python3 create_superadmin.py
```
*(Input your admin name, email, and password when prompted)*

---

### 4. Frontend Setup
1. Open a new terminal and navigate to the frontend folder:
   ```bash
   cd frontend
   ```
2. Install the packages:
   ```bash
   npm install
   ```
3. Configure the environment variables. Create a `.env.local` file:
   ```bash
   echo "NEXT_PUBLIC_API_URL=/api" > .env.local
   ```

---

## 🏃 Running the Application

### Start the Backend
From the `backend` folder:
```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```
*Note: On first startup, the server will download the XTTS v2 model (~2GB) and Whisper model. This might take a few minutes.*

### Start the Frontend
From the `frontend` folder:
```bash
npm run dev
```

Visit the app at **`http://localhost:3000`** (or your public Cloudflare Tunnel URL).

---

## 🧪 Running Tests
To run the automated backend test suite (40 integration tests):
```bash
cd backend
PYTHONPATH=. ./venv/bin/pytest
```

---

## 📝 License
This project is licensed under the MIT License.
