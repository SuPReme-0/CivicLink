// app/(admin)/components/MetricCard.tsx
'use client';

import { motion } from 'framer-motion';
import { ArrowUpRight, ArrowDownRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MetricCardProps {
  title: string;
  value: string | number;
  change?: {
    value: number;
    isPositive: boolean;
  };
  icon: React.ElementType;
  trend?: 'up' | 'down' | 'stable';
  loading?: boolean;
  onClick?: () => void;
  className?: string;
}

export function MetricCard({
  title,
  value,
  change,
  icon: Icon,
  trend = 'stable',
  loading = false,
  onClick,
  className,
}: MetricCardProps) {
  // 🚨 FIXED: Removed unused `trendColors` to prevent ESLint build failures

  const trendIcons = {
    up: ArrowUpRight,
    down: ArrowDownRight,
    stable: null,
  };

  const TrendIcon = trendIcons[trend];

  return (
    <motion.div
      whileHover={{ 
        y: -4,
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)',
        borderColor: 'rgba(99, 102, 241, 0.5)'
      }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      onClick={onClick}
      className={cn(
        'glass-panel p-5 rounded-2xl cursor-default transition-all',
        onClick && 'cursor-pointer hover:bg-white/5',
        className
      )}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="min-w-0">
          <p className="text-sm text-white/60 truncate">{title}</p>
          {loading ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="h-8 w-20 bg-white/10 rounded mt-1 animate-pulse"
            />
          ) : (
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-2xl font-bold mt-1 truncate"
            >
              {value}
            </motion.p>
          )}
        </div>
        
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className={cn(
            'p-2.5 rounded-xl',
            trend === 'up' ? 'bg-green-500/20 text-green-400' :
            trend === 'down' ? 'bg-red-500/20 text-red-400' :
            'bg-blue-500/20 text-blue-400'
          )}
        >
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Icon className="w-5 h-5" />
          )}
        </motion.div>
      </div>
      
      {change && !loading && (
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3 }}
          className={cn(
            'flex items-center gap-1 text-sm',
            change.isPositive ? 'text-green-400' : 'text-red-400'
          )}
        >
          {TrendIcon && <TrendIcon className="w-4 h-4" />}
          <span>{Math.abs(change.value)}% from last week</span>
        </motion.div>
      )}
      
      {/* Subtle glow effect on hover */}
      <motion.div
        className="absolute inset-0 rounded-2xl opacity-0 hover:opacity-100 transition-opacity pointer-events-none"
        style={{
          background: `radial-gradient(circle at 30% 30%, ${trend === 'up' ? 'rgba(34, 197, 94, 0.1)' : trend === 'down' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(56, 189, 248, 0.1)'}, transparent 70%)`,
        }}
      />
    </motion.div>
  );
}