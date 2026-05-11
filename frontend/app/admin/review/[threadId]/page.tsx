'use client';

import { useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  AlertCircle, ArrowLeft, Clock, RefreshCw, 
  MessageSquare, MapPin, Image as ImageIcon, User, Mail, FileText, ShieldCheck, Terminal, Download, Activity
} from 'lucide-react';
import { toast } from 'react-hot-toast';

import { cn, formatRelativeTime } from '@/lib/utils';
import { useRealTime } from '../../layout';
import { GraphVisualizer } from '../../components/GraphVisualizer';
import { HITLPanel } from '../../components/HITLPanel';
import { StatusBadge } from '../../components/StatusBadge';
import { apiClient } from '@/lib/api-client';
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
      className="glass-card p-6 mb-6 border-b-4 border-b-purple-500/30"
    >
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-center gap-5">
          <button
            onClick={onBack}
            className="p-2.5 bg-white/[0.03] hover:bg-white/[0.08] border border-white/5 hover:border-white/10 rounded-xl transition-all text-slate-400 hover:text-white"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-3 mb-1.5">
              <h1 className="text-2xl font-black tracking-tight text-white uppercase">Node Inspector</h1>
              <StatusBadge status={grievance.status} size="lg" />
            </div>
            <p className="text-[11px] font-mono text-slate-400 uppercase tracking-widest">
              Tracking Signature: <span className="text-purple-400 font-bold">{grievance.trackingId}</span>
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 bg-white/[0.02] px-3 py-1.5 rounded-lg border border-white/5">
            <Clock className="w-3.5 h-3.5" />
            <span>Ingested: {formatRelativeTime(grievance.createdAt)}</span>
          </div>
          <button 
            onClick={onRefresh}
            disabled={isRefreshing}
            className="btn-action bg-white/[0.03] border-white/10 text-slate-300 py-2.5 px-4 text-xs tracking-widest uppercase font-bold disabled:opacity-50"
          >
            <RefreshCw className={cn("w-4 h-4 mr-2", isRefreshing && "animate-spin text-purple-400")} />
            Sync State
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
      className="glass-card p-6 md:p-8 animate-slide-up"
    >
      <div className="flex items-center gap-2 mb-6 pb-4 border-b border-white/[0.05]">
        <Terminal className="w-5 h-5 text-emerald-400" />
        <h3 className="text-lg font-bold tracking-tight text-slate-100">Compiled Artifacts</h3>
      </div>
      
      <div className="space-y-6">
        {/* Original Submission */}
        <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="w-4 h-4 text-purple-400" />
            <span className="text-[10px] font-bold tracking-widest uppercase text-slate-300">Raw Ingestion</span>
          </div>
          <div className="p-4 bg-black/40 border border-white/[0.02] rounded-lg">
            <p className="text-sm text-slate-300 leading-relaxed font-mono">{grievance.descriptionText}</p>
            <div className="flex items-center gap-3 mt-3 pt-3 border-t border-white/5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              <span>{formatRelativeTime(grievance.createdAt)}</span>
              {grievance.systemMetadata?.image_hash && (
                <span className="flex items-center gap-1 text-purple-400/80">
                  <ImageIcon className="w-3.5 h-3.5" /> Visual Media Attached
                </span>
              )}
            </div>
          </div>
        </div>
        
        {/* Location & Target Official */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {jurisdiction && (
            <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <MapPin className="w-4 h-4 text-rose-400" />
                <span className="text-[10px] font-bold tracking-widest uppercase text-slate-300">Resolved Jurisdiction</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold mb-1">Ward</p>
                  <p className="text-sm font-medium text-slate-200">{jurisdiction.ward || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold mb-1">District</p>
                  <p className="text-sm font-medium text-slate-200">{jurisdiction.district}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold mb-1">State</p>
                  <p className="text-sm font-medium text-slate-200">{jurisdiction.state}</p>
                </div>
              </div>
            </div>
          )}

          {contact && (
            <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <User className="w-4 h-4 text-emerald-400" />
                <span className="text-[10px] font-bold tracking-widest uppercase text-slate-300">Target Official</span>
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold mb-1">Designation</p>
                  <p className="text-sm font-medium text-slate-200">{contact.officialDesignation}</p>
                </div>
                {contact.officialEmail && (
                  <div>
                    <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold mb-1">Verified Email Endpoint</p>
                    <div className="flex items-center gap-2 p-2 bg-black/40 rounded-lg border border-white/5 mt-1">
                      <Mail className="w-3.5 h-3.5 text-emerald-400" />
                      <p className="text-emerald-300 font-mono text-[11px] break-all select-all">
                        {contact.officialEmail}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        
        {/* Drafted Letter */}
        {drafted && (
          <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-5">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/[0.05]">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-purple-400" />
                <span className="text-[10px] font-bold tracking-widest uppercase text-slate-300">Generated Payload</span>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold mb-1.5">Subject Header</p>
                <div className="p-3 bg-black/40 rounded-lg border border-white/5 text-sm font-semibold text-slate-200">
                  {drafted.subject}
                </div>
              </div>
              <div>
                <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold mb-1.5">Payload Body</p>
                <div className="p-4 bg-black/60 rounded-lg border border-white/5 max-h-64 overflow-y-auto thin-scrollbar">
                  <p className="text-slate-300 whitespace-pre-wrap font-serif text-sm leading-relaxed">
                    {drafted.body}
                  </p>
                </div>
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
    // 🚨 Extracting conversation from graph-state if a dedicated messages route doesn't exist yet
    queryFn: async () => {
      try {
        const state = await apiClient.fetchGraphState(grievance.threadId);
        // This simulates message extraction. Adjust depending on your backend LangGraph return object.
        return state?.messages || []; 
      } catch (e) {
        return [];
      }
    },
    refetchInterval: 5000,
  });
  
  if (isLoading) {
    return (
      <div className="glass-card p-6">
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton h-16 w-full rounded-xl opacity-50" />
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
      className="glass-card p-6 flex flex-col h-[400px]"
    >
      <div className="flex items-center justify-between mb-4 pb-4 border-b border-white/[0.05] flex-shrink-0">
        <h3 className="text-[11px] font-bold tracking-widest uppercase text-slate-200 flex items-center gap-2">
          <Activity className="w-4 h-4 text-rose-400" />
          Citizen Interaction Log
        </h3>
        <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-white/[0.05] text-slate-400 border border-white/10">
          {messages?.length || 0} BLOCKS
        </span>
      </div>
      
      <div className="flex-1 space-y-4 overflow-y-auto pr-2 thin-scrollbar">
        {messages?.map((message: any) => (
          <div key={message.id || Math.random()} className={cn(
            "p-4 rounded-xl border max-w-[85%]",
            message.role === 'system' 
              ? "bg-purple-500/[0.03] border-purple-500/20 ml-auto" 
              : "bg-white/[0.02] border-white/5"
          )}>
            <p className={cn("text-sm leading-relaxed", message.role === 'system' ? "text-purple-100" : "text-slate-300 font-mono")}>
              {message.content}
            </p>
            <div className={cn(
              "flex items-center gap-2 mt-3 text-[9px] font-bold uppercase tracking-widest",
              message.role === 'system' ? "text-purple-400/60 justify-end" : "text-slate-500"
            )}>
              {message.role === 'system' && <ShieldCheck className="w-3 h-3 text-purple-400" />}
              <span>{formatRelativeTime(message.timestamp)}</span>
            </div>
          </div>
        ))}
        
        {(!messages || messages.length === 0) && (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <MessageSquare className="w-8 h-8 mb-3 opacity-20" />
            <p className="text-[10px] font-bold tracking-widest uppercase">No Interaction Data</p>
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
  
  const { data: caseData, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'case', threadId],
    // 🚨 Extracting the exact case dynamically using the grievances endpoint search
    queryFn: async () => {
      const res = await apiClient.fetchGrievances({ search: threadId });
      return res.items?.[0] || null;
    },
    enabled: !!threadId,
    refetchInterval: 5000, 
  });
  
  useEffect(() => {
    if (!threadId) return;
    const unsubscribe = subscribe(threadId, (update) => {
      refetch();
      if (update.type === 'node_completed' && update.node === 'verification_gate') {
        toast.success('Authorization Required: Payload awaiting signature.', {
          style: { background: 'rgba(20, 10, 30, 0.9)', color: '#9333ea', border: '1px solid rgba(147, 51, 234, 0.3)' }
        });
      }
    });
    return unsubscribe;
  }, [threadId, subscribe, refetch]);
  
  const approveMutation = useMutation({
    mutationFn: () => apiClient.reviewGrievance(threadId, 'APPROVED'),
    onSuccess: () => {
      toast.success('Directive Approved: Dispatching via DKIM');
      queryClient.invalidateQueries({ queryKey: ['admin', 'case', threadId] });
    },
    onError: (e: Error) => toast.error(`Approval failed: ${e.message}`),
  });
  
  const rejectMutation = useMutation({
    mutationFn: (reason: string) => apiClient.reviewGrievance(threadId, 'REJECTED', reason),
    onSuccess: () => {
      toast.success('Thread Terminated');
      queryClient.invalidateQueries({ queryKey: ['admin', 'case', threadId] });
    },
    onError: (e: Error) => toast.error(`Termination failed: ${e.message}`),
  });
  
  const handleNodeClick = useCallback((node: any) => {
    console.log('Node inspected:', node);
  }, []);
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="w-8 h-8 animate-spin text-purple-500" />
          <p className="text-[10px] font-bold tracking-widest uppercase text-slate-500 animate-pulse">Decrypting Artifacts...</p>
        </div>
      </div>
    );
  }
  
  if (!caseData) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <div className="text-center glass-card p-12 max-w-md border-rose-500/20">
          <AlertCircle className="w-12 h-12 text-rose-500/50 mx-auto mb-4" />
          <p className="text-lg font-bold text-white mb-2 tracking-tight">Artifact Not Found</p>
          <p className="text-xs text-slate-400 mb-6">The requested tracking signature does not exist in the ledger.</p>
          <button 
            onClick={() => router.push('/admin/grievances')}
            className="btn-action bg-white/[0.05] border-white/10 hover:bg-white/10 py-2.5 px-6"
          >
            Return to Ledger
          </button>
        </div>
      </div>
    );
  }
  
  return (
    <div className="space-y-6 pb-12 animate-slide-up max-w-[1600px] mx-auto">
      <CaseHeader 
        grievance={caseData} 
        onBack={() => router.push('/admin/grievances')} 
        onRefresh={refetch}
        isRefreshing={isFetching}
      />
      
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: Telemetry (4/12 width) */}
        <div className="lg:col-span-5 xl:col-span-4 space-y-6 lg:sticky lg:top-24">
          <div className="h-[500px] glass-card p-1 border-purple-500/20 shadow-[0_0_30px_rgba(147,51,234,0.05)]">
            <GraphVisualizer 
              threadId={threadId} 
              isPreview={false}
              onNodeClick={handleNodeClick}
            />
          </div>
          <MessageHistory grievance={caseData} />
        </div>
        
        {/* RIGHT COLUMN: Artifacts & Action (8/12 width) */}
        <div className="lg:col-span-7 xl:col-span-8 space-y-6">
          {caseData.status === 'AWAITING_REVIEW' ? (
            <HITLPanel
              grievance={caseData}
              onApprove={async () => { await approveMutation.mutateAsync(); }}
              onReject={async (reason: string) => { await rejectMutation.mutateAsync(reason); }}
              isLoading={approveMutation.isPending || rejectMutation.isPending}
            />
          ) : (
            <CaseDetailsPanel grievance={caseData} />
          )}
          
          <div className="glass-card p-6">
            <h3 className="text-[10px] font-bold tracking-widest uppercase text-slate-300 mb-4">Quick Operations</h3>
            <div className="grid grid-cols-2 gap-4">
              <button className="flex flex-col items-center justify-center gap-2 p-5 bg-white/[0.02] border border-white/5 rounded-xl hover:bg-white/[0.05] hover:border-white/10 transition-colors group">
                <MessageSquare className="w-5 h-5 text-slate-400 group-hover:text-purple-400 transition-colors" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Ping Citizen</span>
              </button>
              <button className="flex flex-col items-center justify-center gap-2 p-5 bg-white/[0.02] border border-white/5 rounded-xl hover:bg-white/[0.05] hover:border-white/10 transition-colors group">
                <Download className="w-5 h-5 text-slate-400 group-hover:text-rose-400 transition-colors" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Export Dossier</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}