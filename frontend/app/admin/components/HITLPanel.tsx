'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Check, X, AlertCircle, ShieldCheck, FileText, Mail, 
  User, MapPin, Loader2, Scale, Zap, Terminal
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { cn, formatRelativeTime } from '@/lib/utils';
import { StatusBadge } from './StatusBadge';
import type { GrievanceCase } from '@/types';

export interface HITLPanelProps {
  grievance: GrievanceCase;
  onApprove: () => Promise<void>;
  onReject: (reason: string) => Promise<void>;
  isLoading?: boolean;
  className?: string;
}

export function HITLPanel({
  grievance,
  onApprove,
  onReject,
  isLoading = false,
  className,
}: HITLPanelProps) {
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  
  const rejectInputRef = useRef<HTMLTextAreaElement>(null);
  
  const drafted = grievance.systemMetadata?.drafted_letter;
  const jurisdiction = grievance.systemMetadata?.jurisdiction;
  const contact = grievance.systemMetadata?.primary_contact;
  
  // Auto-focus reject reason safely
  useEffect(() => {
    if (showRejectModal) {
      const timer = setTimeout(() => {
        rejectInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [showRejectModal]);
  
  const handleApprove = async () => {
    setIsApproving(true);
    try {
      await onApprove();
      toast.success('Directive Approved: Dispatching via DKIM');
    } catch (error) {
      toast.error(`Approval failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsApproving(false);
    }
  };
  
  const handleReject = async () => {
    if (!rejectReason.trim()) {
      toast.error('Reason required for operational halt.');
      return;
    }
    
    setIsRejecting(true);
    try {
      await onReject(rejectReason);
      toast.success('Thread Terminated Successfully');
      setShowRejectModal(false);
      setRejectReason('');
    } catch (error) {
      toast.error(`Termination failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsRejecting(false);
    }
  };
  
  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn('glass-card p-6 md:p-8 animate-slide-up', className)}
      >
        {/* --- HEADER --- */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-8 border-b border-white/[0.05] pb-6">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <ShieldCheck className="w-5 h-5 text-purple-400" />
              <h3 className="text-xl font-bold tracking-tight text-slate-100">Authorization Required</h3>
            </div>
            <p className="text-xs font-mono tracking-wide text-slate-400">
              AI-generated payload awaits human cryptosignature prior to dispatch.
            </p>
          </div>
          <StatusBadge status={grievance.status} showPulse={true} />
        </div>
        
        {/* --- CASE SUMMARY GRID --- */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          
          {/* Issue Details */}
          <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/[0.05]">
              <FileText className="w-4 h-4 text-purple-400" />
              <span className="text-[10px] font-bold tracking-widest uppercase text-slate-300">Payload Details</span>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">Category</p>
                <p className="text-sm font-medium text-slate-200 capitalize">{grievance.issueCategory.replace(/_/g, ' ')}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">Severity</p>
                  <span className={cn(
                    'status-pill mt-1',
                    grievance.severity === 'CRITICAL' ? 'status-pill-error animate-pulse' :
                    grievance.severity === 'HIGH' ? 'status-pill-warning' :
                    grievance.severity === 'MEDIUM' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                    'status-pill-success'
                  )}>
                    {grievance.severity}
                  </span>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">Timestamp</p>
                  <p className="text-sm font-mono text-slate-300 mt-1">{formatRelativeTime(grievance.createdAt)}</p>
                </div>
              </div>
            </div>
          </div>
          
          {/* Location & Contact */}
          <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/[0.05]">
              <MapPin className="w-4 h-4 text-rose-400" />
              <span className="text-[10px] font-bold tracking-widest uppercase text-slate-300">Target Vector</span>
            </div>
            
            <div className="space-y-4">
              {jurisdiction ? (
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">Jurisdiction Resolved</p>
                  <p className="text-sm font-medium text-slate-200">
                    {jurisdiction.ward && `Ward ${jurisdiction.ward}, `}
                    {jurisdiction.district}, {jurisdiction.state}
                  </p>
                </div>
              ) : (
                <p className="text-amber-400 text-xs font-mono flex items-center gap-1"><AlertCircle className="w-3 h-3"/> UNRESOLVED JURISDICTION</p>
              )}
              
              {contact ? (
                <div className="pt-1">
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1.5">Official Identified</p>
                  <div className="flex items-center gap-2 text-sm text-slate-200 mb-2">
                    <User className="w-3.5 h-3.5 text-slate-500" />
                    <span className="font-semibold">{contact.officialDesignation}</span>
                  </div>
                  {contact.officialEmail && (
                    <div className="flex items-center gap-2 p-2.5 bg-black/40 rounded-lg border border-white/5">
                      <Mail className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                      <p className="text-rose-300 font-mono text-xs break-all select-all">
                        {contact.officialEmail}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-rose-400 text-xs font-mono flex items-center gap-1"><AlertCircle className="w-3 h-3"/> OSINT TARGET NOT FOUND</p>
              )}
            </div>
          </div>
        </div>
        
        {/* --- DRAFTED EMAIL PREVIEW --- */}
        {drafted && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="bg-white/[0.02] border border-purple-500/20 rounded-xl p-6 mb-8 shadow-[0_0_30px_rgba(147,51,234,0.05)]"
          >
            <div className="flex items-center justify-between mb-5 border-b border-white/[0.05] pb-4">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-purple-400" />
                <span className="text-[10px] font-bold tracking-widest uppercase text-slate-300">Generated Legal Dispatch</span>
              </div>
              <span className="px-2 py-0.5 text-[10px] font-bold tracking-widest uppercase bg-purple-500/10 text-purple-300 border border-purple-500/20 rounded">
                LANG: {drafted.language || 'EN'}
              </span>
            </div>
            
            <div className="space-y-5">
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1.5">Subject Header</p>
                <div className="p-3 bg-black/40 rounded-lg border border-white/5 text-sm font-semibold text-slate-200">
                  {drafted.subject}
                </div>
              </div>
              
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1.5">Payload Body</p>
                <div className="p-4 bg-black/60 rounded-lg border border-white/5 max-h-[300px] overflow-y-auto thin-scrollbar">
                  <p className="text-slate-300 whitespace-pre-wrap font-serif text-sm leading-relaxed">
                    {drafted.body}
                  </p>
                </div>
              </div>
              
              {Array.isArray(drafted.legal_citations) && drafted.legal_citations.length > 0 && (
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-2 flex items-center gap-1.5">
                    <Scale className="w-3 h-3" /> Statutory Injections
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {drafted.legal_citations.map((cite: string, i: number) => (
                      <motion.span
                        key={i}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: i * 0.1 }}
                        className="px-2.5 py-1 text-[10px] font-bold tracking-wide bg-purple-500/10 border border-purple-500/20 text-purple-300 rounded"
                      >
                        {cite}
                      </motion.span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
        
        {/* --- CONFIDENCE METRICS --- */}
        {grievance.systemMetadata?.confidence_metrics && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="w-4 h-4 text-emerald-400" />
              <span className="text-[10px] font-bold tracking-widest uppercase text-slate-300">Telemetry & Confidence</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(grievance.systemMetadata.confidence_metrics).map(([key, value]) => {
                const score = (value as number) * 100;
                // Strict dynamic thresholds
                const scoreColor = score >= 90 ? 'text-emerald-400' : score >= 75 ? 'text-amber-400' : 'text-rose-400';
                
                return (
                  <div key={key} className="p-3 bg-white/[0.02] rounded-xl border border-white/5 flex flex-col items-center justify-center">
                    <p className={cn("text-2xl font-black font-mono tracking-tighter mb-1 drop-shadow-md", scoreColor)}>
                      {score.toFixed(0)}<span className="text-sm opacity-50">%</span>
                    </p>
                    <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold text-center">
                      {key.replace(/_/g, ' ')}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        
        {/* --- ACTION TERMINALS --- */}
        <div className="flex flex-col sm:flex-row gap-4 pt-4 border-t border-white/[0.05]">
          <button
            onClick={handleApprove}
            disabled={isLoading || isApproving || isRejecting}
            className={cn(
              'flex-1 btn-action bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/50 py-3.5',
              (isLoading || isApproving || isRejecting) && 'opacity-50 cursor-wait'
            )}
          >
            {isApproving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
            {isApproving ? 'Executing...' : 'Authorize & Dispatch'}
          </button>
          
          <button
            onClick={() => setShowRejectModal(true)}
            disabled={isLoading || isApproving || isRejecting}
            className={cn(
              'flex-1 btn-action bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20 hover:border-rose-500/50 py-3.5',
              (isLoading || isApproving || isRejecting) && 'opacity-50 cursor-wait'
            )}
          >
            {isRejecting ? <Loader2 className="w-5 h-5 animate-spin" /> : <X className="w-5 h-5" />}
            {isRejecting ? 'Halting...' : 'Halt & Reject'}
          </button>
        </div>
      </motion.div>
      
      {/* ========================================================================= */}
      {/* REJECT MODAL (Overlay) */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {showRejectModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0a040d]/90 backdrop-blur-md"
            onClick={() => setShowRejectModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="glass-card w-full max-w-lg rounded-2xl p-8 border-rose-500/30 shadow-[0_0_50px_rgba(225,29,72,0.15)] bg-[#050208]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-4 mb-6">
                <div className="p-3 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20 flex-shrink-0">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-xl font-bold text-slate-100 tracking-tight">Terminate Workflow</h4>
                  <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                    This action will permanently halt LangGraph execution. Provide administrative reasoning for the citizen logs.
                  </p>
                </div>
              </div>
              
              <div className="relative mb-6">
                <Terminal className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
                <textarea
                  ref={rejectInputRef}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Specify validation failure or regulatory mismatch..."
                  className="precision-input w-full min-h-[140px] pl-10 resize-none thin-scrollbar font-mono text-sm"
                  disabled={isRejecting}
                />
              </div>
              
              <div className="flex gap-3">
                <button
                  onClick={() => { setShowRejectModal(false); setRejectReason(''); }}
                  disabled={isRejecting}
                  className="flex-1 btn-action bg-white/[0.02] border-white/10 text-slate-300 hover:bg-white/5 py-3"
                >
                  Abort
                </button>
                <button
                  onClick={handleReject}
                  disabled={!rejectReason.trim() || isRejecting}
                  className={cn(
                    'flex-1 btn-action bg-rose-500/20 text-rose-300 border-rose-500/30 hover:bg-rose-500/30 py-3',
                    (!rejectReason.trim() || isRejecting) && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  {isRejecting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm Halt'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}