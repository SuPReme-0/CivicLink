// app/(admin)/components/HITLPanel.tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Check, X, AlertCircle, ShieldCheck, FileText, Mail, 
  Clock, User, MapPin, Loader2
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
  
  // 🚨 FIX 1: React standard useRef instead of document.getElementById
  const rejectInputRef = useRef<HTMLTextAreaElement>(null);
  
  const drafted = grievance.systemMetadata?.drafted_letter;
  const jurisdiction = grievance.systemMetadata?.jurisdiction;
  const contact = grievance.systemMetadata?.primary_contact;
  
  // Auto-focus reject reason safely via React Ref
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
      toast.success('Grievance approved and dispatched');
    } catch (error) {
      toast.error(`Approval failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsApproving(false);
    }
  };
  
  const handleReject = async () => {
    if (!rejectReason.trim()) {
      toast.error('Please provide a reason for rejection');
      return;
    }
    
    setIsRejecting(true);
    try {
      await onReject(rejectReason);
      toast.success('Grievance rejected');
      setShowRejectModal(false);
      setRejectReason('');
    } catch (error) {
      toast.error(`Rejection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsRejecting(false);
    }
  };
  
  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn('glass-panel rounded-2xl p-6', className)}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="w-5 h-5 text-[var(--admin-accent)]" />
              <h3 className="text-lg font-semibold">Human Review Required</h3>
            </div>
            <p className="text-sm text-white/60">
              AI-drafted grievance awaiting your approval before secure dispatch
            </p>
          </div>
          <StatusBadge status={grievance.status} showPulse={true} />
        </div>
        
        {/* Case Summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {/* Issue Details */}
          <div className="glass-panel rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-4 h-4 text-[var(--primary)]" />
              <span className="font-medium text-sm">Issue Details</span>
            </div>
            <div className="space-y-2 text-sm">
              <div>
                <p className="text-xs text-white/60">Category</p>
                <p className="font-medium capitalize">{grievance.issueCategory.replace(/_/g, ' ')}</p>
              </div>
              <div>
                <p className="text-xs text-white/60">Severity</p>
                <span className={cn(
                  'px-2 py-0.5 rounded text-xs font-medium inline-block mt-1',
                  grievance.severity === 'CRITICAL' ? 'bg-red-500/20 text-red-300' :
                  grievance.severity === 'HIGH' ? 'bg-orange-500/20 text-orange-300' :
                  grievance.severity === 'MEDIUM' ? 'bg-yellow-500/20 text-yellow-300' :
                  'bg-green-500/20 text-green-300'
                )}>
                  {grievance.severity}
                </span>
              </div>
              <div>
                <p className="text-xs text-white/60">Submitted</p>
                <p>{formatRelativeTime(grievance.createdAt)}</p>
              </div>
            </div>
          </div>
          
          {/* Location & Contact */}
          <div className="glass-panel rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="w-4 h-4 text-[var(--primary)]" />
              <span className="font-medium text-sm">Jurisdiction & Contact</span>
            </div>
            <div className="space-y-3 text-sm">
              {jurisdiction ? (
                <div>
                  <p className="text-xs text-white/60">Location Engine Match</p>
                  <p className="font-medium mt-0.5">
                    {jurisdiction.ward && `Ward ${jurisdiction.ward}, `}
                    {jurisdiction.district}, {jurisdiction.state}
                  </p>
                </div>
              ) : (
                <p className="text-yellow-400 text-xs flex items-center gap-1"><AlertCircle className="w-3 h-3"/> Unknown Jurisdiction</p>
              )}
              
              {contact ? (
                <div className="pt-2 border-t border-white/10">
                  <p className="text-xs text-white/60">Target Official</p>
                  <div className="flex items-center gap-2 mt-1">
                    <User className="w-4 h-4 text-white/60 flex-shrink-0" />
                    <p className="font-medium">{contact.officialDesignation}</p>
                  </div>
                  {contact.officialEmail && (
                    <div className="flex items-center gap-2 mt-1.5 p-2 bg-black/20 rounded-lg border border-white/5">
                      <Mail className="w-4 h-4 text-[var(--primary)] flex-shrink-0" />
                      <p className="text-[var(--primary)] font-mono text-xs break-all select-all">
                        {contact.officialEmail}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-red-400 text-xs flex items-center gap-1"><AlertCircle className="w-3 h-3"/> Target official not found</p>
              )}
            </div>
          </div>
        </div>
        
        {/* Drafted Email Preview */}
        {drafted && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="glass-panel rounded-xl p-5 mb-6"
          >
            <div className="flex items-center gap-2 mb-4">
              <FileText className="w-4 h-4 text-[var(--primary)]" />
              <span className="font-medium text-sm">Drafted Legal Communication</span>
              <span className="ml-auto px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase bg-blue-500/20 text-blue-300 rounded">
                {drafted.language || 'EN'}
              </span>
            </div>
            
            <div className="space-y-4 text-sm">
              <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                <p className="text-xs text-white/50 uppercase tracking-wider font-semibold mb-1">Subject</p>
                <p className="font-medium">{drafted.subject}</p>
              </div>
              
              <div>
                <p className="text-xs text-white/50 uppercase tracking-wider font-semibold mb-1">Generated Body</p>
                {/* 🚨 FIX 2: Removed line-clamp, added scrollable view for legal review */}
                <div className="mt-1 p-4 bg-black/30 rounded-lg border border-white/10 max-h-[300px] overflow-y-auto custom-scrollbar">
                  <p className="text-white/90 whitespace-pre-wrap font-serif leading-relaxed">
                    {drafted.body}
                  </p>
                </div>
              </div>
              
              {/* 🚨 FIX 3: Safe Array Handling */}
              {Array.isArray(drafted.legal_citations) && drafted.legal_citations.length > 0 && (
                <div>
                  <p className="text-xs text-white/50 uppercase tracking-wider font-semibold mb-2">Statutory Citations</p>
                  <div className="flex flex-wrap gap-2">
                    {drafted.legal_citations.map((cite: string, i: number) => (
                      <motion.span
                        key={i}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: i * 0.1 }}
                        className="px-2.5 py-1 text-xs bg-purple-500/10 border border-purple-500/30 text-purple-300 rounded-md shadow-sm"
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
        
        {/* Confidence Metrics */}
        {grievance.systemMetadata?.confidence_metrics && (
          <div className="glass-panel rounded-xl p-5 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <ShieldCheck className="w-4 h-4 text-green-400" />
              <span className="font-medium text-sm">AI Engine Confidence Scoring</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Object.entries(grievance.systemMetadata.confidence_metrics).map(([key, value]) => {
                const score = (value as number) * 100;
                // 🚨 UPGRADE: Dynamic visual thresholds for system safety monitoring
                const scoreColor = score >= 90 ? 'text-green-400' : score >= 75 ? 'text-yellow-400' : 'text-red-400';
                
                return (
                  <div key={key} className="text-center p-3 bg-white/5 rounded-lg border border-white/5">
                    <p className={cn("text-2xl font-bold font-mono tracking-tight", scoreColor)}>
                      {score.toFixed(0)}%
                    </p>
                    <p className="text-xs text-white/60 mt-1 uppercase tracking-wider font-medium">
                      {key.replace(/_/g, ' ')}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        
        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 pt-2">
          <motion.button
            whileHover={{ scale: 1.02, boxShadow: "0 0 20px rgba(99, 102, 241, 0.4)" }}
            whileTap={{ scale: 0.98 }}
            onClick={handleApprove}
            disabled={isLoading || isApproving || isRejecting}
            className={cn(
              'flex-1 glass-btn glass-btn-admin justify-center gap-2 py-3.5 text-base',
              (isLoading || isApproving || isRejecting) && 'opacity-50 cursor-wait'
            )}
          >
            {isApproving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
            {isApproving ? 'Executing Dispatch...' : 'Approve & Dispatch via DKIM'}
          </motion.button>
          
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowRejectModal(true)}
            disabled={isLoading || isApproving || isRejecting}
            className={cn(
              'flex-1 glass-btn glass-btn-outline justify-center gap-2 border-red-500/30 text-red-300 hover:bg-red-500/10 py-3.5 text-base',
              (isLoading || isApproving || isRejecting) && 'opacity-50 cursor-wait'
            )}
          >
            {isRejecting ? <Loader2 className="w-5 h-5 animate-spin" /> : <X className="w-5 h-5" />}
            {isRejecting ? 'Rejecting...' : 'Halt & Reject'}
          </motion.button>
        </div>
      </motion.div>
      
      {/* Reject Modal */}
      <AnimatePresence>
        {showRejectModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
            onClick={() => setShowRejectModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="glass-panel w-full max-w-lg rounded-2xl p-6 border-red-500/20 shadow-[0_0_50px_rgba(239,68,68,0.1)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-4 mb-5">
                <div className="p-3 rounded-xl bg-red-500/20 text-red-400 border border-red-500/30">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-xl font-bold text-slate-200">Reject Grievance</h4>
                  <p className="text-sm text-slate-400 mt-1">
                    This will permanently halt the LangGraph execution. The citizen will be notified with your reasoning below.
                  </p>
                </div>
              </div>
              
              <textarea
                ref={rejectInputRef} // 🚨 FIX: Safe React Ref attachment
                id="reject-reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Specify regulatory, evidentiary, or duplicate failure reasons..."
                className="glass-input w-full min-h-[140px] mb-6 resize-none"
                disabled={isRejecting}
              />
              
              <div className="flex gap-3">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    setShowRejectModal(false);
                    setRejectReason('');
                  }}
                  disabled={isRejecting}
                  className="flex-1 glass-btn glass-btn-outline justify-center py-3"
                >
                  Cancel
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleReject}
                  disabled={!rejectReason.trim() || isRejecting}
                  className={cn(
                    'flex-1 glass-btn justify-center bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/50 py-3',
                    (!rejectReason.trim() || isRejecting) && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  {isRejecting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Confirm Termination'}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}