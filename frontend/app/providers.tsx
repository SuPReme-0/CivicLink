'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Toaster } from 'react-hot-toast'; 

// 1. Create a factory function for the QueryClient
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000, 
        gcTime: 1000 * 60 * 60 * 24, // Keep in cache for 24h
        refetchOnWindowFocus: false,
        retry: (failureCount, error: any) => {
          // Do not retry on client errors that won't magically fix themselves
          const noRetryStatuses = [401, 403, 404, 422];
          if (error?.status && noRetryStatuses.includes(error.status)) {
            return false;
          }
          return failureCount < 2;
        },
      },
    },
  });
}

// 2. Safely cache the client ONLY in the browser
let browserQueryClient: QueryClient | undefined = undefined;

function getQueryClient() {
  if (typeof window === 'undefined') {
    // Server: Always make a new client per request to prevent data leaking between users
    return makeQueryClient();
  } else {
    // Browser: Make a new client if we don't have one, then reuse it
    if (!browserQueryClient) browserQueryClient = makeQueryClient();
    return browserQueryClient;
  }
}

export default function Providers({ children }: { children: React.ReactNode }) {
  // 3. Initialize using the safe getter instead of useState
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      
      {/* Production Toast Notifications */}
      <Toaster 
        position="bottom-right" // Moved to bottom-right (standard for dashboards)
        toastOptions={{
          duration: 4000,
          className: 'font-mono text-sm shadow-[0_0_20px_rgba(0,0,0,0.5)]',
          style: { 
            background: '#0a040d', 
            color: '#cbd5e1', 
            border: '1px solid rgba(99, 102, 241, 0.2)' // Matched CivicLink's indigo theme
          },
          success: {
            style: { border: '1px solid rgba(16, 185, 129, 0.3)' }
          },
          error: {
            style: { border: '1px solid rgba(244, 63, 94, 0.3)' }
          }
        }}
      />
      
      {process.env.NODE_ENV === 'development' && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}