export class ApiError extends Error {
  constructor(
    /** HTTP status; 0 for network errors and timeouts. */
    readonly status: number,
    message: string,
  ) {
    super(message);
  }

  /** Worth retrying later (offline, timeout, server error) rather than a bad request. */
  get transient() {
    return this.status === 0 || this.status >= 500;
  }
}

export interface HttpClient {
  postJson<T>(path: string, body: unknown): Promise<T>;
}

/** fetch-based JSON transport with a timeout. Knows nothing about the API's endpoints. */
export class FetchHttpClient implements HttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 20_000,
  ) {}

  async postJson<T>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(res.status, (json as { error?: string }).error ?? `HTTP ${res.status}`);
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
 * Empty means cloud sync is off and the app runs fully on-device.
 */
export function configuredApiUrl(): string {
  return (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
}
