'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  FileText, CheckCircle, AlertTriangle, RefreshCw, 
  Search, Filter, Download, ChevronDown, ChevronUp, 
  MoreVertical, ShieldCheck, MapPin, Image as ImageIcon, X, Loader2
} from 'lucide-react';
import { toast } from 'react-hot-toast';

import { cn, formatRelativeTime } from '@/lib/utils';
import { useRealTime } from '../layout';
import { StatusBadge } from '../components/StatusBadge';
import type { GrievanceCase, GrievanceStatus } from '@/types';

// =============================================================================
// UTILITIES: DEBOUNCE HOOK (Prevents API spam on Search)
// =============================================================================
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

// =============================================================================
// 🚨 SECURE ADMIN API WRAPPERS (Vercel Ready)
// =============================================================================
const getBaseUrl = () => {
  const url = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
  return url.replace('localhost', '127.0.0.1'); 
};

// 🚨 BUG 1 FIXED: Restored proper dual-authentication headers!
const getAuthHeaders = () => {
  const defaultKey = process.env.NEXT_PUBLIC_FRONTEND_API_KEY || 'civiclink_dev_super_secret_998877';
  let token = defaultKey;
  
  if (typeof window !== 'undefined') {
    const localToken = localStorage.getItem('civiclink_admin_token');
    if (localToken) token = localToken;
  }

  return {
    'Authorization': `Bearer ${token}`,
    'X-Frontend-API-Key': defaultKey,
    'Content-Type': 'application/json'
  };
};

const secureAdminFetch = async (endpoint: string) => {
  const res = await fetch(`${getBaseUrl()}/api/v1/admin/${endpoint}`, {
    headers: getAuthHeaders(),
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.statusText}`);
  return res.json();
};

const secureAdminAction = async (threadId: string, decision: 'APPROVED' | 'REJECTED') => {
  const res = await fetch(`${getBaseUrl()}/api/v1/admin/review/${threadId}`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ decision, notes: "Processed via Admin Ledger Bulk/Quick Action" })
  });
  if (!res.ok) throw new Error(`Action failed: ${res.statusText}`);
  return res.json();
};

// =============================================================================
// TYPES
// =============================================================================
interface FilterState {
  status?: GrievanceStatus | '';
  severity?: string;
  dateRange?: string;
}

// =============================================================================
// FILTERS & SEARCH COMPONENT
// =============================================================================
function GrievanceFilters({ 
  filters, 
  searchQuery,
  onFilterChange,
  onSearch,
  onExport
}: {
  filters: FilterState;
  searchQuery: string;
  onFilterChange: (filters: FilterState) => void;
  onSearch: (query: string) => void;
  onExport: () => void;
}) {
  const [showFilters, setShowFilters] = useState(false);
  
  const statusOptions: GrievanceStatus[] = [
    'RECEIVED', 'VERIFYING_IMAGE', 'ROUTING_JURISDICTION', 
    'DISCOVERING_CONTACT', 'DRAFTING_LETTER', 'AWAITING_REVIEW',
    'DISPATCHING', 'DISPATCHED', 'FAILED', 'RESOLVED', 
    'REJECTED_FRAUD', 'ESCALATED'
  ];
  
  const severityOptions = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-5 mb-6"
    >
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="search"
            placeholder="Query tracking ID or category..."
            className="precision-input pl-11 h-11 text-sm w-full"
            value={searchQuery}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn("btn-action py-2.5 text-xs font-bold uppercase tracking-widest px-4", showFilters ? "bg-purple-500/10 text-purple-400 border-purple-500/30" : "bg-white/[0.03] text-slate-300")}
          >
            <Filter className="w-4 h-4 mr-2" />
            Parameters
            {showFilters ? <ChevronUp className="w-4 h-4 ml-2" /> : <ChevronDown className="w-4 h-4 ml-2" />}
          </button>
          
          <button
            onClick={onExport}
            className="btn-action bg-white/[0.03] text-slate-300 py-2.5 text-xs font-bold uppercase tracking-widest px-4"
          >
            <Download className="w-4 h-4 mr-2" />
            Export
          </button>
          
          <button
            onClick={() => { onFilterChange({}); onSearch(''); }}
            className="p-2.5 hover:bg-white/10 rounded-xl transition-colors border border-transparent hover:border-white/10 text-slate-400"
            title="Reset Filters"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>
      
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-5 pt-5 border-t border-white/[0.05]"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Status Node</label>
                <div className="relative">
                  <select
                    className="precision-input appearance-none text-sm cursor-pointer pr-10 w-full"
                    value={filters.status || ''}
                    onChange={(e) => onFilterChange({ ...filters, status: (e.target.value as GrievanceStatus) || '' })}
                  >
                    <option value="">Global Pipeline</option>
                    {statusOptions.map((status) => (
                      <option key={status} value={status}>
                        {status.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                </div>
              </div>
              
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Severity Level</label>
                <div className="relative">
                  <select
                    className="precision-input appearance-none text-sm cursor-pointer pr-10 w-full"
                    value={filters.severity || ''}
                    onChange={(e) => onFilterChange({ ...filters, severity: e.target.value || '' })}
                  >
                    <option value="">All Tiers</option>
                    {severityOptions.map((severity) => (
                      <option key={severity} value={severity}>{severity}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// =============================================================================
// GRIEVANCE TABLE ROW COMPONENT
// =============================================================================
function GrievanceTableRow({ 
  grievance, 
  isSelected,
  onSelect,
  onQuickAction
}: {
  grievance: GrievanceCase;
  isSelected: boolean;
  onSelect: (threadId: string) => void;
  onQuickAction: (action: 'APPROVED' | 'REJECTED', grievance: GrievanceCase) => void;
}) {
  const router = useRouter(); 
  const [showActions, setShowActions] = useState(false);
  
  return (
    <motion.tr
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={cn('table-row group cursor-pointer transition-colors', isSelected ? 'bg-purple-500/[0.05] border-l-2 border-l-purple-500' : 'hover:bg-white/[0.02] border-l-2 border-transparent')}
      onClick={() => router.push(`/admin/review/${grievance.threadId}`)}
    >
      <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onSelect(grievance.threadId)}
          className="w-4 h-4 rounded border-white/20 bg-black/40 text-purple-500 focus:ring-purple-500 focus:ring-offset-0 cursor-pointer transition-colors"
        />
      </td>
      
      <td className="px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-500/10 to-indigo-500/10 flex items-center justify-center border border-white/5 group-hover:border-purple-500/30 transition-colors">
            <FileText className="w-4 h-4 text-purple-400" />
          </div>
          <div>
            <p className="font-mono text-[13px] font-bold text-slate-200 group-hover:text-white transition-colors">
              {grievance.trackingId.slice(0, 12)}...
            </p>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 mt-0.5 truncate max-w-[100px]">{grievance.citizenId?.slice(0,8) || 'ANON_USER'}</p>
          </div>
        </div>
      </td>
      
      <td className="px-6 py-4">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-semibold text-slate-200 capitalize tracking-wide">{grievance.issueCategory?.replace(/_/g, ' ') || 'Triage'}</p>
            {grievance.systemMetadata?.image_hash && (
              <ImageIcon className="w-3.5 h-3.5 text-purple-400 opacity-80" />
            )}
          </div>
          <p className="text-[11px] text-slate-400 line-clamp-1 max-w-[200px] mt-0.5">{grievance.descriptionText}</p>
        </div>
      </td>
      
      <td className="px-6 py-4">
        <span className={cn(
          'px-2 py-0.5 rounded-[4px] text-[10px] font-bold tracking-widest uppercase border',
          grievance.severity === 'CRITICAL' ? 'bg-rose-500/10 text-rose-400 border-rose-500/30 animate-pulse' :
          grievance.severity === 'HIGH' ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' :
          grievance.severity === 'MEDIUM' ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' :
          'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
        )}>
          {grievance.severity}
        </span>
      </td>
      
      <td className="px-6 py-4">
        <StatusBadge status={grievance.status} size="sm" />
      </td>
      
      <td className="px-6 py-4">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-slate-400">
          <MapPin className="w-3.5 h-3.5 flex-shrink-0 text-slate-500" />
          <span className="truncate max-w-[120px]">
            {grievance.systemMetadata?.jurisdiction?.district || 'ROUTING...'}
          </span>
        </div>
      </td>
      
      <td className="px-6 py-4 text-right">
        <span className="text-[11px] font-mono text-slate-400 whitespace-nowrap">
          {formatRelativeTime(grievance.createdAt)}
        </span>
      </td>
      
      <td className="px-6 py-4 text-right">
        <div className="relative inline-block text-left">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowActions(!showActions);
            }}
            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors border border-transparent hover:border-white/10"
          >
            <MoreVertical className="w-4 h-4 text-slate-400" />
          </button>
          
          <AnimatePresence>
            {showActions && (
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                className="absolute right-0 mt-2 w-48 glass-card rounded-xl p-1.5 z-50 shadow-[0_10px_40px_rgba(0,0,0,0.5)] border-white/10"
                onClick={(e) => e.stopPropagation()}
              >
                {grievance.status === 'AWAITING_REVIEW' && (
                  <>
                    <button
                      onClick={() => { onQuickAction('APPROVED', grievance); setShowActions(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-widest text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors"
                    >
                      <CheckCircle className="w-3.5 h-3.5" /> Authorize
                    </button>
                    <button
                      onClick={() => { onQuickAction('REJECTED', grievance); setShowActions(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-widest text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors mb-1"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" /> Halt
                    </button>
                  </>
                )}
                <div className="h-px bg-white/[0.05] my-1 w-full" />
                <button
                  onClick={() => router.push(`/admin/review/${grievance.threadId}`)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-widest text-slate-300 hover:bg-white/5 rounded-lg transition-colors"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-purple-400" /> View Node
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </td>
    </motion.tr>
  );
}

// =============================================================================
// BULK ACTIONS BAR
// =============================================================================
function BulkActionsBar({ 
  selectedCount, 
  onBulkAction,
  onClearSelection
}: {
  selectedCount: number;
  onBulkAction: (action: 'APPROVED' | 'REJECTED' | 'EXPORT') => Promise<void>;
  onClearSelection: () => void;
}) {
  const [isProcessing, setIsProcessing] = useState(false);

  if (selectedCount === 0) return null;
  
  const handleAction = async (action: 'APPROVED' | 'REJECTED' | 'EXPORT') => {
    setIsProcessing(true);
    await onBulkAction(action);
    setIsProcessing(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40 glass-card rounded-2xl p-2.5 shadow-[0_20px_50px_rgba(0,0,0,0.8)] border-purple-500/40 bg-[#0a040d]/95 flex items-center gap-4"
    >
      <div className="px-4 py-1.5 bg-purple-500/10 border border-purple-500/20 rounded-xl flex items-center gap-2">
        <span className="text-sm font-black font-mono text-purple-400">
          {selectedCount}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Targeted</span>
      </div>
      
      <div className="flex items-center gap-2 border-l border-white/10 pl-4">
        <button
          onClick={() => handleAction('APPROVED')}
          disabled={isProcessing}
          className="btn-action bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 py-2 px-4 text-xs tracking-widest uppercase font-bold disabled:opacity-50"
        >
          {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5 mr-2" />}
          Authorize
        </button>
        
        <button
          onClick={() => handleAction('REJECTED')}
          disabled={isProcessing}
          className="btn-action bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20 py-2 px-4 text-xs tracking-widest uppercase font-bold disabled:opacity-50"
        >
          {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5 mr-2" />}
          Halt
        </button>
        
        <button
          onClick={() => handleAction('EXPORT')}
          disabled={isProcessing}
          className="btn-action bg-white/[0.03] border-white/10 text-slate-300 hover:bg-white/[0.08] py-2 px-4 text-xs tracking-widest uppercase font-bold disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5 mr-2" /> Export
        </button>
        
        <button
          onClick={onClearSelection}
          disabled={isProcessing}
          className="ml-2 p-2 hover:bg-white/10 rounded-lg transition-colors text-slate-500 hover:text-white"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
}

// =============================================================================
// PAGINATION COMPONENT
// =============================================================================
function Pagination({ currentPage, totalPages, onPageChange }: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between px-6 py-4 border-t border-white/[0.05] bg-white/[0.01]">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
        Page {currentPage} of {totalPages}
      </span>
      
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          className="p-1.5 bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 rounded-lg transition-colors disabled:opacity-30 text-slate-400"
        >
          <ChevronDown className="w-4 h-4 rotate-90" />
        </button>
        
        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
          let page = currentPage - 2 + i;
          if (currentPage <= 2) page = i + 1;
          if (currentPage >= totalPages - 1) page = totalPages - 4 + i;
          if (page < 1 || page > totalPages) return null;
          
          return (
            <button
              key={page}
              onClick={() => onPageChange(page)}
              className={cn(
                'w-8 h-8 rounded-lg text-xs font-bold font-mono transition-colors border',
                currentPage === page
                  ? 'bg-purple-500/20 text-purple-300 border-purple-500/40 shadow-[0_0_10px_rgba(147,51,234,0.2)]'
                  : 'bg-white/[0.02] border-white/5 text-slate-500 hover:bg-white/[0.05] hover:text-slate-300'
              )}
            >
              {page}
            </button>
          );
        })}
        
        <button
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          className="p-1.5 bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 rounded-lg transition-colors disabled:opacity-30 text-slate-400"
        >
          <ChevronDown className="w-4 h-4 -rotate-90" />
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// MAIN GRIEVANCES PAGE
// =============================================================================
export default function GrievancesPage() {
  const [filters, setFilters] = useState<FilterState>({});
  
  // 🚨 BUG 3 FIXED: Input state separates from backend query state to prevent DDoS
  const [rawSearchQuery, setRawSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(rawSearchQuery, 500);
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;
  
  const queryClient = useQueryClient();
  const { isConnected, subscribe } = useRealTime();
  
  const { data: grievancesResponse, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'grievances', { filters, searchQuery: debouncedSearchQuery, page: currentPage, pageSize }],
    queryFn: () => {
      const q = new URLSearchParams();
      q.append('page', String(currentPage));
      q.append('pageSize', String(pageSize));
      if (debouncedSearchQuery) q.append('search', debouncedSearchQuery);
      if (filters.status) q.append('status', filters.status);
      if (filters.severity) q.append('severity', filters.severity);
      return secureAdminFetch(`grievances?${q.toString()}`);
    },
    refetchInterval: 15000,
  });
  
  const items: GrievanceCase[] = grievancesResponse?.items || [];
  const totalItems = grievancesResponse?.total || 0;
  
  useEffect(() => {
    if (!items.length) return;
    // 🚨 BUG 2 FIXED: Backend SSE emits on `thread_id`, not `trackingId`.
    const subscriptions = items.map((g) => subscribe(g.threadId, () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'grievances'] });
    }));
    return () => subscriptions.forEach(unsub => unsub());
  }, [items, queryClient, subscribe]);
  
  const handleFilterChange = useCallback((newFilters: FilterState) => {
    setFilters(newFilters);
    setCurrentPage(1); 
  }, []);
  
  const handleSearch = useCallback((query: string) => {
    setRawSearchQuery(query);
    setCurrentPage(1);
  }, []);
  
  const handleExport = useCallback(() => {
    toast.success('Export payload assembled', { icon: '📊', style: { background: '#0a040d', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' } });
  }, []);
  
  const handleSelect = useCallback((threadId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  }, []);

  // 🚨 BUG 4 FIXED: Dynamically check if all currently visible items are selected
  const isAllCurrentPageSelected = items.length > 0 && items.every(g => selectedIds.has(g.threadId));
  const handleSelectAll = useCallback((checked: boolean) => {
    if (checked) {
      const newSet = new Set(selectedIds);
      items.forEach(g => newSet.add(g.threadId));
      setSelectedIds(newSet);
    } else {
      const newSet = new Set(selectedIds);
      items.forEach(g => newSet.delete(g.threadId));
      setSelectedIds(newSet);
    }
  }, [items, selectedIds]);
  
  const handleBulkAction = useCallback(async (action: 'APPROVED' | 'REJECTED' | 'EXPORT') => {
    if (action === 'EXPORT') return handleExport();
    
    try {
      await Promise.all(
        Array.from(selectedIds).map(threadId => secureAdminAction(threadId, action))
      );
      
      toast.success(action === 'APPROVED' ? `Authorized ${selectedIds.size} payload(s)` : `Halted ${selectedIds.size} payload(s)`, {
        style: { background: '#0a040d', color: action === 'APPROVED' ? '#10b981' : '#f43f5e', border: `1px solid ${action === 'APPROVED' ? 'rgba(16,185,129,0.3)' : 'rgba(244,63,94,0.3)'}` }
      });
      
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['admin', 'grievances'] });
    } catch (error) {
      toast.error('Bulk Directive Failed');
    }
  }, [selectedIds, queryClient, handleExport]);
  
  const handleQuickAction = useCallback(async (action: 'APPROVED' | 'REJECTED', grievance: GrievanceCase) => {
    try {
      await secureAdminAction(grievance.threadId, action);
      toast.success(action === 'APPROVED' ? 'Directive Authorized' : 'Directive Halted', {
        style: { background: '#0a040d', color: action === 'APPROVED' ? '#10b981' : '#f43f5e', border: `1px solid ${action === 'APPROVED' ? 'rgba(16,185,129,0.3)' : 'rgba(244,63,94,0.3)'}` }
      });
      queryClient.invalidateQueries({ queryKey: ['admin', 'grievances'] });
    } catch (error) {
      toast.error('Action Failed');
    }
  }, [queryClient]);
  
  const totalPages = Math.ceil(totalItems / pageSize) || 1;
  
  return (
    <div className="space-y-6 pb-24 animate-slide-up px-4 md:px-8 max-w-[1600px] mx-auto pt-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white mb-1 flex items-center gap-3">
            <FileText className="w-8 h-8 text-purple-500" />
            Central Ledger
          </h1>
          <div className="flex items-center gap-3 text-[11px] font-mono uppercase tracking-widest text-slate-400 mt-2">
            <span>Global Pipeline Monitoring</span>
            {isConnected && (
              <span className="flex items-center gap-1.5 text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live Stream
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => refetch()}
            disabled={isFetching}
            className="btn-action bg-white/[0.03] border-white/10 text-slate-300 py-2.5 px-4 text-xs tracking-widest uppercase font-bold disabled:opacity-50"
          >
            <RefreshCw className={cn('w-4 h-4 mr-2', isFetching && 'animate-spin text-purple-400')} />
            Synchronize
          </button>
        </div>
      </div>
      
      <GrievanceFilters 
        filters={filters} 
        searchQuery={rawSearchQuery} 
        onFilterChange={handleFilterChange} 
        onSearch={handleSearch} 
        onExport={handleExport} 
      />
      
      {/* Table Container */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto thin-scrollbar">
          <table className="w-full whitespace-nowrap text-left border-collapse">
            <thead>
              <tr className="bg-white/[0.02] border-b border-white/[0.05]">
                <th className="px-6 py-4 w-12">
                  <input
                    type="checkbox"
                    checked={isAllCurrentPageSelected}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className="w-4 h-4 rounded border-white/20 bg-black/40 text-purple-500 focus:ring-purple-500 focus:ring-offset-0 cursor-pointer"
                  />
                </th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Tracking ID</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Payload Data</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Threat Level</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">System Status</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Vector</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">T-Minus</th>
                <th className="px-6 py-4 w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {isLoading ? (
                Array.from({ length: pageSize }).map((_, i) => (
                  <tr key={`skeleton-${i}`} className="bg-white/[0.01]">
                    <td colSpan={8} className="px-6 py-4">
                      <div className="h-8 skeleton rounded-md w-full" />
                    </td>
                  </tr>
                ))
              ) : items.length > 0 ? (
                items.map((grievance) => (
                  <GrievanceTableRow
                    key={grievance.id}
                    grievance={grievance}
                    isSelected={selectedIds.has(grievance.threadId)}
                    onSelect={handleSelect}
                    onQuickAction={handleQuickAction}
                  />
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center justify-center text-slate-500">
                      <Search className="w-10 h-10 mb-4 opacity-30 text-purple-500" />
                      <p className="text-sm font-bold tracking-widest uppercase">No Active Payloads</p>
                      <button onClick={() => { handleFilterChange({}); setRawSearchQuery(''); }} className="mt-2 text-[10px] font-mono text-purple-400 hover:text-rose-400 transition-colors">
                        Clear Search Parameters
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
      </div>
      
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <BulkActionsBar
            selectedCount={selectedIds.size}
            onBulkAction={handleBulkAction}
            onClearSelection={() => setSelectedIds(new Set())}
          />
        )}
      </AnimatePresence>
    </div>
  );
}