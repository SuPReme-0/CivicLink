'use client';

import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Users, Plus, Search, Mail, Clock, Edit2, Trash2, 
  ShieldCheck, ShieldAlert, Shield, UserCheck, UserX,
  Loader2, X, CheckCircle, AlertTriangle, ChevronDown, ChevronRight, ChevronLeft, KeyRound,
  Fingerprint, Activity, ShieldBan, Globe
} from 'lucide-react';
import { toast } from 'react-hot-toast';

import { cn, formatRelativeTime } from '@/lib/utils';
import { apiClient } from '@/lib/api-client';
import type { AdminUser, UserRole, UserStatus } from '@/types';

// =============================================================================
// UI COMPONENTS (Amethyst & Crimson)
// =============================================================================

function RoleBadge({ role }: { role: UserRole }) {
  const config: Record<UserRole, { classes: string; icon: React.ElementType; label: string }> = {
    SUPER_ADMIN: { classes: 'bg-rose-500/10 border-rose-500/30 text-rose-400', icon: ShieldAlert, label: 'Super Admin' },
    ADMIN: { classes: 'bg-purple-500/10 border-purple-500/30 text-purple-400', icon: Shield, label: 'Admin' },
    REVIEWER: { classes: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400', icon: CheckCircle, label: 'Reviewer' },
    AUDITOR: { classes: 'bg-amber-500/10 border-amber-500/30 text-amber-400', icon: ShieldCheck, label: 'Auditor' },
    SUPPORT: { classes: 'bg-slate-500/10 border-slate-500/30 text-slate-300', icon: UserCheck, label: 'Support' },
  };
  const { classes, icon: Icon, label } = config[role] || config.SUPPORT;
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[9px] uppercase tracking-widest font-bold border backdrop-blur-sm', classes)}>
      <Icon className="w-3 h-3" /> {label}
    </span>
  );
}

function StatusBadge({ status }: { status: UserStatus }) {
  const config: Record<UserStatus, { classes: string; dotClass: string; label: string }> = {
    ACTIVE: { classes: 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400', dotClass: 'bg-emerald-400', label: 'Active' },
    INACTIVE: { classes: 'bg-slate-500/10 border-slate-500/20 text-slate-400', dotClass: 'bg-slate-500', label: 'Inactive' },
    SUSPENDED: { classes: 'bg-rose-500/10 border-rose-500/30 text-rose-400', dotClass: 'bg-rose-500', label: 'Suspended' },
  };
  const { classes, dotClass, label } = config[status] || config.INACTIVE;
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[9px] uppercase tracking-widest font-bold border backdrop-blur-sm', classes)}>
      <span className={cn('w-1.5 h-1.5 rounded-full', dotClass)} /> {label}
    </span>
  );
}

function TrustScoreBadge({ score }: { score: number }) {
  const isHigh = score >= 0.8;
  const isMedium = score >= 0.5 && score < 0.8;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 w-16 bg-white/10 rounded-full overflow-hidden">
        <div 
          className={cn("h-full rounded-full transition-all duration-1000", isHigh ? "bg-emerald-400" : isMedium ? "bg-amber-400" : "bg-rose-400")}
          style={{ width: `${Math.max(10, score * 100)}%` }}
        />
      </div>
      <span className={cn("text-[10px] font-mono font-bold tracking-widest", isHigh ? "text-emerald-400" : isMedium ? "text-amber-400" : "text-rose-400")}>
        {(score * 100).toFixed(0)}%
      </span>
    </div>
  );
}

// =============================================================================
// ADD/EDIT ADMIN MODAL
// =============================================================================

function UserModal({ isOpen, onClose, onSubmit, isLoading, initialData }: { isOpen: boolean; onClose: () => void; onSubmit: (data: any) => void; isLoading: boolean; initialData?: AdminUser | null; }) {
  const [formData, setFormData] = useState({
    name: initialData?.name || '',
    email: initialData?.email || '',
    role: initialData?.role || 'REVIEWER' as UserRole,
    status: initialData?.status || 'ACTIVE' as UserStatus,
    password: '',
  });

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0a040d]/90 backdrop-blur-md" onClick={onClose}>
        <motion.div initial={{ scale: 0.95, opacity: 0, y: 10 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 10 }} className="glass-card bg-[#050208] w-full max-w-md rounded-2xl p-8 shadow-[0_0_50px_rgba(147,51,234,0.15)] border-purple-500/30" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-8 pb-4 border-b border-white/[0.05]">
            <div>
              <h3 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-purple-400" />
                {initialData ? 'Modify Personnel' : 'Provision User'}
              </h3>
              <p className="text-[10px] uppercase tracking-widest font-bold text-slate-500 mt-1">Configure Access Control Layer</p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/[0.05] border border-transparent hover:border-white/10 rounded-lg transition-colors text-slate-400"><X className="w-5 h-5" /></button>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); onSubmit(formData); }} className="space-y-5">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-widest">Full Designation</label>
              <input type="text" required className="precision-input w-full font-mono text-sm" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g., Arjun Mehta" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-widest">Secure Endpoint (Email)</label>
              <input type="email" required className="precision-input w-full font-mono text-sm" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder="user@civiclink.in" />
            </div>
            {!initialData && (
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-widest flex items-center gap-2"><KeyRound className="w-3 h-3 text-purple-400" /> Temporary Passkey</label>
                <input type="password" required={!initialData} className="precision-input w-full font-mono text-sm" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} placeholder="••••••••" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-widest">Access Role</label>
                <div className="relative">
                  <select className="precision-input w-full appearance-none pr-8 cursor-pointer text-sm" value={formData.role} onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })}>
                    <option value="SUPER_ADMIN" className="bg-[#050208]">Super Admin</option>
                    <option value="ADMIN" className="bg-[#050208]">Admin</option>
                    <option value="REVIEWER" className="bg-[#050208]">Reviewer</option>
                    <option value="AUDITOR" className="bg-[#050208]">Auditor</option>
                    <option value="SUPPORT" className="bg-[#050208]">Support</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-widest">System Status</label>
                <div className="relative">
                  <select className="precision-input w-full appearance-none pr-8 cursor-pointer text-sm" value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value as UserStatus })}>
                    <option value="ACTIVE" className="bg-[#050208]">Active</option>
                    <option value="INACTIVE" className="bg-[#050208]">Inactive</option>
                    <option value="SUSPENDED" className="bg-[#050208]">Suspended</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 pt-6 border-t border-white/[0.05] mt-8">
              <button type="button" onClick={onClose} className="flex-1 btn-action bg-white/[0.03] border-white/10 text-slate-300 hover:bg-white/[0.08] justify-center py-3 text-xs tracking-widest">Abort</button>
              <button type="submit" disabled={isLoading} className={cn('flex-1 btn-action justify-center py-3 text-xs tracking-widest shadow-lg', initialData ? 'bg-purple-500/20 text-purple-300 border-purple-500/40 hover:bg-purple-500/30' : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30', isLoading && 'opacity-50 cursor-wait')}>
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : initialData ? 'Commit Modification' : 'Provision Identity'}
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// =============================================================================
// MAIN USERS PAGE
// =============================================================================

export default function IdentityManagementPage() {
  const [activeTab, setActiveTab] = useState<'personnel' | 'citizens'>('personnel');
  
  // Shared States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  
  // Personnel Specific States
  const [roleFilter, setRoleFilter] = useState<UserRole | ''>('');
  const [statusFilter, setStatusFilter] = useState<UserStatus | ''>('');
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);

  // Citizen Specific States
  const [citizenStatusFilter, setCitizenStatusFilter] = useState<'ALL' | 'ACTIVE' | 'BANNED'>('ALL');
  
  const queryClient = useQueryClient();

  // Reset pagination & selection when switching tabs
  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
    setSearchQuery('');
  }, [activeTab]);

  // --- QUERIES ---
  const { data: admins = [], isLoading: isLoadingAdmins } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => apiClient.fetchUsers(),
    enabled: activeTab === 'personnel',
    refetchInterval: 60000,
  });

  const { data: citizens = [], isLoading: isLoadingCitizens } = useQuery({
    queryKey: ['admin', 'citizens'],
    queryFn: () => apiClient.fetchCitizens(),
    enabled: activeTab === 'citizens',
    refetchInterval: 30000,
  });

  const isLoading = activeTab === 'personnel' ? isLoadingAdmins : isLoadingCitizens;

  // --- MUTATIONS ---
  const handleCreateUser = useMutation({
    mutationFn: (data: any) => apiClient.createUser(data),
    onSuccess: () => {
      toast.success('Personnel ledger updated', { style: { background: '#0a040d', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' } });
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      setShowModal(false);
    },
    onError: (e: Error) => toast.error(`Provision failed: ${e.message}`, { style: { background: '#0a040d', color: '#e11d48', border: '1px solid rgba(225,29,72,0.3)' } }),
  });

  const handleBulkAction = async (action: string) => {
    try {
      await new Promise(resolve => setTimeout(resolve, 800)); // Simulate backend call for now
      toast.success(`${selectedIds.size} identities ${action}d (Backend sync required)`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['admin', activeTab === 'personnel' ? 'users' : 'citizens'] });
    } catch {
      toast.error('Bulk modification failed');
    }
  };

  // --- DATA PROCESSING ---
  const filteredData = useMemo(() => {
    if (activeTab === 'personnel') {
      return admins.filter((u: AdminUser) => 
        (u.name.toLowerCase().includes(searchQuery.toLowerCase()) || u.email.includes(searchQuery)) &&
        (!roleFilter || u.role === roleFilter) &&
        (!statusFilter || u.status === statusFilter)
      );
    } else {
      return citizens.filter((c: any) => 
        (c.username.toLowerCase().includes(searchQuery.toLowerCase()) || c.phoneHash.includes(searchQuery)) &&
        (citizenStatusFilter === 'ALL' || (citizenStatusFilter === 'BANNED' ? c.isBanned : !c.isBanned))
      );
    }
  }, [activeTab, admins, citizens, searchQuery, roleFilter, statusFilter, citizenStatusFilter]);

  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredData.slice(startIndex, startIndex + pageSize);
  }, [filteredData, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredData.length / pageSize) || 1;

  const handleSelectAll = (checked: boolean) => {
    if (checked) setSelectedIds(new Set(paginatedData.map((u: any) => u.id)));
    else setSelectedIds(new Set());
  };

  return (
    <div className="space-y-6 pb-24 animate-slide-up px-4 md:px-8 max-w-7xl mx-auto pt-6">
      
      {/* Header & Tabs */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-2">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white mb-1 flex items-center gap-3">
            <Users className="w-8 h-8 text-purple-500" />
            Identity Management
          </h1>
          <p className="text-[11px] font-mono text-slate-400 uppercase tracking-widest mt-1">
            Global roster of personnel and citizen nodes
          </p>
        </div>
        {activeTab === 'personnel' && (
          <button 
            onClick={() => { setEditingUser(null); setShowModal(true); }}
            className="btn-action bg-purple-500/20 text-purple-300 border-purple-500/40 hover:bg-purple-500/30 py-2.5 px-6 text-xs tracking-widest uppercase font-bold shadow-lg"
          >
            <Plus className="w-4 h-4 mr-2" /> Provision User
          </button>
        )}
      </div>

      {/* Tab Switcher */}
      <div className="bg-[#050208] border border-white/[0.05] rounded-2xl p-1.5 flex gap-1 w-fit mb-8">
        <button
          onClick={() => setActiveTab('personnel')}
          className={cn('flex items-center gap-2 px-6 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all', activeTab === 'personnel' ? 'bg-purple-500/10 border border-purple-500/20 text-purple-400 shadow-[0_0_15px_rgba(147,51,234,0.1)]' : 'border border-transparent hover:bg-white/[0.02] text-slate-500 hover:text-slate-300')}
        >
          <ShieldCheck className="w-3.5 h-3.5" /> Internal Personnel
        </button>
        <button
          onClick={() => setActiveTab('citizens')}
          className={cn('flex items-center gap-2 px-6 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all', activeTab === 'citizens' ? 'bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.1)]' : 'border border-transparent hover:bg-white/[0.02] text-slate-500 hover:text-slate-300')}
        >
          <Globe className="w-3.5 h-3.5" /> Citizen Network
        </button>
      </div>

      {/* Filters */}
      <div className="glass-card p-5">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="search"
              placeholder={activeTab === 'personnel' ? "Query Admin Name or Email..." : "Query Public Username or Hash..."}
              className="precision-input pl-11 h-11 text-sm w-full"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            />
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-3">
            {activeTab === 'personnel' ? (
              <>
                <div className="relative w-full sm:w-48">
                  <select className="precision-input h-11 text-sm appearance-none cursor-pointer pr-10 w-full" value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value as UserRole); setCurrentPage(1); }}>
                    <option value="">Global Roles</option>
                    <option value="SUPER_ADMIN">Super Admin</option>
                    <option value="ADMIN">Admin</option>
                    <option value="REVIEWER">Reviewer</option>
                    <option value="AUDITOR">Auditor</option>
                    <option value="SUPPORT">Support</option>
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                </div>
                <div className="relative w-full sm:w-48">
                  <select className="precision-input h-11 text-sm appearance-none cursor-pointer pr-10 w-full" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as UserStatus); setCurrentPage(1); }}>
                    <option value="">All Statuses</option>
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                    <option value="SUSPENDED">Suspended</option>
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                </div>
              </>
            ) : (
              <div className="relative w-full sm:w-48">
                <select className="precision-input h-11 text-sm appearance-none cursor-pointer pr-10 w-full" value={citizenStatusFilter} onChange={(e) => { setCitizenStatusFilter(e.target.value as any); setCurrentPage(1); }}>
                  <option value="ALL">All Identities</option>
                  <option value="ACTIVE">Active</option>
                  <option value="BANNED">Blacklisted</option>
                </select>
                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Table Area */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto thin-scrollbar">
          <table className="w-full whitespace-nowrap text-left border-collapse">
            <thead>
              <tr className="bg-white/[0.02] border-b border-white/[0.05]">
                <th className="px-6 py-4 w-12">
                  <input type="checkbox" checked={paginatedData.length > 0 && selectedIds.size === paginatedData.length} onChange={(e) => handleSelectAll(e.target.checked)} className="w-4 h-4 rounded border-white/20 bg-black/40 text-purple-500 focus:ring-purple-500 focus:ring-offset-0 cursor-pointer transition-colors" />
                </th>
                
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  {activeTab === 'personnel' ? 'Identity Node' : 'Public Identity'}
                </th>
                
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  {activeTab === 'personnel' ? 'Clearance Level' : 'Network Status'}
                </th>
                
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  {activeTab === 'personnel' ? 'System Status' : 'Trust Score'}
                </th>
                
                {activeTab === 'personnel' ? (
                  <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Ledger Volume</th>
                ) : (
                  <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">LangGraph Workflows</th>
                )}
                
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Last Uplink</th>
                <th className="px-6 py-4 w-24"></th>
              </tr>
            </thead>
            
            <tbody className="divide-y divide-white/[0.05]">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="bg-white/[0.01]"><td colSpan={7} className="px-6 py-4"><div className="h-10 skeleton rounded-md w-full" /></td></tr>
                ))
              ) : paginatedData.length ? (
                paginatedData.map((user: any) => (
                  <motion.tr 
                    key={user.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className={cn('table-row group', selectedIds.has(user.id) && 'bg-purple-500/[0.02] border-l-2 border-l-purple-500')}
                  >
                    <td className="px-6 py-4">
                      <input type="checkbox" checked={selectedIds.has(user.id)} onChange={(e) => { const newSet = new Set(selectedIds); if (e.target.checked) newSet.add(user.id); else newSet.delete(user.id); setSelectedIds(newSet); }} className="w-4 h-4 rounded border-white/20 bg-black/40 text-purple-500 cursor-pointer" />
                    </td>
                    
                    {/* Identity Column */}
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center border border-white/5 transition-colors", activeTab === 'personnel' ? "bg-gradient-to-br from-purple-500/10 to-rose-500/10 text-purple-400 font-black font-mono group-hover:border-purple-500/30" : "bg-gradient-to-br from-indigo-500/10 to-cyan-500/10 group-hover:border-indigo-500/30")}>
                          {activeTab === 'personnel' ? user.name.charAt(0) : <Fingerprint className="w-5 h-5 text-indigo-400" />}
                        </div>
                        <div>
                          <p className="font-bold text-sm text-slate-200 group-hover:text-white transition-colors">{user.name || user.username}</p>
                          <p className={cn("text-[10px] font-mono text-slate-500 flex items-center gap-1.5 mt-0.5", activeTab === 'citizens' && "max-w-[150px] truncate")}>
                            {activeTab === 'personnel' ? <><Mail className="w-3 h-3 text-slate-600" /> {user.email}</> : user.phoneHash}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Role / Network Status Column */}
                    <td className="px-6 py-4">
                      {activeTab === 'personnel' ? <RoleBadge role={user.role} /> : (
                        user.isBanned ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[9px] uppercase tracking-widest font-bold bg-rose-500/10 border border-rose-500/30 text-rose-400"><ShieldBan className="w-3 h-3" /> Blacklisted</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[9px] uppercase tracking-widest font-bold bg-emerald-500/5 border border-emerald-500/20 text-emerald-400"><ShieldCheck className="w-3 h-3" /> Active</span>
                        )
                      )}
                    </td>

                    {/* Status / Trust Score Column */}
                    <td className="px-6 py-4">
                      {activeTab === 'personnel' ? <StatusBadge status={user.status} /> : <TrustScoreBadge score={user.trustScore} />}
                    </td>

                    {/* Volume Column */}
                    <td className="px-6 py-4 text-xs font-mono text-slate-500">
                      {activeTab === 'personnel' ? `${user.actionsCount} Blocks` : (
                        <div className="flex items-center gap-2">
                          <Activity className="w-4 h-4 text-indigo-400 opacity-50" />
                          <span className="text-sm font-black text-indigo-300">{user.workflowCount}</span>
                          <span className="text-[9px] uppercase tracking-widest text-slate-500 font-sans">Payloads</span>
                        </div>
                      )}
                    </td>

                    {/* Timestamp Column */}
                    <td className="px-6 py-4 text-sm text-slate-400 font-sans">
                      <div className="flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5 text-slate-500" /> 
                        {formatRelativeTime(activeTab === 'personnel' ? user.lastLogin : user.lastActive)}
                      </div>
                    </td>

                    {/* Actions Column */}
                    <td className="px-6 py-4 text-right">
                      {activeTab === 'personnel' && (
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => { setEditingUser(user); setShowModal(true); }} className="p-2 hover:bg-purple-500/20 rounded-lg transition-colors border border-transparent hover:border-purple-500/30" title="Modify Clearance">
                            <Edit2 className="w-4 h-4 text-purple-400" />
                          </button>
                          <button className="p-2 hover:bg-rose-500/20 rounded-lg transition-colors border border-transparent hover:border-rose-500/30" title="Terminate Identity">
                            <Trash2 className="w-4 h-4 text-rose-400" />
                          </button>
                        </div>
                      )}
                    </td>
                  </motion.tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center justify-center text-slate-500">
                      <UserX className="w-10 h-10 mb-4 opacity-30 text-purple-500" />
                      <p className="text-sm font-bold tracking-widest uppercase">Identity Not Found</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {filteredData.length > 0 && (
          <div className="border-t border-white/[0.05] flex items-center justify-between px-6 py-4 bg-white/[0.01]">
            <span className="text-[10px] font-bold tracking-widest uppercase text-slate-500">
              Showing {((currentPage - 1) * pageSize) + 1} - {Math.min(currentPage * pageSize, filteredData.length)} of {filteredData.length} Nodes
            </span>
            <div className="flex items-center gap-2">
              <button onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1} className="p-2 hover:bg-white/[0.05] border border-transparent hover:border-white/10 rounded-lg disabled:opacity-30 transition-colors text-slate-400 hover:text-white"><ChevronLeft className="w-4 h-4" /></button>
              <span className="text-[10px] font-bold tracking-widest uppercase text-slate-300 px-3">Page {currentPage} of {totalPages}</span>
              <button onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages} className="p-2 hover:bg-white/[0.05] border border-transparent hover:border-white/10 rounded-lg disabled:opacity-30 transition-colors text-slate-400 hover:text-white"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}
      </div>

      {/* Bulk Actions Bar */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40 glass-card rounded-2xl p-2.5 shadow-[0_20px_50px_rgba(0,0,0,0.8)] border-purple-500/40 bg-[#0a040d]/95 flex items-center gap-4"
          >
            <div className="px-4 py-1.5 bg-purple-500/10 border border-purple-500/20 rounded-xl flex items-center gap-2">
              <span className="text-sm font-black font-mono text-purple-400">{selectedIds.size}</span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Targeted</span>
            </div>
            
            <div className="flex items-center gap-2 border-l border-white/10 pl-4">
              {activeTab === 'personnel' ? (
                <>
                  <button onClick={() => handleBulkAction('activate')} className="btn-action bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 py-2 px-4 text-xs tracking-widest uppercase font-bold"><CheckCircle className="w-3.5 h-3.5 mr-2" /> Activate</button>
                  <button onClick={() => handleBulkAction('suspend')} className="btn-action bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20 py-2 px-4 text-xs tracking-widest uppercase font-bold"><AlertTriangle className="w-3.5 h-3.5 mr-2" /> Suspend</button>
                  <button onClick={() => handleBulkAction('delete')} className="btn-action bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20 py-2 px-4 text-xs tracking-widest uppercase font-bold"><Trash2 className="w-3.5 h-3.5 mr-2" /> Terminate</button>
                </>
              ) : (
                <>
                  <button onClick={() => handleBulkAction('unban')} className="btn-action bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 py-2 px-4 text-xs tracking-widest uppercase font-bold"><ShieldCheck className="w-3.5 h-3.5 mr-2" /> Restore Access</button>
                  <button onClick={() => handleBulkAction('ban')} className="btn-action bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20 py-2 px-4 text-xs tracking-widest uppercase font-bold"><ShieldBan className="w-3.5 h-3.5 mr-2" /> Blacklist</button>
                </>
              )}
              <button onClick={() => setSelectedIds(new Set())} className="ml-2 p-2 hover:bg-white/10 rounded-lg text-slate-500 hover:text-white transition-colors"><X className="w-4 h-4" /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Modal (Personnel Only) */}
      {showModal && (
        <UserModal 
          isOpen={showModal} onClose={() => setShowModal(false)} 
          onSubmit={(data) => handleCreateUser.mutate(data)}
          isLoading={handleCreateUser.isPending} initialData={editingUser}
        />
      )}
    </div>
  );
}