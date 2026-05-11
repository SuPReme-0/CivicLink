import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Add any custom middleware logic here if needed
  return NextResponse.next();
}

// 🚨 VERCEL CRASH FIX: A valid Next.js matcher array. 
// This tells Vercel exactly where middleware should run, ignoring static files.
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};