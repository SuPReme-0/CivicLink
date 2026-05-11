import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// 🚨 CRITICAL: Do NOT import NextAuth, auth.ts, databases, or heavy Node.js libraries here!
// Vercel Middleware runs on the "Edge", which will crash if it sees Node.js APIs.

export function middleware(request: NextRequest) {
  // We simply pass the request through to the page. 
  // Your ApiClient and React components already handle 401 Unauthorized redirects beautifully.
  return NextResponse.next();
}

// Vercel's ultra-safe Regex matcher
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - Any static assets (png, svg, ico)
     */
    '/((?!api|_next/static|_next/image|.*\\.png$|.*\\.svg$|.*\\.ico$).*)',
  ],
};