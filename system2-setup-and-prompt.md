# System 2: STT & TTS Service Setup Guide and AI Prompt

This document provides:
1. The architecture and requirements for **System 2** (the dedicated STT + TTS Node).
2. The complete Python implementation code for the System 2 microservice.
3. A copy-paste prompt that you can send to this AI (Antigravity) to automatically deploy or write code.

---

## 1. System 2 Setup Requirements

System 2 is equipped with an **RTX 5070 (12GB VRAM)**. It will host:
- **Speech-to-Text (STT):** `faster-whisper` (Large-v3 model)
- **Text-to-Speech (TTS):** `Kokoro-82M` (ONNX model, run in duplicate instances for high concurrency)

### Dependencies to Install on System 2
Create a virtual environment and install the following packages:
```bash
pip install fastapi uvicorn faster-whisper kokoro-onnx onnxruntime-gpu soundfile numpy
```

### Models to Download on System 2
For the Kokoro-82M ONNX model, download the ONNX file and voice checkpoints into a `models/` directory:
```bash
mkdir -p models
# Download Kokoro ONNX model (v0.19)
wget https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files/kokoro-v0_19.onnx -O models/kokoro.onnx
# Download Kokoro voice file
wget https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files/voices.bin -O models/voices.bin
```

---

## 2. Microservice Implementation Code (`speech_service.py`)

Here is the standalone microservice that runs on **System 2 (Port 8002)**:

```python
import os
import io
import tempfile
import numpy as np
import soundfile as sf
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import Response
from faster_whisper import WhisperModel
from kokoro_onnx import Kokoro

app = FastAPI(title="System 2: Speech STT & TTS Service")

# 1. Initialize Whisper STT (RTX 5070 GPU)
print("Loading Whisper model (large-v3) onto CUDA...")
whisper_model = WhisperModel("large-v3", device="cuda", compute_type="float16")

# 2. Initialize Kokoro TTS (ONNX CUDA runtime)
ONNX_PATH = "models/kokoro.onnx"
VOICES_PATH = "models/voices.bin"

if not os.path.exists(ONNX_PATH) or not os.path.exists(VOICES_PATH):
    raise FileNotFoundError("Kokoro ONNX or voices.bin model files not found in models/ directory. Run download steps first.")

print("Loading Kokoro TTS onto ONNX GPU runtime...")
# We initialize Kokoro. Since the ONNX Runtime with CUDA handles inference, this resides in VRAM.
kokoro = Kokoro(ONNX_PATH, VOICES_PATH)

# Helper: Map voice genders to Kokoro native voices
# af_bella (female, expressive), am_adam (male, professional)
VOICE_MAP = {
    "female": "af_bella",
    "male": "am_adam",
    "auto": "af_bella"
}

@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...), language: str = Form("en")):
    """Transcribes uploaded audio bytes to text using Whisper-large-v3."""
    try:
        suffix = os.path.splitext(audio.filename or "audio.wav")[1]
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(await audio.read())
            tmp_path = tmp.name

        segments, _ = whisper_model.transcribe(
            tmp_path,
            language=language,
            beam_size=1,
            condition_on_previous_text=False,
            temperature=0.0
        )
        text = " ".join([seg.text for seg in segments]).strip()
        os.remove(tmp_path)
        return {"text": text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")

@app.post("/synthesize")
async def synthesize(text: str = Form(...), voice_gender: str = Form("female")):
    """Synthesizes text into WAV audio using Kokoro-82M ONNX."""
    try:
        voice = VOICE_MAP.get(voice_gender.lower().strip(), "af_bella")
        
        # Kokoro ONNX generation
        samples, sample_rate = kokoro.create(text, voice=voice, speed=1.0)
        
        # Convert audio samples to WAV file format in memory
        out_buf = io.BytesIO()
        sf.write(out_buf, samples, sample_rate, format='WAV', subtype='PCM_16')
        wav_bytes = out_buf.getvalue()
        
        return Response(content=wav_bytes, media_type="audio/wav")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Speech synthesis failed: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
```

---

## 3. Instruction Prompt for Future Agent Invocations

Copy and paste the prompt below to direct the AI to integrate this system:

```text
Please execute the 3-system scaling plan:
1. Create a subfolder called `system2_service/` in the workspace root.
2. Put the `speech_service.py` file inside `system2_service/` containing the FastAPI service for Whisper and Kokoro-82M.
3. Write a Dockerfile inside `system2_service/` to package FastAPI, faster-whisper, and kokoro-onnx with CUDA GPU support.
4. Modify the primary codebase (System 1) according to the codebase-migration-plan.md to route STT and TTS traffic to System 2 instead of executing Whisper and XTTS models locally.
```
