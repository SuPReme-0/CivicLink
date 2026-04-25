// app/(admin)/review/[threadId]/page.tsx
'use client';

import { useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  AlertCircle, ArrowLeft, Clock, RefreshCw, 
  MessageSquare, MapPin, Image as ImageIcon, User, Mail, FileText, ShieldCheck
} from 'lucide-react';
import { toast } from 'react-hot-toast';

import { apiClient } from '@/lib/api-client';
import { cn, formatRelativeTime } from '@/lib/utils';
import { useRealTime } from '../../layout';
import { GraphVisualizer } from '../../components/GraphVisualizer';
import { HITLPanel } from '../../components/HITLPanel';
import { StatusBadge } from '../../components/StatusBadge';
import type { GrievanceCase } from '@/types';

// =============================================================================
// CASE HEADER COMPONENT
// =============================================================================

function CaseHeader({ 
  grievance, 
  onBack,
  onRefresh,
  isRefreshing
}: { 
  grievance: GrievanceCase; 
  onBack: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-panel rounded-2xl p-6 mb-6"
    >
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold">Case Review</h1>
              <StatusBadge status={grievance.status} size="lg" />
            </div>
            <p className="text-white/60">
              Tracking ID: <span className="font-mono text-[var(--primary)]">{grievance.trackingId}</span>
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 text-sm text-white/60">
            <Clock className="w-4 h-4" />
            <span>Created: {formatRelativeTime(grievance.createdAt)}</span>
          </div>
          <button 
            onClick={onRefresh}
            disabled={isRefreshing}
            className="glass-btn glass-btn-outline px-4 py-2 text-sm disabled:opacity-50"
          >
            <RefreshCw className={cn("w-4 h-4 mr-2", isRefreshing && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// =============================================================================
// CASE DETAILS PANEL (Used when NOT awaiting review)
// =============================================================================

function CaseDetailsPanel({ grievance }: { grievance: GrievanceCase }) {
  const jurisdiction = grievance.systemMetadata?.jurisdiction;
  const contact = grievance.systemMetadata?.primary_contact;
  const drafted = grievance.systemMetadata?.drafted_letter;
  
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.2 }}
      className="glass-panel rounded-2xl p-6"
    >
      <h3 className="text-lg font-semibold mb-4">Case Details</h3>
      
      <div className="space-y-6">
        {/* Original Submission */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="w-4 h-4 text-[var(--primary)]" />
            <span className="font-medium text-sm">Original Submission</span>
          </div>
          <div className="chat-bubble chat-bubble-in">
            <p className="text-sm">{grievance.descriptionText}</p>
            <div className="flex items-center gap-2 mt-2 text-xs text-white/50">
              <span>{formatRelativeTime(grievance.createdAt)}</span>
              {grievance.systemMetadata?.image_hash && (
                <span className="flex items-center gap-1">
                  <ImageIcon className="w-3 h-3" />
                  Image attached
                </span>
              )}
            </div>
          </div>
        </div>
        
        {/* Location & Jurisdiction */}
        {jurisdiction && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="w-4 h-4 text-[var(--primary)]" />
              <span className="font-medium text-sm">Jurisdiction</span>
            </div>
            <div className="glass-panel rounded-xl p-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-white/60">Ward</p>
                  <p className="font-medium">{jurisdiction.ward || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs text-white/60">District</p>
                  <p className="font-medium">{jurisdiction.district}</p>
                </div>
                <div>
                  <p className="text-xs text-white/60">State</p>
                  <p className="font-medium">{jurisdiction.state}</p>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Target Official */}
        {contact && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <User className="w-4 h-4 text-[var(--primary)]" />
              <span className="font-medium text-sm">Target Official</span>
            </div>
            <div className="glass-panel rounded-xl p-4">
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-xs text-white/60">Designation</p>
                  <p className="font-medium">{contact.officialDesignation}</p>
                </div>
                {contact.officialEmail && (
                  <div>
                    <p className="text-xs text-white/60">Email</p>
                    <div className="flex items-center gap-2">
                      <Mail className="w-4 h-4 text-[var(--primary)]" />
                      <p className="text-[var(--primary)] font-mono break-all select-all">
                        {contact.officialEmail}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        
        {/* Drafted Letter */}
        {drafted && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-4 h-4 text-[var(--primary)]" />
              <span className="font-medium text-sm">Drafted Communication</span>
            </div>
            <div className="glass-panel rounded-xl p-4 text-sm">
              <p className="text-xs text-white/60 mb-1">Subject</p>
              <p className="font-medium mb-3">{drafted.subject}</p>
              <p className="text-xs text-white/60 mb-1">Body</p>
              <div className="mt-1 p-3 bg-black/20 rounded-lg border border-white/10 max-h-48 overflow-y-auto custom-scrollbar">
                <p className="text-white/80 whitespace-pre-wrap">{drafted.body}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// =============================================================================
// MESSAGE HISTORY COMPONENT
// =============================================================================

function MessageHistory({ grievance }: { grievance: GrievanceCase }) {
  const { data: messages, isLoading } = useQuery({
    queryKey: ['admin', 'case', grievance.trackingId, 'messages'],
    // 🚨 FIXED: Now explicitly connected to the patched endpoint
    queryFn: () => apiClient.fetchCaseMessages(grievance.trackingId),
    refetchInterval: 5000,
  });
  
  if (isLoading) {
    return (
      <div className="glass-panel rounded-2xl p-6">
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="h-4 bg-white/10 rounded w-3/4 mb-2" />
              <div className="h-3 bg-white/10 rounded w-1/2" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.3 }}
      className="glass-panel rounded-2xl p-6"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Citizen Interaction Log</h3>
        <span className="text-xs text-white/60">{messages?.length || 0} messages</span>
      </div>
      
      <div className="space-y-4 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
        {messages?.map((message: any) => (
          <div key={message.id} className="chat-bubble chat-bubble-in">
            <p className="text-sm">{message.content}</p>
            <div className="flex items-center justify-end gap-2 mt-2 text-xs text-white/50">
              <span>{formatRelativeTime(message.timestamp)}</span>
              {message.role === 'system' && (
                <span className="flex items-center gap-1 text-green-400">
                  <ShieldCheck className="w-3 h-3" /> System
                </span>
              )}
            </div>
          </div>
        ))}
        
        {(!messages || messages.length === 0) && (
          <div className="text-center py-8 text-white/60">
            No interaction history found.
          </div>
        )}
      </div>
    </motion.div>
  );
}

// =============================================================================
// MAIN CASE REVIEW PAGE
// =============================================================================

export default function CaseReviewPage() {
  const params = useParams();
  const router = useRouter();
  const threadId = params.threadId as string;
  const { subscribe } = useRealTime();
  const queryClient = useQueryClient();
  
  // Fetch case details
  const { data: caseData, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'case', threadId],
    queryFn: () => apiClient.fetchGrievanceCase(threadId),
    enabled: !!threadId,
    refetchInterval: 5000, // 5s for real-time feel
  });
  
  // Real-time subscription for this thread
  useEffect(() => {
    if (!threadId) return;
    
    const unsubscribe = subscribe(threadId, (update) => {
      refetch();
      if (update.type === 'node_completed' && update.node === 'verification_gate') {
        toast('Case ready for HITL Review', { icon: '⚖️' });
      }
    });
    
    return unsubscribe;
  }, [threadId, subscribe, refetch]);
  
  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: () => apiClient.approveGrievance(threadId),
    onSuccess: () => {
      toast.success('Grievance approved and dispatched');
      queryClient.invalidateQueries({ queryKey: ['admin', 'case', threadId] });
    },
    onError: (e: Error) => {
      toast.error(`Approval failed: ${e.message}`);
    },
  });
  
  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: (reason: string) => apiClient.rejectGrievance(threadId, reason),
    onSuccess: () => {
      toast.success('Grievance rejected');
      queryClient.invalidateQueries({ queryKey: ['admin', 'case', threadId] });
    },
    onError: (e: Error) => {
      toast.error(`Rejection failed: ${e.message}`);
    },
  });
  
  const handleNodeClick = useCallback((node: any) => {
    console.log('Node inspected:', node);
  }, []);
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="w-8 h-8 animate-spin text-[var(--admin-accent)]" />
          <p className="text-white/60 animate-pulse">Loading case artifacts...</p>
        </div>
      </div>
    );
  }
  
  if (!caseData) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 text-white/40 mx-auto mb-4" />
        <p className="text-lg font-medium">Case not found</p>
        <button 
          onClick={() => router.push('/admin')}
          className="mt-4 glass-btn glass-btn-outline"
        >
          Return to Dashboard
        </button>
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      {/* 🚨 FIXED: Wired up the refresh button prop */}
      <CaseHeader 
        grievance={caseData} 
        onBack={() => router.push('/admin')} 
        onRefresh={refetch}
        isRefreshing={isFetching}
      />
      
      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Left Column: LangGraph Visualization */}
        <div className="space-y-6 sticky top-24">
          {/* 🚨 FIXED: Removed redundant wrapper since GraphVisualizer has its own header */}
          <div className="h-[600px] glass-panel rounded-2xl">
            <GraphVisualizer 
              threadId={threadId} 
              isPreview={false}
              onNodeClick={handleNodeClick}
            />
          </div>
          
          {/* Message History */}
          <MessageHistory grievance={caseData} />
        </div>
        
        {/* Right Column: Case Details & HITL */}
        <div className="space-y-6">
          {/* 🚨 FIXED: UX Logic. Show HITL if awaiting review, otherwise show standard Details */}
          {caseData.status === 'AWAITING_REVIEW' ? (
            <HITLPanel
              grievance={caseData}
              onApprove={async () => {
                await approveMutation.mutateAsync();
              }}
              onReject={async (reason: string) => {
                await rejectMutation.mutateAsync(reason);
              }}
              isLoading={approveMutation.isPending || rejectMutation.isPending}
            />
          ) : (
            <CaseDetailsPanel grievance={caseData} />
          )}
          
          {/* Quick Actions (Always visible below main panels) */}
          <div className="glass-panel rounded-2xl p-6">
            <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
            <div className="grid grid-cols-2 gap-3">
              <button className="flex flex-col items-center gap-2 p-4 glass-panel rounded-xl hover:bg-white/5 transition-colors">
                <MessageSquare className="w-5 h-5 text-[var(--admin-accent)]" />
                <span className="text-xs font-medium">Contact Citizen</span>
              </button>
              <button className="flex flex-col items-center gap-2 p-4 glass-panel rounded-xl hover:bg-white/5 transition-colors">
                <FileText className="w-5 h-5 text-[var(--admin-accent)]" />
                <span className="text-xs font-medium">Export Case Report</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}