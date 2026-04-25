// app/page.tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal, ShieldAlert, Lock, ArrowRight, Activity, Cpu, Network } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { cn } from '@/lib/utils';

// =============================================================================
// BACKGROUND DATA STREAM COMPONENT
// =============================================================================
function HexGrid() {
  return (
    <div className="absolute inset-0 z-0 overflow-hidden opacity-[0.03] pointer-events-none">
      <div className="absolute inset-0" style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%236366f1' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        backgroundSize: '30px 30px',
      }} />
      <div className="absolute inset-0 bg-gradient-to-b from-[#050505] via-transparent to-[#050505]" />
    </div>
  );
}

// =============================================================================
// MAIN GATEWAY PAGE
// =============================================================================
export default function RootGateway() {
  const router = useRouter();
  const [showOverride, setShowOverride] = useState(false);
  const [adminKey, setAdminKey] = useState('');
  const [hasError, setHasError] = useState(false);
  const [bootSequence, setBootSequence] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

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
    const handleInteraction = (e: KeyboardEvent | MouseEvent) => {
      // 1. Detect the Hidden Override: Ctrl + Alt + P
      if (e instanceof KeyboardEvent && e.ctrlKey && e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        e.stopPropagation();
        setShowOverride(true);
        return;
      }

      // 2. Escape key closes the override
      if (e instanceof KeyboardEvent && e.key === 'Escape' && showOverride) {
        setShowOverride(false);
        setAdminKey('');
        setBootSequence([]);
        return;
      }

      // 3. Normal User Interaction: Redirect to Citizen Dashboard
      if (!showOverride) {
        if (e instanceof KeyboardEvent && ['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
        router.push('/dashboard');
      }
    };

    window.addEventListener('keydown', handleInteraction);
    window.addEventListener('mousedown', handleInteraction);

    return () => {
      window.removeEventListener('keydown', handleInteraction);
      window.removeEventListener('mousedown', handleInteraction);
    };
  }, [showOverride, router]);

  // Handle Override Mount & Boot Sequence Animation
  useEffect(() => {
    if (showOverride) {
      let delay = 0;
      fakeBootLogs.forEach((log, index) => {
        setTimeout(() => {
          setBootSequence(prev => [...prev, log]);
          if (index === fakeBootLogs.length - 1) {
            setTimeout(() => inputRef.current?.focus(), 100);
          }
        }, delay);
        delay += Math.random() * 150 + 50; // Random delay for realistic terminal feel
      });
    }
  }, [showOverride]);

  const handleOverrideSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (adminKey.toUpperCase() === 'PRIYANSHU') {
      toast.success('Decryption successful. Welcome, Architect.', {
        icon: '🔐',
        style: { background: '#0a0e17', color: '#4ade80', border: '1px solid rgba(74, 222, 128, 0.3)' }
      });
      router.push('/admin');
    } else {
      setHasError(true);
      setAdminKey('');
      toast.error('FATAL: SIGNATURE REJECTED', {
        icon: '🛑',
        style: { background: '#1a0505', color: '#f87171', border: '1px solid rgba(248, 113, 113, 0.3)' }
      });
      setTimeout(() => setHasError(false), 500);
    }
  };

  return (
    <div className="relative min-h-screen bg-[#030305] text-slate-200 overflow-hidden font-mono select-none flex flex-col items-center justify-center">
      
      {/* BACKGROUND ELEMENTS */}
      <HexGrid />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60vw] h-[60vh] bg-indigo-500/5 blur-[120px] rounded-full pointer-events-none" />

      {/* MAIN SCREEN (Citizen Facing) */}
      <div className="z-10 flex flex-col items-center justify-center text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.8, rotate: -10 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ duration: 1.2, type: "spring", bounce: 0.4 }}
          className="relative flex items-center justify-center w-28 h-28 mb-8 rounded-2xl bg-black/40 border border-indigo-500/30 shadow-[0_0_60px_rgba(99,102,241,0.2)] backdrop-blur-md"
        >
          <div className="absolute inset-0 rounded-2xl border border-indigo-400/20 animate-pulse" />
          <Network className="w-12 h-12 text-indigo-400 drop-shadow-[0_0_15px_rgba(99,102,241,0.8)]" />
        </motion.div>
        
        <motion.h1 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="text-5xl md:text-7xl font-black tracking-[0.15em] uppercase mb-4 text-transparent bg-clip-text bg-gradient-to-br from-white via-indigo-200 to-slate-500 drop-shadow-xl"
        >
          CIVICLINK
        </motion.h1>
        
        <motion.p 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.4 }}
          className="text-xs md:text-sm text-indigo-300/50 tracking-[0.3em] uppercase mb-16 flex items-center gap-3"
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
          <div className="flex items-center gap-3 px-6 py-2 rounded-full border border-white/5 bg-white/[0.02] backdrop-blur-sm">
            <span className="w-2 h-2 bg-indigo-400 rounded-full shadow-[0_0_10px_rgba(99,102,241,0.8)] animate-pulse" />
            <span className="uppercase tracking-[0.2em] text-xs font-medium text-slate-300">Press any key to establish connection</span>
          </div>
        </motion.div>
      </div>

      {/* NODE STATUS INDICATORS */}
      <div className="absolute bottom-8 flex gap-8 text-[10px] uppercase tracking-widest text-white/30 font-semibold">
        <div className="flex items-center gap-2"><Activity className="w-3 h-3 text-green-500" /> Gateway: Online</div>
        <div className="flex items-center gap-2"><Cpu className="w-3 h-3 text-blue-500" /> Core Engine: Active</div>
      </div>

      {/* HIDDEN ADMIN OVERLAY (Triggered by Ctrl+Alt+P) */}
      <AnimatePresence>
        {showOverride && (
          <motion.div
            initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
            animate={{ opacity: 1, backdropFilter: "blur(12px)" }}
            exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-[#050505]/90"
            onMouseDown={(e) => e.stopPropagation()} 
          >
            {/* Scanline Effect Overlay */}
            <div className="absolute inset-0 pointer-events-none bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSJ0cmFuc3BhcmVudCIvPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSIxIiBmaWxsPSJyZ2JhKDI1NSwgMjU1LCAyNTUsIDAuMDUpIi8+Cjwvc3ZnPg==')] opacity-50 z-0" />

            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className={cn(
                "relative z-10 w-full max-w-2xl p-[1px] rounded-xl overflow-hidden bg-gradient-to-b",
                hasError ? "from-red-500/50 to-red-900/10 shadow-[0_0_50px_rgba(239,68,68,0.15)]" : "from-indigo-500/40 to-slate-900/40 shadow-[0_0_60px_rgba(99,102,241,0.1)]",
                hasError && "animate-shake" 
              )}
              style={hasError ? { animation: 'shake 0.4s cubic-bezier(.36,.07,.19,.97) both' } : {}}
            >
              <div className="bg-[#0a0a0c] rounded-xl h-full w-full flex flex-col">
                {/* Terminal Header */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-white/[0.02]">
                  <div className="flex items-center gap-2 text-xs text-white/40">
                    <Terminal className="w-4 h-4" />
                    <span>root@civiclink-core:~#</span>
                  </div>
                  <button 
                    onClick={() => { setShowOverride(false); setAdminKey(''); setBootSequence([]); }}
                    className="text-white/30 hover:text-white/80 transition-colors text-[10px] tracking-widest uppercase"
                  >
                    [ESC] ABORT
                  </button>
                </div>

                {/* Terminal Body */}
                <div className="p-6">
                  <div className="flex items-start gap-4 mb-6">
                    <div className={cn("p-3 rounded-lg border", hasError ? "bg-red-500/10 border-red-500/20" : "bg-yellow-500/10 border-yellow-500/20")}>
                      <ShieldAlert className={cn("w-6 h-6", hasError ? "text-red-500" : "text-yellow-500")} />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-white mb-1 uppercase tracking-widest">Protocol 7 Restricted Access</h2>
                      <p className="text-xs text-white/50 leading-relaxed max-w-md">
                        All unauthorized connection attempts are logged. Provide the architect key sequence to mount the Mission Control volume.
                      </p>
                    </div>
                  </div>

                  {/* Boot Sequence Output */}
                  <div className="mb-4 space-y-1 min-h-[120px] font-mono text-xs text-green-400/80">
                    {bootSequence.map((log, i) => (
                      <motion.div key={i} initial={{ opacity: 0, x: -5 }} animate={{ opacity: 1, x: 0 }}>
                        {log}
                      </motion.div>
                    ))}
                  </div>

                  {/* Input Form */}
                  {bootSequence.length === fakeBootLogs.length && (
                    <motion.form 
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      onSubmit={handleOverrideSubmit} 
                      className="relative border-t border-white/5 pt-4"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-indigo-400 font-bold text-sm">~ $</span>
                        <input
                          ref={inputRef}
                          type="password"
                          value={adminKey}
                          onChange={(e) => setAdminKey(e.target.value)}
                          className="flex-1 bg-transparent border-none outline-none text-white font-mono tracking-[0.3em] text-lg focus:ring-0"
                          placeholder="KEY_REQUIRED"
                          spellCheck={false}
                          autoComplete="off"
                        />
                        <button 
                          type="submit"
                          disabled={!adminKey}
                          className="px-4 py-2 bg-indigo-500/20 hover:bg-indigo-500/40 text-indigo-300 rounded border border-indigo-500/30 transition-all disabled:opacity-0 text-xs tracking-widest uppercase"
                        >
                          Execute <ArrowRight className="w-3 h-3 inline ml-1" />
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

      {/* 🚨 FIX: Corrected React syntax for inline CSS injection */}
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