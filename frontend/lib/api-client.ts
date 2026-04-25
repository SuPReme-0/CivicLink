// lib/api-client.ts
import type { IngestPayload, IngestResponse, GrievanceCase, GrievanceStatus } from '@/types';

class ApiClient {
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    // 🚨 ALL requests hit the Next.js internal proxy, NEVER FastAPI directly
    const url = `/api${endpoint}`;

    const headers = new Headers(options.headers);
    headers.set('Content-Type', 'application/json');

    const response = await fetch(url, { ...options, headers });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.detail || `Request failed (${response.status})`);
    }

    return response.json();
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

  async getStatus(threadId: string) {
    return this.request<{
      status: string;
      current_state: GrievanceStatus;
      bot_reply?: string;
      system_metadata?: any;
      issue_category?: string;
      description_text?: string;
      dispatch_records?: any[];
    }>(`/v1/status/${threadId}`, { method: 'GET' });
  }

  // ==========================================
  // ADMIN MISSION CONTROL METHODS
  // ==========================================

  // 1. Fetch aggregate stats for the Recharts dashboard
  async fetchDashboardStats() {
    return this.request<any>('/v1/admin/stats', { method: 'GET' });
  }

  // 2. Fetch the active queue for the main table
  async fetchReviewQueue() {
    return this.request<GrievanceCase[]>('/v1/admin/queue', { method: 'GET' });
  }

  // 3. Fetch specific case details (including extracted metadata)
  async fetchGrievanceCase(threadId: string) {
    return this.request<GrievanceCase>(`/v1/admin/case/${threadId}`, { method: 'GET' });
  }

  // 4. Fetch the raw LangGraph Checkpointer history for the visualizer
  async fetchGraphState(threadId: string) {
    return this.request<any>(`/v1/admin/graph-state/${threadId}`, { method: 'GET' });
  }

  // 5. HITL Action: Approve and resume the graph
  async approveGrievance(threadId: string) {
    return this.request(`/v1/admin/approve/${threadId}`, { method: 'POST' });
  }

  // 6. HITL Action: Reject and halt the graph
  async rejectGrievance(threadId: string, reason: string) {
    return this.request(`/v1/admin/reject/${threadId}`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
  }

  // 7. Fetch system health metrics
  async fetchSystemHealth() {
    return this.request<any>('/v1/admin/health', { method: 'GET' });
  }

  // 8. Fetch only grievances awaiting HITL review
  async fetchPendingReviews() {
    return this.request<GrievanceCase[]>('/v1/admin/pending', { method: 'GET' });
  }

  // 9. Retry a specific node in the LangGraph (for admins)
  async retryGraphNode(threadId: string, nodeId: string) {
    return this.request(`/v1/admin/retry/${threadId}/${nodeId}`, { 
      method: 'POST' 
    });
  }

    // 10. Fetch all messages in a grievance thread (for audit logs)
  async fetchCaseMessages(threadId: string) {
    return this.request<any[]>(`/v1/admin/messages/${threadId}`, { method: 'GET' });
  }

  // 11. Fetch grievances with optional filters (for the grievances page)
  async fetchGrievances(params: any = {}) {
    // Convert params object to URL Query String
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== '') {
        searchParams.append(key, String(value));
      }
    });
    
    return this.request<{items: GrievanceCase[], total: number}>(`/v1/admin/grievances?${searchParams.toString()}`, { 
      method: 'GET' 
    });
  }

  // ==========================================
  // USER MANAGEMENT METHODS
  // ==========================================
  async fetchUsers() {
    return this.request<any[]>('/v1/admin/users', { method: 'GET' });
  }

// 12. Create a new admin user
  async createUser(userData: any) {
    return this.request('/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify(userData)
    });
  }

  // ==========================================
  // AUDIT LOG METHODS
  // ==========================================
  async fetchAuditLogs() {
    return this.request<any[]>('/v1/admin/audit', { method: 'GET' });
  }

  // ==========================================
  // SYSTEM SETTINGS METHODS
  // ==========================================
  async fetchSystemSettings() {
    return this.request<any>('/v1/admin/settings', { method: 'GET' });
  }

  async updateSystemSettings(settings: any) {
    return this.request('/v1/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(settings)
    });
  }
}

export const apiClient = new ApiClient();