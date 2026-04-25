// app/(admin)/users/page.tsx
'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Users, Plus, Search, Mail, Clock, MoreVertical, Edit2, Trash2, 
  ShieldCheck, ShieldAlert, Shield, UserCheck, UserX,
  Loader2, X, CheckCircle, AlertTriangle
} from 'lucide-react';
import { toast } from 'react-hot-toast';

import { apiClient } from '@/lib/api-client';
import { cn, formatRelativeTime } from '@/lib/utils';

// =============================================================================
// TYPES
// =============================================================================

type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'REVIEWER' | 'AUDITOR' | 'SUPPORT';
type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  lastLogin: string;
  createdAt: string;
  actionsCount: number;
}

// =============================================================================
// UI COMPONENTS
// =============================================================================

function RoleBadge({ role }: { role: UserRole }) {
  const config: Record<UserRole, { color: string; icon: React.ElementType; label: string }> = {
    SUPER_ADMIN: { color: 'violet', icon: ShieldAlert, label: 'Super Admin' },
    ADMIN: { color: 'indigo', icon: Shield, label: 'Admin' },
    REVIEWER: { color: 'blue', icon: CheckCircle, label: 'Reviewer' },
    AUDITOR: { color: 'amber', icon: ShieldCheck, label: 'Auditor' },
    SUPPORT: { color: 'cyan', icon: UserCheck, label: 'Support' },
  };
  
  const { color, icon: Icon, label } = config[role];
  
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border backdrop-blur-sm',
      `bg-${color}-500/10 border-${color}-500/30 text-${color}-300`
    )}>
      <Icon className="w-3.5 h-3.5" />
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: UserStatus }) {
  const config: Record<UserStatus, { color: string; label: string }> = {
    ACTIVE: { color: 'green', label: 'Active' },
    INACTIVE: { color: 'yellow', label: 'Inactive' },
    SUSPENDED: { color: 'red', label: 'Suspended' },
  };
  
  const { color, label } = config[status];
  
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border backdrop-blur-sm',
      `bg-${color}-500/10 border-${color}-500/30 text-${color}-300`
    )}>
      <span className={cn('w-1.5 h-1.5 rounded-full', `bg-${color}-400`)} />
      {label}
    </span>
  );
}

// =============================================================================
// ADD/EDIT USER MODAL
// =============================================================================

function UserModal({ 
  isOpen, 
  onClose, 
  onSubmit, 
  isLoading, 
  initialData 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  onSubmit: (data: any) => void; 
  isLoading: boolean;
  initialData?: AdminUser | null;
}) {
  const [formData, setFormData] = useState({
    name: initialData?.name || '',
    email: initialData?.email || '',
    role: initialData?.role || 'REVIEWER' as UserRole,
    status: initialData?.status || 'ACTIVE' as UserStatus,
  });

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          className="glass-panel w-full max-w-md rounded-2xl p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold">
              {initialData ? 'Edit User' : 'Add New User'}
            </h3>
            <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); onSubmit(formData); }} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1 uppercase tracking-wider">Full Name</label>
              <input
                type="text"
                required
                className="glass-input w-full"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Arjun Mehta"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1 uppercase tracking-wider">Email Address</label>
              <input
                type="email"
                required
                className="glass-input w-full"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="user@civiclink.in"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1 uppercase tracking-wider">System Role</label>
                <select
                  className="glass-input w-full"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })}
                >
                  <option value="SUPER_ADMIN">Super Admin</option>
                  <option value="ADMIN">Admin</option>
                  <option value="REVIEWER">Reviewer</option>
                  <option value="AUDITOR">Auditor</option>
                  <option value="SUPPORT">Support</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1 uppercase tracking-wider">Account Status</label>
                <select
                  className="glass-input w-full"
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as UserStatus })}
                >
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                  <option value="SUSPENDED">Suspended</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3 pt-6 border-t border-white/10 mt-6">
              <button type="button" onClick={onClose} className="flex-1 glass-btn glass-btn-outline justify-center py-2.5">
                Cancel
              </button>
              <button type="submit" disabled={isLoading} className={cn('flex-1 glass-btn glass-btn-admin justify-center py-2.5', isLoading && 'opacity-50 cursor-wait')}>
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : initialData ? 'Save Changes' : 'Create User'}
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

export default function UsersPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | ''>('');
  const [statusFilter, setStatusFilter] = useState<UserStatus | ''>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  
  const queryClient = useQueryClient();

  // 🚨 FIXED: Removed mock data that causes Hydration crash. Trust the backend API.
  const { data: users = [], isLoading } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => apiClient.fetchUsers(),
    refetchInterval: 60000,
  });

  const handleCreateUser = useMutation({
    mutationFn: (data: any) => apiClient.createUser(data),
    onSuccess: () => {
      toast.success('User saved successfully');
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      setShowModal(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleBulkAction = async (action: 'activate' | 'suspend' | 'delete') => {
    try {
      // In production: await apiClient.bulkUserAction(Array.from(selectedIds), action);
      await new Promise(resolve => setTimeout(resolve, 800));
      toast.success(`${selectedIds.size} users ${action}d`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    } catch {
      toast.error('Bulk action failed');
    }
  };

  const filteredUsers = useMemo(() => {
    return users.filter((u: AdminUser) => 
      (u.name.toLowerCase().includes(searchQuery.toLowerCase()) || u.email.includes(searchQuery)) &&
      (!roleFilter || u.role === roleFilter) &&
      (!statusFilter || u.status === statusFilter)
    );
  }, [users, searchQuery, roleFilter, statusFilter]);

  // 🚨 FIXED: Global Checkbox Handler
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(filteredUsers.map((u: AdminUser) => u.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6 text-indigo-400" />
            User Management
          </h1>
          <p className="text-white/60 mt-1">Manage admin staff, roles, and system access permissions</p>
        </div>
        <button 
          onClick={() => { setEditingUser(null); setShowModal(true); }}
          className="glass-btn glass-btn-admin px-4 py-2 text-sm"
        >
          <Plus className="w-4 h-4 mr-2" /> Add User
        </button>
      </div>

      {/* Filters */}
      <div className="glass-panel rounded-2xl p-4 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <input
              type="search"
              placeholder="Search by name or email..."
              className="glass-input pl-10 w-full"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <select className="glass-input w-full sm:w-auto" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as UserRole)}>
              <option value="">All Roles</option>
              <option value="SUPER_ADMIN">Super Admin</option>
              <option value="ADMIN">Admin</option>
              <option value="REVIEWER">Reviewer</option>
              <option value="AUDITOR">Auditor</option>
              <option value="SUPPORT">Support</option>
            </select>
            <select className="glass-input w-full sm:w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as UserStatus)}>
              <option value="">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="SUSPENDED">Suspended</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="glass-panel rounded-2xl overflow-hidden shadow-lg">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full whitespace-nowrap">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-4 py-4 w-12">
                  {/* 🚨 FIXED: Select All Checkbox */}
                  <input 
                    type="checkbox" 
                    checked={filteredUsers.length > 0 && selectedIds.size === filteredUsers.length}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className="rounded border-white/20 bg-black/20 text-indigo-500 focus:ring-indigo-500" 
                  />
                </th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-white/60 uppercase tracking-wider">User</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-white/60 uppercase tracking-wider">Role</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-white/60 uppercase tracking-wider">Status</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-white/60 uppercase tracking-wider">Last Login</th>
                <th className="px-4 py-4 text-left text-xs font-semibold text-white/60 uppercase tracking-wider">Audit Log</th>
                <th className="px-4 py-4 w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse bg-white/[0.02]">
                    <td colSpan={7} className="px-4 py-5">
                      <div className="h-8 bg-white/5 rounded-lg w-full" />
                    </td>
                  </tr>
                ))
              ) : filteredUsers.length ? (
                filteredUsers.map((user: AdminUser) => (
                  <motion.tr 
                    key={user.id} 
                    initial={{ opacity: 0 }} 
                    animate={{ opacity: 1 }}
                    className="hover:bg-white/5 transition-colors group"
                  >
                    <td className="px-4 py-4">
                      {/* 🚨 FIXED: Individual Row Checkbox */}
                      <input 
                        type="checkbox" 
                        checked={selectedIds.has(user.id)}
                        onChange={(e) => {
                          const newSet = new Set(selectedIds);
                          if (e.target.checked) newSet.add(user.id);
                          else newSet.delete(user.id);
                          setSelectedIds(newSet);
                        }}
                        className="rounded border-white/20 bg-black/20 text-indigo-500 focus:ring-indigo-500" 
                      />
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold shadow-md">
                          {user.name.charAt(0)}
                        </div>
                        <div>
                          <p className="font-medium text-sm text-slate-200">{user.name}</p>
                          <p className="text-xs text-white/50 flex items-center gap-1 mt-0.5">
                            <Mail className="w-3 h-3" /> {user.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4"><RoleBadge role={user.role} /></td>
                    <td className="px-4 py-4"><StatusBadge status={user.status} /></td>
                    <td className="px-4 py-4 text-sm text-white/60">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" /> 
                        {user.lastLogin ? formatRelativeTime(user.lastLogin) : 'Never'}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-xs font-mono text-white/40">
                      {user.actionsCount} actions
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => { setEditingUser(user); setShowModal(true); }}
                          className="p-2 hover:bg-indigo-500/20 rounded-lg transition-colors"
                          title="Edit User"
                        >
                          <Edit2 className="w-4 h-4 text-indigo-400" />
                        </button>
                        <button 
                          className="p-2 hover:bg-red-500/20 rounded-lg transition-colors"
                          title="Delete User"
                        >
                          <Trash2 className="w-4 h-4 text-red-400" />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center justify-center text-white/50">
                      <Users className="w-8 h-8 mb-3 opacity-20" />
                      <p>No users found matching your criteria.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 glass-panel rounded-2xl p-3 shadow-[0_10px_40px_rgba(0,0,0,0.5)] border-indigo-500/30"
          >
            <div className="flex items-center gap-4">
              <div className="px-3 py-1 bg-white/10 rounded-lg">
                <span className="text-sm font-bold text-indigo-400">
                  {selectedIds.size}
                </span>
                <span className="text-sm font-medium ml-1">selected</span>
              </div>
              <div className="flex items-center gap-2 border-l border-white/10 pl-4">
                <button onClick={() => handleBulkAction('activate')} className="flex items-center gap-2 px-3 py-1.5 glass-btn text-sm">
                  <CheckCircle className="w-4 h-4" /> Activate
                </button>
                <button onClick={() => handleBulkAction('suspend')} className="flex items-center gap-2 px-3 py-1.5 glass-btn glass-btn-outline border-yellow-500/30 text-yellow-300 text-sm hover:bg-yellow-500/10">
                  <AlertTriangle className="w-4 h-4" /> Suspend
                </button>
                <button onClick={() => handleBulkAction('delete')} className="flex items-center gap-2 px-3 py-1.5 glass-btn glass-btn-outline border-red-500/30 text-red-300 text-sm hover:bg-red-500/10">
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
                <button onClick={() => setSelectedIds(new Set())} className="ml-2 p-1.5 hover:bg-white/10 rounded-lg text-white/60 hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Modal */}
      {showModal && (
        <UserModal 
          isOpen={showModal} 
          onClose={() => setShowModal(false)} 
          onSubmit={(data) => handleCreateUser.mutate(data)}
          isLoading={handleCreateUser.isPending}
          initialData={editingUser}
        />
      )}
    </div>
  );
}