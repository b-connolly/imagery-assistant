import type { RunnableConfig } from "@langchain/core/runnables";
import { extractLastUserText, AGENT_KEYWORDS } from "../../../../utils/agentHelpers";
import { lastStacSearchResults, showMoreStacResults, searchStac } from "../tools/searchStac/core";
import { addStacResultsToMap } from "../tools/addStacResults/core";
import { getStacEndpoints } from "../../../../utils/stacClient";
import type { StacSearchStateType } from "../state";

// ── STAC-specific detection ─────────────────────────────────────────────────

const STAC_SIGNAL = AGENT_KEYWORDS.stac;

// ── Result extraction regex ─────────────────────────────────────────────────

function quickExtractStacAddResults(text: string): number[] | "all" | null {
  const lower = text.toLowerCase();

  // Must mention "stac" to distinguish from ContentSearch's "add result N"
  if (!/stac/i.test(lower)) return null;

  // "add all stac results"
  if (
    /(?:add|load|open|show)\s+(?:all|every(?:thing)?)\s*(?:stac\s*)?(?:results?|items?|layers?)?/i.test(lower) ||
    /(?:add|load|open|show)\s+(?:stac\s*)?(?:results?|items?|layers?)\s*(?:all)/i.test(lower)
  ) {
    return "all";
  }

  // "add stac result 1", "add stac results 1-5"
  const afterVerb = text.match(
    /(?:add|load|open|show)\s+(?:stac\s*)?(?:results?|items?|layers?|#)?\s*([\d\s,\-\u2013\u2014andto]+)/i,
  );
  if (afterVerb) {
    const spec = afterVerb[1];
    const indices = new Set<number>();
    const parts = spec.split(/[,\s]+(?:and\s+)?/).filter(Boolean);

    for (const part of parts) {
      const rangeMatch = part.match(/^(\d+)\s*[-\u2013\u2014]\s*(\d+)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        if (start >= 1 && end >= start && end <= 200) {
          for (let i = start; i <= end; i++) indices.add(i);
        }
        continue;
      }
      const num = parseInt(part, 10);
      if (!isNaN(num) && num >= 1) {
        indices.add(num);
      }
    }

    if (indices.size > 0) return [...indices].sort((a, b) => a - b);
  }

  return null;
}

// ── Router node ─────────────────────────────────────────────────────────────

export async function stacSearchRouter(
  state: StacSearchStateType,
  _config?: RunnableConfig,
): Promise<Partial<StacSearchStateType>> {
  const text = extractLastUserText(state);

  // ── Bail out: save commands ──
  if (/\b(save)\s+(web\s*map|web\s*scene|map|scene)\b/i.test(text)) {
    console.log("[StacSearch] Skipping — save command.");
    return { outputMessage: "" };
  }

  // ── Fast-path: generic "Search STAC" → browse top 5 collections from each catalog ──
  if (/^\s*search\s+stac\s*$/i.test(text)) {
    const endpoints = getStacEndpoints();
    if (endpoints.length === 0) {
      return { outputMessage: "No STAC catalogs configured. Open STAC Catalogs from the user menu to add one." };
    }
    if (endpoints.length === 1) {
      // Single catalog — return top 5 items from current extent
      const msg = await searchStac({
        endpoint: endpoints[0].id,
        useBbox: true,
        limit: 5,
      });
      return { outputMessage: msg };
    }
    // Multiple catalogs — show top 5 collections from each
    const { browseCollections } = await import("../tools/browseCollections/core");
    const results: string[] = [];
    for (const ep of endpoints) {
      const msg = await browseCollections({ endpoint: ep.id });
      // Trim to first 5 collections by taking header + first 5 list items
      const lines = msg.split("\n");
      const header = lines[0] ?? "";
      const items = lines.filter((l) => l.trimStart().startsWith("- **")).slice(0, 5);
      results.push([header, ...items].join("\n"));
    }
    results.push('\nTo search a specific catalog, say e.g. "search earth search for sentinel-2 imagery".');
    return { outputMessage: results.join("\n\n---\n\n") };
  }

  // ── Fast-path: "show more STAC results" ──
  if (/\b(show|more|next|page)\b.*\bstac\b.*\b(results?|items?)\b/i.test(text) ||
      /\bstac\b.*\b(show\s*more|next\s*page|more\s*results)\b/i.test(text)) {
    const msg = showMoreStacResults();
    return { outputMessage: msg };
  }

  // ── Fast-path: "add STAC result N" ──
  const quickAdd = quickExtractStacAddResults(text);
  if (quickAdd !== null) {
    if (lastStacSearchResults.length === 0) {
      return {
        outputMessage:
          "No previous STAC search results. Search a STAC catalog first, then add results by number.",
      };
    }
    const addAll = quickAdd === "all";
    const indices = addAll ? [] : (quickAdd as number[]);
    const msg = await addStacResultsToMap({ indices, addAll });
    return { outputMessage: msg };
  }

  // ── Bail out if not STAC-related ──
  if (!STAC_SIGNAL.test(text)) {
    // Check if another agent owns this
    const bailouts = [
      { pattern: AGENT_KEYWORDS.imagery, label: "ImageryToolsAgent" },
      { pattern: AGENT_KEYWORDS.measurement, label: "MeasurementAgent" },
      { pattern: AGENT_KEYWORDS.elevationOffset, label: "ElevationOffsetAgent" },
      { pattern: AGENT_KEYWORDS.elevationOffsetSimple, label: "ElevationOffsetAgent" },
      { pattern: AGENT_KEYWORDS.pointCloud, label: "PointCloudAgent" },
      { pattern: AGENT_KEYWORDS.swipe, label: "SwipeAgent" },
      { pattern: AGENT_KEYWORDS.orientedImagery, label: "OrientedImageryAgent" },
      { pattern: AGENT_KEYWORDS.catalogLayer, label: "CatalogLayerAgent" },
      { pattern: AGENT_KEYWORDS.layerInfo, label: "LayerInfoAgent" },
      { pattern: AGENT_KEYWORDS.scopedContent, label: "ContentSearchAgent" },
    ];
    for (const { pattern, label } of bailouts) {
      if (pattern.test(text)) {
        console.log(`[StacSearch] Skipping — ${label} territory.`);
        return { outputMessage: "" };
      }
    }

    // No STAC signal and no other agent match — bail out silently
    console.log("[StacSearch] Skipping — no STAC signal detected.");
    return { outputMessage: "" };
  }

  // STAC signal detected — pass through to LLM
  return {};
}
