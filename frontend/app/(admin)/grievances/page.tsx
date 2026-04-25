// app/(admin)/grievances/page.tsx
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  FileText, CheckCircle, AlertTriangle, Clock, RefreshCw, 
  Search, Filter, Download, ChevronDown, ChevronUp, 
  MoreVertical, Mail, ShieldCheck, MapPin, Image as ImageIcon, X
} from 'lucide-react';
import { toast } from 'react-hot-toast';

import { apiClient } from '@/lib/api-client';
import { cn, formatRelativeTime } from '@/lib/utils';
import { useRealTime } from '../layout';
import { StatusBadge } from '../components/StatusBadge';
import type { GrievanceCase, GrievanceStatus } from '@/types';

// =============================================================================
// TYPES
// =============================================================================

interface FilterState {
  status?: GrievanceStatus | '';
  severity?: string;
  dateRange?: string;
  search?: string;
}

// =============================================================================
// FILTERS & SEARCH COMPONENT
// =============================================================================

function GrievanceFilters({ 
  filters, 
  onFilterChange,
  onSearch,
  onExport
}: {
  filters: FilterState;
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
      className="glass-panel rounded-2xl p-4 mb-6"
    >
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
          <input
            type="search"
            placeholder="Search tracking ID or citizen..."
            className="glass-input pl-10 w-full"
            value={filters.search || ''}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
        
        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 px-4 py-2 glass-btn glass-btn-outline text-sm"
          >
            <Filter className="w-4 h-4" />
            Filters
            {showFilters ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          
          <button
            onClick={onExport}
            className="flex items-center gap-2 px-4 py-2 glass-btn glass-btn-outline text-sm"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
          
          <button
            onClick={() => onFilterChange({})}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            title="Clear filters"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>
      
      {/* Expanded Filters */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 pt-4 border-t border-white/10"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Status Filter */}
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1">Status</label>
                <select
                  className="glass-input w-full"
                  value={filters.status || ''}
                  onChange={(e) => onFilterChange({ ...filters, status: (e.target.value as GrievanceStatus) || '' })}
                >
                  <option value="">All Statuses</option>
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
              
              {/* Severity Filter */}
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1">Severity</label>
                <select
                  className="glass-input w-full"
                  value={filters.severity || ''}
                  onChange={(e) => onFilterChange({ ...filters, severity: e.target.value || '' })}
                >
                  <option value="">All Severities</option>
                  {severityOptions.map((severity) => (
                    <option key={severity} value={severity}>
                      {severity}
                    </option>
                  ))}
                </select>
              </div>
              
              {/* Date Range Filter */}
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1">Date Range</label>
                <select
                  className="glass-input w-full"
                  value={filters.dateRange || ''}
                  onChange={(e) => onFilterChange({ ...filters, dateRange: e.target.value || '' })}
                >
                  <option value="">All Time</option>
                  <option value="today">Today</option>
                  <option value="week">This Week</option>
                  <option value="month">This Month</option>
                  <option value="year">This Year</option>
                </select>
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
  onSelect: (trackingId: string) => void;
  onQuickAction: (action: 'approve' | 'reject', grievance: GrievanceCase) => void;
}) {
  const [showActions, setShowActions] = useState(false);
  
  return (
    <motion.tr
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={cn(
        'border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer',
        isSelected && 'bg-white/10'
      )}
      onClick={() => window.location.href = `/admin/review/${grievance.trackingId}`}
    >
      {/* Checkbox */}
      <td className="px-4 py-4">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => {
            e.stopPropagation();
            // 🚨 FIX: Using trackingId instead of internal DB id
            onSelect(grievance.trackingId);
          }}
          className="rounded border-white/20 bg-black/20 text-[var(--admin-accent)] focus:ring-[var(--admin-accent)] focus:ring-offset-0"
          onClick={(e) => e.stopPropagation()}
        />
      </td>
      
      {/* Tracking ID */}
      <td className="px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center">
            <FileText className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <p className="font-mono text-sm text-[var(--primary)]">
              {grievance.trackingId.slice(0, 12)}...
            </p>
            <p className="text-xs text-white/40 truncate max-w-[100px]">{grievance.citizenId}</p>
          </div>
        </div>
      </td>
      
      {/* Issue */}
      <td className="px-4 py-4">
        <div>
          <p className="text-sm font-medium capitalize">{grievance.issueCategory.replace(/_/g, ' ')}</p>
          <p className="text-xs text-white/60 line-clamp-1 max-w-[200px]">{grievance.descriptionText}</p>
        </div>
      </td>
      
      {/* Severity */}
      <td className="px-4 py-4">
        <span className={cn(
          'px-2 py-0.5 rounded text-xs font-medium',
          grievance.severity === 'CRITICAL' ? 'bg-red-500/20 text-red-300' :
          grievance.severity === 'HIGH' ? 'bg-orange-500/20 text-orange-300' :
          grievance.severity === 'MEDIUM' ? 'bg-yellow-500/20 text-yellow-300' :
          'bg-green-500/20 text-green-300'
        )}>
          {grievance.severity}
        </span>
      </td>
      
      {/* Status */}
      <td className="px-4 py-4">
        <StatusBadge status={grievance.status} />
      </td>
      
      {/* Location */}
      <td className="px-4 py-4">
        <div className="flex items-center gap-2 text-sm text-white/60">
          <MapPin className="w-4 h-4 flex-shrink-0" />
          <span className="truncate max-w-[120px]">
            {grievance.systemMetadata?.jurisdiction?.district || 'Unknown'}
          </span>
        </div>
      </td>
      
      {/* Attachments */}
      <td className="px-4 py-4">
        <div className="flex items-center gap-2">
          {grievance.systemMetadata?.image_hash && (
            <span title="Image Attached">
              <ImageIcon className="w-4 h-4 text-white/40" />
            </span>
          )}
          {grievance.systemMetadata?.has_voice && (
            <span className="text-xs text-white/40" title="Voice Note Attached">🎤</span>
          )}
        </div>
      </td>
      
      {/* Time */}
      <td className="px-4 py-4 text-right">
        <span className="text-sm text-white/60 whitespace-nowrap">
          {formatRelativeTime(grievance.createdAt)}
        </span>
      </td>
      
      {/* Actions */}
      <td className="px-4 py-4 text-right">
        <div className="relative inline-block text-left">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowActions(!showActions);
            }}
            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
          
          <AnimatePresence>
            {showActions && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="absolute right-0 mt-2 w-48 glass-panel rounded-xl py-1 z-10 shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                {grievance.status === 'AWAITING_REVIEW' && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onQuickAction('approve', grievance);
                        setShowActions(false);
                      }}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-white/5 transition-colors"
                    >
                      <CheckCircle className="w-4 h-4 text-green-400" />
                      Approve
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onQuickAction('reject', grievance);
                        setShowActions(false);
                      }}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-white/5 transition-colors"
                    >
                      <AlertTriangle className="w-4 h-4 text-red-400" />
                      Reject
                    </button>
                  </  >
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    window.location.href = `/admin/review/${grievance.trackingId}`;
                    setShowActions(false);
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-white/5 transition-colors"
                >
                  <ShieldCheck className="w-4 h-4 text-[var(--admin-accent)]" />
                  View Full Case
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
  onBulkAction: (action: 'approve' | 'reject' | 'export') => void;
  onClearSelection: () => void;
}) {
  if (selectedCount === 0) return null;
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 glass-panel rounded-2xl p-3 shadow-[0_10px_40px_rgba(0,0,0,0.5)] border-[var(--admin-accent)]/30"
    >
      <div className="flex items-center gap-4">
        <div className="px-3 py-1 bg-white/10 rounded-lg">
          <span className="text-sm font-bold text-[var(--admin-accent)]">
            {selectedCount}
          </span>
          <span className="text-sm font-medium ml-1">selected</span>
        </div>
        <div className="flex items-center gap-2 border-l border-white/10 pl-4">
          <button
            onClick={() => onBulkAction('approve')}
            className="flex items-center gap-2 px-3 py-1.5 glass-btn glass-btn-admin text-sm"
          >
            <CheckCircle className="w-4 h-4" />
            Approve All
          </button>
          <button
            onClick={() => onBulkAction('reject')}
            className="flex items-center gap-2 px-3 py-1.5 glass-btn glass-btn-outline border-red-500/30 text-red-300 text-sm hover:bg-red-500/10"
          >
            <AlertTriangle className="w-4 h-4" />
            Reject All
          </button>
          <button
            onClick={() => onBulkAction('export')}
            className="flex items-center gap-2 px-3 py-1.5 glass-btn glass-btn-outline text-sm"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          <button
            onClick={onClearSelection}
            className="ml-2 p-1.5 hover:bg-white/10 rounded-lg transition-colors text-white/60 hover:text-white"
            title="Clear selection"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// =============================================================================
// PAGINATION COMPONENT
// =============================================================================

function Pagination({ 
  currentPage, 
  totalPages, 
  onPageChange 
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  // 🚨 FIX: Hide pagination if there's only 1 page
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between mt-6 pt-4 border-t border-white/10">
      <span className="text-sm text-white/60">
        Page {currentPage} of {totalPages}
      </span>
      
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
        >
          <ChevronDown className="w-4 h-4 rotate-90" />
        </button>
        
        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
          let page = currentPage - 2 + i;
          // Boundary checks for the 5-page window
          if (currentPage <= 2) page = i + 1;
          if (currentPage >= totalPages - 1) page = totalPages - 4 + i;
          
          if (page < 1 || page > totalPages) return null;
          
          return (
            <button
              key={page}
              onClick={() => onPageChange(page)}
              className={cn(
                'w-8 h-8 rounded-lg text-sm font-medium transition-colors',
                currentPage === page
                  ? 'bg-[var(--admin-accent)] text-black'
                  : 'hover:bg-white/10'
              )}
            >
              {page}
            </button>
          );
        })}
        
        <button
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
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
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  
  const queryClient = useQueryClient();
  const { isConnected, subscribe } = useRealTime();
  
  // 🚨 FIXED: Calls proper paginated endpoint
  const { data: grievancesResponse, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'grievances', { filters, searchQuery, page: currentPage, pageSize }],
    queryFn: () => apiClient.fetchGrievances({
      ...filters,
      search: searchQuery,
      page: currentPage,
      pageSize,
    }),
    refetchInterval: 30000,
  });
  
  // Safely extract items and total
  const items: GrievanceCase[] = grievancesResponse?.items || [];
  const totalItems = grievancesResponse?.total || 0;
  
  // Real-time subscription for visible grievances
  useEffect(() => {
    if (!items.length) return;
    
    const subscriptions = items.map((g) => {
      const unsubscribe = subscribe(g.trackingId, () => {
        // Invalidate to fetch fresh data
        queryClient.invalidateQueries({ queryKey: ['admin', 'grievances'] });
      });
      return unsubscribe;
    });
    
    return () => subscriptions.forEach(unsub => unsub());
  }, [items, queryClient, subscribe]);
  
  const handleFilterChange = useCallback((newFilters: FilterState) => {
    setFilters(newFilters);
    setCurrentPage(1); 
  }, []);
  
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    setFilters(prev => ({ ...prev, search: query }));
    setCurrentPage(1);
  }, []);
  
  const handleExport = useCallback(() => {
    toast('Exporting CSV...', { icon: '📊' });
    // Production: Trigger actual CSV download via API
  }, []);
  
  const handleSelect = useCallback((trackingId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(trackingId)) next.delete(trackingId);
      else next.add(trackingId);
      return next;
    });
  }, []);
  
  const handleBulkAction = useCallback(async (action: 'approve' | 'reject' | 'export') => {
    if (action === 'export') {
      handleExport();
      return;
    }
    
    try {
      if (action === 'approve') {
        await Promise.all(
          Array.from(selectedIds).map(trackingId => apiClient.approveGrievance(trackingId))
        );
        toast.success(`${selectedIds.size} grievances approved`);
      } else {
        await Promise.all(
          Array.from(selectedIds).map(trackingId => apiClient.rejectGrievance(trackingId, 'Bulk rejection'))
        );
        toast.success(`${selectedIds.size} grievances rejected`);
      }
      
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['admin', 'grievances'] });
    } catch (error) {
      toast.error(`Bulk action failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [selectedIds, queryClient, handleExport]);
  
  const handleQuickAction = useCallback(async (action: 'approve' | 'reject', grievance: GrievanceCase) => {
    try {
      if (action === 'approve') {
        await apiClient.approveGrievance(grievance.trackingId);
        toast.success(`Approved ${grievance.trackingId}`);
      } else {
        await apiClient.rejectGrievance(grievance.trackingId, 'Admin rejection');
        toast.success(`Rejected ${grievance.trackingId}`);
      }
      queryClient.invalidateQueries({ queryKey: ['admin', 'grievances'] });
    } catch (error) {
      toast.error(`Action failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [queryClient]);
  
  const totalPages = Math.ceil(totalItems / pageSize);
  
  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Grievance Management</h1>
          <p className="text-white/60 mt-1">
            Manage and monitor all citizen grievances
            {isConnected && (
              <span className="ml-2 text-green-400">• Live updates enabled</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => refetch()}
            className={cn(
              'glass-btn glass-btn-outline px-4 py-2 text-sm',
              isFetching && 'opacity-50 cursor-wait'
            )}
            disabled={isFetching}
          >
            <RefreshCw className={cn('w-4 h-4 mr-2', isFetching && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>
      
      {/* Filters */}
      <GrievanceFilters
        filters={filters}
        onFilterChange={handleFilterChange}
        onSearch={handleSearch}
        onExport={handleExport}
      />
      
      {/* Table */}
      <div className="glass-panel rounded-2xl overflow-hidden shadow-lg">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full whitespace-nowrap">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-4 py-3 text-left w-12">
                  <input
                    type="checkbox"
                    // 🚨 FIX: Strict length check to prevent "Checked" state when empty
                    checked={items.length > 0 && selectedIds.size === items.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(new Set(items.map(g => g.trackingId)));
                      } else {
                        setSelectedIds(new Set());
                      }
                    }}
                    className="rounded border-white/20 bg-black/20 text-[var(--admin-accent)] focus:ring-[var(--admin-accent)] focus:ring-offset-0"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-white/60 uppercase tracking-wider">Tracking ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-white/60 uppercase tracking-wider">Issue Details</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-white/60 uppercase tracking-wider">Severity</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-white/60 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-white/60 uppercase tracking-wider">Location</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-white/60 uppercase tracking-wider">Media</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-white/60 uppercase tracking-wider">Time</th>
                <th className="px-4 py-3 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: pageSize }).map((_, i) => (
                  <tr key={`skeleton-${i}`} className="border-b border-white/5">
                    {Array.from({ length: 9 }).map((_, j) => (
                      <td key={j} className="px-4 py-4">
                        <div className="h-4 bg-white/10 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : items.length ? (
                items.map((grievance) => (
                  <GrievanceTableRow
                    key={grievance.id}
                    grievance={grievance}
                    isSelected={selectedIds.has(grievance.trackingId)}
                    onSelect={handleSelect}
                    onQuickAction={handleQuickAction}
                  />
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center justify-center text-white/60">
                      <Search className="w-8 h-8 mb-3 opacity-20" />
                      <p>No grievances found matching your filters.</p>
                      <button 
                        onClick={() => handleFilterChange({})}
                        className="mt-3 text-[var(--admin-accent)] hover:underline text-sm"
                      >
                        Clear all filters
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination */}
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />
      </div>
      
      {/* Bulk Actions Bar */}
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