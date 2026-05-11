'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal, ShieldAlert, Lock, ArrowRight, Activity, Cpu, Network, User, KeyRound, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/api-client';

// 🚨 FIXED: Define the storage key locally for the root page
const USER_STORAGE_KEY = 'civiclink_user_session';

// =============================================================================
// BACKGROUND ATMOSPHERE (Amethyst & Crimson)
// =============================================================================
function BackgroundAtmosphere() {
  return (
    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
      <motion.div 
        animate={{ scale: [1, 1.05, 1], opacity: [0.3, 0.5, 0.3] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
        className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-indigo-600/20 blur-[150px] rounded-full mix-blend-screen" 
      />
      <motion.div 
        animate={{ scale: [1, 1.1, 1], opacity: [0.2, 0.4, 0.2] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut", delay: 1 }}
        className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-purple-600/20 blur-[150px] rounded-full mix-blend-screen" 
      />
      {/* Subtle Dot Grid */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px),linear-gradient(to_bottom,#ffffff03_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_50%,#000_80%,transparent_100%)]" />
    </div>
  );
}

// =============================================================================
// MAIN GATEWAY PAGE
// =============================================================================
function RootGateway() {
  const router = useRouter();
  
  // Admin State
  const [showOverride, setShowOverride] = useState(false);
  const [adminKey, setAdminKey] = useState('');
  const [hasAdminError, setHasAdminError] = useState(false);
  const [bootSequence, setBootSequence] = useState<string[]>([]);
  const adminInputRef = useRef<HTMLInputElement>(null);

  // Citizen State
  const [showCitizenAuth, setShowCitizenAuth] = useState(false);
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [citizenUsername, setCitizenUsername] = useState('');
  const [citizenPassword, setCitizenPassword] = useState('');
  const [citizenPhone, setCitizenPhone] = useState(''); 
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const citizenInputRef = useRef<HTMLInputElement>(null);

  // Keyboard Tracking for 3-key combo (Ctrl + Q + P)
  const keysPressed = useRef<Set<string>>(new Set());

  const fakeBootLogs = [
    "[ OK ] Reached target Edge AI Inference Module.",
    "[ OK ] Started CivicLink Master Daemon.",
    "[ OK ] Connected to Vision Model API.",
    "Mounting encrypted volume /dev/mapper/admin-root...",
    "Verifying kernel signatures... SUCCESS.",
    "Awaiting sysadmin authentication sequence..."
  ];

  // Global Keyboard & Click Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.key) return; // Safety guard
      const key = e.key.toLowerCase();
      keysPressed.current.add(key);

      if (showOverride || showCitizenAuth) return;

      if (e.ctrlKey && keysPressed.current.has('q') && key === 'p') {
        e.preventDefault();
        e.stopPropagation();
        setShowOverride(true);
        keysPressed.current.clear(); 
        return;
      }

      const ignoredKeys = ['control', 'alt', 'shift', 'meta', 'escape', 'q', 'p'];
      if (!ignoredKeys.includes(key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
        setShowCitizenAuth(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!e.key) return;
      keysPressed.current.delete(e.key.toLowerCase());
    };

    const handleMouseClick = (e: MouseEvent) => {
      if (!showOverride && !showCitizenAuth) setShowCitizenAuth(true);
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowOverride(false);
        setShowCitizenAuth(false);
        setAdminKey('');
        setBootSequence([]);
        keysPressed.current.clear();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousedown', handleMouseClick);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousedown', handleMouseClick);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [showOverride, showCitizenAuth]);

  // Handle Admin Override Animation
  useEffect(() => {
    if (showOverride) {
      let delay = 0;
      fakeBootLogs.forEach((log, index) => {
        setTimeout(() => {
          setBootSequence(prev => [...prev, log]);
          if (index === fakeBootLogs.length - 1) {
            setTimeout(() => adminInputRef.current?.focus(), 100);
          }
        }, delay);
        delay += Math.random() * 150 + 50;
      });
    }
  }, [showOverride]);

  // Auto-focus citizen login
  useEffect(() => {
    if (showCitizenAuth) {
      setTimeout(() => citizenInputRef.current?.focus(), 100);
    }
  }, [showCitizenAuth]);

  // --- Handlers ---

  const handleAdminSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminKey === 'Admin') {
      toast.success('Decryption successful. Welcome, Architect.', {
        style: { background: '#0a040d', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)' }
      });
      router.push('/admin');
    } else {
      setHasAdminError(true);
      setAdminKey('');
      toast.error('FATAL: SIGNATURE REJECTED', {
        style: { background: '#0a040d', color: '#f43f5e', border: '1px solid rgba(244, 63, 94, 0.3)' }
      });
      setTimeout(() => setHasAdminError(false), 500);
    }
  };

  const handleCitizenAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAuthLoading(true);
    
    try {
      // 🚨 FIXED: Explicitly typed sessionResponse as 'any' so TypeScript stops complaining
      let sessionResponse: any;

      if (isLoginMode) {
        sessionResponse = await apiClient.citizenLogin(citizenUsername, citizenPassword);
        toast.success('Identity verified. Entering network.', { style: { background: '#0a040d', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)' }});
      } else {
        await apiClient.citizenRegister(citizenUsername, citizenPassword, citizenPhone);
        sessionResponse = await apiClient.citizenLogin(citizenUsername, citizenPassword);
        toast.success('Identity established. Welcome.', { style: { background: '#0a040d', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)' }});
      }

      // 🚨 FIXED: Safely check for token and save
      if (sessionResponse && sessionResponse.token) {
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify({ 
          sessionId: sessionResponse.token,
          username: sessionResponse.citizen?.username || citizenUsername 
        }));
      }

      router.push('/dashboard');
    } catch (error: any) {
      toast.error(error.message || 'Authentication failed. Please try again.', { style: { background: '#0a040d', color: '#f43f5e', border: '1px solid rgba(244, 63, 94, 0.3)' }});
    } finally {
      setIsAuthLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-[#050208] text-slate-200 overflow-hidden font-mono select-none flex flex-col items-center justify-center">
      
      <BackgroundAtmosphere />

      {/* MAIN SCREEN (Idle State) */}
      <div className={cn("z-10 flex flex-col items-center justify-center text-center transition-all duration-700", (showOverride || showCitizenAuth) && "opacity-0 blur-md scale-95 pointer-events-none")}>
        <motion.div
          initial={{ opacity: 0, scale: 0.8, rotate: -10 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ duration: 1.2, type: "spring", bounce: 0.4 }}
          className="relative flex items-center justify-center w-32 h-32 mb-8 rounded-3xl bg-indigo-500/5 border border-indigo-500/20 shadow-[0_0_60px_rgba(99,102,241,0.15)] backdrop-blur-xl group"
        >
          <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-indigo-500/10 to-purple-500/5 pointer-events-none" />
          <Network className="w-14 h-14 text-indigo-400 drop-shadow-[0_0_15px_rgba(99,102,241,0.5)] transition-transform duration-700 group-hover:scale-110" />
        </motion.div>
        
        <motion.h1 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="text-5xl md:text-7xl font-black tracking-[0.15em] uppercase mb-4 text-transparent bg-clip-text bg-gradient-to-br from-white via-indigo-100 to-slate-500 drop-shadow-xl font-sans"
        >
          CIVICLINK
        </motion.h1>
        
        <motion.p 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.4 }}
          className="text-xs md:text-sm text-indigo-300/50 tracking-[0.3em] uppercase mb-16 flex items-center gap-3 font-bold"
        >
          <span className="w-12 h-[1px] bg-indigo-500/30" />
          Autonomous Grievance Node
          <span className="w-12 h-[1px] bg-indigo-500/30" />
        </motion.p>

        <motion.div 
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
          className="flex flex-col items-center gap-4"
        >
          <div className="flex items-center gap-3 px-8 py-3 rounded-full border border-white/5 bg-white/[0.02] backdrop-blur-md cursor-pointer hover:bg-white/[0.05] transition-colors shadow-2xl">
            <span className="w-2 h-2 bg-indigo-400 rounded-full shadow-[0_0_10px_rgba(99,102,241,0.8)] animate-pulse" />
            <span className="uppercase tracking-[0.2em] text-xs font-bold text-slate-300">Click or press any key to authenticate</span>
          </div>
        </motion.div>
      </div>

      {/* NODE STATUS INDICATORS */}
      <div className="absolute bottom-8 flex gap-8 text-[10px] uppercase tracking-widest text-slate-500 font-bold">
        <div className="flex items-center gap-2"><Activity className="w-3.5 h-3.5 text-emerald-500/80" /> Gateway: Online</div>
        <div className="flex items-center gap-2"><Cpu className="w-3.5 h-3.5 text-indigo-500/80" /> Core Engine: Active</div>
      </div>

      {/* ========================================================================= */}
      {/* CITIZEN AUTHENTICATION MODAL */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {showCitizenAuth && (
          <motion.div
            initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
            animate={{ opacity: 1, backdropFilter: "blur(16px)" }}
            exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
            className="absolute inset-0 z-40 flex items-center justify-center bg-[#050208]/80"
            onMouseDown={(e) => e.stopPropagation()} 
          >
            <motion.div
              initial={{ scale: 0.95, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 20, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="relative w-full max-w-md p-8 rounded-3xl border border-indigo-500/20 shadow-[0_20px_50px_rgba(0,0,0,0.5)] bg-[#0a040d]/90 backdrop-blur-2xl font-sans"
            >
              {/* Internal Glow */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[80%] h-32 bg-indigo-500/10 blur-[50px] rounded-full pointer-events-none" />

              <div className="flex justify-center mb-6 relative z-10">
                <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/30 shadow-[0_0_20px_rgba(99,102,241,0.15)]">
                  <User className="w-7 h-7 text-indigo-400" />
                </div>
              </div>

              <h2 className="text-2xl font-black text-center text-white mb-2 tracking-tight">Citizen Identity</h2>
              <p className="text-center text-xs text-slate-400 mb-8 font-mono uppercase tracking-widest">
                {isLoginMode ? 'Authenticate to enter network' : 'Establish civic identity'}
              </p>

              <form onSubmit={handleCitizenAuth} className="space-y-4 relative z-10">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-widest">Username</label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      ref={citizenInputRef}
                      type="text"
                      required
                      value={citizenUsername}
                      onChange={(e) => setCitizenUsername(e.target.value)}
                      className="w-full bg-white/[0.03] border border-white/10 rounded-xl py-3 pl-11 pr-4 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 focus:bg-white/[0.05] transition-all"
                      placeholder="Enter designation"
                    />
                  </div>
                </div>

                {!isLoginMode && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                    <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-widest">Phone Number (Optional)</label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type="tel"
                        value={citizenPhone}
                        onChange={(e) => setCitizenPhone(e.target.value)}
                        className="w-full bg-white/[0.03] border border-white/10 rounded-xl py-3 pl-11 pr-4 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 focus:bg-white/[0.05] transition-all"
                        placeholder="Link hardware ID"
                      />
                    </div>
                  </motion.div>
                )}

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-widest">Passkey</label>
                  <div className="relative">
                    <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="password"
                      required
                      value={citizenPassword}
                      onChange={(e) => setCitizenPassword(e.target.value)}
                      className="w-full bg-white/[0.03] border border-white/10 rounded-xl py-3 pl-11 pr-4 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 focus:bg-white/[0.05] transition-all"
                      placeholder="••••••••"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isAuthLoading || !citizenUsername || !citizenPassword}
                  className="w-full mt-8 py-3.5 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white rounded-xl font-bold tracking-widest uppercase text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(99,102,241,0.3)] border border-indigo-400/20"
                >
                  {isAuthLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (isLoginMode ? 'Establish Connection' : 'Register Identity')}
                </button>
              </form>

              <div className="mt-6 text-center relative z-10 border-t border-white/5 pt-6">
                <button 
                  type="button"
                  onClick={() => setIsLoginMode(!isLoginMode)}
                  className="text-[10px] text-slate-400 hover:text-indigo-400 font-bold uppercase tracking-widest transition-colors"
                >
                  {isLoginMode ? "Need access? Register here." : "Already provisioned? Authenticate here."}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* HIDDEN ADMIN OVERLAY (Triggered by Ctrl+Q+P) */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {showOverride && (
          <motion.div
            initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
            animate={{ opacity: 1, backdropFilter: "blur(16px)" }}
            exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-[#050208]/95"
            onMouseDown={(e) => e.stopPropagation()} 
          >
            {/* Scanline Effect Overlay */}
            <div className="absolute inset-0 pointer-events-none bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSJ0cmFuc3BhcmVudCIvPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSIxIiBmaWxsPSJyZ2JhKDI1NSwgMjU1LCAyNTUsIDAuMDUpIi8+Cjwvc3ZnPg==')] opacity-50 z-0" />

            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className={cn(
                "relative z-10 w-full max-w-2xl p-[1px] rounded-2xl overflow-hidden bg-gradient-to-b transition-colors duration-300",
                hasAdminError ? "from-rose-500/50 to-rose-900/10 shadow-[0_0_50px_rgba(244,63,94,0.15)]" : "from-purple-500/40 to-slate-900/40 shadow-[0_0_60px_rgba(147,51,234,0.15)]",
                hasAdminError && "animate-shake" 
              )}
              style={hasAdminError ? { animation: 'shake 0.4s cubic-bezier(.36,.07,.19,.97) both' } : {}}
            >
              <div className="bg-[#050208] rounded-2xl h-full w-full flex flex-col">
                <div className="flex items-center justify-between px-5 py-3 border-b border-white/5 bg-white/[0.02]">
                  <div className="flex items-center gap-2 text-xs font-mono text-slate-500">
                    <Terminal className="w-4 h-4" />
                    <span>root@civiclink-core:~#</span>
                  </div>
                  <button 
                    onClick={() => { setShowOverride(false); setAdminKey(''); setBootSequence([]); keysPressed.current.clear(); }}
                    className="text-slate-500 hover:text-white transition-colors text-[10px] tracking-widest uppercase font-bold"
                  >
                    [ESC] ABORT
                  </button>
                </div>

                <div className="p-8">
                  <div className="flex items-start gap-5 mb-8">
                    <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center border shrink-0", hasAdminError ? "bg-rose-500/10 border-rose-500/30" : "bg-purple-500/10 border-purple-500/30")}>
                      <ShieldCheck className={cn("w-6 h-6", hasAdminError ? "text-rose-500" : "text-purple-400")} />
                    </div>
                    <div>
                      <h2 className="text-sm font-black text-slate-200 mb-1 uppercase tracking-widest">Protocol 7 Restricted Access</h2>
                      <p className="text-xs font-mono text-slate-500 leading-relaxed max-w-md uppercase tracking-wide">
                        Unauthorized access attempts are traced. Provide the architect signature to mount Mission Control.
                      </p>
                    </div>
                  </div>

                  <div className="mb-6 space-y-1.5 min-h-[120px] font-mono text-xs text-emerald-400/80 tracking-wide">
                    {bootSequence.map((log, i) => (
                      <motion.div key={i} initial={{ opacity: 0, x: -5 }} animate={{ opacity: 1, x: 0 }}>
                        {log}
                      </motion.div>
                    ))}
                  </div>

                  {bootSequence.length === fakeBootLogs.length && (
                    <motion.form 
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      onSubmit={handleAdminSubmit} 
                      className="relative border-t border-white/5 pt-5"
                    >
                      <div className="flex items-center gap-4 bg-black/40 p-4 rounded-xl border border-white/[0.05]">
                        <span className="text-purple-500 font-bold text-sm">~ $</span>
                        <input
                          ref={adminInputRef}
                          type="password"
                          value={adminKey}
                          onChange={(e) => setAdminKey(e.target.value)}
                          className="flex-1 bg-transparent border-none outline-none text-slate-200 font-mono tracking-[0.3em] text-lg focus:ring-0 placeholder:text-slate-700"
                          placeholder="KEY_REQUIRED"
                          spellCheck={false}
                          autoComplete="off"
                        />
                        <button 
                          type="submit"
                          disabled={!adminKey}
                          className="px-5 py-2.5 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 rounded-lg border border-purple-500/30 transition-all disabled:opacity-0 text-xs tracking-widest uppercase font-bold flex items-center gap-2"
                        >
                          Execute <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    </motion.form>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes shake {
          10%, 90% { transform: translate3d(-1px, 0, 0); }
          20%, 80% { transform: translate3d(2px, 0, 0); }
          30%, 50%, 70% { transform: translate3d(-4px, 0, 0); }
          40%, 60% { transform: translate3d(4px, 0, 0); }
        }
      `}} />
    </div>
  );
}

// 🚨 SUSPENSE WRAPPER FIX FOR NEXT.JS BUILD ERROR
export default function Page() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen bg-[#050208] items-center justify-center">
        <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
      </div>
    }>
      <RootGateway />
    </Suspense>
  );
}