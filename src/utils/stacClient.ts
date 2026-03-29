import { safeFetch } from "./safeFetch";
import { getCurrentView } from "./viewManager";
import * as webMercatorUtils from "@arcgis/core/geometry/support/webMercatorUtils";

// ── Types ───────────────────────────────────────────────────────────────────

export interface StacEndpoint {
  id: string;
  name: string;
  url: string;
}

export interface StacCollection {
  id: string;
  title?: string;
  description?: string;
  extent?: {
    spatial?: { bbox?: number[][] };
    temporal?: { interval?: (string | null)[][] };
  };
  links?: StacLink[];
  keywords?: string[];
  license?: string;
}

export interface StacLink {
  rel: string;
  href: string;
  type?: string;
  title?: string;
}

export interface StacAsset {
  href: string;
  title?: string;
  description?: string;
  type?: string;
  roles?: string[];
}

export interface StacItem {
  id: string;
  type: "Feature";
  geometry: any;
  bbox?: number[];
  properties: {
    datetime: string | null;
    title?: string;
    [key: string]: any;
  };
  assets: Record<string, StacAsset>;
  links?: StacLink[];
  collection?: string;
}

export interface StacSearchParams {
  bbox?: [number, number, number, number];
  datetime?: string;
  collections?: string[];
  limit?: number;
  ids?: string[];
  query?: Record<string, Record<string, number | string>>;
}

export interface StacSearchResult {
  type: "FeatureCollection";
  features: StacItem[];
  links?: StacLink[];
  numberMatched?: number;
  numberReturned?: number;
  context?: { matched?: number; returned?: number; limit?: number };
}

// ── Default endpoints ───────────────────────────────────────────────────────

export const DEFAULT_STAC_ENDPOINTS: StacEndpoint[] = [
  {
    id: "earth-search",
    name: "Element84 Earth Search",
    url: "https://earth-search.aws.element84.com/v1",
  },
  {
    id: "planetary-computer",
    name: "Microsoft Planetary Computer",
    url: "https://planetarycomputer.microsoft.com/api/stac/v1",
  },
];

const STORAGE_KEY = "imagery-assistant-stac-endpoints";

function loadEndpoints(): StacEndpoint[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as StacEndpoint[];
      if (Array.isArray(saved) && saved.length > 0) return saved;
    }
  } catch { /* fall through to defaults */ }
  return [...DEFAULT_STAC_ENDPOINTS];
}

function saveEndpoints(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stacEndpoints));
  } catch { /* localStorage full or unavailable */ }
}

let stacEndpoints: StacEndpoint[] = loadEndpoints();

export function getStacEndpoints(): StacEndpoint[] {
  return [...stacEndpoints];
}

export function addStacEndpoint(endpoint: StacEndpoint): void {
  if (!stacEndpoints.find((e) => e.id === endpoint.id)) {
    stacEndpoints.push(endpoint);
    saveEndpoints();
  }
}

export function removeStacEndpoint(id: string): void {
  stacEndpoints = stacEndpoints.filter((e) => e.id !== id);
  saveEndpoints();
}

export function updateStacEndpoint(id: string, updates: Partial<Omit<StacEndpoint, "id">>): void {
  const ep = stacEndpoints.find((e) => e.id === id);
  if (ep) {
    if (updates.name !== undefined) ep.name = updates.name;
    if (updates.url !== undefined) ep.url = updates.url;
    saveEndpoints();
  }
}

export function resetStacEndpoints(): void {
  stacEndpoints = [...DEFAULT_STAC_ENDPOINTS];
  saveEndpoints();
}

/**
 * Fuzzy-match an endpoint by ID or name substring.
 */
export function resolveEndpoint(idOrName: string): StacEndpoint | null {
  const lower = idOrName.toLowerCase().trim();
  // Exact ID match
  const exact = stacEndpoints.find((e) => e.id === lower);
  if (exact) return exact;
  // Substring match on name or ID
  return (
    stacEndpoints.find(
      (e) =>
        e.name.toLowerCase().includes(lower) ||
        e.id.toLowerCase().includes(lower),
    ) ?? null
  );
}

// ── Fetch helper ────────────────────────────────────────────────────────────

async function stacFetchJson<T = any>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const resp = await safeFetch(url, options, 20000);
  return (await resp.json()) as T;
}

// ── STAC API functions ──────────────────────────────────────────────────────

export async function getStacCollections(
  endpoint: StacEndpoint,
): Promise<StacCollection[]> {
  const url = `${endpoint.url.replace(/\/$/, "")}/collections`;
  const data = await stacFetchJson<{ collections: StacCollection[] }>(url);
  return data.collections ?? [];
}

export async function getStacCollection(
  endpoint: StacEndpoint,
  collectionId: string,
): Promise<StacCollection> {
  const url = `${endpoint.url.replace(/\/$/, "")}/collections/${encodeURIComponent(collectionId)}`;
  return await stacFetchJson<StacCollection>(url);
}

/**
 * Normalize a datetime string or interval to full RFC 3339 format.
 * "2026-02-27" → "2026-02-27T00:00:00Z"
 * "2026-02-27/2026-03-27" → "2026-02-27T00:00:00Z/2026-03-27T23:59:59Z"
 */
function normalizeDateTime(dt: string): string {
  return dt
    .split("/")
    .map((part, i, arr) => {
      const trimmed = part.trim();
      if (trimmed === ".." || trimmed === "") return trimmed;
      // Already has a time component
      if (trimmed.includes("T")) return trimmed;
      // Date-only: add start-of-day or end-of-day
      const isEnd = i === arr.length - 1 && arr.length > 1;
      return isEnd ? `${trimmed}T23:59:59Z` : `${trimmed}T00:00:00Z`;
    })
    .join("/");
}

export async function searchStacItems(
  endpoint: StacEndpoint,
  params: StacSearchParams,
): Promise<StacSearchResult> {
  const url = `${endpoint.url.replace(/\/$/, "")}/search`;
  const body: Record<string, any> = {};
  if (params.bbox) body.bbox = params.bbox;
  if (params.datetime) body.datetime = normalizeDateTime(params.datetime);
  if (params.collections?.length) body.collections = params.collections;
  if (params.limit) body.limit = params.limit;
  if (params.ids?.length) body.ids = params.ids;
  if (params.query && Object.keys(params.query).length > 0) body.query = params.query;

  return await stacFetchJson<StacSearchResult>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Planetary Computer SAS token signing ─────────────────────────────────────
//
// Microsoft Planetary Computer stores assets in Azure Blob Storage behind SAS
// tokens. The signing endpoint is free and anonymous — no API key required.
// Tokens are cached per collection and valid for ~24 hours.

const PC_SAS_BASE = "https://planetarycomputer.microsoft.com/api/sas/v1/token";
const PC_HOST = "planetarycomputer.microsoft.com";

interface SasTokenEntry {
  token: string;
  expiry: number; // epoch ms
}

const sasTokenCache = new Map<string, SasTokenEntry>();

/**
 * Check if a STAC endpoint is Planetary Computer (needs signed URLs).
 */
function isPlanetaryComputer(endpoint: StacEndpoint): boolean {
  return endpoint.url.includes(PC_HOST) || endpoint.id === "planetary-computer";
}

/**
 * Get a SAS token for a Planetary Computer collection.
 * Tokens are cached until 5 minutes before expiry.
 */
async function getSasToken(collectionId: string): Promise<string> {
  const cached = sasTokenCache.get(collectionId);
  const now = Date.now();
  // Use cached token if still valid (with 5 min buffer)
  if (cached && cached.expiry - now > 5 * 60 * 1000) {
    return cached.token;
  }

  const url = `${PC_SAS_BASE}/${encodeURIComponent(collectionId)}`;
  const data = await stacFetchJson<{ token: string; "msft:expiry": string }>(url);

  const expiry = new Date(data["msft:expiry"]).getTime();
  sasTokenCache.set(collectionId, { token: data.token, expiry });
  console.log(`[STAC] SAS token for "${collectionId}" cached until ${data["msft:expiry"]}`);

  return data.token;
}

/**
 * Sign a STAC asset URL if it belongs to Planetary Computer.
 * Appends the SAS token as query parameters. Returns the URL unchanged
 * for non-PC endpoints.
 */
export async function signAssetUrl(
  href: string,
  collectionId: string | undefined,
  endpoint: StacEndpoint | null,
): Promise<string> {
  // Only sign for Planetary Computer
  if (!endpoint || !isPlanetaryComputer(endpoint)) return href;
  // Only sign Azure blob storage URLs
  if (!href.includes(".blob.core.windows.net")) return href;
  if (!collectionId) return href;

  try {
    const token = await getSasToken(collectionId);
    const sep = href.includes("?") ? "&" : "?";
    return `${href}${sep}${token}`;
  } catch (err) {
    console.warn(`[STAC] Failed to sign URL for collection "${collectionId}":`, err);
    return href; // Fall back to unsigned URL
  }
}

// ── Asset helpers ───────────────────────────────────────────────────────────

const COG_MEDIA_TYPES = [
  "image/tiff",
  "image/tiff; application=geotiff",
  "image/tiff; application=geotiff; profile=cloud-optimized",
  "image/vnd.stac.geotiff",
];

const COPC_MEDIA_TYPES = [
  "application/vnd.laszip+copc",
  "application/vnd.laszip",
  "application/octet-stream",
];

function matchesMediaType(asset: StacAsset, mediaTypes: string[]): boolean {
  if (!asset.type) return false;
  const lower = asset.type.toLowerCase();
  return mediaTypes.some((mt) => lower.startsWith(mt.toLowerCase()));
}

/** Check if an asset href is loadable in a browser (HTTPS only, not s3://) */
function isHttpsAsset(asset: StacAsset): boolean {
  return !!asset.href && asset.href.startsWith("https://");
}

export function getCogAssets(item: StacItem): [string, StacAsset][] {
  return Object.entries(item.assets).filter(
    ([, a]) =>
      isHttpsAsset(a) && (
        matchesMediaType(a, COG_MEDIA_TYPES) ||
        (a.roles?.includes("data") && a.href?.endsWith(".tif")) ||
        (a.roles?.includes("data") && a.href?.endsWith(".tiff"))
      ),
  );
}

export function getCopcAssets(item: StacItem): [string, StacAsset][] {
  return Object.entries(item.assets).filter(
    ([, a]) =>
      matchesMediaType(a, COPC_MEDIA_TYPES) ||
      a.href?.endsWith(".copc.laz") ||
      a.roles?.includes("pointcloud"),
  );
}

/** Known S3 buckets with CORS enabled for browser image loading. */
const CORS_SAFE_HOSTS = [
  "sentinel-cogs.s3.us-west-2.amazonaws.com",
  "planetarycomputer.microsoft.com",
  ".blob.core.windows.net",
  "landsatlook.usgs.gov",
];

function isCorsLikelyAllowed(url: string): boolean {
  return CORS_SAFE_HOSTS.some((host) => url.includes(host));
}

export function getThumbnail(item: StacItem): string | null {
  const thumb = Object.values(item.assets).find(
    (a) =>
      (a.roles?.includes("thumbnail") ||
      a.roles?.includes("overview") ||
      a.type?.startsWith("image/png") ||
      a.type?.startsWith("image/jpeg")) &&
      isHttpsAsset(a) &&
      isCorsLikelyAllowed(a.href),
  );
  return thumb?.href ?? null;
}

/** Preferred asset keys for composite/visual imagery (in priority order). */
const PREFERRED_VISUAL_KEYS = ["visual", "tci", "image", "render", "preview"];

/**
 * Get the best data asset for loading. Prefers visual/composite COGs over
 * single-band assets. Filters out s3:// URLs that can't be loaded in a browser.
 */
export function getBestDataAsset(
  item: StacItem,
): { key: string; asset: StacAsset; type: "cog" | "copc" | "other" } | null {
  const cogs = getCogAssets(item);
  if (cogs.length > 0) {
    // Prefer visual/composite asset over arbitrary single band
    for (const preferred of PREFERRED_VISUAL_KEYS) {
      const match = cogs.find(([k]) => k.toLowerCase() === preferred);
      if (match) return { key: match[0], asset: match[1], type: "cog" };
    }
    return { key: cogs[0][0], asset: cogs[0][1], type: "cog" };
  }
  const copcs = getCopcAssets(item);
  if (copcs.length > 0) {
    return { key: copcs[0][0], asset: copcs[0][1], type: "copc" };
  }
  // Fallback: any HTTPS asset with "data" role
  const dataEntry = Object.entries(item.assets).find(
    ([, a]) => isHttpsAsset(a) && a.roles?.includes("data"),
  );
  if (dataEntry) {
    return { key: dataEntry[0], asset: dataEntry[1], type: "other" };
  }
  // No HTTPS assets available (e.g., requester-pays S3 bucket)
  const anyData = Object.entries(item.assets).find(([, a]) => a.roles?.includes("data"));
  if (anyData && anyData[1].href?.startsWith("s3://")) {
    return { key: anyData[0], asset: anyData[1], type: "other" };
  }
  return null;
}

// ── View bbox helper ────────────────────────────────────────────────────────

/**
 * Get the current map view extent as a WGS84 bbox [west, south, east, north].
 */
export function getViewBbox(): [number, number, number, number] | null {
  const view = getCurrentView();
  if (!view?.extent) return null;

  let ext = view.extent;
  // Project from Web Mercator to WGS84 if needed
  if (ext.spatialReference?.isWebMercator) {
    ext = webMercatorUtils.webMercatorToGeographic(ext) as any;
  }

  return [ext.xmin, ext.ymin, ext.xmax, ext.ymax];
}
