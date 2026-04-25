// app/api/admin/sse/route.ts
import { NextRequest } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export async function GET(req: NextRequest) {
  // Construct the SSE URL for FastAPI
  const url = new URL('/api/v1/admin/stream', BACKEND_URL);

  try {
    // Open a persistent connection to the FastAPI SSE endpoint
    const backendResponse = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        // Optional: Pass an admin token here if required by FastAPI
        'Authorization': `Bearer ${process.env.BACKEND_INTERNAL_KEY || 'dev-key-12345'}`
      },
    });

    if (!backendResponse.ok) {
      throw new Error(`Backend SSE rejected with status ${backendResponse.status}`);
    }

    // Pipe the readable stream directly to the Next.js client
    return new Response(backendResponse.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        // Ensure reverse proxies don't buffer the stream
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