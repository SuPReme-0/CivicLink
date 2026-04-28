// app/(admin)/audit/page.tsx
'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { 
  Activity, Search, Filter, Download, RefreshCw, ChevronLeft, ChevronRight,
  Lock, User, Globe, Terminal, AlertCircle, CheckCircle, XCircle, Clock, Eye
} from 'lucide-react';
import { toast } from 'react-hot-toast';

import { apiClient } from '@/lib/api-client';
import { cn, formatRelativeTime } from '@/lib/utils';
import { useRealTime } from '../layout';

// =============================================================================
// TYPES
// =============================================================================

type AuditSeverity = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR' | 'CRITICAL';
type AuditAction = 'LOGIN' | 'APPROVE' | 'REJECT' | 'ESCALATE' | 'SYSTEM_ERROR' | 'DATA_EXPORT' | 'ROLE_CHANGE';

interface AuditLog {
  id: string;
  timestamp: string;
  actor: string;
  actorRole: string;
  action: AuditAction;
  severity: AuditSeverity;
  target: string;
  details: string;
  ip: string;
  userAgent: string;
  immutableHash: string;
}

// =============================================================================
// UI COMPONENTS
// =============================================================================

function SeverityBadge({ severity }: { severity: AuditSeverity }) {
  const config: Record<AuditSeverity, { color: string; icon: React.ElementType; label: string }> = {
    INFO: { color: 'blue', icon: Globe, label: 'Info' },
    SUCCESS: { color: 'green', icon: CheckCircle, label: 'Success' },
    WARNING: { color: 'amber', icon: AlertCircle, label: 'Warning' },
    ERROR: { color: 'red', icon: XCircle, label: 'Error' },
    CRITICAL: { color: 'rose', icon: AlertCircle, label: 'Critical' },
  };
  
  const { color, icon: Icon, label } = config[severity] || config.INFO;
  
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border',
      `bg-${color}-500/10 border-${color}-500/30 text-${color}-300`
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="glass-panel w-full max-w-2xl rounded-2xl p-6 overflow-hidden shadow-2xl border-indigo-500/20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-6">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Terminal className="w-5 h-5 text-[var(--admin-accent)]" />
              Log Entry Details
            </h3>
            <p className="text-sm text-white/60 mt-1">Immutable record • SHA-256 verified</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors">
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          <div className="p-3 bg-black/20 rounded-lg border border-white/5">
            <p className="text-xs text-white/60 uppercase tracking-wider font-semibold">Timestamp</p>
            <p className="text-sm font-mono mt-1">{new Date(log.timestamp).toLocaleString()}</p>
          </div>
          <div className="p-3 bg-black/20 rounded-lg border border-white/5">
            <p className="text-xs text-white/60 uppercase tracking-wider font-semibold">Actor</p>
            <p className="text-sm mt-1">{log.actor} <span className="text-white/40">({log.actorRole})</span></p>
          </div>
          <div className="p-3 bg-black/20 rounded-lg border border-white/5">
            <p className="text-xs text-white/60 uppercase tracking-wider font-semibold">Action</p>
            <p className="text-sm font-medium mt-1">{log.action}</p>
          </div>
          <div className="p-3 bg-black/20 rounded-lg border border-white/5">
            <p className="text-xs text-white/60 uppercase tracking-wider font-semibold">Target</p>
            <p className="text-sm font-mono text-[var(--primary)] break-all mt-1">{log.target}</p>
          </div>
          <div className="p-3 bg-black/20 rounded-lg border border-white/5">
            <p className="text-xs text-white/60 uppercase tracking-wider font-semibold">IP Address</p>
            <p className="text-sm font-mono mt-1">{log.ip}</p>
          </div>
          <div className="p-3 bg-black/20 rounded-lg border border-white/5">
            <p className="text-xs text-white/60 uppercase tracking-wider font-semibold">Immutable Hash</p>
            <p className="text-xs font-mono text-white/40 truncate mt-1" title={log.immutableHash}>
              {log.immutableHash}
            </p>
          </div>
        </div>

        <div className="mb-6">
          <p className="text-xs font-medium text-white/60 mb-2 uppercase tracking-wider">System Details & Payload</p>
          <pre className="text-xs bg-black/40 rounded-lg p-4 overflow-x-auto max-h-40 border border-white/10 font-mono text-green-300 custom-scrollbar">
            {log.details}
          </pre>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-white/10">
          <div className="flex items-center gap-2 text-xs text-green-400/70">
            <Lock className="w-3 h-3" />
            <span>Entry is cryptographically sealed</span>
          </div>
          <button className="glass-btn glass-btn-outline text-sm py-2">
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
  
  // 🚨 FIX: Added actual pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;

  // 🚨 FIX: Removed hydration-crashing mock array. Let React Query handle fetching.
  const { data: logs = [], isLoading, refetch } = useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: () => apiClient.fetchAuditLogs(),
    refetchInterval: isLive ? 5000 : false,
  });

  const filteredLogs = useMemo(() => {
    const filtered = logs.filter((log: AuditLog) => 
      (log.target.toLowerCase().includes(searchQuery.toLowerCase()) || log.actor.toLowerCase().includes(searchQuery.toLowerCase())) &&
      (!severityFilter || log.severity === severityFilter) &&
      (!actionFilter || log.action === actionFilter)
    );
    return filtered;
  }, [logs, searchQuery, severityFilter, actionFilter]);

  // 🚨 FIX: Slice the array for client-side pagination to prevent browser freezing
  const paginatedLogs = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredLogs.slice(startIndex, startIndex + pageSize);
  }, [filteredLogs, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredLogs.length / pageSize);

  const handleExport = () => toast.success('Audit log export initiated', { icon: '📊' });

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="w-6 h-6 text-[var(--admin-accent)]" />
            System Audit Logs
          </h1>
          <p className="text-white/60 mt-1">Immutable system activity tracking & compliance records</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => {
              setIsLive(!isLive);
              if (!isLive) refetch();
            }}
            className={cn(
              'glass-btn glass-btn-outline text-sm transition-colors',
              isLive && 'bg-green-500/10 border-green-500/30 text-green-400'
            )}
          >
            <RefreshCw className={cn('w-4 h-4 mr-2', isLive && 'animate-spin')} />
            {isLive ? 'Live Feed' : 'Paused'}
          </button>
          <button onClick={handleExport} className="glass-btn glass-btn-admin text-sm">
            <Download className="w-4 h-4 mr-2" /> Export Logs
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="glass-panel rounded-2xl p-4 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <input
              type="search"
              placeholder="Search by tracking ID or actor..."
              className="glass-input pl-10 w-full"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1); // Reset page on search
              }}
            />
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Filter className="w-4 h-4 text-white/40" />
              <select 
                className="glass-input w-full sm:w-auto" 
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
            <select 
              className="glass-input w-full sm:w-auto" 
              value={actionFilter} 
              onChange={(e) => {
                setActionFilter(e.target.value as AuditAction);
                setCurrentPage(1);
              }}
            >
              <option value="">All Actions</option>
              <option value="LOGIN">Login</option>
              <option value="APPROVE">Approve</option>
              <option value="REJECT">Reject</option>
              <option value="ESCALATE">Escalate</option>
              <option value="SYSTEM_ERROR">System Error</option>
              <option value="DATA_EXPORT">Export</option>
              <option value="ROLE_CHANGE">Role Change</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="glass-panel rounded-2xl overflow-hidden border border-red-500/20 shadow-[0_10px_30px_rgba(239,68,68,0.05)]">
        {/* Immutable Banner */}
        <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2.5 flex items-center gap-2 text-xs text-red-300 font-medium tracking-wide">
          <Lock className="w-3.5 h-3.5" />
          <span>ENTRIES ARE CRYPTOGRAPHICALLY SEALED AND READ-ONLY. MODIFICATIONS WILL INVALIDATE THE CHAIN.</span>
        </div>

        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full whitespace-nowrap">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-4 py-4 text-left text-xs font-semibold text-white/60 uppercase tracking-wider">Timestamp</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-white/60 uppercase tracking-wider">Severity</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-white/60 uppercase tracking-wider">Actor</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-white/60 uppercase tracking-wider">Action</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-white/60 uppercase tracking-wider">Target ID</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-white/60 uppercase tracking-wider">IP Origin</th>
                <th className="px-4 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-mono text-sm">
              {isLoading ? (
                Array.from({ length: pageSize }).map((_, i) => (
                  <tr key={`skeleton-${i}`} className="animate-pulse bg-white/[0.01]">
                    <td colSpan={7} className="px-4 py-4">
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
                    className="hover:bg-white/5 transition-colors cursor-pointer group"
                    onClick={() => setSelectedLog(log)}
                  >
                    <td className="px-4 py-3.5 text-white/70">
                      {formatRelativeTime(log.timestamp)}
                    </td>
                    <td className="px-4 py-3.5 font-sans"><SeverityBadge severity={log.severity} /></td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2 font-sans">
                        <User className="w-3.5 h-3.5 text-white/40" />
                        <span className="truncate max-w-[150px]">{log.actor}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 font-semibold text-white/80">{log.action}</td>
                    <td className="px-4 py-3.5 text-[var(--primary)]">{log.target}</td>
                    <td className="px-4 py-3.5 text-white/40">{log.ip}</td>
                    <td className="px-4 py-3.5 text-right">
                      <button className="p-1.5 hover:bg-white/10 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                        <Eye className="w-4 h-4 text-indigo-400" />
                      </button>
                    </td>
                  </motion.tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center font-sans">
                    <div className="flex flex-col items-center justify-center text-white/50">
                      <Terminal className="w-8 h-8 mb-3 opacity-20" />
                      <p>No audit logs matching your filters.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination Footer */}
        {filteredLogs.length > 0 && (
          <div className="pt-4 border-t border-white/10 flex items-center justify-between text-sm text-white/60 px-6 pb-4 bg-white/[0.02]">
            <span>Showing {((currentPage - 1) * pageSize) + 1} - {Math.min(currentPage * pageSize, filteredLogs.length)} of {filteredLogs.length} entries</span>
            
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="p-1.5 hover:bg-white/10 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="font-medium px-2">Page {currentPage} of {totalPages}</span>
              <button 
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 hover:bg-white/10 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 🚨 FIX: Proper AnimatePresence placement for Modal exit animations */}
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