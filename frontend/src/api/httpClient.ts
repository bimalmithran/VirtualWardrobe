import type { DeviceIdentity } from './installationId';

export class ApiError extends Error {
  constructor(
    /** HTTP status; 0 for network errors and timeouts. */
    readonly status: number,
    message: string,
    /** Stable machine-readable code from the API, e.g. 'consent_required' or 'quota_exceeded'. */
    readonly code: string | null = null,
  ) {
    super(message);
  }

  /** Worth retrying later (offline, timeout, server error) rather than a bad request. */
  get transient() {
    return this.status === 0 || this.status >= 500;
  }
}

export interface HttpClient {
  readonly baseUrl: string;
  getJson<T>(path: string): Promise<T>;
  postJson<T>(path: string, body: unknown): Promise<T>;
  delete(path: string): Promise<void>;
  /** Headers that authenticate this install; for transports that bypass this client (SSE). */
  authHeaders(): Promise<Record<string, string>>;
}

/**
 * fetch-based JSON transport with a timeout. Knows nothing about the API's endpoints.
 * With an identity it authenticates every request and enrols the install on the first 401.
 */
export class FetchHttpClient implements HttpClient {
  private enrolled: Promise<void> | null = null;

  constructor(
    readonly baseUrl: string,
    private readonly identity: DeviceIdentity | null = null,
    private readonly timeoutMs = 20_000,
  ) {}

  getJson<T>(path: string): Promise<T> {
    return this.send<T>('GET', path);
  }

  postJson<T>(path: string, body: unknown): Promise<T> {
    return this.send<T>('POST', path, body);
  }

  async delete(path: string): Promise<void> {
    await this.send('DELETE', path);
  }

  async authHeaders(): Promise<Record<string, string>> {
    if (!this.identity) return {};
    const { userId, token } = await this.identity.credentials();
    return { 'X-User-ID': userId, Authorization: `Bearer ${token}` };
  }

  private async send<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
    try {
      return await this.request<T>(method, path, body);
    } catch (e) {
      // 401 means this install has not enrolled its token yet (or the server lost it).
      if (!retried && this.identity && e instanceof ApiError && e.status === 401) {
        await this.enroll();
        return this.send<T>(method, path, body, true);
      }
      throw e;
    }
  }

  /** Single-flight, so a burst of first requests enrols once. */
  private enroll(): Promise<void> {
    this.enrolled ??= this.request<unknown>('POST', '/api/devices/enroll')
      .then(() => undefined)
      .finally(() => {
        this.enrolled = null;
      });
    return this.enrolled;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: 'application/json', ...(await this.authHeaders()) };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!res.ok) throw new ApiError(res.status, json.error ?? `HTTP ${res.status}`, json.code ?? null);
      return json as T;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(0, controller.signal.aborted ? 'Request timed out' : `Network error: ${String(e)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Base URL of the Go API, baked in at bundle time from EXPO_PUBLIC_API_URL.
 * Empty means cloud features are off and the app runs fully on-device.
 */
export function configuredApiUrl(): string {
  return (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
}
