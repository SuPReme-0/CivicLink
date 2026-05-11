'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  Users, FileText, CheckCircle, AlertTriangle, Clock, 
  ArrowUpRight, RefreshCw, Search, Activity, ShieldCheck, 
  Loader2, Cpu, Globe, Database, Network, Settings, LogOut, Terminal
} from 'lucide-react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import toast from 'react-hot-toast';

import { cn } from '@/lib/utils';
import { useRealTime } from './layout';
import { MetricCard } from './components/MetricCard';
import { StatusBadge } from './components/StatusBadge';
import { GraphVisualizer } from './components/GraphVisualizer';

// =============================================================================
// 🚨 SECURE FETCH WRAPPERS (Vercel Ready)
// =============================================================================
const getBaseUrl = () => {
  const url = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
  return url.replace('localhost', '127.0.0.1'); 
};

const secureAdminFetch = async (endpoint: string) => {
  const res = await fetch(`${getBaseUrl()}/api/v1/admin/${endpoint}`, {
    headers: {
      'X-Frontend-API-Key': process.env.NEXT_PUBLIC_FRONTEND_API_KEY || 'civiclink_dev_super_secret_998877',
      'Authorization': `Bearer ${process.env.NEXT_PUBLIC_FRONTEND_API_KEY || 'civiclink_dev_super_secret_998877'}`
    },
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.statusText}`);
  return res.json();
};

const secureAdminAction = async (endpoint: string, method: string = 'POST') => {
  const res = await fetch(`${getBaseUrl()}/api/v1/admin/${endpoint}`, {
    method,
    headers: {
      'X-Frontend-API-Key': process.env.NEXT_PUBLIC_FRONTEND_API_KEY || 'civiclink_dev_super_secret_998877',
      'Authorization': `Bearer ${process.env.NEXT_PUBLIC_FRONTEND_API_KEY || 'civiclink_dev_super_secret_998877'}`
    }
  });
  if (!res.ok) throw new Error(`Action failed: ${res.statusText}`);
  return res.json();
};

// =============================================================================
// OPTICAL CHARTS 
// =============================================================================
function ThroughputChart({ data }: { data: any[] }) {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);

  return (
    <div className="glass-card p-6 h-full flex flex-col">
      <div className="mb-6 flex-shrink-0">
        <h3 className="text-sm font-bold tracking-widest uppercase text-slate-200">Grievance Throughput</h3>
        <p className="text-xs text-slate-500 mt-1 font-mono">Processed / Hr</p>
      </div>
      <div className="flex-1 min-h-[200px] w-full">
        {!isMounted ? (
          <div className="w-full h-full skeleton rounded-xl" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="time" stroke="rgba(255,255,255,0.3)" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="rgba(255,255,255,0.3)" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip 
                contentStyle={{ background: 'rgba(10, 4, 13, 0.95)', border: '1px solid rgba(225,29,72,0.3)', borderRadius: '12px', boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }} 
                itemStyle={{ color: '#f8fafc' }}
              />
              <Line 
                type="monotone" 
                dataKey="count" 
                stroke="#e11d48" 
                strokeWidth={3} 
                dot={{ fill: '#0a040d', stroke: '#e11d48', strokeWidth: 2, r: 4 }} 
                activeDot={{ r: 6, fill: '#e11d48', stroke: '#fff', strokeWidth: 2 }} 
              />
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
  const COLORS = ['#10b981', '#0ea5e9', '#f59e0b', '#e11d48', '#9333ea'];

  return (
    <div className="glass-card p-6 h-full flex flex-col">
      <h3 className="text-sm font-bold tracking-widest uppercase text-slate-200 mb-6 flex-shrink-0">Pipeline Distribution</h3>
      <div className="flex-1 min-h-[200px] w-full flex items-center justify-center">
        {!isMounted ? (
          <div className="w-40 h-40 rounded-full skeleton" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie 
                data={data} 
                cx="50%" cy="50%" 
                innerRadius={65} outerRadius={85} 
                paddingAngle={4} 
                dataKey="value"
                stroke="none"
              >
                {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip 
                contentStyle={{ background: 'rgba(10, 4, 13, 0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} 
                itemStyle={{ color: '#f8fafc' }}
              />
              <Legend verticalAlign="bottom" height={36} iconType="circle" formatter={(v) => <span className="text-[11px] font-medium text-slate-300 uppercase tracking-wider">{v}</span>} />
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
function RecentGrievances({ selectedId, onSelect }: { selectedId: string | null, onSelect: (id: string) => void }) {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'grievances', 'dashboard'],
    queryFn: () => secureAdminFetch('grievances?pageSize=6'), 
    refetchInterval: 15000
  });
  
  const queryClient = useQueryClient();
  const { subscribe } = useRealTime();
  const items = data?.items || [];

  useEffect(() => {
    if (!items.length) return;
    const subs = items.map((g: any) => subscribe(g.trackingId, () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'grievances', 'dashboard'] });
    }));
    return () => subs.forEach((unsub: () => void) => unsub());
  }, [items, subscribe, queryClient]);

  return (
    <div className="glass-card p-6 flex flex-col h-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-sm font-bold tracking-widest uppercase text-slate-200">Active Feed</h3>
          <p className="text-xs text-slate-500 mt-1 font-mono">Live Ingestion Stream</p>
        </div>
        <button onClick={() => refetch()} className={cn('p-2 hover:bg-white/10 rounded-lg transition-colors border border-white/[0.05]', isFetching && 'animate-spin text-rose-400 border-rose-400/30')}>
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
      
      <div className="flex-1 space-y-2 overflow-y-auto thin-scrollbar pr-2">
        {isLoading ? Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="p-3"><div className="h-12 skeleton rounded-lg" /></div>
        )) : items.length > 0 ? items.map((g: any) => (
          <button 
            key={g.id} 
            onClick={() => onSelect(g.threadId)} 
            className={cn("w-full block group text-left", selectedId === g.threadId && "ring-1 ring-purple-500/50 rounded-xl")}
          >
            <motion.div
              initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
              className="table-row flex items-center justify-between p-3 rounded-xl bg-white/[0.01] border border-transparent hover:bg-white/[0.03]"
            >
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/10 to-rose-500/10 flex items-center justify-center flex-shrink-0 border border-white/[0.05] group-hover:border-rose-500/30 transition-colors">
                  <FileText className="w-4 h-4 text-purple-400 group-hover:text-rose-400 transition-colors" />
                </div>
                <div className="min-w-0">
                  <p className="font-mono text-sm text-slate-200 truncate group-hover:text-white transition-colors">{g.trackingId}</p>
                  <p className="text-[11px] text-slate-500 truncate capitalize tracking-wide mt-0.5">
                    {g.issueCategory?.replace(/_/g, ' ') || 'Triage'} <span className="mx-1 opacity-50">•</span> {g.severity}
                  </p>
                </div>
              </div>
              <StatusBadge status={g.status} size="sm" />
            </motion.div>
          </button>
        )) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 text-sm font-mono border border-dashed border-white/10 rounded-xl p-8">
            <ShieldCheck className="w-8 h-8 mb-2 opacity-50" />
            Queue is clear
          </div>
        )}
      </div>
      <Link href="/admin/grievances" className="block mt-4 text-center text-xs font-bold uppercase tracking-widest text-purple-400 hover:text-rose-400 transition-colors pt-4 border-t border-white/[0.05]">
        Access Full Ledger <ArrowUpRight className="w-3 h-3 inline mb-0.5" />
      </Link>
    </div>
  );
}

// =============================================================================
// SYSTEM HEALTH WIDGET 
// =============================================================================
function SystemHealth() {
  const { data: health, isLoading } = useQuery({
    queryKey: ['admin', 'system-health'],
    queryFn: async () => {
      const res = await fetch(`${getBaseUrl()}/ready`);
      if (!res.ok) throw new Error('Healthcheck failed');
      return res.json();
    },
    refetchInterval: 30000,
  });

  const isHealthy = health?.status === "healthy";
  const checks = health?.checks || {};

  const services = [
    { name: 'API Gateway', status: isHealthy ? 'operational' : 'degraded', icon: Globe },
    { name: 'Database Core', status: checks.database ? 'operational' : 'offline', icon: Database },
    { name: 'LangGraph Hub', status: checks.langgraph ? 'operational' : 'offline', icon: Cpu },
  ];
  
  return (
    <div className="glass-card p-6">
      <h3 className="text-sm font-bold tracking-widest uppercase text-slate-200 mb-5">System Telemetry</h3>
      <div className="space-y-4">
        {isLoading ? (
          <div className="h-32 skeleton rounded-lg" />
        ) : (
          services.map(s => {
            const Icon = s.icon;
            const isUp = s.status === 'operational';
            return (
              <div key={s.name} className="flex items-center justify-between group">
                <div className="flex items-center gap-3">
                  <Icon className={cn("w-4 h-4", isUp ? "text-slate-400" : "text-rose-400")} />
                  <span className="text-sm font-medium text-slate-300 group-hover:text-white transition-colors">{s.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn('text-[10px] font-mono uppercase tracking-widest', isUp ? 'text-emerald-400' : 'text-rose-400')}>{s.status}</span>
                  <span className={cn("w-2 h-2 rounded-full", isUp ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-rose-500 animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.8)]")} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// =============================================================================
// PENDING HITL WIDGET 
// =============================================================================
function PendingReviews() {
  const { data, isLoading } = useQuery({ 
    queryKey: ['admin', 'pending-reviews'], 
    queryFn: () => secureAdminFetch('grievances?status=AWAITING_REVIEW&pageSize=5'), 
    refetchInterval: 10000 
  });
  
  const queryClient = useQueryClient();
  const pending = data?.items || [];

  const handleAction = async (threadId: string, action: 'APPROVED' | 'REJECTED') => {
    try {
      await secureAdminAction(`review/${threadId}`, 'POST');
      toast.success(`Directive ${action} accepted.`);
      queryClient.invalidateQueries({ queryKey: ['admin', 'pending-reviews'] });
    } catch (e) { 
      toast.error('Directive failed. Target unresponsive.'); 
    }
  };

  return (
    <div className="glass-card p-6 relative overflow-hidden border-rose-500/20">
      {pending.length > 0 && <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-rose-500 to-orange-500 animate-pulse" />}

      <div className="flex items-center justify-between mb-5">
        <h3 className="text-sm font-bold tracking-widest uppercase text-rose-100 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400" /> Pending HITL
        </h3>
        <span className="px-2.5 py-0.5 text-xs font-bold bg-rose-500/20 text-rose-300 rounded-md border border-rose-500/30">
          {pending.length || 0}
        </span>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          <div className="h-32 skeleton rounded-lg" />
        ) : pending.length > 0 ? pending.slice(0, 3).map((g: any) => (
          <div key={g.id} className="p-4 bg-white/[0.02] border border-white/5 rounded-xl hover:border-rose-500/30 transition-colors">
            <div className="flex justify-between items-start mb-3">
              <div className="min-w-0 pr-2">
                <p className="text-sm font-bold font-mono text-white tracking-tight truncate">{g.trackingId?.slice(0, 12)}...</p>
                <p className="text-xs text-slate-400 mt-1 line-clamp-1">{g.descriptionText || 'Awaiting Review'}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => handleAction(g.threadId, 'APPROVED')} className="flex-1 py-2 text-[10px] font-bold tracking-widest uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/20 transition-colors">
                Authorize
              </button>
              <button onClick={() => handleAction(g.threadId, 'REJECTED')} className="flex-1 py-2 text-[10px] font-bold tracking-widest uppercase bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-lg hover:bg-rose-500/20 transition-colors">
                Halt
              </button>
            </div>
          </div>
        )) : (
          <div className="text-center py-8 text-slate-500 text-xs font-mono uppercase tracking-widest border border-dashed border-white/5 rounded-xl">
            No pending authorizations
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// MAIN DASHBOARD PAGE
// =============================================================================
export default function AdminDashboard() {
  const router = useRouter();
  const { isConnected } = useRealTime();
  const [selectedThreadForMonitor, setSelectedThreadForMonitor] = useState<string | null>(null);

  const { data: stats, isLoading: statsLoading, refetch: refetchStats, isFetching } = useQuery({
    queryKey: ['admin', 'dashboard-stats'],
    queryFn: () => secureAdminFetch('dashboard-stats'),
    refetchInterval: 15000,
  });

  const handleLogout = () => {
    localStorage.removeItem('civiclink_admin_token');
    toast.success("Admin Session Terminated.", { style: { background: '#0a040d', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' } });
    router.replace('/');
  };

  const metrics = stats?.metrics || { total: 0, active: 0, resolved: 0, avgTime: '0h' };
  const throughputData = stats?.throughputData || [];
  const statusData = stats?.statusData || [];

  return (
    <div className="space-y-6 pb-12 animate-slide-up px-4 md:px-8 max-w-[1600px] mx-auto pt-6">
      
      {/* --- HEADER --- */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white mb-1">Command Node</h1>
          <div className="flex items-center gap-3 text-xs font-mono uppercase tracking-widest text-slate-400">
            <span>Orchestration Status:</span>
            <span className={cn('flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-black/50 border border-white/5', isConnected ? 'text-emerald-400' : 'text-amber-400')}>
              <span className={cn('w-1.5 h-1.5 rounded-full', isConnected ? 'bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-amber-400')} />
              {isConnected ? 'Uplink Established' : 'Reconnecting...'}
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="relative hidden md:block w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input type="search" placeholder="Query Tracking ID..." className="precision-input pl-10 h-10 text-sm w-full" />
          </div>
          <button 
            onClick={() => refetchStats()} 
            disabled={isFetching}
            className="h-10 w-10 flex items-center justify-center bg-white/[0.03] border border-white/10 rounded-xl hover:bg-white/10 hover:border-white/20 transition-all disabled:opacity-50"
            title="Refresh Telemetry"
          >
            <RefreshCw className={cn("w-4 h-4 text-slate-300", isFetching && "animate-spin text-purple-400")} />
          </button>
          
          {/* 🚨 THE PROFESSIONAL BACK/LOGOUT BUTTON */}
          <button 
            onClick={handleLogout}
            className="flex items-center gap-2 h-10 px-4 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded-xl transition-colors text-[10px] font-bold uppercase tracking-widest text-rose-400 hover:text-rose-300"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Terminate Session</span>
          </button>
        </div>
      </div>

      {/* --- ROW 1: METRICS --- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard title="Total Packets" value={metrics.total.toLocaleString()} loading={statsLoading} icon={FileText} trend="up" />
        <MetricCard title="Active Threads" value={metrics.active.toLocaleString()} loading={statsLoading} icon={Activity} trend="stable" />
        <MetricCard title="Resolved (24h)" value={metrics.resolved.toLocaleString()} loading={statsLoading} icon={CheckCircle} trend="up" />
        <MetricCard title="Avg TTL" value={metrics.avgTime} loading={statsLoading} icon={Clock} trend="up" />
      </div>

      {/* --- ROW 2 & 3: THE 12-COLUMN DATA GRID --- */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column (Spans 8/12) */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-80">
            <ThroughputChart data={throughputData} />
            <StatusPieChart data={statusData} />
          </div>

          <div className="h-[400px]">
            <RecentGrievances selectedId={selectedThreadForMonitor} onSelect={setSelectedThreadForMonitor} />
          </div>
        </div>

        {/* Right Column (Spans 4/12) */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          <PendingReviews />
          <SystemHealth />
          
          {/* 🚨 REPLACED DEAD LINKS WITH ACTUAL PAGES */}
          <div className="glass-card p-6">
            <h3 className="text-sm font-bold tracking-widest uppercase text-slate-200 mb-4">Directories</h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { l: 'Full Ledger', i: Database, href: '/admin/grievances' }, 
                { l: 'Personnel', i: Users, href: '/admin/users' }, 
                { l: 'System Logs', i: Terminal, href: '/admin/audit' },
                { l: 'Settings', i: Settings, href: '/admin/settings' }
              ].map(a => (
                <Link key={a.l} href={a.href} className="flex flex-col items-center justify-center gap-3 p-4 bg-white/[0.02] border border-white/5 rounded-xl hover:border-purple-500/30 hover:bg-purple-500/5 transition-all text-center group">
                  <a.i className="w-5 h-5 text-slate-400 group-hover:text-purple-400 transition-colors" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-300 group-hover:text-white">{a.l}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* --- ROW 4: WORKFLOW VISUALIZER --- */}
      <div className="glass-card p-6 border-purple-500/20 shadow-[0_0_40px_rgba(147,51,234,0.05)] mt-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-sm font-bold tracking-widest uppercase text-slate-200 flex items-center gap-2">
              <Network className="w-4 h-4 text-purple-400" /> LangGraph Telemetry
            </h3>
            <p className="text-xs text-slate-500 mt-1 font-mono">
              {selectedThreadForMonitor ? `Live tracking thread: ${selectedThreadForMonitor.slice(0,15)}...` : "Select a thread from Active Feed to monitor"}
            </p>
          </div>
          {selectedThreadForMonitor && (
             <Link href={`/admin/review/${selectedThreadForMonitor}`} className="btn-action btn-action-primary text-[10px] tracking-widest py-1.5 px-3">
               Open Full Node <ArrowUpRight className="w-3 h-3 ml-1" />
             </Link>
          )}
        </div>
        <div className="h-[400px] w-full rounded-xl overflow-hidden border border-white/5 bg-black/40">
          {selectedThreadForMonitor ? (
            <GraphVisualizer threadId={selectedThreadForMonitor} isPreview={false} onNodeClick={() => {}} />
          ) : (
            <div className="flex items-center justify-center h-full text-slate-500 font-mono text-xs tracking-widest uppercase">
               AWAITING TARGET SELECTION
            </div>
          )}
        </div>
      </div>
    </div>
  );
}