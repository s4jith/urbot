# URBot — Adaptive AI Mock Interview Trainer & Assessment Dashboard

URBot is a production-ready, full-stack AI-powered mock interview training platform. It simulates professional, voice-only technical interviews by leveraging dynamic difficulty balancing, semantic question rotation, speech-to-text transcriptions, local LLM parsing, and multi-key API load balancing, culminating in a data-dense candidate feedback dashboard.

---

## 🚀 Key Features

* **Adaptive Question Selection:** Dynamically selects questions satisfying targeted interview difficulties (Easy, Medium, Hard distribution quotas) and enforces a reinforcement cap of **2 follow-ups per weak subtopic** to prevent AI loop frustration.
* **Semantic Deduplication:** Uses Jaccard similarity keyword checking to verify that no exact or semantically duplicate questions are asked during a session.
* **Smart Question Rotation:** Tracks database question usage statistics and last-used timestamps to prioritize unused or older questions.
* **Local Parsing & Matching (Ollama):** Resume data parsing, target job description extraction, and candidate expectation gap matching are run 100% locally via local model endpoints.
* **Gemini Key-Rotation Load Balancer:** coordinates API requests across 20+ keys stored in Redis, recovering gracefully from `429` rate limits.
* **Speech-to-Text & Text-to-Speech:** High-fidelity TTS (Coqui XTTS v2) and fast local voice transcription (faster-whisper).
* **Interactive Assessment Dashboard:**
  - **Executive Summary:** Overall score circular ring, performance badge, and duration statistics.
  - **Topic Accordion & Heatmap:** Progress master bars with a grid of subtopic grades.
  - **Speech Coach:** Speech pace speedometer (WPM), response latency delay, and filler words scanning (`um`, `uh`, `basically`).
  - **Hiring Simulation:** Mock decision with educational disclaimer warning.
  - **Roadmaps & Trends:** Ordered learning roadmaps and SVG timeline sparkline trends comparing historical attempts.

---

## 🛠️ System Architecture

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
         MongoDB, Redis, Ollama,                    |
         XTTS, Whisper & Gemini                     |
                  |                                 |
                  +----------------<----------------+
                            Local Dev Proxy
```

* **Routing Gateway:** Frontend (`/`) and API routes (`/api/*`) proxy through a single Cloudflare Tunnel to avoid CORS issues.
* **Local Cache & Storage:** MongoDB stores persistent reports, sessions, and question banks; Redis handles hot session states, lock coordinations, and key rotation metrics.

---

## 💻 Installation & Setup Guide

### 1. Prerequisites
Ensure you have the following installed on your machine:
* **Node.js** (v20+ and npm)
* **Python** (3.10+ / 3.12 recommended)
* **MongoDB** (Atlas or local instance)
* **Redis** (local instance or Upstash)
* **Ollama** (for local model inference)

---

### 2. Ollama Local Model Setup
1. Install Ollama by following instructions at [ollama.com](https://ollama.com).
2. Download the default model (`llama3.1:8b` or `llama3` as defined in backend configurations):
   ```bash
   ollama pull llama3.1
   ```
3. (Optional) Set environment variables to support concurrent requests:
   ```bash
   export OLLAMA_NUM_PARALLEL=2
   export OLLAMA_KEEP_ALIVE=30m
   ```
4. Verify Ollama is running at `http://localhost:11434`.

---

### 3. Backend Setup
1. Open a terminal and navigate to the backend folder:
   ```bash
   cd backend
   ```
2. Initialize and activate a virtual environment:
   ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```
3. Install PyTorch first (specifying CPU index or CUDA-enabled wheels if you have a GPU):
   ```bash
   pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
   ```
4. Install all python requirements:
   ```bash
   pip install TTS==0.22.0
   pip install -r requirements.txt
   ```
5. Configure environment parameters. Copy `.env.example` to `.env`:
   ```bash
   cp ../.env.example .env
   ```
   Open `backend/.env` and update the key variables:
   ```env
   APP_ENV=development
   GEMINI_API_KEY=your_primary_gemini_api_key  # Secondary keys loaded in rotation pool
   MONGO_URI=mongodb://127.0.0.1:27017/interview_bot
   REDIS_URL=redis://127.0.0.1:6379
   OLLAMA_BASE_URL=http://127.0.0.1:11434
   OLLAMA_MODEL=llama3.1
   JWT_SECRET=your_super_secret_jwt_key
   COQUI_TOS_AGREED=1
   ```

---

### 4. Create Admin Account
Execute the CLI database seeder script to register your admin user:
```bash
./venv/bin/python3 create_superadmin.py
```
*(Input your admin username, email, and password when prompted)*

---

### 5. Frontend Setup
1. Open a new terminal and navigate to the frontend folder:
   ```bash
   cd frontend
   ```
2. Install the node packages:
   ```bash
   npm install
   ```
3. Create a `.env.local` configuration:
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
*Note: On first startup, the server will fetch local speech-to-text models and the XTTS voice model (~2GB) which might take a few minutes.*

### Start the Frontend
From the `frontend` folder:
```bash
npm run dev
```

Visit the app at **`http://localhost:3000`** (or your designated Cloudflare Tunnel domain).

---

## 🧪 Running Tests
To run the automated backend test suite (including similarity validations, rotation limits, and report computations):
```bash
cd backend
PYTHONPATH=. ./venv/bin/pytest
```

---

## 📝 License
This project is licensed under the MIT License.
