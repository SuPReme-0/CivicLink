// app/(admin)/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  Users, FileText, CheckCircle, AlertTriangle, Clock, TrendingUp,
  ArrowUpRight, RefreshCw, Search, Bell, Activity, ShieldCheck, 
  MapPin, Loader2, Image as ImageIcon
} from 'lucide-react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import toast from 'react-hot-toast';

import { apiClient } from '@/lib/api-client';
import { cn, formatRelativeTime } from '@/lib/utils';
import { useRealTime } from './layout';
import { MetricCard } from './components/MetricCard';
import { StatusBadge } from './components/StatusBadge';
import { GraphVisualizer } from './components/GraphVisualizer';
import type { GrievanceCase, GrievanceStatus } from '@/types';

// =============================================================================
// CHART COMPONENTS (Hydration Safe)
// =============================================================================

function ThroughputChart({ data }: { data: any[] }) {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);

  return (
    <div className="glass-panel rounded-2xl p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold">Grievance Throughput</h3>
          <p className="text-sm text-white/60 mt-1">Cases processed per hour</p>
        </div>
      </div>
      <div className="h-64">
        {!isMounted ? (
          <div className="w-full h-full bg-white/5 rounded-xl animate-pulse" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="time" stroke="rgba(255,255,255,0.5)" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="rgba(255,255,255,0.5)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}`} />
              <Tooltip contentStyle={{ background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '12px' }} />
              <Line type="monotone" dataKey="count" stroke="var(--admin-accent)" strokeWidth={3} dot={{ fill: 'var(--admin-accent)', strokeWidth: 2, r: 4 }} activeDot={{ r: 6, stroke: 'var(--admin-accent)', strokeWidth: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function StatusPieChart({ data }: { data: any[] }) {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);
  const COLORS = ['#22c55e', '#38bdf8', '#f59e0b', '#ef4444', '#8b5cf6'];

  return (
    <div className="glass-panel rounded-2xl p-6">
      <h3 className="text-lg font-semibold mb-4">Pipeline Status</h3>
      <div className="h-64 flex items-center justify-center">
        {!isMounted ? (
          <div className="w-48 h-48 rounded-full bg-white/5 animate-pulse" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={60} outerRadius={85} paddingAngle={3} dataKey="value">
                {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '12px' }} />
              <Legend verticalAlign="bottom" height={36} formatter={(v) => <span className="text-sm text-white/80">{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// RECENT GRIEVANCES WIDGET
// =============================================================================

function RecentGrievances() {
  const { data: grievancesResponse, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'grievances', 'dashboard'],
    // 🚨 FIXED: This endpoint now returns { items: [] }
    queryFn: () => apiClient.fetchGrievances({ pageSize: 5 }), 
    refetchInterval: 30000
  });
  
  const queryClient = useQueryClient();
  const { subscribe } = useRealTime();

  const items = grievancesResponse?.items || [];

  useEffect(() => {
    if (!items.length) return;
    const subs = items.map((g: GrievanceCase) => subscribe(g.trackingId, () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'grievances', 'dashboard'] });
    }));
    return () => subs.forEach(unsub => unsub());
  }, [items, subscribe, queryClient]);

  return (
    <div className="glass-panel rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Live Case Queue</h3>
          <p className="text-sm text-white/60">Most recent incoming grievances</p>
        </div>
        <button onClick={() => refetch()} className={cn('p-2 hover:bg-white/10 rounded-lg transition-colors', isFetching && 'animate-spin')}>
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
      
      <div className="space-y-3">
        {isLoading ? Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="p-3 animate-pulse"><div className="h-12 bg-white/5 rounded-lg" /></div>
        )) : items.map((g: GrievanceCase) => (
          // 🚨 FIXED: Object Mapping Crash resolved.
          <motion.a
            key={g.id}
            href={`/admin/review/${g.trackingId}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between p-3 glass-panel rounded-xl hover:bg-white/5 transition-colors cursor-pointer group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center flex-shrink-0">
                <FileText className="w-5 h-5 text-indigo-400" />
              </div>
              <div className="min-w-0">
                <p className="font-mono text-sm text-[var(--primary)] truncate">{g.trackingId}</p>
                <p className="text-xs text-white/60 truncate capitalize">{g.issueCategory.replace(/_/g, ' ')} • {g.systemMetadata?.jurisdiction?.district || 'Routing...'}</p>
              </div>
            </div>
            <StatusBadge status={g.status} size="sm" />
          </motion.a>
        ))}
      </div>
      <a href="/admin/grievances" className="block mt-4 text-center text-sm text-[var(--admin-accent)] hover:underline">View all grievances →</a>
    </div>
  );
}

// =============================================================================
// SYSTEM HEALTH & HITL WIDGETS
// =============================================================================

function SystemHealth() {
  // 🚨 FIXED: Real API Integration
  const { data: health, isLoading } = useQuery({
    queryKey: ['admin', 'system-health'],
    queryFn: () => apiClient.fetchSystemHealth(),
    refetchInterval: 60000,
  });

  const defaultServices = [
    { name: 'API Gateway', status: 'operational' },
    { name: 'LangGraph Engine', status: 'operational' },
    { name: 'VLM Providers', status: 'operational' },
    { name: 'Database', status: 'operational' },
  ];

  const services = health ? Object.keys(health).map(key => ({
    name: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    status: health[key].status || 'operational'
  })) : defaultServices;
  
  return (
    <div className="glass-panel rounded-2xl p-6">
      <h3 className="text-lg font-semibold mb-4">System Health</h3>
      <div className="space-y-3">
        {isLoading ? (
          <div className="h-24 bg-white/5 rounded-lg animate-pulse" />
        ) : (
          services.map(s => (
            <div key={s.name} className="flex items-center justify-between">
              <span className="text-sm">{s.name}</span>
              <span className={cn('px-2 py-0.5 rounded text-xs font-medium', 
                s.status === 'operational' ? 'bg-green-500/20 text-green-300' : 
                s.status === 'degraded' ? 'bg-yellow-500/20 text-yellow-300' : 
                'bg-red-500/20 text-red-300'
              )}>
                {s.status}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function PendingReviews() {
  const { data: pending, isLoading } = useQuery({ 
    queryKey: ['admin', 'pending'], 
    queryFn: () => apiClient.fetchPendingReviews(), 
    refetchInterval: 10000 
  });
  
  const queryClient = useQueryClient();

  const handleAction = async (id: string, action: 'approve' | 'reject') => {
    try {
      await (action === 'approve' ? apiClient.approveGrievance(id) : apiClient.rejectGrievance(id, 'Admin action'));
      toast.success(`Grievance ${action}d`);
      queryClient.invalidateQueries({ queryKey: ['admin', 'pending'] });
    } catch (e) { 
      toast.error('Action failed'); 
    }
  };

  return (
    <div className="glass-panel rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Pending HITL</h3>
        <span className="px-2 py-0.5 text-xs font-medium bg-orange-500/20 text-orange-300 rounded-full">{pending?.length || 0}</span>
      </div>
      <div className="space-y-3">
        {isLoading ? (
          <div className="h-32 bg-white/5 rounded-lg animate-pulse" />
        ) : pending?.slice(0, 3).map(g => (
          <div key={g.id} className="p-3 glass-panel rounded-xl">
            <div className="flex justify-between items-start mb-2">
              <div>
                <p className="text-sm font-medium font-mono">{g.trackingId.slice(0, 8)}...</p>
                <p className="text-xs text-white/50 line-clamp-1">{g.descriptionText}</p>
              </div>
              <StatusBadge status={g.status as GrievanceStatus} size="sm" showPulse />
            </div>
            <div className="flex gap-2">
              <button onClick={() => handleAction(g.trackingId, 'approve')} className="flex-1 py-1.5 text-xs font-medium bg-green-500/20 text-green-300 rounded hover:bg-green-500/30 transition-colors">Approve</button>
              <button onClick={() => handleAction(g.trackingId, 'reject')} className="flex-1 py-1.5 text-xs font-medium bg-red-500/20 text-red-300 rounded hover:bg-red-500/30 transition-colors">Reject</button>
            </div>
          </div>
        )) || <div className="text-center py-6 text-white/50 text-sm">No pending reviews</div>}
      </div>
      <a href="/admin/grievances?status=AWAITING_REVIEW" className="block mt-4 text-center text-sm text-[var(--admin-accent)] hover:underline">Review queue →</a>
    </div>
  );
}

// =============================================================================
// MAIN DASHBOARD PAGE
// =============================================================================

export default function AdminDashboard() {
  const { isConnected, lastUpdate } = useRealTime();
  
  // 🚨 FIXED: Real API Fetching for Main Dashboard Stats
  const { data: stats, isLoading: statsLoading, refetch: refetchStats, isFetching } = useQuery({
    queryKey: ['admin', 'dashboard-stats'],
    queryFn: () => apiClient.fetchDashboardStats(),
    refetchInterval: 15000,
  });

  const metrics = stats?.metrics || {
    total: 0, active: 0, resolved: 0, avgTime: '0h'
  };

  const throughputData = stats?.throughputData || [];
  const statusData = stats?.statusData || [];

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Mission Control</h1>
          <p className="text-white/60 mt-1 flex items-center">
            Real-time orchestration & monitoring
            <span className={cn('ml-2 flex items-center gap-1', isConnected ? 'text-green-400' : 'text-yellow-400')}>
              <span className={cn('w-2 h-2 rounded-full', isConnected ? 'bg-green-400 animate-pulse' : 'bg-yellow-400')} />
              {isConnected ? `Live` : 'Reconnecting...'}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative hidden sm:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <input type="search" placeholder="Search tracking IDs..." className="glass-input pl-10 w-64" />
          </div>
          <button 
            onClick={() => refetchStats()} 
            disabled={isFetching}
            className="p-2.5 hover:bg-white/10 rounded-lg relative transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("w-5 h-5", isFetching && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Total Grievances" value={metrics.total.toLocaleString()} loading={statsLoading} icon={FileText} trend="up" />
        <MetricCard title="Active Cases" value={metrics.active} loading={statsLoading} icon={Clock} trend="stable" />
        <MetricCard title="Resolved Today" value={metrics.resolved} loading={statsLoading} icon={CheckCircle} trend="up" />
        <MetricCard title="Avg Resolution" value={metrics.avgTime} loading={statsLoading} icon={TrendingUp} trend="up" />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ThroughputChart data={throughputData} />
            <StatusPieChart data={statusData} />
          </div>
          <RecentGrievances />
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <SystemHealth />
          <PendingReviews />
          
          <div className="glass-panel rounded-2xl p-6">
            <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
            <div className="grid grid-cols-2 gap-3">
              {[{l:'Broadcast', i: Bell, href: '#'}, {l:'Export Report', i: FileText, href: '#'}, {l:'Users', i: Users, href: '/admin/users'}, {l:'Audit', i: Activity, href: '/admin/audit'}].map(a => (
                <a key={a.l} href={a.href} className="flex flex-col items-center gap-2 p-4 glass-panel rounded-xl hover:bg-white/5 transition-colors text-center">
                  <a.i className="w-5 h-5 text-[var(--admin-accent)]" />
                  <span className="text-xs font-medium">{a.l}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Live Workflow Preview */}
      <div className="glass-panel rounded-2xl p-6 border border-indigo-500/20 shadow-[0_0_30px_rgba(99,102,241,0.05)]">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Activity className="w-5 h-5 text-indigo-400" />
              Live Workflow Visualization
            </h3>
            <p className="text-sm text-white/60 mt-1">Real-time LangGraph execution for active grievances</p>
          </div>
          <a href="/admin/review/demo-thread-123" className="text-sm text-[var(--admin-accent)] hover:underline flex items-center gap-1">
            Open Full View <ArrowUpRight className="w-4 h-4" />
          </a>
        </div>
        <div className="h-80">
          <GraphVisualizer threadId="demo-thread-123" isPreview={true} onNodeClick={() => {}} />
        </div>
      </div>
    </div>
  );
}