import { getToken } from "../utils/storage";
import { config } from "../config/env";

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl = config.proxyBaseUrl) {
    this.baseUrl = baseUrl;
  }

  private getHeaders(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    const token = getToken();
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: this.getHeaders(),
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const res = await fetch(url, init);

    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      try {
        const errorBody = await res.json();
        if (errorBody.error) message = errorBody.error;
        else if (errorBody.message) message = errorBody.message;
      } catch {
        // ignore parse errors
      }
      throw new Error(message);
    }

    // Handle 204 No Content
    if (res.status === 204) {
      return undefined as T;
    }

    return res.json() as Promise<T>;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }

  async del(path: string): Promise<void> {
    await this.request<void>("DELETE", path);
  }

  async download(path: string): Promise<Blob> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, { headers: this.getHeaders() });
    if (!res.ok) {
      throw new Error(`Download failed: ${res.status} ${res.statusText}`);
    }
    return res.blob();
  }
}

export const apiClient = new ApiClient();
