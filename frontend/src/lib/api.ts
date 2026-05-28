import axios from "axios";
import type { AxiosRequestConfig } from "axios";
import { getToken, setToken, logout } from "./auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const api = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

type DedupeGetConfig = AxiosRequestConfig & { skipDedupe?: boolean; _retry?: boolean };

const inFlightGetRequests = new Map<string, Promise<unknown>>();

const stableSerialize = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const typedValue = value as Record<string, unknown>;
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${key}:${stableSerialize(typedValue[key])}`).join(",")}}`;
  }
  return String(value);
};

const buildGetRequestKey = (url: string, config?: DedupeGetConfig): string => {
  const paramsPart = stableSerialize(config?.params);
  return `${url}::${paramsPart}`;
};

const rawGet = api.get.bind(api);
api.get = ((url: string, config?: DedupeGetConfig) => {
  if (config?.skipDedupe === true) {
    return rawGet(url, config);
  }

  const key = buildGetRequestKey(url, config);
  const inFlight = inFlightGetRequests.get(key);
  if (inFlight) {
    return inFlight;
  }

  const request = (rawGet(url, config) as Promise<unknown>).finally(() => {
    inFlightGetRequests.delete(key);
  });

  inFlightGetRequests.set(key, request);
  return request;
}) as typeof api.get;

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// --- JWT silent refresh ---
let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

const onTokenRefreshed = (token: string) => {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
};

// Response interceptor: on 401, try a silent token refresh before logging out
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    // Format validation errors (Pydantic objects) into clear message strings
    if (error.response?.data?.detail && Array.isArray(error.response.data.detail)) {
      error.response.data.detail = error.response.data.detail
        .map((err: any) => {
          const field = err.loc && err.loc.length > 1 ? err.loc[err.loc.length - 1] : "";
          const msg = err.msg || "Invalid value";
          const cleanMsg = msg.replace(/^Value error,\s*/i, "");
          return field ? `${field}: ${cleanMsg}` : cleanMsg;
        })
        .join("; ");
    }

    const originalRequest = error.config as DedupeGetConfig & { _retry?: boolean };

    const is401 = error.response?.status === 401;
    const isAuthEndpoint =
      originalRequest?.url?.includes("/auth/login") ||
      originalRequest?.url?.includes("/auth/signup") ||
      originalRequest?.url?.includes("/auth/refresh");

    if (is401 && !originalRequest._retry && !isAuthEndpoint) {
      // If another request is already refreshing, queue this one
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          refreshSubscribers.push((token: string) => {
            originalRequest.headers = originalRequest.headers ?? {};
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(api(originalRequest));
          });
          // If refresh ultimately fails, reject queued requests too
          setTimeout(() => reject(error), 10000);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const currentToken = getToken();
      if (!currentToken) {
        isRefreshing = false;
        logout();
        return Promise.reject(error);
      }

      try {
        // Use a raw axios call (not api) to avoid interceptor loops
        const { data } = await axios.post(
          `${API_URL}/auth/refresh`,
          {},
          { headers: { Authorization: `Bearer ${currentToken}` } }
        );
        const newToken: string = data.access_token;
        setToken(newToken);
        isRefreshing = false;
        onTokenRefreshed(newToken);
        originalRequest.headers = originalRequest.headers ?? {};
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch {
        isRefreshing = false;
        refreshSubscribers = [];
        if (
          typeof window !== "undefined" &&
          !window.location.pathname.includes("/login") &&
          !window.location.pathname.includes("/register")
        ) {
          logout();
        }
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
