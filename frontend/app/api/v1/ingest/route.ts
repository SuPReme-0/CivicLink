// frontend/app/api/v1/ingest/route.ts
import { NextResponse } from 'next/server';

// 🚨 VERCEL FIX: Prevent 504 Gateway Timeouts
// This allows the proxy to stay open just long enough for FastAPI to acknowledge receipt
export const maxDuration = 60; 
export const dynamic = 'force-dynamic'; // Prevent aggressive Next.js caching

export async function POST(request: Request) {
  try {
    // 1. Parse incoming payload from the React Client
    const payload = await request.json();
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    
    // 2. Secure Header Extraction
    const incomingKey = request.headers.get('X-Frontend-API-Key');
    const sessionId = request.headers.get('X-Session-ID') || payload.phone_number || 'anonymous';
    const API_KEY = incomingKey || process.env.FRONTEND_API_KEY;

    if (!API_KEY) {
      console.error("FATAL: FRONTEND_API_KEY is missing from environment/headers.");
      return NextResponse.json(
        { error: "Server configuration error", status: "failed" }, 
        { status: 500 }
      );
    }

    // 3. Fire to FastAPI Gateway
    const response = await fetch(`${API_URL}/api/v1/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Frontend-API-Key': API_KEY,
        'X-Session-ID': sessionId,
        'X-Request-ID': `req-ingest-${Date.now()}`
      },
      body: JSON.stringify(payload),
      cache: 'no-store'
    });

    const data = await response.json();

    // 4. Handle FastAPI Rejections
    if (!response.ok) {
      console.error("FastAPI Rejection:", data);
      return NextResponse.json(
        { error: data.detail || data.message || "Backend rejected the request" }, 
        { status: response.status }
      );
    }

    // 5. Success: Return the Thread ID to the React Client
    return NextResponse.json(data);
    
  } catch (error: any) {
    console.error("Secure Proxy Error:", error.message || error);
    return NextResponse.json(
      { error: "Failed to communicate with AI Backend. Is FastAPI running?" }, 
      { status: 503 }
    );
  }
}