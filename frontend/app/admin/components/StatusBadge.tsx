// app/(admin)/components/StatusBadge.tsx
'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { GrievanceStatus } from '@/types';

export interface StatusBadgeProps {
  status: GrievanceStatus;
  size?: 'sm' | 'md' | 'lg';
  showPulse?: boolean;
  className?: string;
}

export function StatusBadge({
  status,
  size = 'md',
  showPulse = true,
  className,
}: StatusBadgeProps) {
  // 🚨 FIXED: Full class strings mapped to prevent Tailwind PurgeCSS from stripping colors in production
  const config: Record<GrievanceStatus, { 
    classes: string; 
    dotClass: string;
    label: string;
    pulseColor: string;
  }> = {
    RECEIVED: { 
      classes: 'bg-blue-500/10 border-blue-500/30 text-blue-300', 
      dotClass: 'bg-blue-400',
      label: 'Received',
      pulseColor: 'rgba(56, 189, 248, 0.4)'
    },
    VERIFYING_IMAGE: { 
      classes: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300', 
      dotClass: 'bg-yellow-400',
      label: 'Verifying',
      pulseColor: 'rgba(245, 158, 11, 0.4)'
    },
    ROUTING_JURISDICTION: { 
      classes: 'bg-purple-500/10 border-purple-500/30 text-purple-300', 
      dotClass: 'bg-purple-400',
      label: 'Routing',
      pulseColor: 'rgba(139, 92, 246, 0.4)'
    },
    DISCOVERING_CONTACT: { 
      classes: 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300', 
      dotClass: 'bg-indigo-400',
      label: 'Finding Contact',
      pulseColor: 'rgba(99, 102, 241, 0.4)'
    },
    DRAFTING_LETTER: { 
      classes: 'bg-pink-500/10 border-pink-500/30 text-pink-300', 
      dotClass: 'bg-pink-400',
      label: 'Drafting',
      pulseColor: 'rgba(236, 72, 153, 0.4)'
    },
    AWAITING_REVIEW: { 
      classes: 'bg-orange-500/10 border-orange-500/30 text-orange-300', 
      dotClass: 'bg-orange-400',
      label: 'Awaiting Review',
      pulseColor: 'rgba(249, 115, 22, 0.4)'
    },
    DISPATCHING: { 
      classes: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300', 
      dotClass: 'bg-cyan-400',
      label: 'Dispatching',
      pulseColor: 'rgba(6, 182, 212, 0.4)'
    },
    DISPATCHED: { 
      classes: 'bg-green-500/10 border-green-500/30 text-green-300', 
      dotClass: 'bg-green-400',
      label: 'Dispatched',
      pulseColor: 'rgba(34, 197, 94, 0.4)'
    },
    FAILED: { 
      classes: 'bg-red-500/10 border-red-500/30 text-red-300', 
      dotClass: 'bg-red-400',
      label: 'Failed',
      pulseColor: 'rgba(239, 68, 68, 0.4)'
    },
    RESOLVED: { 
      classes: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300', 
      dotClass: 'bg-emerald-400',
      label: 'Resolved',
      pulseColor: 'rgba(16, 185, 129, 0.4)'
    },
    REJECTED_FRAUD: { 
      classes: 'bg-rose-500/10 border-rose-500/30 text-rose-300', 
      dotClass: 'bg-rose-400',
      label: 'Rejected',
      pulseColor: 'rgba(244, 63, 94, 0.4)'
    },
    ESCALATED: { 
      classes: 'bg-violet-500/10 border-violet-500/30 text-violet-300', 
      dotClass: 'bg-violet-400',
      label: 'Escalated',
      pulseColor: 'rgba(124, 58, 237, 0.4)'
    },
  };
  
  const { classes, dotClass, label, pulseColor } = config[status] || config.RECEIVED;
  
  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-xs',
    lg: 'px-3 py-1.5 text-sm',
  };
  
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium border backdrop-blur-sm',
        classes,
        sizeClasses[size],
        className
      )}
    >
      {showPulse && (
        <motion.span
          className={cn('w-1.5 h-1.5 rounded-full', dotClass)}
          animate={{
            boxShadow: [
              `0 0 0 0 ${pulseColor}`,
              `0 0 0 8px transparent`,
              `0 0 0 0 transparent`,
            ],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      )}
      {label}
    </motion.span>
  );
}