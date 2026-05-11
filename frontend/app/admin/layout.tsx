'use client';

import { useState, useEffect, createContext, useContext, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  LayoutDashboard, Users, FileText, ShieldCheck, Settings, 
  LogOut, Bell, Search, Menu, X, Activity, Globe, Terminal,Link
} from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';

import { cn } from '@/lib/utils';

// =============================================================================
// 🚨 SECURE ADMIN API WRAPPERS (Vercel Ready)
// =============================================================================
const getBaseUrl = () => {
  const url = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
  return url.replace('localhost', '127.0.0.1'); 
};

const secureAdminPing = async () => {
  const res = await fetch(`${getBaseUrl()}/api/v1/admin/dashboard-stats`, {
    headers: { 'Authorization': `Bearer ${process.env.NEXT_PUBLIC_FRONTEND_API_KEY || 'civiclink_dev_super_secret_998877'}` },
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(`Ping failed`);
  return res.json();
};

// =============================================================================
// REAL-TIME CONTEXT (SSE + Fallback Polling)
// =============================================================================

type RealTimeContextType = {
  isConnected: boolean;
  lastUpdate: Date | null;
  subscribe: (threadId: string, callback: (data: any) => void) => () => void;
};

const RealTimeContext = createContext<RealTimeContextType | null>(null);

export function RealTimeProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  
  const callbacksRef = useRef<Map<string, Set<(data: any) => void>>>(new Map());
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  useEffect(() => {
    let eventSource: EventSource | null = null;
    
    const connectSSE = () => {
      try {
        // 🚨 FIXED: Correct backend SSE route
        eventSource = new EventSource(`${getBaseUrl()}/api/v1/admin/stream`);
        
        eventSource.onopen = () => {
          setIsConnected(true);
        };
        
        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            setLastUpdate(new Date());
            
            if (data.thread_id && callbacksRef.current.has(data.thread_id)) {
              callbacksRef.current.get(data.thread_id)?.forEach(cb => cb(data));
            }
          } catch (e) {
            console.error('SSE parse error:', e);
          }
        };
        
        eventSource.onerror = () => {
          setIsConnected(false);
          eventSource?.close();
          startPolling();
        };
        
      } catch (e) {
        startPolling();
      }
    };
    
    const startPolling = () => {
      if (pollIntervalRef.current) return; 
      
      pollIntervalRef.current = setInterval(async () => {
        try {
          // 🚨 FIXED: Now uses the Secure Admin Ping to bypass auth blocks
          await secureAdminPing(); 
          setLastUpdate(new Date());
          setIsConnected(true);
        } catch (e) {
          setIsConnected(false);
        }
      }, 10000); 
    };
    
    connectSSE();
    
    return () => {
      eventSource?.close();
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);
  
  const subscribe = (threadId: string, callback: (data: any) => void) => {
    if (!callbacksRef.current.has(threadId)) {
      callbacksRef.current.set(threadId, new Set());
    }
    callbacksRef.current.get(threadId)!.add(callback);
    
    return () => {
      callbacksRef.current.get(threadId)?.delete(callback);
      if (callbacksRef.current.get(threadId)?.size === 0) {
        callbacksRef.current.delete(threadId);
      }
    };
  };
  
  return (
    <RealTimeContext.Provider value={{ isConnected, lastUpdate, subscribe }}>
      {children}
      {/* Global connection indicator - Amethyst Theme */}
      <div className={cn(
        'fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2 rounded-full text-[10px] uppercase tracking-widest font-bold transition-all duration-500 shadow-2xl backdrop-blur-md border',
        isConnected 
          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.1)]' 
          : 'bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse shadow-[0_0_20px_rgba(245,158,11,0.1)]'
      )}>
        <div className={cn('w-2 h-2 rounded-full', isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400')} />
        <Globe className="w-3 h-3 opacity-50" />
        {isConnected ? 'Uplink Stable' : 'Restoring Uplink...'}
      </div>
    </RealTimeContext.Provider>
  );
}

export const useRealTime = () => {
  const ctx = useContext(RealTimeContext);
  if (!ctx) throw new Error('useRealTime must be used within RealTimeProvider');
  return ctx;
};

// =============================================================================
// SIDEBAR NAVIGATION
// =============================================================================

const NAV_ITEMS = [
  { href: '/admin', icon: LayoutDashboard, label: 'Mission Control' }, 
  { href: '/admin/grievances', icon: FileText, label: 'Full Ledger' },
  { href: '/admin/users', icon: Users, label: 'Personnel' },
  { href: '/admin/audit', icon: Terminal, label: 'Telemetry Logs' },
  { href: '/admin/settings', icon: Settings, label: 'Configurations' },
];

function Sidebar({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  
  const handleLogout = () => {
    // 🚨 FIXED: Purges the specific localStorage token we rely on
    localStorage.removeItem('civiclink_admin_token');
    router.replace('/');
    toast.success('System connection terminated.', {
      style: { background: '#0a040d', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }
    });
  };
  
  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[#0a040d]/80 backdrop-blur-md z-40 lg:hidden"
            onClick={onClose}
          />
        )}
      </AnimatePresence>
      
      <motion.aside
        initial={{ x: -300 }}
        animate={{ x: isOpen ? 0 : -300 }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className={cn(
          'fixed lg:static inset-y-0 left-0 z-50 w-[280px] bg-[#050208]/95 backdrop-blur-2xl border-r border-white/5',
          'flex flex-col shadow-[20px_0_40px_rgba(0,0,0,0.5)] lg:shadow-none'
        )}
      >
        <div className="p-6 border-b border-white/5 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-purple-500/5 to-transparent pointer-events-none" />
          <div className="flex items-center justify-between relative z-10">
            <Link href="/admin" onClick={onClose} className="group">
              <h1 className="text-xl font-black tracking-widest uppercase flex items-center gap-2 text-slate-100 group-hover:text-white transition-colors">
                <ShieldCheck className="w-5 h-5 text-purple-500 group-hover:text-purple-400 transition-colors" />
                CivicLink
              </h1>
              <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-[0.2em] font-mono font-bold">Admin Node</p>
            </Link>
            <button 
              onClick={onClose}
              className="lg:hidden p-2 hover:bg-white/10 rounded-lg transition-colors text-slate-400"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto thin-scrollbar">
          <p className="px-2 text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-4">Directories</p>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = item.href === '/admin' 
              ? pathname === '/admin' 
              : pathname.startsWith(item.href);
            
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-left transition-all duration-300 relative overflow-hidden group',
                  isActive
                    ? 'bg-purple-500/10 text-white shadow-[0_0_15px_rgba(147,51,234,0.1)] border border-purple-500/20'
                    : 'hover:bg-white/[0.03] text-slate-400 hover:text-slate-200 border border-transparent hover:border-white/5'
                )}
              >
                {isActive && (
                  <motion.div layoutId="active-nav" className="absolute left-0 top-0 bottom-0 w-1 bg-purple-500 rounded-r-full shadow-[0_0_10px_rgba(147,51,234,0.8)]" />
                )}
                <Icon className={cn('w-4 h-4 transition-colors z-10', isActive ? 'text-purple-400' : 'text-slate-500 group-hover:text-slate-300')} />
                <span className={cn("text-xs font-bold tracking-wider uppercase z-10", isActive && "drop-shadow-md")}>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        
        <div className="p-5 border-t border-white/5 bg-black/20 backdrop-blur-md">
          <div className="flex items-center gap-3 px-2 mb-5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-600 to-rose-600 flex items-center justify-center font-black text-sm text-white shadow-[0_0_15px_rgba(225,29,72,0.3)]">
              A
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold text-slate-200 truncate uppercase tracking-widest">Lead Architect</p>
              <p className="text-[10px] font-mono text-slate-500 truncate">SYS.ROOT.1</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-2.5 text-xs font-bold tracking-widest uppercase text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 rounded-xl transition-all group"
          >
            <LogOut className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            Disconnect
          </button>
        </div>
      </motion.aside>
    </>
  );
}

// =============================================================================
// MAIN LAYOUT
// =============================================================================

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  
  // Ensure sidebar forces closed when navigation occurs on mobile
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  // Fix hydration issues by setting mobile state strictly after mount
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
    // On desktop, force the sidebar open naturally via CSS. 
    // This state is just to handle the mobile sliding logic.
    if (window.innerWidth >= 1024) {
      setSidebarOpen(true);
    }
  }, []);

  if (!isMounted) return null;
  
  return (
    <RealTimeProvider>
      <div className="flex h-screen bg-[#03040b] text-slate-200 overflow-hidden font-sans selection:bg-purple-500/30">
        
        {/* Persistent Left Sidebar */}
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        
        {/* Main Content Area */}
        <main className="flex-1 flex flex-col min-w-0 relative">
          {/* Subtle Ambient Background Effects */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-purple-600/10 blur-[150px] rounded-full pointer-events-none -z-10 mix-blend-screen" />
          <div className="absolute bottom-0 right-0 w-[500px] h-[300px] bg-rose-600/5 blur-[120px] rounded-full pointer-events-none -z-10 mix-blend-screen" />
          
          {/* Mobile-Only Header */}
          <header className="lg:hidden bg-[#050208]/80 backdrop-blur-xl border-b border-white/5 p-4 flex items-center justify-between sticky top-0 z-30 shadow-sm">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors text-slate-400"
              >
                <Menu className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex items-center gap-3">
              <button className="relative p-2.5 hover:bg-white/5 rounded-xl transition-colors border border-transparent hover:border-white/10 text-slate-400 hover:text-slate-200">
                <Bell className="w-4 h-4" />
                <span className="absolute top-2 right-2 w-2 h-2 bg-rose-500 rounded-full border-2 border-[#050208]" />
              </button>
            </div>
          </header>
          
          {/* Desktop Search Header (Optional context bar) */}
          <header className="hidden lg:flex bg-transparent p-6 items-center justify-end z-20">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="search"
                placeholder="Global Query (Press '/')"
                className="glass-input pl-11 w-64 lg:w-80 h-10 text-sm"
              />
            </div>
          </header>
          
          {/* Page Content Injection */}
          <div className="flex-1 p-4 lg:p-8 overflow-y-auto w-full relative z-10 custom-scrollbar">
            {children}
          </div>
        </main>
      </div>

      <Toaster 
        position="top-right"
        toastOptions={{
          className: 'glass-panel text-slate-200 shadow-2xl',
          style: {
            background: 'rgba(10, 4, 13, 0.95)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(147, 51, 234, 0.2)',
            fontSize: '13px',
            fontWeight: 600,
            letterSpacing: '0.025em'
          },
          success: {
            iconTheme: { primary: '#10b981', secondary: '#0a040d' },
            style: { border: '1px solid rgba(16, 185, 129, 0.3)' }
          },
          error: {
            iconTheme: { primary: '#e11d48', secondary: '#0a040d' },
            style: { border: '1px solid rgba(225, 29, 72, 0.3)' }
          }
        }}
      />
    </RealTimeProvider>
  );
}