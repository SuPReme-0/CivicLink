'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  Settings, Save, RotateCcw, Shield, Zap, Database, 
  Globe, CheckCircle, AlertTriangle, Loader2, Info, ChevronDown
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { cn } from '@/lib/utils';

// =============================================================================
// 🚨 SECURE ADMIN API WRAPPERS (Vercel Ready)
// =============================================================================
const secureAdminFetch = async (endpoint: string) => {
  const res = await fetch(`/api/v1/admin/${endpoint}`, {
    headers: { 'Authorization': `Bearer ${process.env.NEXT_PUBLIC_FRONTEND_API_KEY || 'civiclink_dev_super_secret_998877'}` },
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.statusText}`);
  return res.json();
};

const secureAdminMutation = async (endpoint: string, data: any) => {
  const res = await fetch(`/api/v1/admin/${endpoint}`, {
    method: 'PUT', // Backend expects a PUT for settings updates
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.NEXT_PUBLIC_FRONTEND_API_KEY || 'civiclink_dev_super_secret_998877'}` 
    },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(`Update failed: ${res.statusText}`);
  return res.json();
};

// =============================================================================
// TYPES
// =============================================================================

type VLMProvider = 'groq' | 'gemini' | 'vllm';

export interface SystemSettings {
  system: {
    apiBaseUrl: string;
    requestTimeout: number;
    maxRetries: number;
    dataRetentionDays: number;
  };
  ai: {
    vlmPriority: VLMProvider[];
    authScoreThreshold: number;
    autoEscalationSeverity: 'HIGH' | 'CRITICAL' | 'NEVER';
    fallbackToMock: boolean;
  };
  features: {
    mockMode: boolean;
    hitlBypassLowSeverity: boolean;
    autoRetryScrapeFailures: boolean;
    realtimePollIntervalMs: number;
  };
  security: {
    sessionTimeoutMin: number;
    enforce2FA: boolean;
    ipWhitelist: string;
    auditLogRetentionDays: number;
  };
}

const DEFAULT_SETTINGS: SystemSettings = {
  system: { apiBaseUrl: 'http://localhost:8000', requestTimeout: 15, maxRetries: 3, dataRetentionDays: 90 },
  ai: { vlmPriority: ['groq', 'gemini', 'vllm'], authScoreThreshold: 0.75, autoEscalationSeverity: 'CRITICAL', fallbackToMock: true },
  features: { mockMode: false, hitlBypassLowSeverity: false, autoRetryScrapeFailures: true, realtimePollIntervalMs: 5000 },
  security: { sessionTimeoutMin: 120, enforce2FA: true, ipWhitelist: '192.168.1.0/24, 10.0.0.0/8', auditLogRetentionDays: 365 },
};

// =============================================================================
// OPTICAL UI COMPONENTS
// =============================================================================

function SectionHeader({ icon: Icon, title, description }: { icon: React.ElementType, title: string, description: string }) {
  return (
    <div className="flex items-start gap-4 mb-8 border-b border-white/[0.05] pb-5">
      <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 shadow-[0_0_15px_rgba(147,51,234,0.15)] flex-shrink-0">
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <h3 className="text-sm font-bold tracking-widest uppercase text-slate-100">{title}</h3>
        <p className="text-xs text-slate-500 font-mono mt-1 leading-relaxed max-w-2xl">{description}</p>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, label, description, disabled = false }: { checked: boolean; onChange: () => void; label: string; description?: string; disabled?: boolean; }) {
  return (
    <div className={cn('flex items-center justify-between py-4 border-b border-white/[0.02] last:border-0', disabled && 'opacity-50 pointer-events-none')}>
      <div className="pr-6">
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-200">{label}</p>
        {description && <p className="text-[10px] font-mono text-slate-500 mt-1.5">{description}</p>}
      </div>
      <button
        onClick={onChange}
        disabled={disabled}
        className={cn(
          'relative w-12 h-6 rounded-full transition-all duration-300 focus:outline-none flex-shrink-0 border',
          checked ? 'bg-emerald-500/20 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.3)]' : 'bg-black/60 border-white/10'
        )}
      >
        <span className={cn('absolute top-0.5 w-4 h-4 rounded-full shadow-md transition-all duration-300', checked ? 'left-[calc(100%-1.125rem)] bg-emerald-400' : 'left-1 bg-slate-500')} />
      </button>
    </div>
  );
}

function InputField({ label, value, onChange, type = 'text', suffix, description, disabled = false }: { label: string; value: string | number; onChange: (val: string) => void; type?: string; suffix?: string; description?: string; disabled?: boolean; }) {
  return (
    <div className="py-4 border-b border-white/[0.02] last:border-0">
      <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">{label}</label>
      <div className="relative max-w-md">
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={cn('precision-input font-mono text-sm w-full', suffix && 'pr-14', disabled && 'opacity-50 cursor-not-allowed')} />
        {suffix && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-widest text-slate-500 pointer-events-none">{suffix}</span>}
      </div>
      {description && <p className="text-[10px] font-mono text-slate-500 mt-2">{description}</p>}
    </div>
  );
}

function SelectField({ label, value, onChange, options, description, disabled = false }: { label: string; value: string; onChange: (val: string) => void; options: { value: string; label: string }[]; description?: string; disabled?: boolean; }) {
  return (
    <div className="py-4 border-b border-white/[0.02] last:border-0">
      <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">{label}</label>
      <div className="relative max-w-md">
        <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={cn('precision-input w-full appearance-none pr-10 text-sm cursor-pointer', disabled && 'opacity-50 cursor-not-allowed')}>
          {options.map(opt => <option key={opt.value} value={opt.value} className="bg-[#050208] text-slate-200">{opt.label}</option>)}
        </select>
        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
      </div>
      {description && <p className="text-[10px] font-mono text-slate-500 mt-2">{description}</p>}
    </div>
  );
}

// =============================================================================
// MAIN SETTINGS PAGE
// =============================================================================

export default function SettingsPage() {
  const [settings, setSettings] = useState<SystemSettings>(DEFAULT_SETTINGS);
  const [isDirty, setIsDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<'system' | 'ai' | 'features' | 'security'>('system');
  
  const queryClient = useQueryClient();

  // 🚨 FIXED: Now queries the real database!
  const { data: savedSettings, isLoading } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => secureAdminFetch('settings'),
  });

  useEffect(() => {
    if (savedSettings) {
      setSettings({ ...DEFAULT_SETTINGS, ...savedSettings });
      setIsDirty(false);
    }
  }, [savedSettings]);

  // 🚨 FIXED: Now explicitly mutates the DB via PUT request
  const saveMutation = useMutation({
    mutationFn: (data: SystemSettings) => secureAdminMutation('settings', data),
    onSuccess: () => {
      toast.success('Configuration Synchronized', { style: { background: '#0a040d', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' } });
      setIsDirty(false);
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
    },
    onError: (error: Error) => {
      toast.error(`Sync Failed: ${error.message}`, { style: { background: '#0a040d', color: '#e11d48', border: '1px solid rgba(225,29,72,0.3)' } });
    }
  });

  const handleReset = () => {
    setSettings(savedSettings || DEFAULT_SETTINGS);
    setIsDirty(false);
    toast('Reverted to last known state', { icon: '⏪' });
  };

  const handleSave = () => {
    saveMutation.mutate(settings);
  };

  const updateSetting = useCallback((section: keyof SystemSettings, key: string, value: any) => {
    setSettings(prev => ({ ...prev, [section]: { ...prev[section], [key]: value } }));
    setIsDirty(true);
  }, []);

  const tabs = [
    { id: 'system', label: 'Core Variables', icon: Database },
    { id: 'ai', label: 'VLM & Intelligence', icon: Zap },
    { id: 'features', label: 'Execution Flags', icon: Globe },
    { id: 'security', label: 'Network Security', icon: Shield },
  ] as const;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Mounting Config Data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24 animate-slide-up px-4 md:px-8 max-w-5xl mx-auto pt-6">
      {/* --- HEADER --- */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white mb-1 flex items-center gap-3">
            <Settings className="w-8 h-8 text-purple-500" />
            System Configurations
          </h1>
          <p className="text-[11px] font-mono text-slate-400 uppercase tracking-widest mt-1">
            Global environmental parameters & AI routing directives
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleReset}
            className="btn-action bg-white/[0.02] border-white/10 text-slate-400 hover:text-slate-200 py-2.5 px-4 text-xs tracking-widest uppercase font-bold disabled:opacity-50"
            disabled={saveMutation.isPending || !isDirty}
          >
            <RotateCcw className="w-4 h-4 mr-2" /> Revert
          </button>
          <button 
            onClick={handleSave}
            disabled={!isDirty || saveMutation.isPending}
            className={cn(
              'btn-action py-2.5 px-6 text-xs tracking-widest uppercase font-bold shadow-lg',
              isDirty ? 'bg-purple-500/20 text-purple-300 border-purple-500/40 hover:bg-purple-500/30' : 'bg-white/[0.02] text-slate-500 border-white/5',
              saveMutation.isPending && 'opacity-50 cursor-not-allowed'
            )}
          >
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            {saveMutation.isPending ? 'Syncing...' : 'Commit Changes'}
          </button>
        </div>
      </div>

      {/* --- TABS --- */}
      <div className="bg-[#050208] border border-white/[0.05] rounded-2xl p-1.5 flex gap-1 overflow-x-auto thin-scrollbar">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={cn(
                'flex items-center gap-2 px-5 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all whitespace-nowrap',
                isActive 
                  ? 'bg-purple-500/10 border border-purple-500/20 text-purple-400 shadow-[0_0_15px_rgba(147,51,234,0.1)]' 
                  : 'border border-transparent hover:bg-white/[0.02] text-slate-500 hover:text-slate-300'
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* --- CONFIGURATION PANELS --- */}
      <div className="glass-card p-8 border-purple-500/10 min-h-[500px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}
          >
            {activeTab === 'system' && (
              <>
                <SectionHeader icon={Database} title="Core System Topography" description="Define upstream API endpoints, rigid timeout thresholds, and data lifecycle management policies." />
                <div className="max-w-3xl">
                  <InputField label="Master API Endpoint" value={settings.system.apiBaseUrl} onChange={(v) => updateSetting('system', 'apiBaseUrl', v)} />
                  <InputField label="Global Request Timeout" value={settings.system.requestTimeout} suffix="Seconds" onChange={(v) => updateSetting('system', 'requestTimeout', Number(v))} />
                  <InputField label="Max Fallback Retries" value={settings.system.maxRetries} suffix="Attempts" onChange={(v) => updateSetting('system', 'maxRetries', Number(v))} />
                  <InputField label="Data Retention Protocol" value={settings.system.dataRetentionDays} suffix="Days" description="Grievance artifacts and attachments will be purged after this horizon." onChange={(v) => updateSetting('system', 'dataRetentionDays', Number(v))} />
                </div>
              </>
            )}

            {activeTab === 'ai' && (
              <>
                <SectionHeader icon={Zap} title="Intelligence Routing" description="Configure Vision Language Model cascading, forensic confidence thresholds, and execution fallbacks." />
                <div className="max-w-3xl">
                  <div className="py-4 border-b border-white/[0.02]">
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Model Cascade Priority</label>
                    <div className="flex flex-wrap gap-2 bg-black/40 p-3 rounded-xl border border-white/5 inline-flex">
                      {(settings.ai.vlmPriority || ['groq', 'gemini', 'vllm']).map((p, i) => (
                        <span key={p} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold bg-purple-500/10 text-purple-300 border border-purple-500/20 uppercase tracking-widest">
                          <span className="text-purple-500/50">#{i + 1}</span> {p}
                        </span>
                      ))}
                    </div>
                    <p className="text-[10px] font-mono text-slate-500 mt-2">Execution falls back across the chain if primary tensor rate-limits.</p>
                  </div>
                  <InputField label="Forensic Authorization Threshold" value={settings.ai.authScoreThreshold} suffix="Ratio (0.0-1.0)" description="Minimum VLM confidence score required to bypass immediate fraud rejection." onChange={(v) => updateSetting('ai', 'authScoreThreshold', Number(v))} />
                  <SelectField label="Auto-Escalation Trigger" value={settings.ai.autoEscalationSeverity} options={[{value:'CRITICAL',label:'Tier 1 (Critical Only)'},{value:'HIGH',label:'Tier 2 (High & Critical)'},{value:'NEVER',label:'Halt Auto-Escalation'}]} description="Grievances meeting this severity bypass standard queue routing." onChange={(v) => updateSetting('ai', 'autoEscalationSeverity', v)} />
                  <Toggle label="Simulated Fallback Mode" description="Route to internal mock engine if all external AI providers suffer cascading failure." checked={settings.ai.fallbackToMock} onChange={() => updateSetting('ai', 'fallbackToMock', !settings.ai.fallbackToMock)} />
                </div>
              </>
            )}

            {activeTab === 'features' && (
              <>
                <SectionHeader icon={Globe} title="Execution Feature Flags" description="Toggle experimental nodes, OSINT behaviors, and operational bypasses." />
                <div className="max-w-3xl">
                  <Toggle label="Dry-Run Mock Engine" description="Simulate LangGraph pipeline without consuming external API credits. Recommended for staging." checked={settings.features.mockMode} onChange={() => updateSetting('features', 'mockMode', !settings.features.mockMode)} />
                  <Toggle label="Low-Severity HITL Bypass" description="Automatically authorize and dispatch grievances flagged as LOW/MEDIUM severity without human intervention." checked={settings.features.hitlBypassLowSeverity} onChange={() => updateSetting('features', 'hitlBypassLowSeverity', !settings.features.hitlBypassLowSeverity)} />
                  <Toggle label="Autonomous Spider Retries" description="Instruct OSINT spider to actively expand search radius upon hitting 404/Contact-Not-Found states." checked={settings.features.autoRetryScrapeFailures} onChange={() => updateSetting('features', 'autoRetryScrapeFailures', !settings.features.autoRetryScrapeFailures)} />
                  <InputField label="Telemetry Polling Rate" value={settings.features.realtimePollIntervalMs} suffix="Milliseconds" description="Frequency of fallback status requests if SSE tunnel collapses." onChange={(v) => updateSetting('features', 'realtimePollIntervalMs', Number(v))} />
                </div>
              </>
            )}

            {activeTab === 'security' && (
              <>
                <SectionHeader icon={Shield} title="Network Security Policies" description="Administer JWT lifetimes, cryptographic constraints, and access control lists (ACL)." />
                <div className="max-w-3xl">
                  <InputField label="Token Lifetime Limit" value={settings.security.sessionTimeoutMin} suffix="Minutes" onChange={(v) => updateSetting('security', 'sessionTimeoutMin', Number(v))} />
                  <Toggle label="Strict 2FA Verification" description="Force cryptographic hardware key or OTP verification for Mission Control access." checked={settings.security.enforce2FA} onChange={() => updateSetting('security', 'enforce2FA', !settings.security.enforce2FA)} />
                  <InputField label="IPv4 / IPv6 ACL Whitelist" value={settings.security.ipWhitelist} description="Comma-separated CIDR notation blocks. Leave blank to disable geofencing." onChange={(v) => updateSetting('security', 'ipWhitelist', v)} />
                  <InputField label="Immutable Ledger Retention" value={settings.security.auditLogRetentionDays} suffix="Days" description="Duration cryptographic audit entries are maintained before deep archiving." onChange={(v) => updateSetting('security', 'auditLogRetentionDays', Number(v))} />
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* --- BOTTOM SYNC BAR --- */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-4 border-t border-white/[0.05] px-2">
        <div className="flex items-center gap-3 text-[10px] font-mono text-slate-500 uppercase tracking-widest">
          <Info className="w-4 h-4 text-purple-500" />
          <span>Modifications apply synchronously across all active edge workers.</span>
        </div>
        <div className="flex items-center gap-2">
          {isDirty ? (
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <AlertTriangle className="w-3 h-3 animate-pulse" /> Unsaved Drifts Detected
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <CheckCircle className="w-3 h-3" /> State Synchronized
            </div>
          )}
        </div>
      </div>
    </div>
  );
}