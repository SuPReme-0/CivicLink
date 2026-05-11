'use client';

import { motion } from 'framer-motion';
import { ArrowUpRight, ArrowDownRight, ArrowRight, Loader2 } from 'lucide-react';
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
  
  const trendIcons = {
    up: ArrowUpRight,
    down: ArrowDownRight,
    stable: ArrowRight,
  };

  const TrendIcon = trendIcons[trend];

  return (
    <motion.div
      whileHover={onClick ? { y: -2 } : {}}
      whileTap={onClick ? { scale: 0.98 } : {}}
      onClick={onClick}
      className={cn(
        'metric-card', // 🚨 Uses the global CSS class for the refractive sweep & border hover
        onClick && 'cursor-pointer hover:bg-white/[0.04]',
        className
      )}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0 flex-1">
          <p className="metric-label uppercase tracking-widest text-[10px]">{title}</p>
          {loading ? (
            <div className="h-8 w-20 skeleton rounded mt-2" />
          ) : (
            <p className="metric-value mt-1">
              {value}
            </p>
          )}
        </div>
        
        <div className={cn(
          'p-2.5 rounded-xl border flex-shrink-0 transition-colors',
          trend === 'up' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
          trend === 'down' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
          'bg-purple-500/10 text-purple-400 border-purple-500/20'
        )}>
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Icon className="w-5 h-5" />
          )}
        </div>
      </div>
      
      {change && !loading && (
        <div className={cn(
          'flex items-center gap-1 text-[11px] font-medium tracking-wide mt-2',
          change.isPositive ? 'text-emerald-400' : 'text-rose-400'
        )}>
          <TrendIcon className="w-3.5 h-3.5" />
          <span>{Math.abs(change.value)}% <span className="text-slate-500">from last week</span></span>
        </div>
      )}
    </motion.div>
  );
}