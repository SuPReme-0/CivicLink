// lib/utils.ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- STYLING & ENV ---
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getEnv(key: string, fallback: string = ''): string {
  return process.env[key] || fallback;
}

// --- DATE & TIME ---
export function formatRelativeTime(date: Date | string): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.round(diffMs / 60000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.round(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  
  // Format as "Apr 25, 2026"
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// --- CIVICLINK SPECIFIC UTILITIES ---

/**
 * Formats screaming snake case Enums into readable UI text.
 * Ex: "ROUTING_JURISDICTION" -> "Routing Jurisdiction"
 */
export function formatStatus(status: string): string {
  if (!status) return 'Unknown';
  return status
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Masks PII for Moderator Dashboards.
 * Ex: "+919876543210" -> "+91 ****** 3210"
 */
export function maskPhoneNumber(phone: string): string {
  if (!phone || phone.length < 8) return phone;
  const visibleLast = 4;
  const visibleFirst = phone.startsWith('+') ? 3 : 2;
  
  const firstPart = phone.slice(0, visibleFirst);
  const lastPart = phone.slice(-visibleLast);
  const maskedLength = phone.length - visibleFirst - visibleLast;
  
  return `${firstPart} ${'*'.repeat(maskedLength)} ${lastPart}`;
}

/**
 * Generates a collision-resistant idempotency key for the frontend 
 * to prevent double-submissions on slow networks.
 */
export function generateFrontendTrackingId(): string {
  const timestamp = Date.now().toString(36);
  const randomChars = Math.random().toString(36).substring(2, 7);
  return `TRK-${timestamp}-${randomChars}`.toUpperCase();
}