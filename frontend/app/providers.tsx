'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Toaster } from 'react-hot-toast'; // Run: npm install react-hot-toast
import { useState } from 'react';

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000, 
            gcTime: 1000 * 60 * 60 * 24, // Keep in cache for 24h
            refetchOnWindowFocus: false,
            retry: (failureCount, error: any) => {
              // Don't retry if the backend specifically says it's a validation error
              if (error?.status === 422) return false;
              return failureCount < 2;
            },
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* Production Toast Notifications */}
      <Toaster 
        position="top-right"
        toastOptions={{
          className: 'glass-card text-white border-white/10',
          style: { background: '#0f0f13', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' },
        }}
      />
      {process.env.NODE_ENV === 'development' && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}