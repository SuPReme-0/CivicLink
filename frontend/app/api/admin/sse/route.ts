// app/api/admin/sse/route.ts
import { NextRequest } from 'next/server';

// 🚨 VERCEL FIX: Serverless environments kill persistent streams. 
// You MUST use the Edge runtime to keep Server-Sent Events alive.
export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export async function GET(req: NextRequest) {
  const url = new URL('/api/v1/admin/stream', BACKEND_URL);

  try {
    const backendResponse = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Authorization': `Bearer ${process.env.BACKEND_INTERNAL_KEY || 'dev-key-12345'}`
      },
    });

    if (!backendResponse.ok) {
      throw new Error(`Backend SSE rejected with status ${backendResponse.status}`);
    }

    return new Response(backendResponse.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', 
      },
    });
  } catch (error) {
    console.error('SSE Proxy connection failed:', error);
    return new Response(
      JSON.stringify({ error: 'SSE Stream Unavailable' }), 
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}