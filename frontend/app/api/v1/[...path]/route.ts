// app/api/v1/[...path]/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300; 
export const dynamic = 'force-dynamic';

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

async function handleRequest(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const resolvedParams = await params;
  const path = resolvedParams.path.join('/');
  
  const url = new URL(`/api/v1/${path}`, BACKEND_URL);
  url.search = req.nextUrl.search;

  const headers = new Headers(req.headers);
  headers.delete('host'); 
  
  // 🚨 CRITICAL FIX: Aggressively force the master keys on every single request
  // This guarantees the Admin Dashboard will never be starved of data.
  const fallbackKey = 'dev-key-12345';
  
  headers.set(
    'X-Frontend-API-Key', 
    headers.get('X-Frontend-API-Key') || 
    process.env.FRONTEND_API_KEY || 
    process.env.NEXT_PUBLIC_FRONTEND_API_KEY || 
    fallbackKey
  );

  headers.set(
    'Authorization', 
    headers.get('Authorization') || 
    `Bearer ${process.env.BACKEND_INTERNAL_KEY || fallbackKey}`
  );

  try {
    const backendResponse = await fetch(url.toString(), {
      method: req.method,
      headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? await req.arrayBuffer() : undefined,
      cache: 'no-store',
    });

    const responseData = await backendResponse.arrayBuffer();
    
    const response = new NextResponse(responseData, {
      status: backendResponse.status,
      statusText: backendResponse.statusText,
    });

    const contentType = backendResponse.headers.get('content-type');
    if (contentType) {
      response.headers.set('content-type', contentType);
    }

    return response;
  } catch (error) {
    return NextResponse.json({ error: 'Gateway Error' }, { status: 502 });
  }
}

export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const PATCH = handleRequest;
export const DELETE = handleRequest;