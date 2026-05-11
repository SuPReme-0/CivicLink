import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- STYLING & ENV ---
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Returns severity-based Tailwind classes for UI badges.
 * Crucial for Mission Control oversight.
 */
export function getSeverityStyles(severity: string) {
  const base = "px-2 py-1 rounded-full text-xs font-bold uppercase tracking-wider";
  switch (severity?.toUpperCase()) {
    case 'CRITICAL': return cn(base, "bg-red-600 text-white animate-pulse shadow-[0_0_10px_rgba(220,38,38,0.5)]");
    case 'HIGH':     return cn(base, "bg-orange-500 text-white");
    case 'MEDIUM':   return cn(base, "bg-yellow-400 text-black");
    case 'LOW':      return cn(base, "bg-blue-500 text-white");
    default:         return cn(base, "bg-gray-200 text-gray-700");
  }
}

// --- DATE & TIME ---
/**
 * Hardened relative time with robust error handling for ISO strings 
 * coming from PostgreSQL/Prisma.
 */
export function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) return 'Never';
  
  const now = new Date();
  const then = new Date(date);
  
  if (isNaN(then.getTime())) return 'Invalid Date';

  const diffMs = now.getTime() - then.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  
  if (diffSecs < 30) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return then.toLocaleDateString('en-IN', { 
    day: 'numeric', 
    month: 'short', 
    year: 'numeric' 
  });
}

// --- CIVICLINK SPECIFIC UTILITIES ---

/**
 * Maps Enum status to human-readable strings + Lucide Icon colors.
 */
export function formatStatus(status: string): string {
  if (!status) return 'Idle';
  // Special case for LangGraph internal node names
  if (status === '__end__') return 'Completed';
  
  return status
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

/**
 * Formats a 0.0 - 1.0 confidence score into a readable percentage.
 */
export function formatConfidence(score: number | undefined | null): string {
  if (score === undefined || score === null) return 'N/A';
  const pct = Math.round(score * 100);
  return `${pct}%`;
}

/**
 * Masks PII for Moderator Dashboards.
 * Hardened to handle international formats and short numbers.
 */
export function maskPhoneNumber(phone: string): string {
  if (!phone) return 'N/A';
  const clean = phone.replace(/\s/g, '');
  if (clean.length < 6) return '***';
  
  const visibleLast = 4;
  const prefix = clean.startsWith('+') ? 3 : 2;
  
  return `${clean.slice(0, prefix)} **** ${clean.slice(-visibleLast)}`;
}

/**
 * Masks Email for privacy (Grievance List view).
 * priyanshu@gmail.com -> pr******@gmail.com
 */
export function maskEmail(email: string | undefined | null): string {
  if (!email) return 'N/A';
  const [user, domain] = email.split('@');
  if (!domain) return '***';
  return `${user.slice(0, 2)}******@${domain}`;
}

/**
 * Generates a high-entropy tracking ID.
 * Uses crypto.randomUUID if available, otherwise falls back to base36.
 */
export function generateFrontendTrackingId(): string {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return `TRK-${window.crypto.randomUUID().split('-')[0].toUpperCase()}`;
  }
  const timestamp = Date.now().toString(36);
  const randomChars = Math.random().toString(36).substring(2, 7);
  return `TRK-${timestamp}-${randomChars}`.toUpperCase();
}