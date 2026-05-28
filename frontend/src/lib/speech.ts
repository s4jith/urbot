import api from "./api";

export const isSpeechSynthesisSupported = () => {
  return typeof window !== "undefined" && "speechSynthesis" in window;
};

export type SpeechVoiceGender = "male" | "female" | "auto";

type SpeakOptions = {
  voiceGender?: SpeechVoiceGender;
  style?: "assistant" | "default";
};

type SpeechRecognitionAlternativeLike = {
  transcript: string;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
};

type SpeechRecognitionResultListLike = {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
};

type SpeechRecognitionResultEventLike = {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
};

type SpeechRecognitionErrorEventLike = {
  error?: string;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionCtorLike = new () => SpeechRecognitionLike;

type SpeechRecognitionWindowLike = Window & {
  SpeechRecognition?: SpeechRecognitionCtorLike;
  webkitSpeechRecognition?: SpeechRecognitionCtorLike;
};

export const isSpeechRecognitionSupported = () => {
  return (
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
  );
};

// Text-to-Speech
let synthesisUtterance: SpeechSynthesisUtterance | null = null;
let speakRequestId = 0;
const preferredVoiceUriByGender: Partial<Record<SpeechVoiceGender, string>> = {};
let currentAudio: HTMLAudioElement | null = null;
let currentAudioUrl: string | null = null;
const backendAudioCache = new Map<string, Blob>();
const backendAudioInFlight = new Map<string, Promise<Blob>>();
let audioPlaybackUnlocked = false;
let speechBackendReady = false;
let speechBackendWarmupInFlight: Promise<void> | null = null;
let lastSpeechHealthCheckAt = 0;
let lastSpeechWarmupAt = 0;
let bootstrapPrefetchDone = false;

const BACKEND_TTS_TIMEOUT_MS = 90000;
const BACKEND_CACHE_LIMIT = 40;
const BACKEND_TTS_RETRIES = 3;
// Raised from 12 s to 75 s — XTTS synthesis can take 30-40 s on CPU.
// A timeout shorter than synthesis time causes browser TTS fallback to start
// while the backend audio is still being prepared, which leads to dual-audio.
const ASSISTANT_TTS_SOFT_TIMEOUT_MS = 75000;
const SPEECH_HEALTH_TTL_MS = 5 * 60 * 1000;
const SPEECH_WARMUP_TTL_MS = 15 * 60 * 1000;
const SILENT_WAV_DATA_URI =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
const ENABLE_ASSISTANT_BROWSER_FALLBACK = ["1", "true", "yes", "on"].includes(
  (process.env.NEXT_PUBLIC_ENABLE_ASSISTANT_BROWSER_TTS_FALLBACK || "")
    .trim()
    .toLowerCase()
);

const normalizeVoiceGender = (value?: SpeechVoiceGender): "male" | "female" => {
  return value === "male" ? "male" : "female";
};

const normalizeSpokenText = (value: string) => {
  let text = (value || "").trim();
  if (!text) return "";

  const prefixPattern = /^\s*(?:question|q)\s*#?\s*\d+(?:\s*of\s*\d+)?\s*[:\-)\.]\s*/i;
  while (prefixPattern.test(text)) {
    text = text.replace(prefixPattern, "").trim();
  }
  return text;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getErrorStatus = (error: unknown): number | undefined => {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const maybeStatus = (error as { response?: { status?: unknown } }).response?.status;
  return typeof maybeStatus === "number" ? maybeStatus : undefined;
};

const getErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const maybeCode = (error as { code?: unknown }).code;
  return typeof maybeCode === "string" ? maybeCode : undefined;
};

const ensureSpeechBackendReady = async ({
  force = false,
}: {
  force?: boolean;
} = {}) => {
  const now = Date.now();
  if (!force && speechBackendReady && now - lastSpeechWarmupAt < SPEECH_WARMUP_TTL_MS) {
    return;
  }

  if (speechBackendWarmupInFlight) {
    return await speechBackendWarmupInFlight;
  }

  const warmupPromise = (async () => {
    const current = Date.now();
    if (
      force ||
      !lastSpeechHealthCheckAt ||
      current - lastSpeechHealthCheckAt > SPEECH_HEALTH_TTL_MS ||
      !speechBackendReady
    ) {
      await api.get("/speech/health");
      lastSpeechHealthCheckAt = Date.now();
    }

    await api.post("/speech/warmup", {}, { timeout: 90000 });
    speechBackendReady = true;
    lastSpeechWarmupAt = Date.now();
  })();

  speechBackendWarmupInFlight = warmupPromise;
  try {
    await warmupPromise;
  } catch (error) {
    speechBackendReady = false;
    throw error;
  } finally {
    if (speechBackendWarmupInFlight === warmupPromise) {
      speechBackendWarmupInFlight = null;
    }
  }
};

const isRetryableTtsError = (error: unknown) => {
  const status = getErrorStatus(error);
  const code = getErrorCode(error);
  if (status !== undefined && [429, 500, 502, 503, 504].includes(status)) return true;
  return code === "ECONNABORTED" || code === "ERR_NETWORK";
};

const revokeObjectUrlSoon = (url: string | null) => {
  if (!url) return;
  // Delay revoke slightly to avoid blob fetch race in some browsers.
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Ignore revoke failures.
    }
  }, 1500);
};

const cacheBackendAudio = (key: string, blob: Blob) => {
  if (backendAudioCache.has(key)) {
    backendAudioCache.delete(key);
  }
  backendAudioCache.set(key, blob);
  if (backendAudioCache.size > BACKEND_CACHE_LIMIT) {
    const oldestKey = backendAudioCache.keys().next().value;
    if (oldestKey) backendAudioCache.delete(oldestKey);
  }
};

const resetCurrentAudio = () => {
  const audio = currentAudio;
  const url = currentAudioUrl;

  if (audio) {
    audio.pause();
    audio.currentTime = 0;
    audio.onended = null;
    audio.onerror = null;
    audio.removeAttribute("src");
    audio.load();
  }

  currentAudio = null;
  currentAudioUrl = null;
  revokeObjectUrlSoon(url);
};

export const unlockSpeechPlayback = async () => {
  if (audioPlaybackUnlocked || typeof window === "undefined") {
    return;
  }

  try {
    const probe = new Audio(SILENT_WAV_DATA_URI);
    probe.muted = true;
    await probe.play();
    probe.pause();
    probe.currentTime = 0;
    audioPlaybackUnlocked = true;
  } catch {
    // Ignore unlock failures; speak() still has browser fallback.
  }
};

const fetchBackendSpeechAudio = async (
  text: string,
  voiceGender: "male" | "female",
  style: SpeakOptions["style"]
) => {
  const cacheKey = `${voiceGender}|${style || "default"}|${text}`;

  const cached = backendAudioCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const inFlight = backendAudioInFlight.get(cacheKey);
  if (inFlight) {
    return await inFlight;
  }

  const promise = (async () => {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < BACKEND_TTS_RETRIES; attempt++) {
      try {
        const response = await api.post(
          "/speech/synthesize",
          {
            text,
            voice_gender: voiceGender,
          },
          {
            responseType: "arraybuffer",
            timeout: BACKEND_TTS_TIMEOUT_MS,
          }
        );
        const blob = new Blob([response.data], { type: "audio/wav" });
        cacheBackendAudio(cacheKey, blob);
        speechBackendReady = true;
        return blob;
      } catch (error) {
        lastError = error;
        const status = getErrorStatus(error);
        if (status !== undefined && [500, 503].includes(status)) {
          try {
            await ensureSpeechBackendReady({ force: true });
          } catch {
            // Keep retry loop active even if warmup endpoint is briefly unavailable.
          }
        }
        if (attempt >= BACKEND_TTS_RETRIES - 1 || !isRetryableTtsError(error)) {
          throw error;
        }
        await sleep(350 * (attempt + 1));
      }
    }

    throw lastError;
  })();

  backendAudioInFlight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    backendAudioInFlight.delete(cacheKey);
  }
};

export const prefetchSpeech = (text: string, options?: SpeakOptions) => {
  const content = normalizeSpokenText(text);
  if (!content) return;
  const backendVoiceGender = normalizeVoiceGender(options?.voiceGender);
  void fetchBackendSpeechAudio(content, backendVoiceGender, options?.style).catch(() => {
    // Silent prefetch failure; speak() has runtime fallback.
  });
};

export const prepareSpeech = async (text: string, options?: SpeakOptions) => {
  const content = normalizeSpokenText(text);
  if (!content) return;
  const backendVoiceGender = normalizeVoiceGender(options?.voiceGender);
  await fetchBackendSpeechAudio(content, backendVoiceGender, options?.style);
};

const FEMALE_HINTS = ["female", "woman", "samantha", "zira", "aria", "jenny", "karen", "susan"];
const MALE_HINTS = ["male", "man", "david", "mark", "guy", "ryan", "adam", "george"];

const scoreVoice = (voice: SpeechSynthesisVoice, voiceGender: SpeechVoiceGender) => {
  const name = (voice.name || "").toLowerCase();
  const lang = (voice.lang || "").toLowerCase();
  let score = 0;

  if (lang.startsWith("en-us")) score += 40;
  else if (lang.startsWith("en")) score += 25;

  if (name.includes("google") || name.includes("microsoft") || name.includes("natural") || name.includes("neural")) {
    score += 20;
  }

  const hasFemale = FEMALE_HINTS.some((hint) => name.includes(hint));
  const hasMale = MALE_HINTS.some((hint) => name.includes(hint));

  if (voiceGender === "female") {
    if (hasFemale) score += 25;
    if (hasMale) score -= 15;
  }

  if (voiceGender === "male") {
    if (hasMale) score += 25;
    if (hasFemale) score -= 15;
  }

  if (voice.default) score += 5;
  return score;
};

const pickBestVoice = (voices: SpeechSynthesisVoice[], voiceGender: SpeechVoiceGender) => {
  if (!voices.length) return null;
  return [...voices].sort((a, b) => scoreVoice(b, voiceGender) - scoreVoice(a, voiceGender))[0] || null;
};

const waitForVoices = (timeoutMs = 1200): Promise<SpeechSynthesisVoice[]> => {
  return new Promise((resolve) => {
    if (!isSpeechSynthesisSupported()) {
      resolve([]);
      return;
    }

    const existing = window.speechSynthesis.getVoices();
    if (existing.length) {
      resolve(existing);
      return;
    }

    // Trigger browser to load voice list.
    window.speechSynthesis.getVoices();

    let settled = false;
    const finish = (voices: SpeechSynthesisVoice[]) => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
      resolve(voices);
    };

    const onVoicesChanged = () => {
      finish(window.speechSynthesis.getVoices());
    };

    window.speechSynthesis.addEventListener("voiceschanged", onVoicesChanged);
    setTimeout(() => finish(window.speechSynthesis.getVoices()), timeoutMs);
  });
};

export const warmupSpeechVoices = async () => {
  await waitForVoices();
  try {
    await ensureSpeechBackendReady();
    if (!bootstrapPrefetchDone) {
      bootstrapPrefetchDone = true;
      prefetchSpeech("Interview starts now.", { voiceGender: "female", style: "assistant" });
    }
  } catch {
    // Keep silent: assistant fallback policy decides runtime behavior.
  }
};

const resolvePreferredVoice = (voices: SpeechSynthesisVoice[], voiceGender: SpeechVoiceGender) => {
  const cachedUri = preferredVoiceUriByGender[voiceGender];
  if (cachedUri) {
    const cached = voices.find((v) => v.voiceURI === cachedUri);
    if (cached) return cached;
  }

  const picked = pickBestVoice(voices, voiceGender);
  if (picked) {
    preferredVoiceUriByGender[voiceGender] = picked.voiceURI;
  }
  return picked;
};

const shouldUseBrowserFallback = (options?: SpeakOptions) => {
  if (options?.style === "assistant") {
    return ENABLE_ASSISTANT_BROWSER_FALLBACK;
  }
  return true;
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(label)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const speakWithBrowserFallback = async (
  text: string,
  requestId: number,
  onEnd?: () => void,
  options?: SpeakOptions
) => {
  const voices = await waitForVoices();
  if (requestId !== speakRequestId) return;

  synthesisUtterance = new SpeechSynthesisUtterance(text);

  const voiceGender = options?.voiceGender || "auto";
  const preferredVoice = resolvePreferredVoice(voices, voiceGender);
  if (preferredVoice) {
    synthesisUtterance.voice = preferredVoice;
  }

  if (options?.style === "assistant") {
    synthesisUtterance.rate = 1.04;
    synthesisUtterance.pitch = voiceGender === "male" ? 0.9 : 1.0;
    synthesisUtterance.volume = 1.0;
  } else {
    synthesisUtterance.rate = 1.0;
    synthesisUtterance.pitch = 1.0;
    synthesisUtterance.volume = 1.0;
  }

  if (onEnd) {
    synthesisUtterance.onend = onEnd;
    synthesisUtterance.onerror = onEnd;
  }

  window.speechSynthesis.speak(synthesisUtterance);
};

export const speak = (text: string, onEnd?: () => void, options?: SpeakOptions) => {
  const content = normalizeSpokenText(text);
  if (!content) {
    if (onEnd) onEnd();
    return;
  }

  if (!isSpeechSynthesisSupported()) {
    console.warn("Speech synthesis is not supported in this browser.");
    if (onEnd) onEnd();
    return;
  }

  // Stop currently playing speech and create an id so stale async plays are ignored.
  stopSpeaking();
  const requestId = ++speakRequestId;
  const backendVoiceGender = normalizeVoiceGender(options?.voiceGender);
  let fallbackTriggered = false;

  const triggerFallback = async () => {
    if (fallbackTriggered || requestId !== speakRequestId) return;
    fallbackTriggered = true;
    resetCurrentAudio();
    if (shouldUseBrowserFallback(options)) {
      await speakWithBrowserFallback(content, requestId, onEnd, options);
    } else if (onEnd) {
      console.warn("XTTS playback failed and assistant browser fallback is disabled.");
      onEnd();
    }
  };

  void (async () => {
    try {
      if (options?.style === "assistant") {
        await ensureSpeechBackendReady().catch(() => undefined);
      }

      const backendPromise = fetchBackendSpeechAudio(content, backendVoiceGender, options?.style);
      // Avoid unhandled rejection if a soft-timeout fallback path wins first.
      backendPromise.catch(() => undefined);

      const wavBlob =
        options?.style === "assistant"
          ? await withTimeout(backendPromise, ASSISTANT_TTS_SOFT_TIMEOUT_MS, "assistant tts timeout")
          : await backendPromise;

      if (requestId !== speakRequestId || !wavBlob) return;

      resetCurrentAudio();
      currentAudioUrl = URL.createObjectURL(wavBlob);
      currentAudio = new Audio(currentAudioUrl);
      currentAudio.preload = "auto";
      currentAudio.playbackRate = options?.style === "assistant" ? 1.12 : 1.08;

      const finish = () => {
        if (requestId !== speakRequestId) return;
        if (onEnd) onEnd();
      };

      currentAudio.onended = finish;
      currentAudio.onerror = () => {
        void (async () => {
          try {
            await unlockSpeechPlayback();
            if (requestId !== speakRequestId || !currentAudio) return;
            await currentAudio.play();
          } catch {
            await triggerFallback();
          }
        })();
      };

      try {
        await currentAudio.play();
      } catch {
        await unlockSpeechPlayback();
        // currentAudio may have been nulled by stopSpeaking() during the await above.
        if (!currentAudio || requestId !== speakRequestId) return;
        await currentAudio.play();
      }
    } catch (err) {
      await triggerFallback();
    }
  })();
};

export const stopSpeaking = () => {
  speakRequestId += 1;
  resetCurrentAudio();
  if (isSpeechSynthesisSupported()) {
    window.speechSynthesis.cancel();
    synthesisUtterance = null;
  }
};

// Speech-to-Text
export const createSpeechRecognition = (
  onResult: (text: string, finalText: string) => void,
  onEnd: () => void,
  onError: (error: string) => void
) => {
  if (!isSpeechRecognitionSupported()) {
    onError("Speech recognition is not supported in this browser.");
    return null;
  }

  const SpeechRecognition =
    (window as SpeechRecognitionWindowLike).SpeechRecognition ||
    (window as SpeechRecognitionWindowLike).webkitSpeechRecognition;

  if (!SpeechRecognition) {
    onError("Speech recognition is not supported in this browser.");
    return null;
  }

  const recognition = new SpeechRecognition();

  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  let finalTranscript = "";

  recognition.onresult = (event) => {
    let interimTranscript = "";
    
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript;
      } else {
        interimTranscript += event.results[i][0].transcript;
      }
    }
    
    // Pass both final+interim for live UI and final-only for downstream validation.
    onResult((finalTranscript + " " + interimTranscript).trim(), finalTranscript.trim());
  };

  recognition.onerror = (event) => {
    onError(event.error || "unknown");
  };

  recognition.onend = () => {
    onEnd();
  };

  return recognition;
};
