import requests
import json
import os
from config import get_settings
settings = get_settings()
# dummy wav
wav = b"RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00D\xac\x00\x00\x88X\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00"
response = requests.post(
    settings.STT_SERVICE_URL,
    files={"audio": ("test.wav", wav, "audio/wav")},
    data={"language": "en"}
)
print("Status:", response.status_code)
print("Body:", response.text)
