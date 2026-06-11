# Architecture & Scalability Questionnaire Responses

Based on the latest codebase implementation and our 3-system deployment, here are the detailed answers to your architectural questions:

### 1. How often is the LLM called?
Your application relies heavily on **batched queue generation** rather than single-question ping-ponging.
- **Initial question generation:** 1 call (generates a batch of seed questions).
- **Follow-up generation:** ~1 call every 2-3 questions. The system checks the Redis queue; if the queue of upcoming questions drops below a threshold, it calls the LLM to generate a batch of 3-5 follow-up questions at once (`generate_followup_question_batch_from_qa`).
- **Answer evaluation:** Not done on a per-answer basis.
- **Final report generation:** 1 call at the end of the interview.
- **Total:** For a 10-question interview, expect roughly **3 to 4 LLM calls total** per candidate.

### 2. Are you evaluating every answer?
**No, you do not immediately send an answer to Ollama for evaluation.**
When a candidate answers a question, the answer is saved to MongoDB and Redis. The LLM is only invoked when the system needs to *refill the question queue*. When that happens, it sends the recent Q&A pairs to the LLM to generate the next batch of follow-ups.

### 3. How long are candidate answers?
Since it is an STT transcript of a spoken interview, answers typically range from 30 seconds to 2 minutes of speech.
- **Typical answer size:** 50 to 250 words (~70 to 350 tokens).

### 4. Voice or text?
- **Format:** Speaking (Voice).
- **STT Model:** `faster-whisper` (Large-v3).
- **Where is STT running?** System 3.
- **Which machine?** System 3 (Dedicated STT/TTS GPU node).

### 5. What exactly is sent to Ollama?
For follow-up generation, the prompt sends the candidate's profile summary plus the history of answers.
**Sample Structure sent to LLM:**
```json
{
  "role_title": "Software Developer",
  "skills": ["React", "Python", "Kubernetes"],
  "experience_level": "mid",
  "qa_pairs": [
    {"question": "How do you handle state in React?", "answer": "...transcript..."},
    {"question": "Explain a time Kubernetes pods crashed.", "answer": "...transcript..."}
  ],
  "previous_questions": ["What is your background?"],
  "count": 3
}
```

### 6. Streaming or not?
- **Current Setup:** `"stream": false`.
- The `ollama_client.py` currently waits for the LLM to generate the entire JSON array of questions, parses it, and then enqueues them. This works well for batched generation.

### 7. What response size do you expect?
- **Follow-up generation (Batch of 3-5 questions):** ~150 - 250 tokens (since it outputs strict JSON).
- **Final Evaluation/Report:** ~800 - 1200 tokens (detailed grading and feedback).

### 8. Concurrent users
When we say "20 users", it is **Case B / C (Mixed)**.
Candidates spend ~85% of their time listening to the TTS question, thinking, or speaking. They only trigger the LLM when their queue drops low. If 20 candidates are interviewing simultaneously, only **3 or 4 of them will be hitting the LLM at the exact same millisecond**.

### 9. What machine runs what?
- **System 1:** 
  - **CPU:** Standard 
  - **RAM:** Standard
  - **Role:** Control Plane (Nginx, FastAPI Gateway, Redis, MongoDB). No GPU inference.
- **System 2:** 
  - **CPU:** Standard
  - **RAM:** Standard
  - **GPU:** RTX 5070 (12GB VRAM)
  - **Role:** LLM Generation (`Ollama` running `Llama 3.1 8B Q4_K_M`). IP: `192.168.76.20`
- **System 3:** 
  - **CPU:** Standard
  - **RAM:** Standard
  - **GPU:** RTX 5070 (12GB VRAM)
  - **Role:** Audio Processing (`faster-whisper` + `Kokoro-82M`). 

### 10. Current architecture
Your system looks exactly like this:
```text
Candidate (Browser)
   ↓ (WebSockets / HTTP)
System 1: Nginx → FastAPI
   ↓ (Stores state)
System 1: Redis & MongoDB
   ↓ (Internal HTTP calls)
   ├──> System 2: Ollama (LLM logic)
   └──> System 3: FastAPI (Whisper STT + Kokoro TTS)
```

---

### Deductions for Scaling (Ollama vs vLLM & 20 Users)
1. **VRAM Usage on System 2:** Llama 3.1 8B Q4 takes ~5.5GB. You have 12GB total. This leaves ~6.5GB for the Context Window (KV Cache). 
2. **OLLAMA_NUM_PARALLEL:** Since you have 6.5GB of free VRAM, setting `OLLAMA_NUM_PARALLEL=4` is perfectly safe. If you set it too high (like 8), the KV cache might overflow and cause OOM errors.
3. **Is 20 users safe?** Yes! Since the LLM is only called a few times per interview (batched), an `OLLAMA_NUM_PARALLEL=4` can easily serve 20-30 concurrent interviews.
4. **Ollama vs vLLM:** Since your `stream` is `false` and you rely on batched JSON generation, Ollama is perfectly fine for 20 users. If you scale to 50+ concurrent users, you should migrate System 2 from Ollama to `vLLM` to utilize continuous batching.
