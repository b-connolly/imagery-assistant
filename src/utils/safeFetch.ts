import IdentityManager from "@arcgis/core/identity/IdentityManager";
import { portalUrl } from "./arcgisAuth";

// ── Error types ──────────────────────────────────────────────────────────────

export class NetworkError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "NetworkError";
  }
}

export class TimeoutError extends Error {
  constructor(public readonly timeoutMs: number, public readonly label: string) {
    super(`${label} timed out after ${(timeoutMs / 1000).toFixed(0)}s`);
    this.name = "TimeoutError";
  }
}

export class PortalError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "PortalError";
  }
}

// ── safeFetch ────────────────────────────────────────────────────────────────

/**
 * Wrapper around fetch() with:
 * - AbortController timeout (default 15s)
 * - response.ok check
 * - Network error wrapping
 */
export async function safeFetch(
  url: string,
  options?: RequestInit,
  timeoutMs = 15000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    if (!resp.ok) {
      throw new NetworkError(`HTTP ${resp.status} ${resp.statusText} for ${url}`);
    }

    return resp;
  } catch (err: unknown) {
    if (err instanceof NetworkError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new TimeoutError(timeoutMs, url);
    }
    throw new NetworkError(`Network request failed: ${url}`, err);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * safeFetch + JSON parse + ArcGIS REST error detection.
 * ArcGIS REST API often returns HTTP 200 with {error: {code, message}} in body.
 */
export async function safeFetchJson<T = any>(
  url: string,
  options?: RequestInit,
  timeoutMs = 15000
): Promise<T> {
  const resp = await safeFetch(url, options, timeoutMs);
  const json = await resp.json();

  if (json?.error) {
    throw new PortalError(
      json.error.code ?? 0,
      json.error.message ?? "ArcGIS REST API error",
      json.error.details
    );
  }

  return json as T;
}

// ── withTimeout ──────────────────────────────────────────────────────────────

/**
 * Wrap any promise with a timeout. Use for SDK operations like
 * layer.load(), portal.load(), ground.queryElevation(), view.goTo().
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new TimeoutError(ms, label)),
      ms
    );
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

// ── Token helper ─────────────────────────────────────────────────────────────

/**
 * Get the current ArcGIS token, or empty string if not authenticated.
 */
export function getToken(): string {
  try {
    const credential = IdentityManager.findCredential(`${portalUrl}/sharing`);
    return credential?.token ?? "";
  } catch {
    return "";
  }
}

/**
 * Append the ArcGIS token to a URL's query parameters.
 * Use for raw REST calls to secured ArcGIS services.
 */
export function appendToken(url: string): string {
  const token = getToken();
  if (!token) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}
