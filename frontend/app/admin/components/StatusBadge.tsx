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
  // 🚨 STRICT SEMANTIC PALETTE: Slate (Idle), Purple (AI Processing), Amber (HITL), Emerald (Success), Rose (Fail)
  const config: Record<GrievanceStatus, { 
    classes: string; 
    dotClass: string;
    label: string;
    pulseColor: string;
    isPulsing: boolean; // Only pulse when actively processing or waiting
  }> = {
    RECEIVED: { 
      classes: 'bg-slate-500/10 border-slate-500/20 text-slate-300', 
      dotClass: 'bg-slate-400',
      label: 'Received',
      pulseColor: 'rgba(148, 163, 184, 0.4)',
      isPulsing: false
    },
    VERIFYING_IMAGE: { 
      classes: 'bg-purple-500/10 border-purple-500/30 text-purple-300', 
      dotClass: 'bg-purple-400',
      label: 'Verifying Vision',
      pulseColor: 'rgba(147, 51, 234, 0.4)',
      isPulsing: true
    },
    ROUTING_JURISDICTION: { 
      classes: 'bg-purple-500/10 border-purple-500/30 text-purple-300', 
      dotClass: 'bg-purple-400',
      label: 'Routing',
      pulseColor: 'rgba(147, 51, 234, 0.4)',
      isPulsing: true
    },
    DISCOVERING_CONTACT: { 
      classes: 'bg-purple-500/10 border-purple-500/30 text-purple-300', 
      dotClass: 'bg-purple-400',
      label: 'OSINT Search',
      pulseColor: 'rgba(147, 51, 234, 0.4)',
      isPulsing: true
    },
    DRAFTING_LETTER: { 
      classes: 'bg-purple-500/10 border-purple-500/30 text-purple-300', 
      dotClass: 'bg-purple-400',
      label: 'Drafting Legal',
      pulseColor: 'rgba(147, 51, 234, 0.4)',
      isPulsing: true
    },
    AWAITING_REVIEW: { 
      classes: 'bg-amber-500/10 border-amber-500/30 text-amber-400', 
      dotClass: 'bg-amber-400',
      label: 'Awaiting Auth',
      pulseColor: 'rgba(245, 158, 11, 0.5)',
      isPulsing: true // Human attention needed
    },
    DISPATCHING: { 
      classes: 'bg-purple-500/10 border-purple-500/30 text-purple-300', 
      dotClass: 'bg-purple-400',
      label: 'Dispatching',
      pulseColor: 'rgba(147, 51, 234, 0.4)',
      isPulsing: true
    },
    DISPATCHED: { 
      classes: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400', 
      dotClass: 'bg-emerald-400',
      label: 'Dispatched',
      pulseColor: 'rgba(16, 185, 129, 0)',
      isPulsing: false
    },
    FAILED: { 
      classes: 'bg-rose-500/10 border-rose-500/30 text-rose-400', 
      dotClass: 'bg-rose-400',
      label: 'Sys Failure',
      pulseColor: 'rgba(225, 29, 72, 0)',
      isPulsing: false
    },
    RESOLVED: { 
      classes: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400', 
      dotClass: 'bg-emerald-400',
      label: 'Resolved',
      pulseColor: 'rgba(16, 185, 129, 0)',
      isPulsing: false
    },
    REJECTED_FRAUD: { 
      classes: 'bg-rose-500/10 border-rose-500/30 text-rose-400', 
      dotClass: 'bg-rose-400',
      label: 'Halted',
      pulseColor: 'rgba(225, 29, 72, 0)',
      isPulsing: false
    },
    ESCALATED: { 
      classes: 'bg-orange-500/10 border-orange-500/30 text-orange-400', 
      dotClass: 'bg-orange-400',
      label: 'Escalated',
      pulseColor: 'rgba(249, 115, 22, 0.4)',
      isPulsing: true
    },
  };
  
  const { classes, dotClass, label, pulseColor, isPulsing } = config[status] || config.RECEIVED;
  
  const sizeClasses = {
    sm: 'px-2 py-0.5 text-[9px]',
    md: 'px-2.5 py-1 text-[10px]',
    lg: 'px-3 py-1.5 text-xs',
  };
  
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md font-bold uppercase tracking-widest border backdrop-blur-md',
        classes,
        sizeClasses[size],
        className
      )}
    >
      {showPulse && (
        <motion.span
          className={cn('rounded-full', dotClass, size === 'sm' ? 'w-1 h-1' : 'w-1.5 h-1.5')}
          animate={isPulsing ? {
            boxShadow: [
              `0 0 0 0 ${pulseColor}`,
              `0 0 0 ${size === 'sm' ? '4px' : '6px'} transparent`,
              `0 0 0 0 transparent`,
            ],
          } : {}}
          transition={isPulsing ? {
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
          } : {}}
        />
      )}
      {label}
    </motion.span>
  );
}