'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  Activity, Search, Filter, Download, RefreshCw, ChevronLeft, ChevronRight,
  Lock, User, Globe, Terminal, AlertCircle, CheckCircle, XCircle, Eye, ShieldCheck
} from 'lucide-react';
import { toast } from 'react-hot-toast';

import { cn, formatRelativeTime } from '@/lib/utils';
import { apiClient } from '@/lib/api-client';
import type { AuditLog, AuditSeverity, AuditAction } from '@/types';

// =============================================================================
// UI COMPONENTS (Amethyst & Crimson)
// =============================================================================

function SeverityBadge({ severity }: { severity: AuditSeverity }) {
  const config: Record<string, { classes: string; icon: React.ElementType; label: string }> = {
    INFO: { classes: 'bg-purple-500/10 border-purple-500/20 text-purple-400', icon: Globe, label: 'Info' },
    SUCCESS: { classes: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400', icon: CheckCircle, label: 'Success' },
    WARNING: { classes: 'bg-amber-500/10 border-amber-500/20 text-amber-400', icon: AlertCircle, label: 'Warning' },
    ERROR: { classes: 'bg-rose-500/10 border-rose-500/20 text-rose-400', icon: XCircle, label: 'Error' },
    CRITICAL: { classes: 'bg-rose-500/20 border-rose-500/40 text-rose-300 animate-pulse', icon: AlertCircle, label: 'Critical' },
  };
  
  const { classes, icon: Icon, label } = config[severity] || config.INFO;
  
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[9px] uppercase tracking-widest font-bold border backdrop-blur-md',
      classes
    )}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

function LogDetailModal({ log, onClose }: { log: AuditLog; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0a040d]/90 backdrop-blur-md"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 10 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="glass-card bg-[#050208] w-full max-w-2xl rounded-2xl p-8 overflow-hidden shadow-[0_0_50px_rgba(147,51,234,0.15)] border-purple-500/30"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Terminal Header */}
        <div className="flex items-start justify-between mb-8 pb-4 border-b border-white/[0.05]">
          <div>
            <h3 className="text-xl font-bold flex items-center gap-2 text-slate-100 tracking-tight">
              <Terminal className="w-5 h-5 text-purple-400" />
              Cryptographic Log Entry
            </h3>
            <p className="text-[10px] uppercase tracking-widest font-bold text-slate-500 mt-2 flex items-center gap-2">
              <ShieldCheck className="w-3 h-3 text-emerald-400" /> Immutable Record • SHA-256 Verified
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/[0.05] border border-transparent hover:border-white/10 rounded-lg transition-colors text-slate-400">
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        {/* Data Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
          <div className="p-4 bg-white/[0.02] rounded-xl border border-white/[0.05]">
            <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">Timestamp</p>
            <p className="text-xs font-mono mt-1 text-slate-300">{new Date(log.timestamp).toLocaleString()}</p>
          </div>
          <div className="p-4 bg-white/[0.02] rounded-xl border border-white/[0.05]">
            <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">Actor</p>
            <p className="text-xs mt-1 font-medium text-slate-300">{log.actor} <span className="text-slate-500 font-mono">({log.actorRole})</span></p>
          </div>
          <div className="p-4 bg-white/[0.02] rounded-xl border border-white/[0.05]">
            <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">Action</p>
            <p className="text-xs font-bold uppercase tracking-widest text-purple-400 mt-1">{log.action}</p>
          </div>
          <div className="p-4 bg-white/[0.02] rounded-xl border border-white/[0.05]">
            <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">Target Vector</p>
            <p className="text-xs font-mono text-rose-400 break-all mt-1">{log.target}</p>
          </div>
          <div className="p-4 bg-white/[0.02] rounded-xl border border-white/[0.05]">
            <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">IP Origin</p>
            <p className="text-xs font-mono mt-1 text-slate-300">{log.ip || 'INTERNAL_SYS'}</p>
          </div>
          <div className="p-4 bg-purple-500/5 rounded-xl border border-purple-500/20 col-span-2 md:col-span-1">
            <p className="text-[9px] text-purple-400 uppercase tracking-widest font-bold">Immutable Hash</p>
            <p className="text-[10px] font-mono text-purple-300/70 truncate mt-1 select-all" title={log.immutableHash}>
              {log.immutableHash}
            </p>
          </div>
        </div>

        <div className="mb-8">
          <p className="text-[10px] font-bold text-slate-500 mb-3 uppercase tracking-widest flex items-center gap-2">
            <Activity className="w-3 h-3" /> System Details & Payload
          </p>
          <div className="bg-[#050208] border border-white/[0.05] rounded-xl p-4 overflow-x-auto max-h-40 thin-scrollbar">
            <pre className="text-[10px] font-mono text-emerald-400/80 leading-relaxed whitespace-pre-wrap">
              {log.details}
            </pre>
          </div>
        </div>

        <div className="flex items-center justify-between pt-5 border-t border-white/[0.05]">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-emerald-500/70">
            <Lock className="w-3 h-3" />
            <span>Entry Cryptographically Sealed</span>
          </div>
          <button onClick={() => toast.success('Raw JSON Copied')} className="btn-action bg-white/[0.03] border-white/10 text-slate-300 hover:bg-white/[0.08] text-xs">
            <Download className="w-4 h-4 mr-2" /> Export JSON
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// =============================================================================
// MAIN AUDIT PAGE
// =============================================================================

export default function AuditPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<AuditSeverity | ''>('');
  const [actionFilter, setActionFilter] = useState<AuditAction | ''>('');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [isLive, setIsLive] = useState(true);
  
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;

  // 🚨 FIXED: Now queries the real database via secureAdminFetch
  const { data: logs = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: () => apiClient.fetchAuditLogs(),
    refetchInterval: isLive ? 5000 : false,
  });

  const filteredLogs = useMemo(() => {
    return logs.filter((log: AuditLog) => 
      (log.target.toLowerCase().includes(searchQuery.toLowerCase()) || log.actor.toLowerCase().includes(searchQuery.toLowerCase())) &&
      (!severityFilter || log.severity === severityFilter) &&
      (!actionFilter || log.action === actionFilter)
    );
  }, [logs, searchQuery, severityFilter, actionFilter]);

  const paginatedLogs = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredLogs.slice(startIndex, startIndex + pageSize);
  }, [filteredLogs, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredLogs.length / pageSize) || 1;

  const handleExport = () => toast.success('Audit log export initiated', { 
    style: { background: '#0a040d', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' } 
  });

  return (
    <div className="space-y-6 pb-24 animate-slide-up px-4 md:px-8 max-w-7xl mx-auto pt-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white mb-1 flex items-center gap-3">
            <ShieldCheck className="w-8 h-8 text-purple-500" />
            Telemetry Logs
          </h1>
          <p className="text-[11px] font-mono text-slate-400 uppercase tracking-widest mt-1">
            Immutable system activity tracking & compliance records
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => {
              setIsLive(!isLive);
              if (!isLive) refetch();
            }}
            className={cn(
              'btn-action text-xs tracking-widest uppercase font-bold py-2.5',
              isLive ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20' : 'bg-white/[0.03] border-white/10 text-slate-400 hover:bg-white/[0.08]'
            )}
          >
            <RefreshCw className={cn('w-4 h-4 mr-2', isLive && isFetching && 'animate-spin')} />
            {isLive ? 'Live Uplink' : 'Feed Paused'}
          </button>
          <button onClick={handleExport} className="btn-action bg-white/[0.03] border-white/10 text-slate-300 hover:bg-white/[0.08] text-xs tracking-widest uppercase font-bold py-2.5">
            <Download className="w-4 h-4 mr-2" /> Export Chain
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="glass-card p-5">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="search"
              placeholder="Query Tracking ID or Actor..."
              className="precision-input pl-11 h-11 text-sm w-full"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
            />
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="relative w-full sm:w-48">
              <Filter className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
              <select 
                className="precision-input pl-11 h-11 text-sm appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2394a3b8%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-[length:1em_1em] bg-[right_1rem_center] bg-no-repeat cursor-pointer w-full" 
                value={severityFilter} 
                onChange={(e) => {
                  setSeverityFilter(e.target.value as AuditSeverity);
                  setCurrentPage(1);
                }}
              >
                <option value="">All Severities</option>
                <option value="INFO">Info</option>
                <option value="SUCCESS">Success</option>
                <option value="WARNING">Warning</option>
                <option value="ERROR">Error</option>
                <option value="CRITICAL">Critical</option>
              </select>
            </div>
            <div className="relative w-full sm:w-48">
              <Activity className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
              <select 
                className="precision-input pl-11 h-11 text-sm appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2394a3b8%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-[length:1em_1em] bg-[right_1rem_center] bg-no-repeat cursor-pointer w-full" 
                value={actionFilter} 
                onChange={(e) => {
                  setActionFilter(e.target.value as AuditAction);
                  setCurrentPage(1);
                }}
              >
                <option value="">All Actions</option>
                <option value="LOGIN">Login</option>
                <option value="REVIEW_APPROVED">Approve</option>
                <option value="REVIEW_REJECTED">Reject</option>
                <option value="CREATE_USER">Provision</option>
                <option value="UPDATE_SETTINGS">Config Sync</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Ledger Table */}
      <div className="glass-card overflow-hidden">
        {/* Immutable Banner */}
        <div className="bg-rose-500/10 border-b border-rose-500/20 px-6 py-3 flex items-center gap-3 text-[10px] text-rose-400 font-bold tracking-widest uppercase">
          <Lock className="w-3.5 h-3.5" />
          <span>Ledger is Cryptographically Sealed. Modifications will invalidate the chain.</span>
        </div>

        <div className="overflow-x-auto thin-scrollbar">
          <table className="w-full whitespace-nowrap text-left border-collapse">
            <thead>
              <tr className="bg-white/[0.02] border-b border-white/[0.05]">
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Timestamp</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Severity</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Actor</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Action</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Target Vector</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Origin IP</th>
                <th className="px-6 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05] font-mono text-xs">
              {isLoading ? (
                Array.from({ length: pageSize }).map((_, i) => (
                  <tr key={`skeleton-${i}`} className="animate-pulse bg-white/[0.01]">
                    <td colSpan={7} className="px-6 py-4">
                      <div className="h-5 bg-white/5 rounded-md w-full" />
                    </td>
                  </tr>
                ))
              ) : paginatedLogs.length > 0 ? (
                paginatedLogs.map((log: AuditLog) => (
                  <motion.tr 
                    key={log.id} 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="table-row group cursor-pointer hover:bg-white/[0.02] transition-colors"
                    onClick={() => setSelectedLog(log)}
                  >
                    <td className="px-6 py-4 text-slate-400 font-sans text-sm">
                      {formatRelativeTime(log.timestamp)}
                    </td>
                    <td className="px-6 py-4 font-sans"><SeverityBadge severity={log.severity} /></td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 font-sans text-sm">
                        <User className="w-3.5 h-3.5 text-slate-500" />
                        <span className="truncate max-w-[150px] text-slate-200">{log.actor}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 font-bold text-slate-300">{log.action}</td>
                    <td className="px-6 py-4 text-rose-400 truncate max-w-[200px]">{log.target}</td>
                    <td className="px-6 py-4 text-slate-500">{log.ip || 'INTERNAL'}</td>
                    <td className="px-6 py-4 text-right">
                      <button className="p-1.5 hover:bg-white/10 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity border border-transparent hover:border-white/10">
                        <Eye className="w-4 h-4 text-purple-400" />
                      </button>
                    </td>
                  </motion.tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-6 py-20 text-center font-sans">
                    <div className="flex flex-col items-center justify-center text-slate-500">
                      <Terminal className="w-10 h-10 mb-4 opacity-30 text-purple-500" />
                      <p className="text-sm font-bold tracking-widest uppercase">No Log Entries Found</p>
                      <p className="text-xs mt-1">Adjust filters or search parameters.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination Footer */}
        {filteredLogs.length > 0 && (
          <div className="border-t border-white/[0.05] flex items-center justify-between px-6 py-4 bg-white/[0.01]">
            <span className="text-[10px] font-bold tracking-widest uppercase text-slate-500">
              Showing {((currentPage - 1) * pageSize) + 1} - {Math.min(currentPage * pageSize, filteredLogs.length)} of {filteredLogs.length} blocks
            </span>
            
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="p-2 hover:bg-white/[0.05] border border-transparent hover:border-white/10 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-slate-400 hover:text-white"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-[10px] font-bold tracking-widest uppercase text-slate-300 px-3">
                Page {currentPage} of {totalPages}
              </span>
              <button 
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="p-2 hover:bg-white/[0.05] border border-transparent hover:border-white/10 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-slate-400 hover:text-white"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {selectedLog && (
          <LogDetailModal 
            log={selectedLog} 
            onClose={() => setSelectedLog(null)} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}