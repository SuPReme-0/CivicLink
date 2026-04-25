// app/(customer)/page.tsx
'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence, useScroll, useSpring } from 'framer-motion';
import { useMutation } from '@tanstack/react-query';
import { 
  Send, Image as ImageIcon, Mic, MapPin, Check, CheckCheck, 
  Loader2, AlertCircle, X, Map, ShieldCheck, FileText, Mail, User
} from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';

import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { IngestPayload, IngestResponse, GrievanceStatus, LocationData } from '@/types';

// =============================================================================
// TYPES & CONSTANTS
// =============================================================================

type Message = {
  id: string;
  role: 'user' | 'system';
  content: string;
  timestamp: Date;
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'processing' | 'error';
  attachment?: {
    type: 'image' | 'voice' | 'location';
    url?: string;
    preview?: string;
    location?: LocationData;
  };
  metadata?: {
    authScore?: number;
    issueCategory?: string;
    officialEmail?: string;
    draftedContent?: string;
  };
};

type ChatState = {
  messages: Message[];
  isTyping: boolean;
  trackingId?: string;
  currentStatus?: GrievanceStatus;
  location?: LocationData;
  lastUpdatedAt?: string;
};

const INITIAL_MESSAGE: Message = {
  id: 'welcome',
  role: 'system',
  content: "👋 Hello! I'm CivicLink Assistant. Send me a message, photo, or voice note about any civic issue. I'll verify, route, and dispatch it to the right official—securely and instantly.",
  timestamp: new Date(),
  status: 'delivered'
};

// Conversational status messages (more natural than robotic status labels)
const CONVERSATIONAL_MESSAGES: Partial<Record<GrievanceStatus, string>> = {
  RECEIVED: "✅ Received your grievance. Starting verification process...",
  VERIFYING_IMAGE: "🔍 Analyzing image authenticity using AI forensics...",
  ROUTING_JURISDICTION: "📍 Pinpointing the responsible government jurisdiction...",
  DISCOVERING_CONTACT: "👔 Finding the correct official's verified contact information...",
  DRAFTING_LETTER: "✍️ Drafting formal legal complaint with municipal bylaws...",
  AWAITING_REVIEW: "⏳ Final verification before secure dispatch...",
  DISPATCHING: "📤 Digitally signing and dispatching to official...",
  DISPATCHED: "🎉 Successfully dispatched! I'll monitor for a reply.",
  FAILED: "⚠️ Something went wrong. Please try again or contact support.",
  RESOLVED: "✅ The official has marked this issue as resolved. Thank you for your patience!",
  REJECTED_FRAUD: "🚫 Submission flagged for manual review. Please contact support if this is an error.",
  ESCALATED: "⬆️ Escalated to higher authority for urgent attention."
};

const DEFAULT_STATUS_MESSAGE = "🔄 Processing your grievance...";

// =============================================================================
// UTILITY HOOKS & COMPONENTS
// =============================================================================

// Client-only time for hydration-safe timestamps
const useClientTime = () => {
  const [now, setNow] = useState<Date>(new Date());
  
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  
  return now;
};

const formatRelativeTime = (date: Date | string, clientNow: Date) => {
  const d = new Date(date);
  const diffMs = clientNow.getTime() - d.getTime();
  const diffMins = Math.round(diffMs / 60000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.round(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return d.toLocaleDateString();
};

// Animated message bubble with rich content support
const MessageBubble = ({ message, clientNow }: { message: Message; clientNow: Date }) => {
  const isUser = message.role === 'user';
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'chat-bubble mb-4',
        isUser ? 'chat-bubble-out' : 'chat-bubble-in'
      )}
    >
      {/* Attachment preview */}
      {message.attachment && (
        <div className="mb-3">
          {message.attachment.type === 'image' && message.attachment.preview && (
            <div className="attachment-preview rounded-xl overflow-hidden">
              <img 
                src={message.attachment.preview} 
                alt="Attachment" 
                className="image-fade loading w-full max-w-[200px] object-cover"
                onLoad={(e) => e.currentTarget.classList.add('loaded')}
              />
            </div>
          )}
          
          {message.attachment.type === 'location' && message.attachment.location && (
            <div className="glass-panel p-3 rounded-xl flex items-center gap-3">
              <Map className="w-5 h-5 text-[var(--primary)] flex-shrink-0" />
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">
                  {message.attachment.location.address_text || 'Location attached'}
                </p>
                <p className="text-xs text-white/60">
                  {message.attachment.location.lat.toFixed(4)}, {message.attachment.location.lon.toFixed(4)}
                </p>
              </div>
            </div>
          )}
          
          {message.attachment.type === 'voice' && (
            <div className="glass-panel p-3 rounded-xl flex items-center gap-3">
              <Mic className="w-5 h-5 text-[var(--primary)] flex-shrink-0" />
              <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-[var(--primary)] rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: '60%' }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                />
              </div>
              <span className="text-xs text-white/60">0:12</span>
            </div>
          )}
        </div>
      )}
      
      {/* Message content with markdown-like formatting */}
      <div className="text-sm leading-relaxed whitespace-pre-wrap">
        {message.content.split('\n').map((line, i) => {
          // Bold text for emphasis
          if (line.startsWith('**') && line.endsWith('**')) {
            return <strong key={i} className="font-semibold">{line.slice(2, -2)}</strong>;
          }
          // Email highlighting
          if (line.includes('@') && line.includes('.')) {
            return (
              <span key={i} className="text-[var(--primary)] font-mono">
                {line}
              </span>
            );
          }
          return <span key={i}>{line}<br /></span>;
        })}
      </div>
      
      {/* Metadata cards for rich bot replies */}
      {message.metadata && (
        <div className="mt-3 space-y-2">
          {message.metadata.authScore !== undefined && (
            <div className="glass-panel rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck className="w-4 h-4 text-green-400" />
                <span className="text-xs font-medium">Verification Result</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Authenticity Score</span>
                <span className="font-mono font-bold text-[var(--primary)]">
                  {(message.metadata.authScore * 100).toFixed(0)}%
                </span>
              </div>
              {message.metadata.issueCategory && (
                <p className="text-xs text-white/60 mt-1">
                  Issue: {message.metadata.issueCategory.replace('_', ' ')}
                </p>
              )}
            </div>
          )}
          
          {message.metadata.draftedContent && (
            <div className="glass-panel rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <FileText className="w-4 h-4 text-[var(--primary)]" />
                <span className="text-xs font-medium">Drafted Complaint</span>
              </div>
              <p className="text-xs text-white/80 italic line-clamp-3">
                "{message.metadata.draftedContent}"
              </p>
            </div>
          )}
          
          {message.metadata.officialEmail && (
            <div className="glass-panel rounded-lg p-3 border border-green-500/30 bg-green-500/5">
              <div className="flex items-center gap-2 mb-1">
                <Mail className="w-4 h-4 text-green-400" />
                <span className="text-xs font-medium text-green-300">Successfully Dispatched</span>
              </div>
              <p className="text-sm font-mono text-green-300 break-all">
                {message.metadata.officialEmail}
              </p>
            </div>
          )}
        </div>
      )}
      
      {/* Timestamp & status */}
      <div className="flex items-center justify-end gap-2 mt-2">
        <span className="text-xs text-white/50">
          {formatRelativeTime(message.timestamp, clientNow)}
        </span>
        
        {isUser && message.status && (
          <div className={cn('message-status', {
            'text-blue-400': message.status === 'read',
            'text-white/70': message.status === 'sent' || message.status === 'delivered',
            'text-red-400': message.status === 'error'
          })}>
            {message.status === 'sending' && <Loader2 className="w-3 h-3 animate-spin" />}
            {message.status === 'sent' && <Check className="w-3 h-3" />}
            {(message.status === 'delivered' || message.status === 'read') && (
              <CheckCheck className="w-3 h-3" />
            )}
            {message.status === 'processing' && <Loader2 className="w-3 h-3 animate-spin text-[var(--primary)]" />}
            {message.status === 'error' && <AlertCircle className="w-3 h-3" />}
          </div>
        )}
      </div>
    </motion.div>
  );
};

// Typing indicator with animated dots
const TypingIndicator = () => (
  <motion.div
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -10 }}
    className="chat-bubble chat-bubble-in mb-4"
  >
    <div className="typing-indicator">
      {[0, 1, 2].map((i) => (
        <span key={i} className="typing-dot" style={{ '--i': i } as React.CSSProperties} />
      ))}
    </div>
  </motion.div>
);

// Location picker modal
const LocationPicker = ({ 
  isOpen, 
  onClose, 
  onSelect 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  onSelect: (location: LocationData) => void 
}) => {
  const [selected, setSelected] = useState<LocationData>();
  
  const handleUseCurrent = async () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation not supported');
      return;
    }
    
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        });
      });
      
      const { latitude, longitude } = position.coords;
      const location: LocationData = { 
        lat: latitude, 
        lon: longitude, 
        type: 'gps',
        address_text: 'Current location'
      };
      setSelected(location);
      onSelect(location);
      onClose();
      toast.success('Location attached');
    } catch (error) {
      toast.error('Could not get location. Please enable permissions.');
    }
  };
  
  if (!isOpen) return null;
  
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="glass-panel w-full max-w-md rounded-3xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <MapPin className="w-5 h-5 text-[var(--primary)]" />
            Attach Location
          </h3>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Map placeholder */}
        <div className="aspect-video bg-gradient-to-br from-blue-900/30 to-purple-900/30 rounded-2xl border border-white/10 mb-6 flex items-center justify-center">
          <div className="text-center">
            <Map className="w-12 h-12 text-white/40 mx-auto mb-3" />
            <p className="text-white/60 text-sm">Map preview</p>
            <p className="text-white/40 text-xs mt-1">
              {selected ? `${selected.lat.toFixed(4)}, ${selected.lon.toFixed(4)}` : 'Select location'}
            </p>
          </div>
        </div>
        
        {/* Actions */}
        <div className="space-y-3">
          <button
            onClick={handleUseCurrent}
            className="glass-btn w-full justify-center gap-2"
          >
            <MapPin className="w-4 h-4" />
            Use Current Location
          </button>
          
          <button
            onClick={onClose}
            className="glass-btn glass-btn-outline w-full justify-center"
          >
            Cancel
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

// Status tracking panel with real-time updates
const StatusPanel = ({ 
  trackingId, 
  status,
  lastUpdatedAt 
}: { 
  trackingId?: string; 
  status?: GrievanceStatus;
  lastUpdatedAt?: string;
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const clientNow = useClientTime();
  
  if (!trackingId) return null;
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-panel rounded-2xl p-4 mb-4"
    >
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-3">
          <div className="live-indicator">
            <span className="live-dot" />
            <span className="text-xs font-medium">Live Tracking</span>
          </div>
          <span className="text-sm font-mono text-[var(--primary)]">{trackingId}</span>
        </div>
        <motion.span
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="text-white/60"
        >
          ▼
        </motion.span>
      </button>
      
      <AnimatePresence>
        {isExpanded && status && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 pt-4 border-t border-white/10"
          >
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-[var(--status-success)] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium mb-1">
                  {CONVERSATIONAL_MESSAGES[status] || DEFAULT_STATUS_MESSAGE}
                </p>
                <p className="text-xs text-white/60">
                  Last updated: {lastUpdatedAt ? formatRelativeTime(lastUpdatedAt, clientNow) : 'Just now'}
                </p>
              </div>
            </div>
            
            {/* Progress steps */}
            <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-2">
              {(['RECEIVED', 'VERIFYING_IMAGE', 'ROUTING_JURISDICTION', 'DISPATCHED'] as const).map((step, i) => {
                const statusOrder = Object.keys(CONVERSATIONAL_MESSAGES);
                const currentIndex = status ? statusOrder.indexOf(status) : -1;
                const stepIndex = statusOrder.indexOf(step);
                const isActive = currentIndex >= stepIndex && stepIndex !== -1;
                
                return (
                  <div key={step} className="flex items-center gap-2 flex-shrink-0">
                    <div className={cn(
                      'w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-all',
                      isActive 
                        ? 'bg-[var(--primary)] text-black' 
                        : 'bg-white/10 text-white/40'
                    )}>
                      {i + 1}
                    </div>
                    {i < 3 && (
                      <div className={cn(
                        'w-8 h-0.5 rounded-full transition-all',
                        isActive ? 'bg-[var(--primary)]' : 'bg-white/10'
                      )} />
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function CustomerChatPage() {
  const [input, setInput] = useState('');
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [attachedPreview, setAttachedPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll();
  const smoothScroll = useSpring(scrollYProgress, { stiffness: 100, damping: 30 });
  
  // ✅ FIX: Client-only time for hydration safety
  const clientNow = useClientTime();
  
  // ✅ NEW: Track which milestones we've already announced to avoid duplicates
  const announcedMilestones = useRef<Set<string>>(new Set());
  
  // Chat state
  const [chatState, setChatState] = useState<ChatState>({
    messages: [INITIAL_MESSAGE],
    isTyping: false
  });
  
  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatState.messages, chatState.isTyping]);
  
  // ✅ REAL POLLING: Fetch actual LangGraph state from FastAPI
  useEffect(() => {
    const trackingId = chatState.trackingId;
    if (!trackingId) return;
    
    const interval = setInterval(async () => {
      try {
        // ✅ CORRECT (Using the public method we defined)
        const data = await apiClient.getStatus(trackingId);
        
        if (data.status === 'found') {
          // Update the top status bar if state changed
          if (data.current_state !== chatState.currentStatus) {
            setChatState(prev => ({ 
              ...prev, 
              currentStatus: data.current_state,
              lastUpdatedAt: new Date().toISOString() 
            }));
          }

          // ✅ CONVERSATIONAL MILESTONES: Inject contextual bot replies
          const newMessages: Message[] = [];

          // Milestone A: VLM Verification Complete
          if (
            data.system_metadata?.auth_score !== undefined && 
            !announcedMilestones.current.has('vlm_verified')
          ) {
            const score = (data.system_metadata.auth_score * 100).toFixed(0);
            const issue = data.issue_category?.replace('_', ' ') || 'civic issue';
            
            newMessages.push({
              id: `vlm-${Date.now()}`,
              role: 'system',
              content: `🔍 **Forensics Complete:** I've analyzed the image. Authenticity score is **${score}%**. Issue categorized as: **${issue}**.`,
              timestamp: new Date(),
              status: 'delivered',
              metadata: {
                authScore: data.system_metadata.auth_score,
                issueCategory: data.issue_category
              }
            });
            announcedMilestones.current.add('vlm_verified');
          }

          // Milestone B: Jurisdiction Resolved
          if (
            data.system_metadata?.jurisdiction && 
            !announcedMilestones.current.has('jurisdiction_found')
          ) {
            const { district, state, ward } = data.system_metadata.jurisdiction;
            newMessages.push({
              id: `jurisdiction-${Date.now()}`,
              role: 'system',
              content: `📍 **Jurisdiction Identified:** This falls under **${ward ? `${ward}, ` : ''}${district}, ${state}**. Locating the responsible official...`,
              timestamp: new Date(),
              status: 'delivered'
            });
            announcedMilestones.current.add('jurisdiction_found');
          }

          // Milestone C: Contact Discovered
          if (
            data.system_metadata?.official_email && 
            !announcedMilestones.current.has('contact_found')
          ) {
            newMessages.push({
              id: `contact-${Date.now()}`,
              role: 'system',
              content: `👔 **Official Found:** Verified contact for **${data.system_metadata.official_designation || 'the responsible authority'}**.`,
              timestamp: new Date(),
              status: 'delivered'
            });
            announcedMilestones.current.add('contact_found');
          }

          // Milestone D: Letter Drafted
          if (
            data.description_text && 
            data.current_state === 'DRAFTING_LETTER' && 
            !announcedMilestones.current.has('letter_drafted')
          ) {
            const preview = data.description_text.substring(0, 120) + (data.description_text.length > 120 ? '...' : '');
            newMessages.push({
              id: `draft-${Date.now()}`,
              role: 'system',
              content: `✍️ **Draft Generated:** I've written the formal legal directive based on municipal bylaws.\n\n"_${preview}_"\n\nLocating the correct official now.`,
              timestamp: new Date(),
              status: 'delivered',
              metadata: {
                draftedContent: preview
              }
            });
            announcedMilestones.current.add('letter_drafted');
          }

        // Milestone E: Successfully Dispatched
          const records = data.dispatch_records; // 1. Extract to local variable
          
          if (
            data.current_state === 'DISPATCHED' && 
            records && // 2. Prove it exists
            records.length > 0 && // 3. Prove it's not empty
            !announcedMilestones.current.has('dispatched')
          ) {
            // TypeScript now 100% trusts that `records[0]` is safe to access
            const officialEmail = records[0].email;
            const officialName = records[0].official_name || 'the responsible official';
            
            newMessages.push({
              id: `dispatch-${Date.now()}`,
              role: 'system',
              content: `📤 **Success!** The formal grievance has been digitally signed via DKIM and securely dispatched to:\n\n👤 **${officialName}**\n📧 **${officialEmail}**\n\nI will monitor their inbox for a reply. You can track updates here.`,
              timestamp: new Date(),
              status: 'delivered',
              metadata: {
                officialEmail: officialEmail
              }
            });
            announcedMilestones.current.add('dispatched');
          }

          // Milestone F: Issue Resolved
          if (
            data.current_state === 'RESOLVED' && 
            !announcedMilestones.current.has('resolved')
          ) {
            newMessages.push({
              id: `resolved-${Date.now()}`,
              role: 'system',
              content: `✅ **Issue Resolved!** The official has marked your grievance as resolved. Thank you for helping improve our community!`,
              timestamp: new Date(),
              status: 'delivered'
            });
            announcedMilestones.current.add('resolved');
          }

          // Inject the new conversational messages into the chat
          if (newMessages.length > 0) {
            setChatState(prev => ({
              ...prev,
              messages: [...prev.messages, ...newMessages]
            }));
          }
        }
      } catch (error) {
        console.error('Real status poll error:', error);
      }
    }, 3000); // Poll every 3 seconds
    
    return () => clearInterval(interval);
  }, [chatState.trackingId, chatState.currentStatus]);
  
  // Submit grievance mutation
  const submitMutation = useMutation({
    mutationFn: async (payload: IngestPayload) => {
      return apiClient.submitGrievance(payload);
    },
    onMutate: () => {
      // Optimistic update: mark last user message as "processing"
      setChatState(prev => ({
        ...prev,
        messages: prev.messages.map((msg, i) => 
          i === prev.messages.length - 1 && msg.role === 'user'
            ? { ...msg, status: 'processing' }
            : msg
        ),
        isTyping: true
      }));
    },
    onSuccess: (data: IngestResponse) => {
      if (data.thread_id) {
        setChatState(prev => ({
          ...prev,
          trackingId: data.thread_id,
          currentStatus: 'RECEIVED',
          isTyping: false,
          lastUpdatedAt: new Date().toISOString()
        }));
        
        // Add tracking confirmation message
        const trackingMessage: Message = {
          id: `tracking-${Date.now()}`,
          role: 'system',
          content: `🎫 Tracking ID: \`${data.thread_id}\`\n\nYour grievance is now being processed. You'll receive real-time updates here.`,
          timestamp: new Date(),
          status: 'delivered'
        };
        setChatState(prev => ({
          ...prev,
          messages: [...prev.messages, trackingMessage]
        }));
        
        toast.success('Grievance submitted successfully');
      }
    },
    onError: (error: Error) => {
      setChatState(prev => ({
        ...prev,
        isTyping: false,
        messages: [
          ...prev.messages,
          {
            id: `error-${Date.now()}`,
            role: 'system',
            content: `❌ Error: ${error.message}\n\nPlease try again or contact support.`,
            timestamp: new Date(),
            status: 'error'
          }
        ]
      }));
      toast.error('Failed to submit grievance');
    }
  });
  
  // ✅ FIX: Convert base64 preview to data URL for prototype compatibility
  const getImageUrlForPayload = useCallback((preview: string | null, file: File | null): string | undefined => {
    if (!preview) return undefined;
    
    // If it's already a data URL (base64), return as-is for prototype
    if (preview.startsWith('data:image')) {
      return preview;
    }
    
    // If it's a blob URL, skip for prototype (upload to Supabase in production)
    if (preview.startsWith('blob:')) {
      return undefined;
    }
    
    return preview;
  }, []);
  
  // Handle sending message
  const handleSend = useCallback(async () => {
    if (!input.trim() && !attachedFile) return;
    
    // Create user message
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
      status: 'sending',
      attachment: attachedFile ? {
        type: attachedFile.type.startsWith('image/') ? 'image' : 'voice',
        preview: attachedPreview || undefined
      } : chatState.location ? {
        type: 'location',
        location: chatState.location
      } : undefined
    };
    
    // Add to chat immediately (optimistic)
    setChatState(prev => ({
      ...prev,
      messages: [...prev.messages, userMessage],
      location: undefined // Clear location after attaching
    }));
    
    // ✅ FIX: Ensure location has required 'type' field
    const locationPayload: LocationData = chatState.location || {
      lat: 22.5726, // Default: Salt Lake, Kolkata
      lon: 88.4140,
      type: 'text' // ✅ FIX: Required field
    };
    
    // ✅ FIX: Get image URL for payload (base64 for prototype)
    const imageUrl = getImageUrlForPayload(attachedPreview, attachedFile);
    
    // ✅ FIX: Get phone number from env or use demo fallback
    const phoneNumber = process.env.NEXT_PUBLIC_DEMO_PHONE || 'demo-user-123';
    
    // Prepare payload for API
    const payload: IngestPayload = {
      phone_number: phoneNumber,
      thread_id: chatState.trackingId || `thread-${Date.now()}`,
      text_message: input.trim(),
      image_url: imageUrl, // ✅ FIX: Include image for VLM processing
      location: locationPayload
    };
    
    // ✅ FIX: Use mutate() instead of mutateAsync() to avoid unhandled promise rejection
    submitMutation.mutate(payload);
    
    // Reset input
    setInput('');
    setAttachedFile(null);
    setAttachedPreview(null);
    
    // Reset milestones for new grievance
    announcedMilestones.current.clear();
  }, [input, attachedFile, attachedPreview, chatState.location, chatState.trackingId, submitMutation, getImageUrlForPayload]);
  
  // Handle file selection
  const handleFileSelect = useCallback((file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File too large. Max 10MB.');
      return;
    }
    
    setAttachedFile(file);
    
    // Generate preview for images
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        // Ensure it's a data URL for prototype compatibility
        if (result && result.startsWith('data:image')) {
          setAttachedPreview(result);
        }
      };
      reader.readAsDataURL(file);
    }
    
    toast.success('Attachment added');
  }, []);
  
  // Handle location attach
  const handleLocationAttach = useCallback((location: LocationData) => {
    setChatState(prev => ({ ...prev, location }));
    toast.success('Location attached');
  }, []);
  
  // Clear attachment
  const clearAttachment = useCallback(() => {
    setAttachedFile(null);
    setAttachedPreview(null);
  }, []);
  
  // Keyboard shortcut: Enter to send
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);
  
  // Memoize message list for performance
  const messageList = useMemo(() => chatState.messages, [chatState.messages]);
  
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-[var(--background)] to-[#0d1321]">
      {/* Connection status bar */}
      <div className={cn(
        'connection-bar',
        submitMutation.isPending ? 'reconnecting' : 'online'
      )} />
      
      {/* Header */}
      <header className="glass-panel border-b-0 rounded-b-3xl p-4 flex items-center justify-between sticky top-0 z-40">
        <div>
          <h1 className="text-lg font-bold text-gradient-customer">CivicLink Assistant</h1>
          <p className="text-xs text-white/60">Secure • Verified • Instant</p>
        </div>
        <div className="live-indicator">
          <span className="live-dot" />
          <span className="text-xs">Online</span>
        </div>
      </header>
      
      {/* Status panel */}
      <div className="px-4 pt-4">
        <StatusPanel 
          trackingId={chatState.trackingId} 
          status={chatState.currentStatus}
          lastUpdatedAt={chatState.lastUpdatedAt}
        />
      </div>
      
      {/* Chat messages */}
      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        <AnimatePresence mode="popLayout">
          {messageList.map((message) => (
            <MessageBubble key={message.id} message={message} clientNow={clientNow} />
          ))}
          
          {chatState.isTyping && <TypingIndicator />}
          
          <div ref={messagesEndRef} />
        </AnimatePresence>
      </main>
      
      {/* Attachment preview */}
      <AnimatePresence>
        {(attachedPreview || chatState.location) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="px-4 pb-2"
          >
            <div className="glass-panel rounded-2xl p-3 flex items-center gap-3">
              {attachedPreview && (
                <img 
                  src={attachedPreview} 
                  alt="Preview" 
                  className="w-16 h-16 object-cover rounded-xl"
                />
              )}
              {chatState.location && (
                <div className="flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-[var(--primary)]" />
                  <span className="text-sm">
                    {chatState.location.address_text || 'Location attached'}
                  </span>
                </div>
              )}
              <button
                onClick={clearAttachment}
                className="ml-auto p-1.5 hover:bg-white/10 rounded-full transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Input area */}
      <footer className="glass-panel border-t-0 rounded-t-3xl p-4 sticky bottom-0 z-40">
        <div className="flex items-end gap-3">
          {/* Action buttons */}
          <div className="flex flex-col gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-2.5 hover:bg-white/10 rounded-xl transition-colors focus-ring"
              title="Attach image"
              aria-label="Attach image"
            >
              <ImageIcon className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowLocationPicker(true)}
              className="p-2.5 hover:bg-white/10 rounded-xl transition-colors focus-ring"
              title="Attach location"
              aria-label="Attach location"
            >
              <MapPin className="w-5 h-5" />
            </button>
            <button
              className="p-2.5 hover:bg-white/10 rounded-xl transition-colors focus-ring"
              title="Record voice"
              aria-label="Record voice"
              disabled
            >
              <Mic className="w-5 h-5 opacity-50" />
            </button>
          </div>
          
          {/* Text input */}
          <div className="flex-1 relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe the issue..."
              rows={1}
              className="glass-input w-full pr-12 resize-none max-h-32 overflow-y-auto"
              style={{ minHeight: '48px' }}
              aria-label="Message input"
            />
            
            {/* Send button */}
            <button
              onClick={handleSend}
              disabled={(!input.trim() && !attachedFile && !chatState.location) || submitMutation.isPending}
              className={cn(
                'absolute right-3 bottom-3 p-2 rounded-xl transition-all focus-ring',
                (input.trim() || attachedFile || chatState.location) && !submitMutation.isPending
                  ? 'glass-btn glass-btn-customer'
                  : 'bg-white/10 cursor-not-allowed'
              )}
              aria-label="Send message"
            >
              {submitMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
        
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,audio/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileSelect(file);
            e.target.value = '';
          }}
          aria-hidden="true"
        />
      </footer>
      
      {/* Location picker modal */}
      <AnimatePresence>
        {showLocationPicker && (
          <LocationPicker
            isOpen={showLocationPicker}
            onClose={() => setShowLocationPicker(false)}
            onSelect={handleLocationAttach}
          />
        )}
      </AnimatePresence>
      
      {/* Scroll progress indicator (subtle) */}
      <motion.div
        className="fixed bottom-0 left-0 right-0 h-0.5 bg-[var(--primary)] origin-left z-50 pointer-events-none"
        style={{ scaleX: smoothScroll }}
        aria-hidden="true"
      />
      {/* Toast container for react-hot-toast */}
      <Toaster 
        position="bottom-right" 
        toastOptions={{
          className: 'glass-panel text-white',
          style: { background: 'rgba(15, 23, 42, 0.9)', backdropFilter: 'blur(10px)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }
        }} 
      />
    </div>
  );
}