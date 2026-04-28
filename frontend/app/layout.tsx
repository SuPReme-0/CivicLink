// app/layout.tsx
import type { Metadata } from 'next';
import './globals.css'; 
import Providers from './providers'; // 🚨 Add this import

export const metadata: Metadata = {
  title: 'CivicLink | AI Grievance Node',
  description: 'Autonomous municipal grievance resolution platform.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-[#030305] text-slate-200 antialiased">
        {/* 🚨 Wrap children with Providers */}
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}