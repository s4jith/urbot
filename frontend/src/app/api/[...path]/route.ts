import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Proxy target backend URL (internal network or localhost)
const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return handleRequest(request, params);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return handleRequest(request, params);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return handleRequest(request, params);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return handleRequest(request, params);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return handleRequest(request, params);
}

async function handleRequest(request: NextRequest, paramsPromise: Promise<{ path: string[] }>) {
  const { path } = await paramsPromise;
  const pathStr = path.join("/");
  const url = new URL(request.url);
  const targetUrl = `${BACKEND_URL}/${pathStr}${url.search}`;

  // Clone headers
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    // Skip host and connection to let the fetch client populate them correctly for the backend
    if (key !== "host" && key !== "connection") {
      headers.set(key, value);
    }
  });

  // Extract body for mutative requests
  let body: any = undefined;
  if (!["GET", "HEAD"].includes(request.method)) {
    try {
      body = await request.blob();
    } catch {
      body = undefined;
    }
  }

  try {
    const res = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
    });

    const resHeaders = new Headers();
    res.headers.forEach((value, key) => {
      resHeaders.set(key, value);
    });

    return new NextResponse(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: resHeaders,
    });
  } catch (error: any) {
    console.error("API Proxy Error:", error);
    return NextResponse.json({ detail: `Proxy error: ${error.message}` }, { status: 502 });
  }
}
