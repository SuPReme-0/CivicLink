// types/index.ts
export type SeverityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

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

  export interface IngestPayload {
  phone_number: string;
  thread_id: string;
  text_message: string;
  image_url?: string;      // ✅ Now optional
  location?: LocationData; // ✅ Now optional (fixes the TS2322 error)
}

export interface LocationData {
  lat: number;
  lon: number;
  type: 'gps' | 'text';
  address_text?: string;
}

export interface IngestResponse {
  status: 'success' | 'error';
  message: string;
  thread_id?: string;
  error_code?: string;
}

export interface GrievanceCase {
  id: string;
  trackingId: string;
  citizenId: string;
  issueCategory: string;
  descriptionText: string;
  severity: SeverityLevel;
  status: GrievanceStatus;
  createdAt: string;
  updatedAt?: string;
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

export interface DispatchRecord {
  email: string;
  status: string;
  official_name?: string;
}

export interface StatusResponse {
  status: 'chatting' | 'found' | 'processing';
  current_state: GrievanceStatus | 'PENDING_DETAILS';
  reply_message?: string;      // ✅ Perfectly matches FastAPI's new gatekeeper output
  issue_category?: string;
  description_text?: string;
  system_metadata?: any;
  dispatch_records?: DispatchRecord[];
}