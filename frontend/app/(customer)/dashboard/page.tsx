'use client';

import { useState, useRef, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useMutation, useQuery } from '@tanstack/react-query';
import { 
  Send, Image as ImageIcon, Mic, MapPin, CheckCheck, 
  Loader2, X, ShieldCheck, Square, Fingerprint, 
  Navigation2, Cpu, CheckCircle2, ChevronRight, LogOut, User,
  Menu, Clock, Plus, Crosshair, Sparkles, FileText, Activity
} from 'lucide-react';
import toast from 'react-hot-toast';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { apiClient } from '@/lib/api-client';
import { cn, formatRelativeTime } from '@/lib/utils';
import type { IngestPayload, LocationData, GrievanceStatus } from '@/types';

// =============================================================================
// 🗺️ LEAFLET NATIVE CSS 
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
  content: "Welcome to **CivicLink Core**. I am your secure municipal intake agent.\n\nPlease detail the issue you are reporting. Attaching a photo or tagging your location significantly accelerates our verification and dispatch process.",
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

const staggerContainer = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08 } } };
const fadeInUp = { hidden: { opacity: 0, y: 20, scale: 0.95 }, show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 400, damping: 30 } } };

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
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19
      }).addTo(mapInstance.current);

      if (position) {
        markerInstance.current = L.marker(initialPos).addTo(mapInstance.current);
      }

      setTimeout(() => mapInstance.current?.invalidateSize(), 250);

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

  return <div ref={mapContainer} className="w-full h-full z-0 bg-[#0a0a0a]" />;
}

// =============================================================================
// 💬 MESSAGE BUBBLE COMPONENT
// =============================================================================
const MessageBubble = ({ message }: { message: Message }) => {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isSystem) {
    return (
      <motion.div variants={fadeInUp} className="flex justify-center my-8 w-full">
        <div className="relative bg-gradient-to-b from-[#0f111a]/90 to-[#0a0a0f]/90 backdrop-blur-xl border border-indigo-500/20 text-indigo-200/90 px-6 py-4 rounded-2xl text-xs font-mono tracking-wide max-w-[90%] text-center shadow-[0_0_30px_rgba(99,102,241,0.08)] before:absolute before:inset-0 before:rounded-2xl before:border before:border-white/5 before:pointer-events-none overflow-hidden">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-px bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent" />
          <div className="prose prose-invert prose-sm prose-p:my-0 leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div variants={fadeInUp} className={cn("flex mb-8 w-full gap-4", isUser ? "flex-row-reverse" : "flex-row")}>
      <div className="flex-shrink-0 mt-1 relative">
        {isUser ? (
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center shadow-[0_0_20px_rgba(99,102,241,0.3)] z-10 relative">
            <User className="w-4 h-4 text-white" />
          </div>
        ) : (
          <div className="w-9 h-9 rounded-full bg-white/[0.03] flex items-center justify-center border border-white/10 shadow-[0_0_15px_rgba(255,255,255,0.05)] backdrop-blur-md z-10 relative">
            <Sparkles className="w-4 h-4 text-indigo-400" />
          </div>
        )}
      </div>

      <div className={cn("flex flex-col max-w-[85%] md:max-w-[75%]", isUser ? "items-end" : "items-start")}>
        <div className={cn(
          "relative px-6 py-4 rounded-3xl transition-all duration-300 text-sm overflow-hidden",
          isUser 
            ? "bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-tr-sm shadow-[0_10px_40px_rgba(99,102,241,0.2)]" 
            : "bg-gradient-to-br from-white/[0.05] to-white/[0.01] backdrop-blur-2xl text-slate-200 border border-white/[0.08] rounded-tl-sm shadow-[0_10px_40px_rgba(0,0,0,0.5)]"
        )}>
          {!isUser && <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />}

          {message.attachment?.preview && (
            <div className="mb-4 rounded-xl overflow-hidden bg-black/40 border border-white/10 relative group">
              <img src={message.attachment.preview} alt="Attachment" className="w-full h-auto max-h-64 object-cover transition-transform duration-700 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
            </div>
          )}
          
          {message.attachment?.type === 'voice' && (
            <div className={cn("mb-3 flex items-center gap-3 p-3 rounded-xl border relative overflow-hidden", isUser ? "bg-black/20 border-white/10" : "bg-black/40 border-white/5")}>
              <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center relative z-10"><Mic className="w-4 h-4 text-white" /></div>
              <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden relative z-10"><div className="w-1/3 h-full bg-indigo-400 rounded-full shadow-[0_0_10px_rgba(129,140,248,0.8)]" /></div>
              <span className="text-[10px] font-mono uppercase tracking-widest opacity-70 relative z-10">Audio</span>
            </div>
          )}
          
          {message.attachment?.type === 'location' && message.attachment.location && (
            <div className={cn("mb-4 flex items-start gap-3 p-3.5 rounded-xl border relative overflow-hidden", isUser ? "bg-black/20 border-white/10" : "bg-black/40 border-white/5")}>
              <MapPin className="w-5 h-5 text-indigo-300 flex-shrink-0 mt-0.5 relative z-10" />
              <div className="min-w-0 relative z-10">
                <p className="font-medium text-sm truncate text-white">
                  {message.attachment.location.address_text || 'Hardware GPS Locked'}
                </p>
                <p className="text-[10px] font-mono mt-1 text-indigo-200/70">
                  {message.attachment.location.lat.toFixed(4)}, {message.attachment.location.lon.toFixed(4)}
                </p>
              </div>
            </div>
          )}

          <div className={cn(
            "leading-relaxed break-words whitespace-pre-wrap max-w-none relative z-10",
            "prose prose-sm prose-p:leading-relaxed prose-pre:p-0 prose-ul:my-2 prose-li:my-0.5",
            isUser ? "prose-invert prose-strong:text-white" : "prose-invert prose-strong:text-indigo-300 prose-a:text-cyan-400"
          )}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-2 px-2 text-[10px] text-slate-500 font-mono uppercase tracking-widest">
          <span>{message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          {isUser && message.status && (
            <div className={cn("flex items-center gap-1", message.status === 'processing' ? "text-indigo-400" : "text-emerald-500")}>
              {message.status === 'processing' ? <><Loader2 className="w-3 h-3 animate-spin" /> Sent... </> : <CheckCheck className="w-3.5 h-3.5" />}
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
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  }, []);

  useEffect(() => {
    if (chatState.messages.length > 1 || chatState.trackingId) {
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chatState));
    }
  }, [chatState]);

  // 🚨 FIXED: Corrected endpoint path to '/me/grievances'
  const { data: historyData, refetch: refetchHistory } = useQuery({
    queryKey: ['citizen-grievances'],
    queryFn: async () => {
      let sessionId = '';
      if (typeof window !== 'undefined') {
        try {
          const data = localStorage.getItem(USER_STORAGE_KEY);
          if (data) sessionId = JSON.parse(data).sessionId;
        } catch (e) {}
      }

      const res = await fetch('/api/v1/auth/citizen/me/grievances', {
        headers: { 
          'X-Frontend-API-Key': process.env.NEXT_PUBLIC_FRONTEND_API_KEY || 'civiclink_dev_super_secret_998877',
          'X-Session-ID': sessionId
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
          content: `🔄 **Secure Handshake Established:** Restoring telemetry for thread \`${urlThreadId}\`...`,
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
      }
    },
    onError: (error) => {
      toast.error(`Transmission Failed: ${error.message}`, { style: { background: '#0a040d', color: '#f43f5e', border: '1px solid rgba(244,63,94,0.3)' } });
    }
  });

  useEffect(() => {
    if (!chatState.trackingId) return;

    const interval = setInterval(async () => {
      try {
        const data = await apiClient.getStatus(chatState.trackingId!);
        const newMessages: Message[] = [];

        if (data.current_state && data.current_state !== chatState.currentStatus) {
          setChatState(prev => ({ ...prev, currentStatus: data.current_state }));
        }

        // 🚨 FIXED: The UI now successfully catches and renders the AI reply!
        if (data.reply_message && data.reply_message !== lastAiReply.current && data.reply_message !== "Processing...") {
          newMessages.push({ id: `chat-${Date.now()}`, role: 'assistant', content: data.reply_message, timestamp: new Date(), status: 'delivered' });
          lastAiReply.current = data.reply_message;
          setChatState(prev => ({ ...prev, isTyping: false }));
        } 
        
        if (data.status === 'found') {
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

    let activeUser = null;
    if (typeof window !== 'undefined') {
      const sessionData = localStorage.getItem(USER_STORAGE_KEY);
      if (sessionData) {
        try {
          const parsed = JSON.parse(sessionData);
          if (parsed.username) activeUser = parsed.username;
        } catch (e) { console.error('Session parse error', e); }
      }
    }

    if (!activeUser) {
      toast.error("Session identity lost. Please click Terminate and log back in.");
      return; 
    }

    const userMsg: Message = {
      id: `u-${Date.now()}`, role: 'user', content: finalInput, timestamp: new Date(), status: 'processing',
      attachment: overrideVoice ? { type: 'voice' } : attachedPreview ? { type: 'image', preview: attachedPreview } : tempLocation ? { type: 'location', location: tempLocation } : undefined
    };

    setChatState(prev => ({ ...prev, messages: [...prev.messages, userMsg], isTyping: true }));
    
    submitMutation.mutate({
      phone_number: activeUser, 
      thread_id: chatState.trackingId || `thread-${Date.now()}`,
      text_message: overrideVoice ? "[Voice note transcribed internally]" : finalInput,
      image_url: attachedPreview || undefined,
      location: tempLocation || undefined
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
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  }, [router]);

  const handleLogout = useCallback(() => {
    localStorage.removeItem(USER_STORAGE_KEY);
    localStorage.removeItem(CHAT_STORAGE_KEY);
    toast.success("Securely disconnected.", { style: { background: '#0a040d', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' } });
    router.replace('/');
  }, [router]);

  const requestLocation = () => {
    setIsLocating(true);
    if (!navigator.geolocation) { toast.error('Geolocation not supported'); setIsLocating(false); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMapPinPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        toast.success("Hardware GPS Locked", { style: { background: '#0a040d', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' } });
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
  
  // 🚨 FIXED: Allow the keyboard to function when status is 'RECEIVED' (the initial database state)
  const isPipelineActive = (chatState.currentStatus && !['PENDING_DETAILS', 'RECEIVED', 'RESOLVED'].includes(chatState.currentStatus)) || hasConfirmed;

  let placeholderText = "Detail your grievance...";
  if (isPipelineActive) {
    if (chatState.currentStatus === 'AWAITING_REVIEW') placeholderText = "🔒 Locked: Awaiting Authority Authorization...";
    else if (chatState.currentStatus === 'DISPATCHED') placeholderText = "✅ Locked: Formal Payload Dispatched.";
    else if (chatState.currentStatus === 'FAILED') placeholderText = "⚠️ Locked: Pipeline Fault Detected.";
    else placeholderText = "⚙️ Executing Background Architecture...";
  }

  return (
    <>
      <div className="flex h-screen w-full bg-[#03040b] overflow-hidden relative selection:bg-indigo-500/30">
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
          <motion.div 
            animate={{ scale: [1, 1.05, 1], opacity: [0.1, 0.2, 0.1] }}
            transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
            className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-indigo-600/20 blur-[150px] rounded-full mix-blend-screen" 
          />
          <motion.div 
            animate={{ scale: [1, 1.1, 1], opacity: [0.1, 0.15, 0.1] }}
            transition={{ duration: 12, repeat: Infinity, ease: "easeInOut", delay: 2 }}
            className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-cyan-600/20 blur-[150px] rounded-full mix-blend-screen" 
          />
        </div>
        
        <AnimatePresence>
          {isSidebarOpen && (
            <>
              <motion.div 
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setIsSidebarOpen(false)}
                className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
              />
              
              <motion.aside 
                initial={{ width: 0, x: -300 }} 
                animate={{ width: 280, x: 0 }} 
                exit={{ width: 0, x: -300 }} 
                transition={{ type: "spring", damping: 25, stiffness: 250 }}
                className="fixed md:relative inset-y-0 left-0 flex flex-col border-r border-white/[0.05] bg-[#05060f]/95 backdrop-blur-2xl z-50 overflow-hidden shadow-[20px_0_40px_rgba(0,0,0,0.5)] md:shadow-none"
              >
                <div className="p-6 border-b border-white/[0.05] flex items-center justify-between min-w-[280px]">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center shadow-[0_0_15px_rgba(99,102,241,0.2)]">
                      <ShieldCheck className="w-4 h-4 text-indigo-400" />
                    </div>
                    <span className="font-bold tracking-wide text-slate-200">History Log</span>
                  </div>
                  <button onClick={() => setIsSidebarOpen(false)} className="md:hidden p-2 hover:bg-white/5 rounded-lg text-slate-400">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                
                <div className="p-4 min-w-[280px]">
                  <button onClick={handleNewSession} className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 rounded-xl text-xs font-bold uppercase tracking-widest text-white transition-all shadow-[0_0_20px_rgba(99,102,241,0.3)] hover:shadow-[0_0_30px_rgba(99,102,241,0.5)] border border-indigo-400/20">
                    <Plus className="w-4 h-4" /> New Initialization
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto thin-scrollbar px-3 pb-4 min-w-[280px]">
                  <p className="text-[10px] uppercase font-mono text-slate-500 tracking-widest px-2 mb-3 mt-2 font-bold">Archived Sessions</p>
                  
                  <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-2">
                    {historyData?.grievances?.map((g: any) => (
                      <motion.button
                        variants={fadeInUp}
                        key={g.tracking_id}
                        onClick={() => { router.push(`?thread=${g.tracking_id}`); if (window.innerWidth < 768) setIsSidebarOpen(false); }}
                        className={cn(
                          "w-full text-left px-4 py-3.5 rounded-xl border transition-all duration-300 flex flex-col gap-1.5 group relative overflow-hidden",
                          chatState.trackingId === g.tracking_id 
                            ? "bg-white/[0.05] border-indigo-500/30 shadow-[0_0_20px_rgba(99,102,241,0.1)]" 
                            : "bg-transparent border-transparent hover:bg-white/[0.02] hover:border-white/5"
                        )}
                      >
                        {chatState.trackingId === g.tracking_id && <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500 rounded-r-full shadow-[0_0_10px_rgba(99,102,241,0.8)]" />}
                        
                        <div className="flex items-center justify-between relative z-10">
                          <span className={cn("text-[10px] font-mono font-bold transition-colors", chatState.trackingId === g.tracking_id ? "text-indigo-400" : "text-slate-500 group-hover:text-indigo-300")}>
                            #{g.tracking_id.slice(-6).toUpperCase()}
                          </span>
                          <span className={cn("text-[8px] px-1.5 py-0.5 rounded flex items-center gap-1 font-bold uppercase tracking-widest", g.status === 'RESOLVED' ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20")}>
                            {g.status === 'PENDING_DETAILS' ? 'DRAFT' : g.status}
                          </span>
                        </div>
                        <p className={cn("text-xs truncate font-bold relative z-10", chatState.trackingId === g.tracking_id ? "text-white" : "text-slate-300")}>
                          {g.issue_category ? g.issue_category.replace(/_/g, ' ') : 'Pending Issue'}
                        </p>
                        <p className="text-[9px] text-slate-500 flex items-center gap-1.5 font-mono uppercase font-bold relative z-10">
                          <Clock className="w-3 h-3 text-slate-600" /> {new Date(g.created_at).toLocaleDateString()}
                        </p>
                      </motion.button>
                    ))}
                  </motion.div>

                  {(!historyData?.grievances || historyData?.grievances?.length === 0) && (
                    <div className="text-center py-12">
                      <FileText className="w-8 h-8 text-slate-600 mx-auto mb-3 opacity-30" />
                      <p className="text-[10px] text-slate-500 font-mono uppercase tracking-widest font-bold">Empty Ledger</p>
                    </div>
                  )}
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        <div className="flex-1 flex flex-col relative min-w-0 z-10">
          <header className="h-16 border-b border-white/[0.03] bg-transparent backdrop-blur-md flex items-center justify-between px-4 md:px-6 sticky top-0 z-20">
            <div className="flex items-center gap-3">
              <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2.5 hover:bg-white/[0.05] rounded-xl text-slate-400 transition-colors border border-transparent hover:border-white/10">
                <Menu className="w-4 h-4" />
              </button>
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse" /> 
                <span className="text-[10px] font-mono text-emerald-400/80 uppercase tracking-widest font-bold">Secure TLS Link</span>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              {chatState.trackingId && (
                <div className="hidden md:flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 px-3 py-1.5 rounded-lg shadow-sm">
                  <Fingerprint className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="text-[10px] font-mono text-indigo-300 uppercase tracking-widest font-bold">{chatState.trackingId.split('-')[0]}...</span>
                </div>
              )}
              <button onClick={handleLogout} className="flex items-center gap-2 px-4 py-2 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded-xl transition-colors text-[10px] font-bold uppercase tracking-widest text-rose-400 hover:text-rose-300">
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Terminate</span>
              </button>
            </div>
          </header>

          <AnimatePresence>
            {/* 🚨 FIXED: Hide the dynamic island if the status is merely 'RECEIVED' */}
            {chatState.trackingId && chatState.currentStatus && !['PENDING_DETAILS', 'RECEIVED'].includes(chatState.currentStatus) && (
              <motion.div 
                initial={{ opacity: 0, y: -20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.95 }}
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
                className="absolute top-20 left-1/2 -translate-x-1/2 z-30 w-[90%] md:w-auto flex justify-center"
              >
                <div className={cn(
                  "border backdrop-blur-2xl rounded-full px-5 py-3 flex items-center gap-3 shadow-2xl transition-colors duration-500",
                  chatState.currentStatus === 'RESOLVED' || chatState.currentStatus === 'DISPATCHED' ? "bg-emerald-950/80 border-emerald-500/40 shadow-emerald-500/20" :
                  chatState.currentStatus === 'FAILED' ? "bg-rose-950/80 border-rose-500/40 shadow-rose-500/20" :
                  "bg-[#0a0a14]/90 border-indigo-500/40 shadow-indigo-500/20"
                )}>
                  {chatState.currentStatus === 'RESOLVED' || chatState.currentStatus === 'DISPATCHED' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : chatState.currentStatus === 'FAILED' ? (
                    <X className="w-4 h-4 text-rose-400" />
                  ) : (
                    <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                  )}
                  <span className="text-xs font-bold text-slate-100 pr-3 border-r border-white/10 whitespace-nowrap tracking-wide">
                    {PIPELINE_STATUS_MESSAGES[chatState.currentStatus] || "Processing..."}
                  </span>
                  <span className="hidden sm:inline text-[9px] font-mono text-slate-400 uppercase tracking-widest font-bold">
                    System Telemetry
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <main className="flex-1 overflow-y-auto px-4 md:px-8 py-8 custom-scrollbar pb-64">
            <motion.div initial="hidden" animate="show" variants={staggerContainer} className="max-w-3xl mx-auto">
              {chatState.messages.map(m => <MessageBubble key={m.id} message={m} />)}
              
              <AnimatePresence>
                {chatState.isTyping && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }} 
                    animate={{ opacity: 1, y: 0 }} 
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="flex gap-4 mb-8"
                  >
                    <div className="w-9 h-9 rounded-full bg-white/[0.03] flex items-center justify-center border border-white/10 shadow-lg backdrop-blur-md flex-shrink-0 mt-1">
                      <Sparkles className="w-4 h-4 text-indigo-400" />
                    </div>
                    <div className="flex gap-1.5 px-6 py-4 bg-white/[0.04] backdrop-blur-xl w-fit rounded-3xl border border-white/[0.08] rounded-tl-sm shadow-[0_10px_40px_rgba(0,0,0,0.3)]">
                      <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-duration:0.8s]" />
                      <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-duration:0.8s] [animation-delay:0.2s]" />
                      <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-duration:0.8s] [animation-delay:0.4s]" />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              
              <div ref={messagesEndRef} className="h-4" />
            </motion.div>
          </main>

          <footer className="absolute bottom-0 left-0 right-0 px-4 md:px-8 bg-gradient-to-t from-[#03040b] via-[#03040b]/95 to-transparent z-40 pb-8 pt-16 pointer-events-none">
            <div className="max-w-3xl mx-auto relative pointer-events-auto">
              
              <AnimatePresence>
                {lastAiReply.current?.toLowerCase().includes('officially') && chatState.currentStatus === 'PENDING_DETAILS' && (
                  <motion.div 
                    initial={{ opacity: 0, y: 20, scale: 0.95 }} 
                    animate={{ opacity: 1, y: 0, scale: 1 }} 
                    exit={{ opacity: 0, y: 10, scale: 0.95 }} 
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                    className="flex flex-col sm:flex-row gap-3 mb-6 justify-center"
                  >
                    <button 
                      onClick={() => handleSend("Proceed with formal filing.")} 
                      className="px-8 py-3.5 bg-gradient-to-r from-emerald-500 to-emerald-400 hover:from-emerald-400 hover:to-emerald-300 text-emerald-950 text-[11px] uppercase tracking-widest font-black rounded-xl transition-all shadow-[0_0_30px_rgba(16,185,129,0.3)] hover:shadow-[0_0_40px_rgba(16,185,129,0.5)] flex items-center justify-center gap-2 border border-emerald-300/50"
                    >
                      <ShieldCheck className="w-4 h-4" /> Authorize Transmission
                    </button>
                    <button 
                      onClick={() => handleSend("Halt. I need to amend the details.")} 
                      className="px-8 py-3.5 bg-white/[0.03] border border-white/10 text-slate-300 text-[11px] uppercase tracking-widest font-bold rounded-xl hover:bg-white/[0.08] transition-all flex items-center justify-center"
                    >
                      Amend Data
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="relative bg-[#0a0a0f]/90 backdrop-blur-3xl border border-white/[0.08] transition-all duration-300 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] focus-within:border-indigo-500/40 focus-within:shadow-[0_0_40px_rgba(99,102,241,0.15)] flex flex-col p-2.5">
                
                <AnimatePresence>
                  {attachedPreview && (
                    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="absolute -top-20 left-4 p-1 bg-[#101018] border border-white/10 rounded-xl flex items-center gap-2 shadow-2xl z-50">
                      <img src={attachedPreview} className="w-16 h-16 rounded-lg object-cover border border-white/5" />
                      <button onClick={() => setAttachedPreview(null)} className="p-1.5 hover:bg-white/10 text-slate-400 hover:text-white rounded-md transition-colors"><X className="w-3 h-3" /></button>
                    </motion.div>
                  )}
                  {tempLocation && (
                    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="absolute -top-16 left-4 px-3 py-2.5 bg-[#101018] border border-white/10 rounded-xl flex items-center gap-2 shadow-2xl z-50">
                      <MapPin className="w-4 h-4 text-indigo-400" />
                      <span className="text-[10px] font-mono text-slate-200 uppercase tracking-widest font-bold">{tempLocation.address_text}</span>
                      <button onClick={() => setTempLocation(null)} className="ml-2 p-1 hover:bg-white/10 text-slate-400 hover:text-white rounded-md transition-colors"><X className="w-3 h-3" /></button>
                    </motion.div>
                  )}
                </AnimatePresence>

                {isRecording ? (
                  <div className="flex items-center justify-center gap-3 py-5 px-4 bg-rose-500/10 rounded-xl border border-rose-500/20 mb-2">
                    <span className="w-3 h-3 bg-rose-500 rounded-full animate-pulse shadow-[0_0_15px_rgba(225,29,72,0.8)]" />
                    <span className="font-mono text-sm text-rose-400 font-bold tracking-widest">RECORDING... 0:{recordingTime.toString().padStart(2, '0')}</span>
                  </div>
                ) : (
                  <textarea 
                    rows={1} 
                    value={input} 
                    onChange={(e) => setInput(e.target.value)} 
                    onKeyDown={(e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }}} 
                    placeholder={placeholderText}
                    disabled={isPipelineActive && chatState.currentStatus !== 'PENDING_DETAILS'}
                    className="w-full bg-transparent border-none outline-none text-sm py-3.5 px-4 placeholder:text-slate-600 resize-none max-h-32 text-slate-100 font-medium disabled:opacity-50" 
                  />
                )}

                <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/[0.05]">
                  <div className="flex gap-1">
                    <button onClick={() => fileInputRef.current?.click()} className="p-2.5 hover:bg-white/[0.05] rounded-xl text-slate-400 hover:text-indigo-400 transition-colors tooltip-trigger"><ImageIcon className="w-4 h-4" /></button>
                    <button onClick={() => setShowLocationModal(true)} className="p-2.5 hover:bg-white/[0.05] rounded-xl text-slate-400 hover:text-indigo-400 transition-colors"><MapPin className="w-4 h-4" /></button>
                    <button onClick={toggleRecording} className={cn("p-2.5 rounded-xl transition-colors", isRecording ? "bg-rose-500/20 text-rose-400" : "hover:bg-white/[0.05] text-slate-400 hover:text-indigo-400")}>
                      {isRecording ? <Square className="w-4 h-4 fill-current" /> : <Mic className="w-4 h-4" />}
                    </button>
                  </div>
                  
                  <button 
                    onClick={() => handleSend()} 
                    disabled={(!input.trim() && !attachedPreview && !tempLocation && !isRecording) || submitMutation.isPending || (isPipelineActive && chatState.currentStatus !== 'PENDING_DETAILS')} 
                    className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 disabled:from-white/5 disabled:to-white/5 disabled:text-slate-600 disabled:shadow-none text-white rounded-xl transition-all shadow-[0_0_20px_rgba(99,102,241,0.2)] flex items-center justify-center min-w-[60px] font-bold text-xs tracking-widest uppercase border border-indigo-400/20 disabled:border-transparent"
                  >
                    {submitMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-3.5 h-3.5 mr-2" /> Send </>}
                  </button>
                </div>
              </div>
            </div>
          </footer>
        </div>
      </div>

      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        accept="image/*" 
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            if (file.size > 10 * 1024 * 1024) { toast.error('Image max limit is 10MB.'); return; }
            const reader = new FileReader();
            reader.onloadend = () => { setAttachedPreview(reader.result as string); toast.success("Visual attached to payload.", { style: { background: '#0a0a0a', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' } }); };
            reader.readAsDataURL(file);
            e.target.value = ''; 
          }
        }} 
      />

      <AnimatePresence>
        {showLocationModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#03040b]/90 backdrop-blur-xl">
            <motion.div initial={{ scale: 0.95, opacity: 0, y: 10 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 10 }} className="w-full max-w-2xl bg-[#05060f] border border-white/10 rounded-2xl overflow-hidden shadow-[0_0_50px_rgba(99,102,241,0.2)] flex flex-col">
              <div className="flex items-center justify-between p-5 border-b border-white/5 bg-white/[0.02]">
                <h3 className="text-[10px] font-bold tracking-widest uppercase flex items-center gap-2 text-slate-200"><Navigation2 className="w-4 h-4 text-indigo-400" /> Geo-Spatial Calibrator</h3>
                <button onClick={() => setShowLocationModal(false)} className="p-2 hover:bg-white/10 rounded-lg text-slate-400 transition-colors"><X className="w-4 h-4" /></button>
              </div>
              
              <div className="h-[400px] w-full bg-[#0a0a0a] relative z-0">
                <NativeMap position={mapPinPosition} setPosition={setMapPinPosition} />
                {!mapPinPosition && (
                  <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none">
                    <span className="bg-black/80 border border-indigo-500/30 text-indigo-300 text-[10px] px-5 py-2.5 rounded-xl backdrop-blur-md font-mono tracking-widest font-bold shadow-2xl">
                      CLICK TO DROP SENSOR PIN
                    </span>
                  </div>
                )}
              </div>

              <div className="p-5 bg-white/[0.02] flex flex-col sm:flex-row gap-3">
                <button onClick={requestLocation} disabled={isLocating} className="flex-1 py-3.5 px-4 bg-white/[0.03] border border-white/10 hover:border-indigo-500/50 hover:bg-indigo-500/5 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50 text-[11px] font-bold tracking-widest uppercase text-slate-300">
                  {isLocating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crosshair className="w-4 h-4 text-indigo-400" />} Extract HW GPS
                </button>
                <button onClick={confirmMapLocation} disabled={!mapPinPosition} className="flex-1 py-3.5 px-4 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white disabled:from-white/5 disabled:to-white/5 disabled:text-slate-600 rounded-xl transition-all font-bold text-[11px] tracking-widest uppercase shadow-[0_0_20px_rgba(99,102,241,0.2)] disabled:shadow-none border border-indigo-400/20 disabled:border-transparent flex items-center justify-center gap-2">
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

export default function Page() {
  return (
    <Suspense fallback={
      <div className="flex h-screen w-full items-center justify-center bg-[#03040b]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
          <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500 font-bold">Initializing Connect...</p>
        </div>
      </div>
    }>
      <DashboardContent />
    </Suspense>
  );
}