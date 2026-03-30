import {
  resolveEndpoint,
  searchStacItems,
  getViewBbox,
  getCogAssets,
  getCopcAssets,
  getThumbnail,
  type StacItem,
  type StacEndpoint,
} from "../../../../../utils/stacClient";
// ── Cached results for "add STAC result N" follow-ups ───────────────────────

export let lastStacSearchResults: StacItem[] = [];
export let lastStacEndpoint: StacEndpoint | null = null;
export let lastStacDisplayedCount = 0;
let lastStacSearchTimestamp = 0;
const STAC_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function hasValidStacResults(): boolean {
  return lastStacSearchResults.length > 0 && (Date.now() - lastStacSearchTimestamp) < STAC_CACHE_TTL_MS;
}

export function clearStacSearchResults(): void {
  lastStacSearchResults = [];
  lastStacEndpoint = null;
  lastStacDisplayedCount = 0;
  lastStacSearchTimestamp = 0;
}

const PAGE_SIZE = 10;

/**
 * Show the next page of already-cached STAC results.
 */
export function showMoreStacResults(): string {
  if (lastStacSearchResults.length === 0) {
    return "No STAC search results to show. Search first.";
  }
  const start = lastStacDisplayedCount;
  const total = lastStacSearchResults.length;
  if (start >= total) {
    return `All ${total} results are already shown.`;
  }
  const end = Math.min(start + PAGE_SIZE, total);
  const lines: string[] = [];
  lines.push(`Showing results ${start + 1}–${end} of ${total}:\n`);
  for (let i = start; i < end; i++) {
    lines.push(formatItemCard(lastStacSearchResults[i], i + 1));
    lines.push("");
  }
  lastStacDisplayedCount = end;
  if (end < total) {
    lines.push(`---\n${total - end} more results available. Say "show more STAC results" to see the next page.`);
  }
  lines.push(
    'To add results, say "add STAC result 1", "add STAC results 1-5", or "add all STAC results".',
  );
  return lines.join("\n");
}

// ── Format helpers ──────────────────────────────────────────────────────────

function formatDate(item: StacItem): string {
  const dt = item.properties.datetime;
  if (!dt) return "—";
  try {
    const d = new Date(dt);
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const yy = String(d.getUTCFullYear()).slice(-2);
    return `${mm}/${dd}/${yy}`;
  } catch {
    return dt;
  }
}

function formatCloudCover(item: StacItem): string | null {
  const cc = item.properties["eo:cloud_cover"];
  if (cc == null) return null;
  return `${Math.round(cc)}%`;
}

function formatPlatform(item: StacItem): string | null {
  return item.properties.platform ?? item.properties.constellation ?? null;
}

function formatGsd(item: StacItem): string | null {
  const gsd = item.properties.gsd ?? item.properties["proj:gsd"];
  if (gsd == null) return null;
  return gsd < 1 ? `${(gsd * 100).toFixed(0)}cm` : `${gsd}m`;
}

function formatAssetStatus(item: StacItem): string {
  const cogs = getCogAssets(item);
  const copcs = getCopcAssets(item);
  if (cogs.length > 0) return `${cogs.length} COG${cogs.length > 1 ? "s" : ""}`;
  if (copcs.length > 0) return `${copcs.length} COPC`;
  const dataAssets = Object.values(item.assets).filter((a) => a.roles?.includes("data"));
  if (dataAssets.length > 0 && dataAssets.every((a) => a.href?.startsWith("s3://"))) {
    return "S3 only";
  }
  return `${Object.keys(item.assets).length} assets`;
}

/**
 * Format a single STAC item as a compact card with metadata.
 * Thumbnail is included as a small markdown image link.
 */
function formatItemCard(item: StacItem, index: number): string {
  const title = item.properties.title || item.id;
  const date = formatDate(item);
  const cloud = formatCloudCover(item);
  const platform = formatPlatform(item);
  const gsd = formatGsd(item);
  const thumb = getThumbnail(item);

  // Build compact metadata line
  const meta: string[] = [];
  meta.push(date);
  if (cloud != null) meta.push(`☁️${cloud}`);
  if (platform) meta.push(platform);
  if (gsd) meta.push(gsd);

  const lines: string[] = [];
  lines.push(`**${index}.** ${title} — ${meta.join(" · ")}`);
  if (thumb) lines.push(`<img src="${thumb}" width="60" height="60" style="border-radius:4px;display:block;margin:2px 0" />`);

  return lines.join("\n");
}

// ── Core search function ────────────────────────────────────────────────────

export async function searchStac(params: {
  endpoint: string;
  collections?: string[];
  useBbox: boolean;
  datetime?: string;
  limit: number;
  maxCloudCover?: number;
  query?: Record<string, Record<string, number | string>>;
}): Promise<string> {
  const { endpoint: endpointRef, collections, useBbox, datetime, limit, maxCloudCover, query } = params;

  const ep = resolveEndpoint(endpointRef);
  if (!ep) {
    return `Unknown STAC catalog "${endpointRef}". Available catalogs: earth-search, planetary-computer.`;
  }

  const bbox = useBbox ? getViewBbox() : undefined;

  // Build property query filters
  const mergedQuery: Record<string, Record<string, number | string>> = { ...query };
  if (maxCloudCover !== undefined) {
    mergedQuery["eo:cloud_cover"] = { lte: maxCloudCover };
  }

  console.log("[StacSearch] Searching:", {
    endpoint: ep.id,
    collections,
    bbox: bbox ?? "none",
    datetime: datetime ?? "none",
    query: Object.keys(mergedQuery).length > 0 ? mergedQuery : "none",
    limit,
  });

  let result;
  try {
    result = await searchStacItems(ep, {
      bbox: bbox ?? undefined,
      datetime,
      collections,
      limit,
      query: Object.keys(mergedQuery).length > 0 ? mergedQuery : undefined,
    });
  } catch (err: any) {
    console.error("[StacSearch] Search failed:", err);
    return `STAC search failed: ${err?.message ?? String(err)}`;
  }

  const items = result.features ?? [];
  lastStacSearchResults = items;
  lastStacEndpoint = ep;
  lastStacSearchTimestamp = Date.now();

  if (items.length === 0) {
    const parts = [`No results found on ${ep.name}`];
    if (collections?.length) parts.push(`in collection${collections.length > 1 ? "s" : ""}: ${collections.join(", ")}`);
    if (bbox) parts.push("within current map extent");
    if (datetime) parts.push(`for date range: ${datetime}`);
    return parts.join(" ") + ". Try broadening your search or zooming out.";
  }

  const matched = result.numberMatched ?? result.context?.matched;
  const displayEnd = Math.min(items.length, PAGE_SIZE);
  lastStacDisplayedCount = displayEnd;

  const lines: string[] = [];
  lines.push(
    `Found ${matched != null && matched > items.length ? `${items.length} of ${matched}` : items.length} result${items.length === 1 ? "" : "s"} on **${ep.name}**:\n`,
  );

  for (let i = 0; i < displayEnd; i++) {
    lines.push(formatItemCard(items[i], i + 1));
    lines.push("");
  }

  if (displayEnd < items.length) {
    lines.push(`---\n${items.length - displayEnd} more results available. Say "show more STAC results" to see the next page.`);
  }
  lines.push(
    'To add results, say "add STAC result 1", "add STAC results 1-5", or "add all STAC results".',
  );

  // Build preview data for the UI thumbnail gallery
  const previews = items.map((item, i) => ({
    index: i + 1,
    title: item.properties.title || item.id,
    thumbnail: getThumbnail(item),
    date: formatDate(item),
    cloud: formatCloudCover(item),
  })).filter((p) => p.thumbnail);

  // Notify the UI
  window.dispatchEvent(
    new CustomEvent("imagery-assistant-stac-results", {
      detail: { count: items.length, endpoint: ep.id, previews },
    }),
  );

  return lines.join("\n");
}
