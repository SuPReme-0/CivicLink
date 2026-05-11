'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { 
  Play, Pause, RotateCcw, Check, X, AlertCircle, ChevronDown, 
  ChevronRight, Copy, ExternalLink, RefreshCw, ShieldCheck,
  Terminal, Network, Zap, Maximize2, Minimize2, Loader2
} from 'lucide-react';
import { toast } from 'react-hot-toast';

import { cn, formatRelativeTime } from '@/lib/utils';
import { useRealTime } from '../layout';
import { apiClient } from '@/lib/api-client';

// =============================================================================
// TYPES
// =============================================================================

export type GraphNode = {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'success' | 'error' | 'skipped';
  startTime?: string;
  endTime?: string;
  duration?: number;
  input?: any;
  output?: any;
  error?: string;
  confidence?: number;
  metadata?: {
    authScore?: number;
    jurisdiction?: any;
    officialEmail?: string;
    draftedContent?: string;
  };
};

// =============================================================================
// NODE VISUAL COMPONENT
// =============================================================================

function GraphNodeVisual({ 
  node, 
  isExpanded, 
  onToggle,
  onRetry
}: { 
  node: GraphNode; 
  isExpanded: boolean; 
  onToggle: () => void;
  onRetry?: () => void;
}) {
  const statusColors: Record<GraphNode['status'], string> = {
    pending: 'border-white/[0.05] bg-white/[0.01]',
    running: 'border-purple-500/40 bg-purple-500/10 shadow-[0_0_15px_rgba(147,51,234,0.15)]',
    success: 'border-emerald-500/20 bg-emerald-500/[0.05]',
    error: 'border-rose-500/40 bg-rose-500/10 shadow-[0_0_15px_rgba(225,29,72,0.1)]',
    skipped: 'border-white/[0.02] bg-white/[0.01] opacity-50',
  };
  
  const statusIcons: Record<GraphNode['status'], React.ElementType> = {
    pending: ChevronRight,
    running: RefreshCw,
    success: Check,
    error: AlertCircle,
    skipped: Pause,
  };
  
  const Icon = statusIcons[node.status];
  
  return (
    <div className={cn(
      'rounded-xl border overflow-hidden transition-all duration-500 backdrop-blur-md',
      statusColors[node.status],
      isExpanded && 'bg-black/40'
    )}>
      {/* --- NODE HEADER --- */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-4 p-4 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className={cn(
          'p-2.5 rounded-lg border flex-shrink-0 transition-all duration-300',
          node.status === 'success' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
          node.status === 'error' ? 'bg-rose-500/20 text-rose-400 border-rose-500/30' :
          node.status === 'running' ? 'bg-purple-500/20 text-purple-400 animate-spin border-purple-500/30' :
          'bg-white/5 text-slate-500 border-white/5'
        )}>
          <Icon className="w-4 h-4" />
        </div>
        
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm text-slate-200 tracking-wide truncate">
            {node.name}
          </p>
          <p className="text-[10px] font-mono tracking-widest uppercase text-slate-500 mt-1">
            {node.startTime ? formatRelativeTime(node.startTime) : 'Awaiting Execution'}
            {node.duration && <span className="text-purple-400/70 ml-2">[{node.duration}ms]</span>}
          </p>
        </div>
        
        {node.confidence !== undefined && (
          <div className="text-right hidden sm:block">
            <p className="text-lg font-black font-mono tracking-tighter text-emerald-400 drop-shadow-sm">
              {(node.confidence * 100).toFixed(0)}<span className="text-xs opacity-50">%</span>
            </p>
            <p className="text-[9px] uppercase tracking-widest font-bold text-slate-600">CONFIDENCE</p>
          </div>
        )}
        
        <ChevronDown className={cn(
          'w-4 h-4 text-slate-500 transition-transform duration-300 ml-2',
          isExpanded && 'rotate-180 text-purple-400'
        )} />
      </button>
      
      {/* --- NODE DETAILS (Expanded) --- */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-white/[0.05]"
          >
            <div className="p-5 space-y-5 bg-black/20">
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {node.input && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">
                      <Terminal className="w-3 h-3 text-slate-400" /> Ingestion Payload
                    </p>
                    <div className="bg-[#050208] border border-white/[0.05] rounded-xl p-3 overflow-x-auto max-h-40 thin-scrollbar">
                      <pre className="text-[10px] font-mono text-slate-400 leading-relaxed">
                        {JSON.stringify(node.input, null, 2).slice(0, 800)}
                        {JSON.stringify(node.input).length > 800 && '\n\n... [TRUNCATED]'}
                      </pre>
                    </div>
                  </div>
                )}
                
                {node.output && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">
                      <Network className="w-3 h-3 text-purple-400" /> Emitted Tensor
                    </p>
                    <div className="bg-[#050208] border border-purple-500/20 rounded-xl p-3 overflow-x-auto max-h-40 thin-scrollbar">
                      <pre className="text-[10px] font-mono text-emerald-400/80 leading-relaxed">
                        {JSON.stringify(node.output, null, 2).slice(0, 800)}
                        {JSON.stringify(node.output).length > 800 && '\n\n... [TRUNCATED]'}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
              
              {node.error && (
                <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] uppercase tracking-widest font-bold text-rose-400 mb-1">Execution Failure</p>
                    <p className="text-xs text-rose-200/80 font-mono leading-relaxed">{node.error}</p>
                  </div>
                </div>
              )}
              
              <div className="flex items-center gap-3 pt-3">
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(node, null, 2));
                    toast.success('Log Copied');
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase tracking-widest font-bold text-slate-400 hover:text-white bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.05] rounded-lg transition-colors"
                >
                  <Copy className="w-3 h-3" /> Copy Log
                </button>
                {node.status === 'error' && onRetry && (
                  <button 
                    onClick={onRetry}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase tracking-widest font-bold text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 rounded-lg transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" /> Force Retry
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// =============================================================================
// MAIN GRAPH VISUALIZER COMPONENT
// =============================================================================

export function GraphVisualizer({ 
  threadId, 
  isPreview = false,
  onNodeClick
}: { 
  threadId: string;
  isPreview?: boolean;
  onNodeClick?: (node: GraphNode) => void;
}) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'simplified' | 'detailed'>('simplified');
  const containerRef = useRef<HTMLDivElement>(null);
  
  const { subscribe } = useRealTime();
  
  // 🚨 FIXED: Now hits the real LangGraph state via secureAdminFetch
  const { data: graphState, isLoading, refetch } = useQuery({
    queryKey: ['admin', 'graph', threadId],
    queryFn: () => apiClient.fetchGraphState(threadId),
    enabled: !!threadId && !isPreview,
    refetchInterval: 3000 // Fast polling to watch AI process in real-time
  });
  
  useEffect(() => {
    if (!threadId || isPreview) return;
    
    const unsubscribe = subscribe(threadId, (update) => {
      refetch();
      if (update.type === 'node_completed' && update.node === 'verification_gate') {
        toast.success('Authorization Required: Thread pending review.', {
          style: { background: 'rgba(20,10,30,0.9)', color: '#9333ea', border: '1px solid rgba(147,51,234,0.3)' }
        });
      }
    });
    
    return unsubscribe;
  }, [threadId, subscribe, refetch, isPreview]);
  
  const toggleNode = (nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };
  
  // 🚨 FIXED: Now hits the secure retry endpoint
  const handleRetry = async (node: GraphNode) => {
    try {
      await apiClient.retryGraphNode(threadId, node.id);
      toast.success(`Directive accepted. Retrying ${node.name}.`);
      refetch();
    } catch (error) {
      toast.error(`Retry failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // 🚨 REMOVED ALL MOCK DATA! It strictly uses the live backend response now.
  const activeNodes: GraphNode[] = graphState?.nodes || [];
  
  if (isLoading && !isPreview) {
    return (
      <div className="flex items-center justify-center h-full min-h-[300px]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Querying Graph State...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="h-full flex flex-col p-4">
      <div className="flex items-center justify-between mb-4 pb-4 border-b border-white/[0.05]">
        <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400" /> Success
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse shadow-[0_0_8px_rgba(147,51,234,0.6)]" /> Processing
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-400" /> Error
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode(viewMode === 'simplified' ? 'detailed' : 'simplified')}
            className="p-2 hover:bg-white/[0.05] border border-transparent hover:border-white/10 rounded-lg transition-colors text-slate-400 hover:text-white"
            title={viewMode === 'simplified' ? 'Expand Data' : 'Collapse Data'}
          >
            {viewMode === 'simplified' ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
          </button>
          {!isPreview && (
            <button
              onClick={() => refetch()}
              className="p-2 hover:bg-white/[0.05] border border-transparent hover:border-white/10 rounded-lg transition-colors text-slate-400 hover:text-white"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      
      <div ref={containerRef} className="flex-1 overflow-y-auto space-y-2.5 pr-2 thin-scrollbar">
        {activeNodes.length > 0 ? (
          activeNodes.map((node) => (
            <GraphNodeVisual
              key={node.id}
              node={node}
              isExpanded={expandedNodes.has(node.id) || viewMode === 'detailed'}
              onToggle={() => {
                toggleNode(node.id);
                if (onNodeClick) onNodeClick(node);
              }}
              onRetry={() => handleRetry(node)}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
             <Network className="w-8 h-8 mb-4 opacity-30 text-purple-500" />
             <p className="text-[10px] font-bold tracking-widest uppercase">No Telemetry Available</p>
             <p className="text-xs font-mono mt-1 opacity-70">Awaiting Graph Execution...</p>
          </div>
        )}
      </div>
    </div>
  );
}