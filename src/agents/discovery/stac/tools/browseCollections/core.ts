import {
  resolveEndpoint,
  getStacCollections,
  type StacCollection,
} from "../../../../../utils/stacClient";
import { withTimeout } from "../../../../../utils/safeFetch";

// ── Format helpers ──────────────────────────────────────────────────────────

function formatTemporalRange(collection: StacCollection): string {
  const intervals = collection.extent?.temporal?.interval;
  if (!intervals?.length) return "no date range";
  const [start, end] = intervals[0];
  const fmt = (d: string | null) => {
    if (!d) return "present";
    try {
      return new Date(d).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
      });
    } catch {
      return d;
    }
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

function formatSpatialCoverage(collection: StacCollection): string {
  const bboxes = collection.extent?.spatial?.bbox;
  if (!bboxes?.length) return "";
  const [west, south, east, north] = bboxes[0];
  if (west === -180 && south === -90 && east === 180 && north === 90) {
    return "Global";
  }
  return `[${west.toFixed(1)}, ${south.toFixed(1)}, ${east.toFixed(1)}, ${north.toFixed(1)}]`;
}

// ── Core browse function ────────────────────────────────────────────────────

export async function browseCollections(params: {
  endpoint: string;
  keyword?: string;
}): Promise<string> {
  const { endpoint: endpointRef, keyword } = params;

  const ep = resolveEndpoint(endpointRef);
  if (!ep) {
    return `Unknown STAC catalog "${endpointRef}". Available catalogs: earth-search, planetary-computer.`;
  }

  console.log("[StacSearch] Browsing collections:", {
    endpoint: ep.id,
    keyword: keyword ?? "all",
  });

  let collections: StacCollection[];
  try {
    collections = await withTimeout(getStacCollections(ep), 30000, `Browse ${ep.name} collections`);
  } catch (err: any) {
    console.error("[StacSearch] Browse failed:", err);
    return `Failed to fetch collections from ${ep.name}: ${err?.message ?? String(err)}`;
  }

  // Filter by keyword if provided
  if (keyword) {
    const lower = keyword.toLowerCase();
    collections = collections.filter(
      (c) =>
        c.id.toLowerCase().includes(lower) ||
        (c.title ?? "").toLowerCase().includes(lower) ||
        (c.description ?? "").toLowerCase().includes(lower) ||
        (c.keywords ?? []).some((k) => k.toLowerCase().includes(lower)),
    );
  }

  if (collections.length === 0) {
    return keyword
      ? `No collections matching "${keyword}" found on ${ep.name}.`
      : `No collections found on ${ep.name}.`;
  }

  const lines: string[] = [];
  lines.push(
    `**${ep.name}** — ${collections.length} collection${collections.length === 1 ? "" : "s"}${keyword ? ` matching "${keyword}"` : ""}:\n`,
  );

  for (const c of collections) {
    const title = c.title || c.id;
    const desc = c.description
      ? ` — ${c.description.slice(0, 100)}${c.description.length > 100 ? "..." : ""}`
      : "";
    const temporal = formatTemporalRange(c);
    const spatial = formatSpatialCoverage(c);
    const coverage = [temporal, spatial].filter(Boolean).join(", ");
    lines.push(`  - **${title}** (\`${c.id}\`) ${coverage}${desc}`);
  }

  lines.push("");
  lines.push(
    `To search a specific collection, say e.g. "search ${ep.id} collection sentinel-2-l2a".`,
  );

  return lines.join("\n");
}
