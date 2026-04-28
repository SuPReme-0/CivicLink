// app/(customer)/dashboard/page.tsx
'use client';

import { useState, useRef, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useMutation, useQuery } from '@tanstack/react-query';
import { 
  Send, Image as ImageIcon, Mic, MapPin, CheckCheck, 
  Loader2, X, ShieldCheck, Square, Fingerprint, 
  Navigation2, Activity, Globe, Menu, Clock,
  Plus, Crosshair, Cpu, CheckCircle2, ChevronRight, LogOut, User
} from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { IngestPayload, LocationData, GrievanceStatus } from '@/types';

// =============================================================================
// 🗺️ LEAFLET NATIVE CSS (Bypasses SSR Issues)
// =============================================================================
// @ts-ignore
import 'leaflet/dist/leaflet.css';

// =============================================================================
// ⚙️ TYPES & CONSTANTS
// =============================================================================
const CHAT_STORAGE_KEY = 'civiclink_active_chat';
const USER_STORAGE_KEY = 'civiclink_user_session';

type Message = {
  id: string;
  role: 'user' | 'system' | 'assistant';
  content: string;
  timestamp: Date;
  status?: 'sending' | 'sent' | 'delivered' | 'processing' | 'error';
  attachment?: {
    type: 'image' | 'voice' | 'location';
    preview?: string;
    location?: LocationData;
  };
};

type ChatState = {
  messages: Message[];
  isTyping: boolean;
  trackingId?: string;
  currentStatus?: GrievanceStatus | 'PENDING_DETAILS' | 'SYNCING_TELEMETRY'; 
};

const INITIAL_MESSAGE: Message = {
  id: 'welcome',
  role: 'assistant',
  content: "Welcome to CivicLink Core. I am your secure municipal intake agent. Please detail the issue you are reporting. Attaching a photo or tagging your location significantly accelerates our verification and dispatch process.",
  timestamp: new Date(),
  status: 'delivered'
};

const PIPELINE_STATUS_MESSAGES: Record<string, string> = {
  PENDING_DETAILS: "Awaiting Case Details...",
  SYNCING_TELEMETRY: "Restoring Pipeline Data...",
  RECEIVED: "Payload Secured. Pipeline Initiated.",
  VERIFYING_IMAGE: "Running Vision-Language Forensics...",
  ROUTING_JURISDICTION: "Calculating Geo-Jurisdiction...",
  DISCOVERING_CONTACT: "Querying Department Matrix...",
  DRAFTING_LETTER: "Compiling Legal Directive...",
  AWAITING_REVIEW: "Awaiting Human Verification...",
  DISPATCHING: "Executing Secure DKIM Dispatch...",
  DISPATCHED: "Mission Success. Payload Dispatched.",
  RESOLVED: "Case Marked as Resolved.",
  FAILED: "Pipeline Fault Detected."
};

const staggerContainer = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.05 } } };
const fadeInUp = { hidden: { opacity: 0, y: 15, scale: 0.98 }, show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 300, damping: 24 } } };

// =============================================================================
// 🗺️ NATIVE LEAFLET COMPONENT
// =============================================================================
function NativeMap({ position, setPosition }: { position: any, setPosition: any }) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const markerInstance = useRef<any>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    import('leaflet').then((L) => {
      if (!mapContainer.current || mapInstance.current) return;

      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      const initialPos: [number, number] = position ? [position.lat, position.lng] : [20.5937, 78.9629];
      const zoom = position ? 16 : 4;
      
      mapInstance.current = L.map(mapContainer.current, { zoomControl: false }).setView(initialPos, zoom);
      L.control.zoom({ position: 'bottomright' }).addTo(mapInstance.current);
      
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap & CartoDB',
        maxZoom: 19
      }).addTo(mapInstance.current);

      if (position) {
        markerInstance.current = L.marker(initialPos).addTo(mapInstance.current);
      }

      setTimeout(() => {
        mapInstance.current?.invalidateSize();
      }, 250);

      mapInstance.current.on('click', (e: any) => {
        setPosition({ lat: e.latlng.lat, lng: e.latlng.lng });
      });
    });

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && mapInstance.current && position) {
      import('leaflet').then((L) => {
        const targetPos: [number, number] = [position.lat, position.lng];

        if (!markerInstance.current) {
           markerInstance.current = L.marker(targetPos).addTo(mapInstance.current);
        } else {
           markerInstance.current.setLatLng(targetPos);
        }
        mapInstance.current.flyTo(targetPos, 16, { animate: true, duration: 1 });
      });
    }
  }, [position]);

  return <div ref={mapContainer} className="w-full h-full z-0 bg-zinc-900" />;
}

// =============================================================================
// 💬 UI COMPONENTS
// =============================================================================
const MessageBubble = ({ message }: { message: Message }) => {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isSystem) {
    return (
      <div className="flex justify-center my-6">
        <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800/80 text-zinc-400 text-xs px-5 py-3 rounded-xl font-mono tracking-wide max-w-[85%] text-center shadow-lg shadow-black/20">
          <div className="prose prose-invert prose-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    );
  }

  return (
    <motion.div variants={fadeInUp} className={cn("flex mb-6 w-full gap-4", isUser ? "flex-row-reverse" : "flex-row")}>
      
      {/* Avatar */}
      <div className="flex-shrink-0 mt-1">
        {isUser ? (
          <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center border border-zinc-700">
            <User className="w-4 h-4 text-zinc-400" />
          </div>
        ) : (
          <div className="w-8 h-8 rounded-full bg-indigo-500/10 flex items-center justify-center border border-indigo-500/30 shadow-[0_0_15px_rgba(99,102,241,0.15)]">
            <Cpu className="w-4 h-4 text-indigo-400" />
          </div>
        )}
      </div>

      {/* Message Content */}
      <div className={cn("flex flex-col max-w-[80%]", isUser ? "items-end" : "items-start")}>
        <div className={cn(
          "relative px-5 py-4 rounded-2xl transition-all duration-300 text-sm shadow-xl",
          isUser 
            ? "bg-zinc-100 text-zinc-950 rounded-tr-sm shadow-zinc-100/10" 
            : "bg-zinc-900/90 backdrop-blur-md text-zinc-100 border border-zinc-800 rounded-tl-sm"
        )}>
          {message.attachment?.preview && (
            <div className="mb-4 rounded-xl overflow-hidden bg-zinc-950 border border-zinc-800/50 shadow-inner">
              <img src={message.attachment.preview} alt="Attachment" className="w-full h-auto max-h-64 object-cover" />
            </div>
          )}
          
          {message.attachment?.type === 'voice' && (
            <div className="mb-3 flex items-center gap-3 bg-zinc-800/40 p-3 rounded-xl border border-zinc-700/50">
              <div className="w-8 h-8 rounded-full bg-zinc-700/80 flex items-center justify-center"><Mic className="w-4 h-4 text-indigo-400" /></div>
              <div className="flex-1 h-1.5 bg-zinc-700/50 rounded-full overflow-hidden"><div className="w-1/3 h-full bg-indigo-500 rounded-full" /></div>
              <span className="text-xs font-mono text-zinc-400">Audio Payload</span>
            </div>
          )}
          
          {message.attachment?.type === 'location' && message.attachment.location && (
            <div className="mb-4 flex items-start gap-3 bg-zinc-950/50 p-3 rounded-xl border border-zinc-800/80 shadow-inner">
              <MapPin className="w-5 h-5 text-indigo-400 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="font-medium text-sm text-zinc-200 truncate">
                  {message.attachment.location.address_text || 'Hardware GPS Locked'}
                </p>
                <p className="text-[10px] text-zinc-500 font-mono mt-0.5">
                  {message.attachment.location.lat.toFixed(4)}, {message.attachment.location.lon.toFixed(4)}
                </p>
              </div>
            </div>
          )}

          <div className={cn(
            "leading-relaxed break-words whitespace-pre-wrap max-w-none",
            "prose prose-sm prose-p:leading-relaxed prose-pre:p-0 prose-ul:my-2 prose-li:my-0.5",
            isUser ? "prose-zinc prose-strong:text-zinc-900" : "prose-invert prose-strong:text-white prose-a:text-indigo-400"
          )}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>

          {!isUser && message.content.includes('?') && (
            <div className="mt-4 flex items-center gap-2 border-t border-zinc-800/50 pt-3 opacity-80">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
              </span>
              <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-400">Agent Awaiting Input</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 mt-2 px-1">
          <span className="text-[10px] text-zinc-500 font-mono">
            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {isUser && message.status && (
            <div className={cn("text-[10px] font-mono uppercase tracking-widest", message.status === 'processing' ? "text-indigo-400" : "text-zinc-600")}>
              {message.status === 'processing' ? <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Transmitting</span> : <CheckCheck className="w-3.5 h-3.5" />}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

// =============================================================================
// 🚀 DASHBOARD LOGIC 
// =============================================================================
function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlThreadId = searchParams.get('thread');

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [input, setInput] = useState('');
  const [attachedPreview, setAttachedPreview] = useState<string | null>(null);
  const [tempLocation, setTempLocation] = useState<LocationData | null>(null);
  
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [mapPinPosition, setMapPinPosition] = useState<{lat: number, lng: number} | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const recordingInterval = useRef<NodeJS.Timeout | null>(null);
  
  const [chatState, setChatState] = useState<ChatState>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(CHAT_STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          parsed.messages = parsed.messages.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }));
          return parsed;
        } catch (e) { console.error(e); }
      }
    }
    return { messages: [INITIAL_MESSAGE], isTyping: false };
  });

  const lastAiReply = useRef<string | null>(null);
  const announcedMilestones = useRef<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (chatState.messages.length > 1 || chatState.trackingId) {
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chatState));
    }
  }, [chatState]);

  // 🚨 FIX 3: Explicitly force the security headers for the history fetch
  const { data: historyData, refetch: refetchHistory } = useQuery({
    queryKey: ['citizen-grievances'],
    queryFn: async () => {
      const res = await fetch('/api/v1/auth/citizen/grievances', {
        headers: { 
          'X-Frontend-API-Key': process.env.FRONTEND_API_KEY || 'civiclink_dev_super_secret_998877',
          'X-Session-ID': 'demo-citizen'
        }
      });
      if (!res.ok) throw new Error('History fetch failed');
      return res.json();
    }
  });

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatState.messages, chatState.isTyping]);

  useEffect(() => {
    if (urlThreadId && urlThreadId !== chatState.trackingId) {
      setChatState(prev => ({
        ...prev,
        trackingId: urlThreadId,
        currentStatus: 'SYNCING_TELEMETRY',
        messages: [{
          id: `sys-resume`, role: 'system',
          content: `🔄 **Synchronizing Protocol:** Restoring telemetry for thread \`${urlThreadId}\`...`,
          timestamp: new Date()
        }]
      }));
      lastAiReply.current = null;
      announcedMilestones.current.clear();

      apiClient.getStatus(urlThreadId).then((data) => {
        if (data.current_state) {
          setChatState(prev => ({ ...prev, currentStatus: data.current_state }));
        }
      }).catch(e => console.error("Immediate sync failed", e));
    }
  }, [urlThreadId, chatState.trackingId]);

  const submitMutation = useMutation({
    mutationFn: (payload: IngestPayload) => apiClient.submitGrievance(payload),
    onSuccess: (data) => {
      if (data.thread_id && !chatState.trackingId) {
        setChatState(prev => ({ ...prev, trackingId: data.thread_id, currentStatus: 'PENDING_DETAILS' }));
        router.replace(`?thread=${data.thread_id}`, { scroll: false });
        refetchHistory();
        toast.success("Encrypted Session Established", { style: { background: '#18181b', color: '#fff', border: '1px solid #27272a' } });
      }
    },
    onError: (error) => {
      toast.error(`Submission Failed: ${error.message}`, {
        style: { background: '#18181b', color: '#fff', border: '1px solid #ef4444' }
      });
    }
  });

  useEffect(() => {
    if (!chatState.trackingId) return;

    const interval = setInterval(async () => {
      try {
        const data = await apiClient.getStatus(chatState.trackingId!);
        const newMessages: Message[] = [];

        // 🚨 FIX 2A: Always sync the current state from the backend!
        if (data.current_state && data.current_state !== chatState.currentStatus) {
          setChatState(prev => ({ ...prev, currentStatus: data.current_state }));
        }

        // Handle Conversational AI Replies
        if (data.status === 'chatting' && data.reply_message) {
          if (data.reply_message !== lastAiReply.current && data.reply_message !== "Processing...") {
            newMessages.push({ id: `chat-${Date.now()}`, role: 'assistant', content: data.reply_message, timestamp: new Date(), status: 'delivered' });
            lastAiReply.current = data.reply_message;
            setChatState(prev => ({ ...prev, isTyping: false }));
          }
        } 
        // Handle Official Database Pipeline Updates
        else if (data.status === 'found') {
          if (chatState.messages.length === 1 && chatState.messages[0].id === 'sys-resume' && data.description_text) {
             newMessages.push({ id: `resume-ctx`, role: 'system', content: `**Context Restored:**\n_${data.description_text}_\n\n**Status:** \`${data.current_state}\``, timestamp: new Date() });
          }

          if (data.system_metadata?.auth_score !== undefined && !announcedMilestones.current.has('vlm')) {
            newMessages.push({ id: `vlm-${Date.now()}`, role: 'system', content: `**Forensics Complete:** Authenticity verified at ${(data.system_metadata.auth_score * 100).toFixed(0)}%. \nCategorized as \`${data.issue_category}\`.`, timestamp: new Date() });
            announcedMilestones.current.add('vlm');
          }
          
          if (data.current_state === 'DISPATCHED' && !announcedMilestones.current.has('sent')) {
            const email = data.dispatch_records?.[0]?.email || "Authority";
            newMessages.push({ id: `sent-${Date.now()}`, role: 'assistant', content: `**Formal Directive Executed.**\nI have cryptographically signed the report and dispatched it to **${email}**. I will continue to monitor this thread.`, timestamp: new Date() });
            announcedMilestones.current.add('sent');
          }
        }

        if (newMessages.length > 0) setChatState(prev => ({ ...prev, messages: [...prev.messages, ...newMessages] }));
      } catch (e) { console.error("Telemetry fault:", e); }
    }, 3000);
    return () => clearInterval(interval);
  }, [chatState.trackingId, chatState.currentStatus, chatState.messages.length]);

  const handleSend = useCallback((overrideText?: string, overrideVoice?: boolean) => {
    const finalInput = overrideText || input;
    if (!finalInput.trim() && !attachedPreview && !tempLocation && !overrideVoice) return;

    const userMsg: Message = {
      id: `u-${Date.now()}`, role: 'user', content: finalInput, timestamp: new Date(), status: 'processing',
      attachment: overrideVoice ? { type: 'voice' } : attachedPreview ? { type: 'image', preview: attachedPreview } : tempLocation ? { type: 'location', location: tempLocation } : undefined
    };

    setChatState(prev => ({ ...prev, messages: [...prev.messages, userMsg], isTyping: true }));
    
    submitMutation.mutate({
      phone_number: process.env.NEXT_PUBLIC_DEMO_PHONE || 'demo-citizen',
      thread_id: chatState.trackingId || `thread-${Date.now()}`,
      text_message: overrideVoice ? "[Voice note transcribed internally]" : finalInput,
      image_url: attachedPreview || undefined,
      location: tempLocation || undefined  // 🚨 FIXED: Phantom GPS eliminated
    });

    setInput(''); setAttachedPreview(null); setTempLocation(null); setMapPinPosition(null);
  }, [input, attachedPreview, tempLocation, chatState.trackingId, submitMutation]);

  const handleNewSession = useCallback(() => {
    setChatState({ messages: [INITIAL_MESSAGE], isTyping: false });
    localStorage.removeItem(CHAT_STORAGE_KEY);
    lastAiReply.current = null;
    announcedMilestones.current.clear();
    setInput('');
    router.replace('/dashboard');
  }, [router]);

  const handleLogout = useCallback(() => {
    localStorage.removeItem(USER_STORAGE_KEY);
    localStorage.removeItem(CHAT_STORAGE_KEY);
    toast.success("Securely disconnected.");
    router.replace('/');
  }, [router]);

  const requestLocation = () => {
    setIsLocating(true);
    if (!navigator.geolocation) { toast.error('Geolocation not supported'); setIsLocating(false); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMapPinPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        toast.success("Hardware GPS Locked");
        setIsLocating(false);
      },
      (err) => { toast.error(`Error: ${err.message}`); setIsLocating(false); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const confirmMapLocation = () => {
    if (mapPinPosition) {
      setTempLocation({ lat: mapPinPosition.lat, lon: mapPinPosition.lng, type: 'gps', address_text: `Coordinates: ${mapPinPosition.lat.toFixed(4)}, ${mapPinPosition.lng.toFixed(4)}` });
      setShowLocationModal(false);
      toast.success("Geo-tag attached.");
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      clearInterval(recordingInterval.current!);
      setIsRecording(false); setRecordingTime(0);
      handleSend("Voice transmission complete.", true);
    } else {
      setIsRecording(true);
      recordingInterval.current = setInterval(() => setRecordingTime(prev => prev + 1), 1000);
    }
  };

  const hasConfirmed = chatState.messages.some(m => m.role === 'user' && m.content.toLowerCase().includes('proceed'));
  const isPipelineActive = (chatState.currentStatus && !['PENDING_DETAILS', 'RESOLVED'].includes(chatState.currentStatus)) || hasConfirmed;

  let placeholderText = "Input directive...";
  if (isPipelineActive) {
    if (chatState.currentStatus === 'AWAITING_REVIEW') placeholderText = "🔒 Locked: Awaiting Admin Authorization...";
    else if (chatState.currentStatus === 'DISPATCHED') placeholderText = "✅ Locked: Payload Dispatched.";
    else if (chatState.currentStatus === 'FAILED') placeholderText = "⚠️ Locked: Pipeline Fault Detected.";
    else placeholderText = "⚙️ Executing Backend Pipeline...";
  }

  return (
    <>
      <AnimatePresence>
        {isSidebarOpen && (
          <>
            {/* Mobile Overlay */}
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
            />
            {/* Sidebar Panel */}
            <motion.aside 
              initial={{ x: -300, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -300, opacity: 0 }} 
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed md:relative inset-y-0 left-0 w-72 flex flex-col border-r border-zinc-800/60 bg-[#050505] flex-shrink-0 z-50 shadow-2xl"
            >
              <div className="p-5 border-b border-zinc-800/60 flex items-center justify-between bg-zinc-950/50">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-zinc-100 rounded-lg flex items-center justify-center shadow-sm">
                    <Cpu className="w-5 h-5 text-zinc-950" />
                  </div>
                  <span className="font-bold tracking-tight text-sm">CivicLink Core</span>
                </div>
                <button onClick={() => setIsSidebarOpen(false)} className="md:hidden p-2 hover:bg-zinc-800 rounded-lg text-zinc-400">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-4">
                <button onClick={handleNewSession} className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-xl text-sm transition-all text-zinc-200 shadow-sm font-semibold">
                  <Plus className="w-4 h-4" /> New Initialization
                </button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-4 space-y-2">
                <p className="text-[10px] uppercase font-mono text-zinc-500 tracking-widest px-1 mb-4 mt-2">Active Sessions</p>
                {historyData?.grievances?.map((g: any) => (
                  <button
                    key={g.tracking_id}
                    onClick={() => { router.push(`?thread=${g.tracking_id}`); setIsSidebarOpen(false); }}
                    className={cn(
                      "w-full text-left px-4 py-4 rounded-xl border transition-all flex flex-col gap-2 group",
                      chatState.trackingId === g.tracking_id ? "bg-zinc-900 border-zinc-700 shadow-md" : "bg-transparent border-transparent hover:bg-zinc-900/40"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-zinc-400 group-hover:text-zinc-200 transition-colors">#{g.tracking_id.split('-').pop()}</span>
                      <span className={cn("text-[9px] px-2 py-0.5 rounded flex items-center gap-1 font-bold uppercase tracking-wider", g.status === 'RESOLVED' ? "bg-emerald-500/10 text-emerald-400" : "bg-indigo-500/10 text-indigo-400")}>
                        <span className={cn("w-1.5 h-1.5 rounded-full", g.status === 'RESOLVED' ? "bg-emerald-400" : "bg-indigo-400 animate-pulse")} />
                        {g.status === 'PENDING_DETAILS' ? 'DRAFT' : g.status}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-200 truncate font-medium">{g.issue_category || 'Pending Triage'}</p>
                    <p className="text-[10px] text-zinc-600 flex items-center gap-1.5 font-mono"><Clock className="w-3 h-3" /> {new Date(g.created_at).toLocaleDateString()}</p>
                  </button>
                ))}
                {(!historyData?.grievances || historyData?.grievances?.length === 0) && <p className="text-xs text-zinc-600 font-mono text-center py-6 border border-dashed border-zinc-800 rounded-xl">0 records found.</p>}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex-1 flex flex-col relative h-screen min-w-0 bg-[#050505]">
        <header className="h-16 border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-2xl flex items-center justify-between px-4 md:px-6 sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-400 transition-colors"><Menu className="w-5 h-5" /></button>
            <span className="hidden sm:flex text-[10px] font-mono text-zinc-400 items-center gap-2 uppercase tracking-widest"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse" /> Link_Active</span>
          </div>
          <div className="flex items-center gap-3">
            {chatState.trackingId && (
              <div className="hidden sm:flex items-center gap-2 bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-lg shadow-sm">
                <Fingerprint className="w-3.5 h-3.5 text-indigo-400" />
                <span className="text-[10px] font-mono text-zinc-300 uppercase tracking-widest">{chatState.trackingId}</span>
              </div>
            )}
            {/* 🚨 THE LOGOUT BUTTON */}
            <button onClick={handleLogout} className="flex items-center gap-2 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded-lg transition-colors text-xs text-rose-400">
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline font-semibold tracking-wide">Disconnect</span>
            </button>
          </div>
        </header>

        {/* 🚀 THE DYNAMIC ISLAND PIPELINE TRACKER */}
        <AnimatePresence>
          {chatState.trackingId && chatState.currentStatus && chatState.currentStatus !== 'PENDING_DETAILS' && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="absolute top-20 left-1/2 -translate-x-1/2 z-30 w-[90%] md:w-auto flex justify-center"
            >
              <div className="glass-panel border border-zinc-700/50 bg-zinc-900/90 backdrop-blur-xl rounded-full px-5 py-2.5 flex items-center gap-3 shadow-2xl shadow-indigo-500/10">
                {chatState.currentStatus === 'RESOLVED' || chatState.currentStatus === 'DISPATCHED' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : chatState.currentStatus === 'FAILED' ? (
                  <X className="w-4 h-4 text-rose-400" />
                ) : (
                  <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                )}
                <span className="text-xs font-medium text-zinc-200 pr-2 border-r border-zinc-700 whitespace-nowrap">
                  {PIPELINE_STATUS_MESSAGES[chatState.currentStatus] || "Processing..."}
                </span>
                <span className="hidden sm:inline text-[10px] font-mono text-zinc-400 uppercase tracking-widest">
                  Live Pipeline
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <main className="flex-1 overflow-y-auto px-4 md:px-8 py-8 custom-scrollbar pb-48">
          <motion.div initial="hidden" animate="show" variants={staggerContainer} className="max-w-3xl mx-auto mt-6">
            {chatState.messages.map(m => <MessageBubble key={m.id} message={m} />)}
            {chatState.isTyping && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-4 mb-6">
                <div className="w-8 h-8 rounded-full bg-indigo-500/10 flex items-center justify-center border border-indigo-500/30 flex-shrink-0 mt-1">
                  <Cpu className="w-4 h-4 text-indigo-400" />
                </div>
                <div className="flex gap-1.5 p-5 bg-zinc-900/80 backdrop-blur-md w-fit rounded-2xl border border-zinc-800 rounded-tl-sm shadow-lg">
                  <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce [animation-duration:0.8s]" />
                  <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce [animation-duration:0.8s] [animation-delay:0.2s]" />
                  <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce [animation-duration:0.8s] [animation-delay:0.4s]" />
                </div>
              </motion.div>
            )}
            <div ref={messagesEndRef} className="h-4" />
          </motion.div>
        </main>

        {/* 🚀 THE CONTINUOUS INPUT FOOTER */}
        <footer className="absolute bottom-0 left-0 right-0 p-4 md:px-8 bg-gradient-to-t from-[#050505] via-[#050505]/95 to-transparent z-40 pb-6">
          <div className="max-w-3xl mx-auto relative">
            <AnimatePresence>
              {lastAiReply.current?.toLowerCase().includes('officially') && chatState.currentStatus === 'PENDING_DETAILS' && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="flex gap-3 mb-5 justify-center">
                  <button onClick={() => handleSend("Proceed with formal filing.")} className="px-6 py-3 bg-zinc-100 text-zinc-950 text-xs font-bold rounded-xl hover:bg-white transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)] flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4" /> Authorize & Dispatch
                  </button>
                  <button onClick={() => handleSend("Halt. I need to amend the details.")} className="px-6 py-3 bg-zinc-900 border border-zinc-700 text-zinc-300 text-xs font-bold rounded-xl hover:bg-zinc-800 transition-all">
                    Amend Payload
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="relative bg-zinc-900/90 backdrop-blur-2xl border border-zinc-700/80 transition-all duration-300 rounded-2xl shadow-2xl focus-within:border-indigo-500/50 focus-within:shadow-[0_0_30px_rgba(99,102,241,0.1)]">
              <AnimatePresence>
                {attachedPreview && (
                  <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="absolute -top-16 left-2 p-1.5 bg-zinc-800 border border-zinc-700 rounded-xl flex items-center gap-2 shadow-2xl">
                    <img src={attachedPreview} className="w-12 h-12 rounded-lg object-cover" />
                    <button onClick={() => setAttachedPreview(null)} className="p-1 hover:bg-zinc-700 text-zinc-400 rounded-md"><X className="w-3 h-3" /></button>
                  </motion.div>
                )}
                {tempLocation && (
                  <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="absolute -top-14 left-2 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-xl flex items-center gap-2 shadow-2xl">
                    <MapPin className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-mono text-zinc-200">{tempLocation.address_text}</span>
                    <button onClick={() => setTempLocation(null)} className="ml-2 p-1 hover:bg-zinc-700 text-zinc-400 rounded-md"><X className="w-3 h-3" /></button>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex items-end p-2 gap-2">
                <div className="flex gap-1 pb-1">
                  <button onClick={() => fileInputRef.current?.click()} className="p-3 hover:bg-zinc-800 rounded-xl text-zinc-400 hover:text-zinc-100 transition-colors"><ImageIcon className="w-5 h-5" /></button>
                  <button onClick={() => setShowLocationModal(true)} className="p-3 hover:bg-zinc-800 rounded-xl text-zinc-400 hover:text-indigo-400 transition-colors"><MapPin className="w-5 h-5" /></button>
                  <button onClick={toggleRecording} className={cn("p-3 rounded-xl transition-colors", isRecording ? "bg-red-500/20 text-red-400" : "hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100")}>
                    {isRecording ? <Square className="w-5 h-5 fill-current" /> : <Mic className="w-5 h-5" />}
                  </button>
                </div>

                {isRecording ? (
                  <div className="flex-1 flex items-center justify-center gap-3 py-3">
                    <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.6)]" />
                    <span className="font-mono text-sm text-red-400 font-bold tracking-widest">0:{recordingTime.toString().padStart(2, '0')}</span>
                  </div>
                ) : (
                  <textarea 
                    rows={1} 
                    value={input} 
                    onChange={(e) => setInput(e.target.value)} 
                    onKeyDown={(e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }}} 
                    placeholder={placeholderText}
                    disabled={isPipelineActive && chatState.currentStatus !== 'PENDING_DETAILS'}
                    className="flex-1 bg-transparent border-none outline-none text-sm py-4 px-2 placeholder:text-zinc-500 resize-none max-h-32 text-zinc-100 font-medium disabled:opacity-50" 
                  />
                )}

                <button 
                  onClick={() => handleSend()} 
                  disabled={(!input.trim() && !attachedPreview && !tempLocation && !isRecording) || submitMutation.isPending || (isPipelineActive && chatState.currentStatus !== 'PENDING_DETAILS')} 
                  className="p-4 mb-1 mr-1 bg-zinc-100 disabled:bg-zinc-800/80 disabled:text-zinc-600 text-zinc-950 rounded-xl transition-all shadow-sm"
                >
                  {submitMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                </button>
              </div>
            </div>
            
            <div className="flex items-center justify-center pt-4 opacity-40">
              <div className="flex items-center gap-1.5 text-zinc-400">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span className="text-[10px] font-mono uppercase tracking-widest">End-to-End Encrypted (TLS 1.3)</span>
              </div>
            </div>
          </div>
        </footer>
      </div>

      {/* 🚨 THE IMAGE INPUT */}
      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        accept="image/*" 
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            if (file.size > 10 * 1024 * 1024) {
              toast.error('Image is too large. Max 10MB.');
              return;
            }
            const reader = new FileReader();
            reader.onloadend = () => {
              setAttachedPreview(reader.result as string);
              toast.success("Image attached to payload.");
            };
            reader.readAsDataURL(file);
            e.target.value = ''; 
          }
        }} 
      />

      <AnimatePresence>
        {showLocationModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#050505]/95 backdrop-blur-xl">
            <motion.div initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }} className="w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-3xl overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)] flex flex-col">
              <div className="flex items-center justify-between p-5 border-b border-zinc-800 bg-zinc-900/50">
                <h3 className="text-sm font-bold tracking-wide flex items-center gap-2"><Navigation2 className="w-4 h-4 text-indigo-400" /> Geo-Spatial Calibrator</h3>
                <button onClick={() => setShowLocationModal(false)} className="p-2 hover:bg-zinc-800 rounded-xl text-zinc-400 transition-colors"><X className="w-5 h-5" /></button>
              </div>
              
              <div className="h-[450px] w-full bg-zinc-900 relative z-0">
                <NativeMap position={mapPinPosition} setPosition={setMapPinPosition} />
                
                {!mapPinPosition && (
                  <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none">
                    <span className="bg-zinc-950/90 border border-zinc-700 text-zinc-200 text-xs px-5 py-2.5 rounded-full shadow-2xl backdrop-blur-md font-mono tracking-widest font-semibold">
                      CLICK TO DROP SENSOR PIN
                    </span>
                  </div>
                )}
              </div>

              <div className="p-5 bg-zinc-900/50 flex gap-4">
                <button onClick={requestLocation} disabled={isLocating} className="flex-[1] py-4 px-4 bg-zinc-950 border border-zinc-800 hover:border-indigo-500/50 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50 text-sm font-semibold shadow-sm">
                  {isLocating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crosshair className="w-4 h-4 text-indigo-400" />} Extract HW GPS
                </button>
                <button onClick={confirmMapLocation} disabled={!mapPinPosition} className="flex-[1.5] py-4 px-4 bg-zinc-100 text-zinc-950 disabled:bg-zinc-800 disabled:text-zinc-600 rounded-xl transition-all font-bold text-sm shadow-md flex items-center justify-center gap-2">
                  Confirm Coordinates <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

// =============================================================================
// 🚨 WRAP EXPORT IN SUSPENSE FOR NEXT.JS BUILD SAFETY
// =============================================================================
export default function Page() {
  return (
    <div className="min-h-screen bg-[#050505] text-zinc-100 font-sans selection:bg-indigo-500/30">
      <Suspense fallback={
        <div className="flex h-screen w-full items-center justify-center bg-[#050505]">
          <div className="flex flex-col items-center gap-4">
            <Cpu className="w-8 h-8 text-zinc-800 animate-pulse" />
            <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
            <p className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">Initializing Core...</p>
          </div>
        </div>
      }>
        <DashboardContent />
      </Suspense>
    </div>
  );
}