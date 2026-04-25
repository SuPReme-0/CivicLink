// app/api/v1/ingest/route.ts
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    const API_KEY = process.env.FRONTEND_API_KEY;

    if (!API_KEY) {
      console.error("FATAL: FRONTEND_API_KEY is missing from environment variables.");
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }

    // Secure Server-to-Server transmission to FastAPI
    const response = await fetch(`${API_URL}/api/v1/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Frontend-API-Key': API_KEY, 
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json({ error: data.detail || "FastAPI rejected the request" }, { status: response.status });
    }

    return NextResponse.json(data);
    
  } catch (error) {
    console.error("Secure Proxy Error:", error);
    return NextResponse.json({ error: "Failed to communicate with AI Backend" }, { status: 500 });
  }
}