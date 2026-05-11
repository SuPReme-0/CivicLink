'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Activity, Database, Users, Terminal, Settings, 
  LogOut, Menu, X, ShieldAlert, ChevronRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'react-hot-toast';

const NAV_LINKS = [
  { name: 'Command Node', href: '/admin', icon: Activity },
  { name: 'Full Ledger', href: '/admin/grievances', icon: Database },
  { name: 'Personnel', href: '/admin/users', icon: Users },
  { name: 'Telemetry', href: '/admin/audit', icon: Terminal },
  { name: 'Settings', href: '/admin/settings', icon: Settings },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  // Close mobile sidebar on route change
  useEffect(() => {
    setIsMobileOpen(false);
  }, [pathname]);

  const handleLogout = () => {
    localStorage.removeItem('civiclink_admin_token');
    toast.success("Admin Session Terminated.", { 
      style: { background: '#0a040d', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' } 
    });
    router.replace('/');
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-[#050208]/95 backdrop-blur-2xl border-r border-white/[0.05] shadow-[20px_0_40px_rgba(0,0,0,0.5)]">
      
      {/* Brand Header */}
      <div className="h-20 flex items-center px-6 border-b border-white/[0.05]">
        <Link href="/admin" className="flex items-center gap-3 group">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500/20 to-indigo-500/20 border border-purple-500/30 flex items-center justify-center shadow-[0_0_15px_rgba(147,51,234,0.2)] group-hover:shadow-[0_0_20px_rgba(147,51,234,0.4)] transition-all">
            <ShieldAlert className="w-4 h-4 text-purple-400" />
          </div>
          <div>
            <h2 className="font-black text-sm tracking-[0.2em] text-white uppercase">CivicLink</h2>
            <p className="text-[8px] font-mono tracking-widest text-purple-400 uppercase">SYS.ROOT.1</p>
          </div>
        </Link>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto thin-scrollbar">
        <p className="px-2 text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-4">Directories</p>
        
        {NAV_LINKS.map((link) => {
          const isActive = pathname === link.href;
          const Icon = link.icon;
          
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex items-center justify-between px-3 py-3 rounded-xl transition-all duration-300 group",
                isActive 
                  ? "bg-purple-500/10 border border-purple-500/20 shadow-[0_0_15px_rgba(147,51,234,0.1)]" 
                  : "border border-transparent hover:bg-white/[0.03] hover:border-white/5"
              )}
            >
              <div className="flex items-center gap-3">
                <Icon className={cn("w-4 h-4 transition-colors", isActive ? "text-purple-400" : "text-slate-500 group-hover:text-slate-300")} />
                <span className={cn("text-[11px] font-bold tracking-widest uppercase transition-colors", isActive ? "text-purple-300" : "text-slate-400 group-hover:text-slate-200")}>
                  {link.name}
                </span>
              </div>
              {isActive && <ChevronRight className="w-3.5 h-3.5 text-purple-500/50" />}
            </Link>
          );
        })}
      </nav>

      {/* Footer / Logout */}
      <div className="p-4 border-t border-white/[0.05]">
        <button 
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 transition-all text-rose-400 hover:text-rose-300 group"
        >
          <LogOut className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          <span className="text-[10px] font-bold tracking-widest uppercase">Terminate</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile Hamburger Menu (Visible only on small screens) */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-[#050208]/90 backdrop-blur-md border-b border-white/[0.05] z-40 flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-purple-500" />
          <span className="font-black text-xs tracking-widest text-white uppercase">CivicLink Admin</span>
        </div>
        <button onClick={() => setIsMobileOpen(!isMobileOpen)} className="p-2 text-slate-400 hover:text-white rounded-lg bg-white/5">
          {isMobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isMobileOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsMobileOpen(false)}
              className="lg:hidden fixed inset-0 bg-black/80 z-40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 250 }}
              className="lg:hidden fixed inset-y-0 left-0 w-72 z-50"
            >
              <SidebarContent />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Desktop Sidebar (Fixed on large screens) */}
      <aside className="hidden lg:block w-72 flex-shrink-0 z-30 h-screen sticky top-0">
        <SidebarContent />
      </aside>
    </>
  );
}