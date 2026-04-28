// app/(admin)/components/GraphVisualizer.tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { 
  Play, Pause, RotateCcw, Check, X, AlertCircle, ChevronDown, 
  ChevronRight, Copy, ExternalLink, RefreshCw, ShieldCheck,
  MessageSquare, MapPin, Image as ImageIcon, FileText, Send,
  Maximize2, Minimize2, Mail, Loader2
} from 'lucide-react';
import { toast } from 'react-hot-toast';

import { apiClient } from '@/lib/api-client';
import { cn, formatRelativeTime } from '@/lib/utils';
import { useRealTime } from '../layout';

// =============================================================================
// TYPES
// =============================================================================

type GraphNode = {
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

type GraphEdge = {
  source: string;
  target: string;
  status: 'active' | 'completed' | 'failed';
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
    pending: 'border-white/20 bg-white/5',
    running: 'border-blue-500/50 bg-blue-500/10 animate-pulse',
    success: 'border-green-500/50 bg-green-500/10',
    error: 'border-red-500/50 bg-red-500/10',
    skipped: 'border-white/10 bg-white/5 opacity-60',
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
      'glass-panel rounded-xl border overflow-hidden transition-all',
      statusColors[node.status]
    )}>
      {/* Node header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/5 transition-colors"
      >
        <div className={cn(
          'p-2 rounded-lg',
          node.status === 'success' ? 'bg-green-500/20 text-green-400' :
          node.status === 'error' ? 'bg-red-500/20 text-red-400' :
          node.status === 'running' ? 'bg-blue-500/20 text-blue-400 animate-pulse' :
          'bg-white/10 text-white/60'
        )}>
          <Icon className="w-4 h-4" />
        </div>
        
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{node.name}</p>
          <p className="text-xs text-white/60 mt-0.5">
            {node.startTime ? formatRelativeTime(node.startTime) : 'Pending'}
            {node.duration && ` • ${node.duration}ms`}
          </p>
        </div>
        
        {node.confidence !== undefined && (
          <div className="text-right hidden sm:block">
            <p className="text-sm font-mono font-bold text-[var(--primary)]">
              {(node.confidence * 100).toFixed(0)}%
            </p>
            <p className="text-xs text-white/60">confidence</p>
          </div>
        )}
        
        <ChevronDown className={cn(
          'w-4 h-4 text-white/40 transition-transform',
          isExpanded && 'rotate-180'
        )} />
      </button>
      
      {/* Node details (expandable) */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-white/10"
          >
            <div className="p-4 space-y-4">
              {/* Input/Output */}
              {node.input && (
                <div>
                  <p className="text-xs font-medium text-white/60 mb-2">Input</p>
                  <pre className="text-xs bg-black/30 rounded-lg p-3 overflow-x-auto max-h-32">
                    {JSON.stringify(node.input, null, 2).slice(0, 500)}
                    {JSON.stringify(node.input).length > 500 && '...'}
                  </pre>
                </div>
              )}
              
              {node.output && (
                <div>
                  <p className="text-xs font-medium text-white/60 mb-2">Output</p>
                  <pre className="text-xs bg-black/30 rounded-lg p-3 overflow-x-auto max-h-32">
                    {JSON.stringify(node.output, null, 2).slice(0, 500)}
                    {JSON.stringify(node.output).length > 500 && '...'}
                  </pre>
                </div>
              )}
              
              {/* Metadata cards */}
              {node.metadata && (
                <div className="space-y-2">
                  {node.metadata.authScore !== undefined && (
                    <div className="glass-panel rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <ShieldCheck className="w-4 h-4 text-green-400" />
                        <span className="text-xs font-medium">Verification Result</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Authenticity Score</span>
                        <span className="font-mono font-bold text-[var(--primary)]">
                          {(node.metadata.authScore * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  )}
                  
                  {node.metadata.officialEmail && (
                    <div className="glass-panel rounded-lg p-3 border border-green-500/30 bg-green-500/5">
                      <div className="flex items-center gap-2 mb-1">
                        <Mail className="w-4 h-4 text-green-400" />
                        <span className="text-xs font-medium text-green-300">Dispatched To</span>
                      </div>
                      <p className="text-sm font-mono text-green-300 break-all">
                        {node.metadata.officialEmail}
                      </p>
                    </div>
                  )}
                </div>
              )}
              
              {/* Error details */}
              {node.error && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <p className="text-sm font-medium text-red-300 mb-1">Error</p>
                  <p className="text-xs text-red-200/80">{node.error}</p>
                </div>
              )}
              
              {/* Actions */}
              <div className="flex items-center gap-2 pt-2 border-t border-white/10">
                <button className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-white/10 hover:bg-white/20 rounded-lg transition-colors">
                  <Copy className="w-3 h-3" />
                  Copy Output
                </button>
                {node.status === 'error' && onRetry && (
                  <button 
                    onClick={onRetry}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 rounded-lg transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Retry Node
                  </button>
                )}
                {node.output && (
                  <button className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-white/10 hover:bg-white/20 rounded-lg transition-colors ml-auto">
                    <ExternalLink className="w-3 h-3" />
                    View Details
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
  
  // Fetch graph state
  const { data: graphState, isLoading, refetch } = useQuery({
    queryKey: ['admin', 'graph', threadId],
    queryFn: () => apiClient.fetchGraphState(threadId),
    enabled: !!threadId && !isPreview
  });
  
  // Real-time subscription
  useEffect(() => {
    if (!threadId || isPreview) return;
    
    const unsubscribe = subscribe(threadId, (update) => {
      // Optimistic update: refetch graph state
      refetch();
      
      // Show toast for important updates
      if (update.type === 'node_completed' && update.node === 'verification_gate') {
        toast('Case ready for review', { icon: 'ℹ️' });
      }
    });
    
    return unsubscribe;
  }, [threadId, subscribe, refetch, isPreview]);
  
  // Mock data for preview mode
  const mockNodes: GraphNode[] = isPreview ? [
    {
      id: 'ingest',
      name: 'Ingest & Sanitize',
      status: 'success',
      startTime: new Date(Date.now() - 30000).toISOString(),
      endTime: new Date(Date.now() - 28000).toISOString(),
      duration: 2000,
      input: { text: 'Garbage not collected...', image_url: '...' },
      output: { extracted_text: 'Garbage not collected...', language: 'en' },
      confidence: 0.99,
    },
    {
      id: 'vlm_verify',
      name: 'VLM Image Verification',
      status: 'success',
      startTime: new Date(Date.now() - 28000).toISOString(),
      endTime: new Date(Date.now() - 24000).toISOString(),
      duration: 4000,
      input: { image_url: '...', context: 'Garbage complaint' },
      output: { is_genuine: true, confidence_score: 0.94, severity: 'MEDIUM' },
      confidence: 0.94,
      metadata: { authScore: 0.94 }
    },
    {
      id: 'resolve_jurisdiction',
      name: 'Jurisdiction Resolution',
      status: 'success',
      startTime: new Date(Date.now() - 24000).toISOString(),
      endTime: new Date(Date.now() - 22000).toISOString(),
      duration: 2000,
      input: { text: '...', location: { lat: 22.57, lon: 88.41 } },
      output: { district: 'North 24 Parganas', ward: '45' },
      confidence: 0.92,
      metadata: { jurisdiction: { district: 'North 24 Parganas', ward: '45' } }
    },
    {
      id: 'discover_contact',
      name: 'Contact Discovery',
      status: 'success',
      startTime: new Date(Date.now() - 22000).toISOString(),
      endTime: new Date(Date.now() - 18000).toISOString(),
      duration: 4000,
      input: { jurisdiction: { ward: "45" } },
      output: { officialEmail: 'cmoh-n24p@wbhealth.gov.in', verification: 'VERIFIED' },
      confidence: 0.98,
      metadata: { officialEmail: 'cmoh-n24p@wbhealth.gov.in' }
    },
    {
      id: 'draft_letter',
      name: 'Legal Draft Generation',
      status: 'success',
      startTime: new Date(Date.now() - 18000).toISOString(),
      endTime: new Date(Date.now() - 15000).toISOString(),
      duration: 3000,
      input: { issue: 'sanitation', jurisdiction: { ward: "45" } },
      output: { subject: 'Grievance: Waste Collection...', body: '...' },
      confidence: 0.96,
      metadata: { draftedContent: 'Formal complaint drafted...' }
    },
    {
      id: 'verification_gate',
      name: 'Verification Gatekeeper',
      status: 'running',
      startTime: new Date(Date.now() - 15000).toISOString(),
      input: { auth_score: 0.94, severity: 'MEDIUM' },
      confidence: undefined,
    },
  ] : (graphState?.nodes || []);
  
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
  
  const handleRetry = async (node: GraphNode) => {
    try {
      await apiClient.retryGraphNode(threadId, node.id);
      toast.success(`Retrying ${node.name}`);
      refetch();
    } catch (error) {
      toast.error(`Retry failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };
  
  if (isLoading && !isPreview) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--admin-accent)]" />
      </div>
    );
  }
  
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 pb-4 border-b border-white/10">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-semibold">Workflow Execution</h3>
          <div className="flex items-center gap-2 text-xs text-white/60">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-400" /> Success
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" /> Running
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-400" /> Error
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode(viewMode === 'simplified' ? 'detailed' : 'simplified')}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            title={viewMode === 'simplified' ? 'Show detailed view' : 'Show simplified view'}
          >
            {viewMode === 'simplified' ? (
              <Maximize2 className="w-4 h-4" />
            ) : (
              <Minimize2 className="w-4 h-4" />
            )}
          </button>
          {!isPreview && (
            <button
              onClick={() => refetch()}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      
      {/* Graph container */}
      <div 
        ref={containerRef}
        className="flex-1 overflow-y-auto space-y-3 pr-2"
        style={{ scrollbarWidth: 'thin' }}
      >
        {mockNodes.map((node) => (
          <GraphNodeVisual
            key={node.id}
            node={node}
            isExpanded={expandedNodes.has(node.id)}
            onToggle={() => {
              toggleNode(node.id);
              if (onNodeClick) onNodeClick(node);
            }}
            onRetry={() => handleRetry(node)}
          />
        ))}
      </div>
      
      {/* Legend for preview mode */}
      {isPreview && (
        <div className="mt-4 pt-4 border-t border-white/10 text-xs text-white/60">
          <p>Preview mode: Showing sample workflow. Click nodes to expand details.</p>
        </div>
      )}
    </div>
  );
}