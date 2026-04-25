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

export interface LocationData {
  lat: number;
  lon: number;
  type: 'gps' | 'text';  // Required field
  address_text?: string;
}

export interface IngestPayload {
  phone_number: string;
  thread_id: string;
  text_message: string;
  image_url?: string;    // URL or base64 data URL for prototype
  location: LocationData;
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