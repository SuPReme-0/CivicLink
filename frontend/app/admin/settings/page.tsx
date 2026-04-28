// app/(admin)/settings/page.tsx
'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  Settings, Save, RotateCcw, Shield, Zap, Bell, Database, 
  Globe, CheckCircle, AlertTriangle, Loader2, Info
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/api-client'; // 🚨 IMPORTED API CLIENT

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
  system: {
    apiBaseUrl: 'http://localhost:8000',
    requestTimeout: 15,
    maxRetries: 3,
    dataRetentionDays: 90,
  },
  ai: {
    vlmPriority: ['groq', 'gemini', 'vllm'],
    authScoreThreshold: 0.75,
    autoEscalationSeverity: 'CRITICAL',
    fallbackToMock: true,
  },
  features: {
    mockMode: false,
    hitlBypassLowSeverity: false,
    autoRetryScrapeFailures: true,
    realtimePollIntervalMs: 5000,
  },
  security: {
    sessionTimeoutMin: 120,
    enforce2FA: true,
    ipWhitelist: '192.168.1.0/24, 10.0.0.0/8',
    auditLogRetentionDays: 365,
  },
};

// =============================================================================
// UI COMPONENTS
// =============================================================================

function SectionHeader({ icon: Icon, title, description }: { icon: React.ElementType, title: string, description: string }) {
  return (
    <div className="flex items-start gap-3 mb-6">
      <div className="p-2 rounded-lg bg-[var(--admin-accent)]/10 text-[var(--admin-accent)]">
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-sm text-white/60 mt-0.5">{description}</p>
      </div>
    </div>
  );
}

function Toggle({ 
  checked, 
  onChange, 
  label, 
  description,
  disabled = false 
}: { 
  checked: boolean; 
  onChange: () => void; 
  label: string; 
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className={cn('flex items-center justify-between py-3 border-b border-white/5 last:border-0', disabled && 'opacity-50 pointer-events-none')}>
      <div>
        <p className="font-medium text-sm">{label}</p>
        {description && <p className="text-xs text-white/50 mt-0.5">{description}</p>}
      </div>
      <button
        onClick={onChange}
        disabled={disabled}
        className={cn(
          'relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[var(--admin-accent)] focus:ring-offset-2 focus:ring-offset-[var(--background)]',
          checked ? 'bg-[var(--admin-accent)]' : 'bg-white/20'
        )}
        aria-pressed={checked}
      >
        <span
          className={cn(
            'absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200',
            checked ? 'translate-x-5' : 'translate-x-0'
          )}
        />
      </button>
    </div>
  );
}

function InputField({ 
  label, 
  value, 
  onChange, 
  type = 'text', 
  suffix, 
  description,
  disabled = false 
}: { 
  label: string; 
  value: string | number; 
  onChange: (val: string) => void; 
  type?: string;
  suffix?: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className="py-3 border-b border-white/5 last:border-0">
      <label className="block text-sm font-medium mb-1">{label}</label>
      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={cn(
            'glass-input w-full pr-12',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
        />
        {suffix && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-white/50">
            {suffix}
          </span>
        )}
      </div>
      {description && <p className="text-xs text-white/50 mt-1">{description}</p>}
    </div>
  );
}

function SelectField({ 
  label, 
  value, 
  onChange, 
  options, 
  description,
  disabled = false 
}: { 
  label: string; 
  value: string; 
  onChange: (val: string) => void; 
  options: { value: string; label: string }[];
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className="py-3 border-b border-white/5 last:border-0">
      <label className="block text-sm font-medium mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn('glass-input w-full', disabled && 'opacity-50 cursor-not-allowed')}
      >
        {options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
      {description && <p className="text-xs text-white/50 mt-1">{description}</p>}
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

  // 🚨 NEW: Fetch real settings from the backend on load
  const { data: savedSettings, isLoading } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => apiClient.fetchSystemSettings(),
  });

  // Sync local state when remote data arrives
  useEffect(() => {
    if (savedSettings) {
      setSettings({ ...DEFAULT_SETTINGS, ...savedSettings });
      setIsDirty(false);
    }
  }, [savedSettings]);

  // 🚨 UPGRADED: Real API mutation
  const saveMutation = useMutation({
    mutationFn: (data: SystemSettings) => apiClient.updateSystemSettings(data),
    onSuccess: () => {
      toast.success('System configuration synchronized');
      setIsDirty(false);
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to save settings: ${error.message}`);
    }
  });

  const handleReset = () => {
    setSettings(savedSettings || DEFAULT_SETTINGS);
    setIsDirty(false);
    toast('Settings reset to last saved state');
  };

  const handleSave = () => {
    saveMutation.mutate(settings);
  };

  const updateSetting = useCallback((section: keyof SystemSettings, key: string, value: any) => {
    setSettings(prev => ({
      ...prev,
      [section]: { ...prev[section], [key]: value }
    }));
    setIsDirty(true);
  }, []);

  const tabs = [
    { id: 'system', label: 'System', icon: Database },
    { id: 'ai', label: 'AI & Models', icon: Zap },
    { id: 'features', label: 'Features', icon: Globe },
    { id: 'security', label: 'Security', icon: Shield },
  ] as const;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--admin-accent)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Settings className="w-6 h-6 text-[var(--admin-accent)]" />
            System Configuration
          </h1>
          <p className="text-white/60 mt-1">Manage platform settings, AI routing, and security policies</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleReset}
            className="glass-btn glass-btn-outline px-4 py-2 text-sm"
            disabled={saveMutation.isPending || !isDirty}
          >
            <RotateCcw className="w-4 h-4 mr-2" /> Revert
          </button>
          <button 
            onClick={handleSave}
            disabled={!isDirty || saveMutation.isPending}
            className={cn(
              'glass-btn glass-btn-admin px-4 py-2 text-sm',
              (!isDirty || saveMutation.isPending) && 'opacity-50 cursor-not-allowed'
            )}
          >
            {saveMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            {saveMutation.isPending ? 'Syncing...' : 'Save & Sync'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="glass-panel rounded-2xl p-1.5 flex gap-1 overflow-x-auto custom-scrollbar">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap',
                isActive 
                  ? 'bg-[var(--admin-accent)]/20 text-[var(--admin-accent)] shadow-sm' 
                  : 'hover:bg-white/5 text-white/70'
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Settings Content */}
      <div className="glass-panel rounded-2xl p-6 shadow-lg">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'system' && (
              <>
                <SectionHeader icon={Database} title="Core System" description="API endpoints, timeouts, and data lifecycle management" />
                <InputField label="Backend API URL" value={settings.system.apiBaseUrl} onChange={(v) => updateSetting('system', 'apiBaseUrl', v)} />
                <InputField label="Request Timeout" value={settings.system.requestTimeout} suffix="sec" onChange={(v) => updateSetting('system', 'requestTimeout', Number(v))} />
                <InputField label="Max Retries" value={settings.system.maxRetries} onChange={(v) => updateSetting('system', 'maxRetries', Number(v))} />
                <InputField label="Data Retention" value={settings.system.dataRetentionDays} suffix="days" onChange={(v) => updateSetting('system', 'dataRetentionDays', Number(v))} />
              </>
            )}

            {activeTab === 'ai' && (
              <>
                <SectionHeader icon={Zap} title="AI & Model Routing" description="VLM provider priority, confidence thresholds, and fallback behavior" />
                <div className="py-3 border-b border-white/5">
                  <label className="block text-sm font-medium mb-1">VLM Provider Priority</label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {(settings.ai.vlmPriority || ['groq', 'gemini', 'vllm']).map((p) => (
                      <span key={p} className="px-3 py-1 rounded-full text-xs font-medium bg-[var(--admin-accent)]/20 text-[var(--admin-accent)] border border-[var(--admin-accent)]/30 uppercase tracking-wider">
                        {p}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-white/50 mt-2">Fixed priority chain: Execution falls back automatically if rate-limited.</p>
                </div>
                <InputField label="Auth Score Threshold" value={settings.ai.authScoreThreshold} suffix="0.0-1.0" onChange={(v) => updateSetting('ai', 'authScoreThreshold', Number(v))} />
                <SelectField 
                  label="Auto-Escalation Severity" 
                  value={settings.ai.autoEscalationSeverity} 
                  options={[{value:'CRITICAL',label:'Critical Only'},{value:'HIGH',label:'High & Critical'},{value:'NEVER',label:'Disabled'}]}
                  onChange={(v) => updateSetting('ai', 'autoEscalationSeverity', v)}
                />
                <Toggle 
                  label="Fallback to Mock Mode" 
                  description="Use simulated responses when all external AI providers are unavailable"
                  checked={settings.ai.fallbackToMock} 
                  onChange={() => updateSetting('ai', 'fallbackToMock', !settings.ai.fallbackToMock)} 
                />
              </>
            )}

            {activeTab === 'features' && (
              <>
                <SectionHeader icon={Globe} title="Feature Flags" description="Toggle experimental features and operational behaviors" />
                <Toggle label="Mock Mode" description="Simulate full pipeline without external API calls (Useful for demo environments)" checked={settings.features.mockMode} onChange={() => updateSetting('features', 'mockMode', !settings.features.mockMode)} />
                <Toggle label="HITL Bypass (Low Severity)" description="Auto-approve grievances marked as LOW/MEDIUM severity" checked={settings.features.hitlBypassLowSeverity} onChange={() => updateSetting('features', 'hitlBypassLowSeverity', !settings.features.hitlBypassLowSeverity)} />
                <Toggle label="Auto-Retry Scraping" description="Automatically retry failed contact discovery with broader URL patterns" checked={settings.features.autoRetryScrapeFailures} onChange={() => updateSetting('features', 'autoRetryScrapeFailures', !settings.features.autoRetryScrapeFailures)} />
                <InputField label="Real-time Poll Interval" value={settings.features.realtimePollIntervalMs} suffix="ms" onChange={(v) => updateSetting('features', 'realtimePollIntervalMs', Number(v))} />
              </>
            )}

            {activeTab === 'security' && (
              <>
                <SectionHeader icon={Shield} title="Security & Access" description="Session management, authentication, and compliance controls" />
                <InputField label="Session Timeout" value={settings.security.sessionTimeoutMin} suffix="min" onChange={(v) => updateSetting('security', 'sessionTimeoutMin', Number(v))} />
                <Toggle label="Enforce 2FA" description="Require two-factor authentication for all admin accounts" checked={settings.security.enforce2FA} onChange={() => updateSetting('security', 'enforce2FA', !settings.security.enforce2FA)} />
                <InputField label="IP Whitelist" value={settings.security.ipWhitelist} onChange={(v) => updateSetting('security', 'ipWhitelist', v)} description="Comma-separated CIDR ranges. Leave empty for open access." />
                <InputField label="Audit Log Retention" value={settings.security.auditLogRetentionDays} suffix="days" onChange={(v) => updateSetting('security', 'auditLogRetentionDays', Number(v))} />
              </>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Config Sync Status */}
        <div className="mt-8 pt-4 border-t border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-white/60">
            <Info className="w-3.5 h-3.5 flex-shrink-0" />
            <span>Changes apply globally across all workers after save. Requires 2-5s to propagate.</span>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium bg-black/20 px-3 py-1.5 rounded-full border border-white/5">
            {isDirty ? (
              <>
                <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />
                <span className="text-yellow-400">Unsaved changes</span>
              </>
            ) : (
              <>
                <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                <span className="text-green-400">Config synchronized</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}