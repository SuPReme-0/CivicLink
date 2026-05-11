import type { 
  IngestPayload, 
  IngestResponse, 
  GrievanceCase, 
  StatusResponse,
  AdminUser,
  AuditLog,
  SystemSettings
} from '@/types';

// ============================================================================
// CUSTOM ERROR CLASS
// ============================================================================
export class ApiError extends Error {
  public status: number;
  public data: any;

  constructor(status: number, message: string, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

// ============================================================================
// API CLIENT
// ============================================================================
class ApiClient {
  // 🚨 UPGRADED: 60 seconds to allow the 70B model to scrape and process
  private defaultTimeout = 60000; 

  /**
   * 🚨 UPGRADED: Direct-to-Cloud Base URL.
   * Bypasses Vercel's relative paths to prevent 504 Timeouts.
   */
  private getBaseUrl(): string {
    return process.env.NEXT_PUBLIC_API_URL || 'https://priyanshu0-1-civiclink.hf.space';
  }

  /**
   * Centralized header constructor to ensure security tokens are 
   * consistently applied across all requests safely.
   */
  private getHeaders(customHeaders?: HeadersInit): Headers {
    const headers = new Headers(customHeaders);
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    // 🚨 UPGRADED: The Universal Key
    const frontendKey = process.env.NEXT_PUBLIC_FRONTEND_API_KEY || 'civiclink_dev_super_secret_998877';
    headers.set('X-Frontend-API-Key', frontendKey);

    if (typeof window !== 'undefined') {
      try {
        const citizenSession = localStorage.getItem('civiclink_user_session');
        if (citizenSession) {
          const parsed = JSON.parse(citizenSession);
          if (parsed.sessionId) headers.set('X-Session-ID', parsed.sessionId);
        }

        // Try to get admin token, fallback to the Universal Key if it doesn't exist
        const adminToken = localStorage.getItem('civiclink_admin_token') || frontendKey;
        headers.set('Authorization', `Bearer ${adminToken}`);
        
      } catch (e) {
        console.error('Session parsing error:', e);
      }
    } else {
      // Server-Side Rendering (SSR) fallback
      headers.set('Authorization', `Bearer ${frontendKey}`);
    }

    return headers;
  }

  /**
   * Core request orchestrator with timeout protection and robust error parsing.
   */
  public async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.getBaseUrl()}/api${endpoint}`;
    const headers = this.getHeaders(options.headers);
    
    // Setup Timeout Controller
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.defaultTimeout);

    try {
      const response = await fetch(url, { 
        ...options, 
        headers,
        signal: controller.signal 
      });

      clearTimeout(timeoutId);

      // Handle empty responses (e.g., 204 No Content)
      if (response.status === 204) {
        return {} as T;
      }

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        let errorMessage = 'Request failed';
        
        // Parse FastAPI detailed validation arrays
        if (typeof data.detail === 'string') {
          errorMessage = data.detail;
        } else if (Array.isArray(data.detail)) {
          errorMessage = data.detail.map((err: any) => `${err.loc?.slice(-1)}: ${err.msg}`).join(' | ');
        } else if (data.error) {
          errorMessage = data.error;
        } else {
          errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }

        // Redirect to login if token is expired/invalid (Global 401 Interceptor)
        if (response.status === 401 && typeof window !== 'undefined') {
          if (endpoint.startsWith('/v1/admin')) {
             localStorage.removeItem('civiclink_admin_token');
             window.location.href = '/'; // Modify if your login route is different
          }
        }

        throw new ApiError(response.status, errorMessage, data);
      }

      return data as T;
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new ApiError(408, 'Network request timed out. The AI might be processing a heavy task.');
      }
      throw error;
    }
  }

  // ==========================================
  // CITIZEN METHODS
  // ==========================================
  
  async submitGrievance(payload: IngestPayload) {
    return this.request<IngestResponse>('/v1/ingest', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async fetchMyGrievances() {
    return this.request<any>('/v1/auth/citizen/me/grievances', { method: 'GET' });
  }

  async getStatus(threadId: string): Promise<StatusResponse> {
    return this.request<StatusResponse>(`/v1/status/${threadId}`, { method: 'GET' });
  }
  
  async citizenLogin(username: string, passwordHash: string) {
    return this.request('/v1/auth/citizen/login', {
      method: 'POST',
      body: JSON.stringify({ 
        username: username, 
        password: passwordHash 
      }),
    });
  }

  async citizenRegister(username: string, passwordHash: string, phone?: string) {
    return this.request('/v1/auth/citizen/register', {
      method: 'POST',
      body: JSON.stringify({ 
        username: username, 
        password: passwordHash, 
        phone_number: phone     
      }),
    });
  }

  // ==========================================
  // ADMIN MISSION CONTROL METHODS
  // ==========================================

  async fetchDashboardStats() {
    return this.request<any>('/v1/admin/dashboard-stats', { method: 'GET' }); // Fixed endpoint name
  }

  async fetchReviewQueue() {
    return this.request<GrievanceCase[]>('/v1/admin/queue', { method: 'GET' });
  }

  async fetchGrievanceCase(threadId: string) {
    return this.request<GrievanceCase>(`/v1/admin/case/${threadId}`, { method: 'GET' });
  }

  async fetchGraphState(threadId: string) {
    return this.request<any>(`/v1/admin/graph-state/${threadId}`, { method: 'GET' });
  }

  async approveGrievance(threadId: string) {
    return this.request(`/v1/admin/approve/${threadId}`, { 
      method: 'POST',
      body: JSON.stringify({ human_review_decision: "APPROVED" }) 
    });
  }

  // ==========================================
  // UNIFIED ADMIN & HEALTH METHODS
  // ==========================================

  /** Replaces `secureAdminFetch` */
  async adminGet<T = any>(endpoint: string) {
    // Strips leading slash if you accidentally pass it (e.g., '/users' becomes 'users')
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
    return this.request<T>(`/v1/admin/${cleanEndpoint}`, { method: 'GET' });
  }

  /** Replaces `secureAdminMutation` and generic `secureAdminAction` */
  async adminMutation<T = any>(endpoint: string, data?: any, method: string = 'POST') {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
    return this.request<T>(`/v1/admin/${cleanEndpoint}`, {
      method,
      body: data ? JSON.stringify(data) : undefined
    });
  }

  /** Replaces the highly specific `secureAdminAction` for Human Review */
  async reviewGrievance(threadId: string, decision: 'APPROVED' | 'REJECTED', notes: string = "Processed via Admin Panel") {
    return this.request(`/v1/admin/review/${threadId}`, {
      method: 'POST',
      body: JSON.stringify({ decision, notes })
    });
  }

  /** Replaces the standalone `/ready` healthcheck */
  async checkHealth() {
    // Note: Healthchecks usually sit at the root level, not under /v1/admin/
    return this.request('/ready', { method: 'GET' });
  }

  async rejectGrievance(threadId: string, reason: string) {
    return this.request(`/v1/admin/reject/${threadId}`, {
      method: 'POST',
      body: JSON.stringify({ 
        human_review_decision: "REJECTED",
        rejection_reason: reason 
      })
    });
  }

  async fetchSystemHealth() {
    return this.request<any>('/v1/admin/health', { method: 'GET' });
  }

  async fetchPendingReviews() {
    return this.request<GrievanceCase[]>('/v1/admin/pending', { method: 'GET' });
  }

  async retryGraphNode(threadId: string, nodeId: string) {
    return this.request(`/v1/admin/retry/${threadId}`, { 
      method: 'POST',
      body: JSON.stringify({ target_node: nodeId, retry_flag: true })
    });
  }

  async fetchCaseMessages(threadId: string) {
    return this.request<any[]>(`/v1/admin/messages/${threadId}`, { method: 'GET' });
  }

  async fetchGrievances(params: any = {}) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        searchParams.append(key, String(value));
      }
    });
    return this.request<{items: GrievanceCase[], total: number}>(`/v1/admin/grievances?${searchParams.toString()}`, { 
      method: 'GET' 
    });
  }

  // ==========================================
  // USER & AUDIT MANAGEMENT
  // ==========================================
  
  async fetchUsers() {
    return this.request<AdminUser[]>('/v1/admin/users', { method: 'GET' });
  }

  async fetchCitizens() {
    return this.request<any[]>('/v1/admin/citizens', { method: 'GET' });
  }

  async createUser(userData: any) {
    return this.request('/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify(userData)
    });
  }

  async updateUser(userId: string, userData: any) {
    return this.request(`/v1/admin/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(userData)
    });
  }

  async deleteUser(userId: string) {
    return this.request(`/v1/admin/users/${userId}`, { method: 'DELETE' });
  }

  async fetchAuditLogs() {
    return this.request<AuditLog[]>('/v1/admin/audit', { method: 'GET' });
  }

  async fetchSystemSettings() {
    return this.request<SystemSettings>('/v1/admin/settings', { method: 'GET' });
  }

  async updateSystemSettings(settings: SystemSettings) {
    return this.request('/v1/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(settings)
    });
  }
}

export const apiClient = new ApiClient();