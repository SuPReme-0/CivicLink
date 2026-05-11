// types/index.ts

// =============================================================================
// ENUMS & LITERALS
// =============================================================================
export type SeverityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'REVIEWER' | 'AUDITOR' | 'SUPPORT';

export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

export type AuditSeverity = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR' | 'CRITICAL';

export type AuditAction = 'LOGIN' | 'APPROVE' | 'REJECT' | 'ESCALATE' | 'SYSTEM_ERROR' | 'DATA_EXPORT' | 'ROLE_CHANGE';

// Sync with Prisma GrievanceStatus enum + LangGraph states
export type GrievanceStatus = 
  | 'RECEIVED' 
  | 'VERIFYING_IMAGE' 
  | 'ROUTING_JURISDICTION' 
  | 'DISCOVERING_CONTACT' 
  | 'DRAFTING_LETTER' 
  | 'AWAITING_REVIEW' 
  | 'DISPATCHING' 
  | 'DISPATCHED' 
  | 'FAILED'
  | 'RESOLVED'           // Added: citizen confirmed resolution
  | 'REJECTED_FRAUD'     // Added: flagged as fake/spam
  | 'ESCALATED';         // Added: forwarded to higher authority

// =============================================================================
// CITIZEN INGESTION & TRACKING
// =============================================================================

export interface LocationData {
  lat: number;
  lon: number; // Backend schema uses `lon`
  lng?: number; // Frontend Leaflet uses `lng` (allow both for safe bridging)
  type: 'gps' | 'text';
  address_text?: string;
}

export interface IngestPayload {
  phone_number: string;
  thread_id: string;
  text_message: string;
  image_url?: string;      
  location?: LocationData; 
}

export interface IngestResponse {
  status: 'success' | 'error';
  message: string;
  thread_id?: string;
  error_code?: string;
}

export interface DispatchRecord {
  email: string;
  status: string;
  official_name?: string;
}

export interface StatusResponse {
  status: 'chatting' | 'found' | 'processing';
  current_state: GrievanceStatus | 'PENDING_DETAILS';
  reply_message?: string;      
  issue_category?: string;
  description_text?: string;
  system_metadata?: any;
  dispatch_records?: DispatchRecord[];
}

// =============================================================================
// ADMIN & CORE DATA MODELS
// =============================================================================

export interface GrievanceCase {
  id: string;
  trackingId: string;
  citizenId: string;
  threadId: string;
  issueCategory: string;
  descriptionText: string;
  severity: SeverityLevel;
  status: GrievanceStatus;
  createdAt: string | Date; // Allow Date object parsing from API
  updatedAt?: string | Date;
  systemMetadata?: {
    confidence_metrics?: Record<string, number>;
    auth_score?: number;
    image_hash?: string;
    has_voice?: boolean;
    drafted_letter?: {
      subject: string;
      body: string;
      language?: string;
      legal_citations?: string[];
    };
    jurisdiction?: {
      district: string;
      state: string;
      ward?: string;
    };
    primary_contact?: {
      officialDesignation: string;
      officialEmail: string;
    };
  };
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  lastLogin: string | Date;
  createdAt: string | Date;
  actionsCount: number;
}

export interface AuditLog {
  id: string;
  timestamp: string | Date;
  actor: string;
  actorRole: string;
  action: AuditAction;
  severity: AuditSeverity;
  target: string;
  details: string;
  ip: string;
  userAgent: string;
  immutableHash: string;
}

// Add this to the bottom of types/index.ts

export type VLMProvider = 'groq' | 'gemini' | 'vllm';

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