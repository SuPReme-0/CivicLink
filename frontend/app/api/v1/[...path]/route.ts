// app/api/v1/[...path]/route.ts
import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

async function handleRequest(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  // Await the params object (Required in Next.js 15 App Router)
  const resolvedParams = await params;
  const path = resolvedParams.path.join('/');
  
  // Construct the destination URL for FastAPI
  const url = new URL(`/api/v1/${path}`, BACKEND_URL);
  
  // Preserve search parameters (e.g., ?status=pending)
  url.search = req.nextUrl.search;

  // Extract headers and attach the secure backend API key
  const headers = new Headers(req.headers);
  headers.delete('host'); // Let fetch set the correct host
  headers.set('Authorization', `Bearer ${process.env.BACKEND_INTERNAL_KEY || 'dev-key-12345'}`);

  try {
    const backendResponse = await fetch(url.toString(), {
      method: req.method,
      headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? await req.arrayBuffer() : undefined,
      // Don't cache proxy requests by default
      cache: 'no-store',
    });

    // Create the response to send back to the browser
    const responseData = await backendResponse.arrayBuffer();
    
    const response = new NextResponse(responseData, {
      status: backendResponse.status,
      statusText: backendResponse.statusText,
    });

    // Forward the content-type so the browser parses JSON properly
    const contentType = backendResponse.headers.get('content-type');
    if (contentType) {
      response.headers.set('content-type', contentType);
    }

    return response;
  } catch (error) {
    console.error(`Proxy Error to ${url}:`, error);
    return NextResponse.json(
      { error: 'Internal API Gateway Error', details: 'Backend server unreachable' }, 
      { status: 502 }
    );
  }
}

// Export the handler for all standard HTTP methods
export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const PATCH = handleRequest;
export const DELETE = handleRequest;