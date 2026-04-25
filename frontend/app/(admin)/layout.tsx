// app/(admin)/layout.tsx
'use client';

import { useState, useEffect, createContext, useContext, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  LayoutDashboard, Users, FileText, ShieldCheck, Settings, 
  LogOut, Bell, Search, Menu, X, Activity 
} from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';

import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';

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
  
  // 🚨 FIXED: Used standard useRef for mutable callback storage
  const callbacksRef = useRef<Map<string, Set<(data: any) => void>>>(new Map());
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  useEffect(() => {
    let eventSource: EventSource | null = null;
    
    const connectSSE = () => {
      try {
        eventSource = new EventSource('/api/admin/sse');
        
        eventSource.onopen = () => {
          setIsConnected(true);
          console.log('✅ Mission Control SSE connected');
        };
        
        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            setLastUpdate(new Date());
            
            // Route to specific thread callbacks
            if (data.thread_id && callbacksRef.current.has(data.thread_id)) {
              callbacksRef.current.get(data.thread_id)?.forEach(cb => cb(data));
            }
          } catch (e) {
            console.error('SSE parse error:', e);
          }
        };
        
        eventSource.onerror = () => {
          console.warn('⚠️ SSE error, falling back to polling.');
          setIsConnected(false);
          eventSource?.close();
          startPolling();
        };
        
      } catch (e) {
        startPolling();
      }
    };
    
    const startPolling = () => {
      // 🚨 FIXED: Safe interval clearing to prevent memory leaks
      if (pollIntervalRef.current) return; 
      
      pollIntervalRef.current = setInterval(async () => {
        try {
          await apiClient.fetchDashboardStats(); // Ping to check connection
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
      {/* Global connection indicator */}
      <div className={cn(
        'fixed top-4 right-4 z-50 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all shadow-lg',
        isConnected 
          ? 'bg-green-500/20 text-green-300 border border-green-500/30' 
          : 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 animate-pulse'
      )}>
        <div className={cn('w-2 h-2 rounded-full', isConnected ? 'bg-green-400' : 'bg-yellow-400')} />
        {isConnected ? 'System Live' : 'Reconnecting...'}
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
  // 🚨 FIXED: Path matches the root `page.tsx`
  { href: '/admin', icon: LayoutDashboard, label: 'Dashboard' }, 
  { href: '/admin/grievances', icon: FileText, label: 'Grievances' },
  { href: '/admin/users', icon: Users, label: 'Users' },
  { href: '/admin/audit', icon: Activity, label: 'Audit Logs' },
  { href: '/admin/settings', icon: Settings, label: 'Settings' },
];

function Sidebar({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  
  const handleLogout = () => {
    // In production: Also call a logout API to invalidate the session token
    document.cookie = 'civiclink-admin-session=; Max-Age=0; path=/';
    router.push('/admin/login');
    toast.success('System disconnected cleanly');
  };
  
  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
            onClick={onClose}
          />
        )}
      </AnimatePresence>
      
      <motion.aside
        initial={{ x: -300 }}
        animate={{ x: isOpen ? 0 : -300 }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className={cn(
          'fixed lg:static inset-y-0 left-0 z-50 w-72 glass-panel border-r-0 rounded-r-3xl lg:rounded-r-none',
          'flex flex-col'
        )}
      >
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2 text-indigo-400">
                <ShieldCheck className="w-6 h-6" />
                CivicLink
              </h1>
              <p className="text-xs text-slate-500 mt-1 uppercase tracking-wider font-semibold">Mission Control</p>
            </div>
            <button 
              onClick={onClose}
              className="lg:hidden p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            // 🚨 FIXED: Exact match for dashboard, prefix match for everything else
            const isActive = item.href === '/admin' 
              ? pathname === '/admin' 
              : pathname.startsWith(item.href);
            
            return (
              <motion.button
                key={item.href}
                whileHover={{ x: 4 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  router.push(item.href);
                  onClose();
                }}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all',
                  isActive
                    ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                    : 'hover:bg-white/5 text-white/80 hover:text-white'
                )}
              >
                <Icon className={cn('w-5 h-5', isActive ? 'text-indigo-400' : 'text-white/60')} />
                <span className="font-medium">{item.label}</span>
              </motion.button>
            );
          })}
        </nav>
        
        <div className="p-4 border-t border-white/10 bg-black/20">
          <div className="flex items-center gap-3 px-2 mb-4">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center font-bold text-sm text-white shadow-lg">
              A
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-200 truncate">Lead Architect</p>
              <p className="text-xs text-slate-500 truncate">admin@civiclink.in</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-2 text-sm text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
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
  
  // Close sidebar on mobile when route changes
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);
  
  return (
    <RealTimeProvider>
      <div className="flex h-screen bg-[#0a0e17] text-slate-200 overflow-hidden font-sans">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        
        <main className="flex-1 flex flex-col min-w-0 relative">
          {/* Subtle background glow effect */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-indigo-500/10 blur-[120px] rounded-full pointer-events-none -z-10" />
          
          <header className="glass-panel border-b-0 rounded-none lg:rounded-b-3xl p-4 flex items-center justify-between sticky top-0 z-30 mx-0 lg:mx-4">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-2 hover:bg-white/10 rounded-lg transition-colors"
              >
                <Menu className="w-6 h-6" />
              </button>
              
              {/* Optional: Global Search (Currently purely visual) */}
              <div className="relative hidden sm:block">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  type="search"
                  placeholder="Global Search (Press '/' to focus)"
                  className="glass-input pl-10 w-64 lg:w-80"
                />
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <button className="p-2 hover:bg-white/10 rounded-lg transition-colors relative">
                <Bell className="w-5 h-5" />
              </button>
            </div>
          </header>
          
          {/* Page Content Injection */}
          <div className="flex-1 p-4 lg:p-8 overflow-y-auto max-w-7xl w-full mx-auto relative z-10 custom-scrollbar">
            {children}
          </div>
        </main>
      </div>

      <Toaster 
        position="bottom-right"
        toastOptions={{
          className: 'glass-panel text-slate-200',
          style: {
            background: 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(99, 102, 241, 0.2)',
          }
        }}
      />
    </RealTimeProvider>
  );
}