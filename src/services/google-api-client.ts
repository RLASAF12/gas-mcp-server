import type { GoogleApiError } from "../types.js";

/**
 * Shared Google API client.
 * Every request carries the user's Google OAuth access token.
 */
export class GoogleApiClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  async get<T>(baseUrl: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(baseUrl);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== "") url.searchParams.set(k, v);
      }
    }
    return this.request<T>(url.toString(), "GET");
  }

  async post<T>(url: string, body?: unknown): Promise<T> {
    return this.request<T>(url, "POST", body);
  }

  async put<T>(url: string, body?: unknown): Promise<T> {
    return this.request<T>(url, "PUT", body);
  }

  async delete<T>(url: string): Promise<T> {
    return this.request<T>(url, "DELETE");
  }

  private async request<T>(url: string, method: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };

    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown network error";
      throw new Error(`Network error calling Google API: ${message}`);
    }

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const errBody = (await res.json()) as GoogleApiError;
        detail = errBody.error?.message ?? detail;
      } catch { /* keep status text */ }
      throw new GoogleApiRequestError(res.status, detail, url);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}

export class GoogleApiRequestError extends Error {
  status: number;
  url: string;

  constructor(status: number, message: string, url: string) {
    super(message);
    this.name = "GoogleApiRequestError";
    this.status = status;
    this.url = url;
  }

  toUserMessage(): string {
    switch (this.status) {
      case 401:
        return "Authentication expired. The user needs to reconnect this connector.";
      case 403:
        return `Permission denied: ${this.message}. The user may need to grant additional scopes or enable the Apps Script API in their GCP project.`;
      case 404:
        return `Not found: ${this.message}. Check that the project ID is correct and the user has access.`;
      case 429:
        return "Google API rate limit reached. Wait a moment and try again.";
      default:
        return `Google API error (${this.status}): ${this.message}`;
    }
  }
}
