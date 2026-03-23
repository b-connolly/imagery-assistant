import { StateGraph, START, END } from "@langchain/langgraph/web";
import {
  searchContentByScope,
  type SearchScope,
  type ScopedSearchResults,
  type PortalSearchResult,
} from "../utils/portalSearch";
import { createLayerFromUrl, createLayerFromItemId, isElevationService, handleElevationRouting } from "../utils/layerFactory";
import { getCurrentView, getCurrentViewType, requestViewSwitch, requestWebMapSwitch, requestWebSceneSwitch, onViewChange } from "../utils/viewManager";
import { REQUIRES_3D, extractLastUserText, createAgentState, registerAgentElement, elapsed, is3DItemType, AGENT_KEYWORDS } from "../utils/agentHelpers";
import { withTimeout } from "../utils/safeFetch";

// ── Cached search results for "add result N" follow-ups ──────────────────────
let lastSearchResults: ScopedSearchResults[] = [];

// Clear stale cached results when the map/view changes (e.g., user loads a different web map)
// Listener is app-scoped — registered once at module load, lives for the app lifetime.
onViewChange(() => {
  lastSearchResults = [];
});

// ── Result extraction helpers ────────────────────────────────────────────────

/**
 * Detect "add result N", "add results 1-5", "add all results", "add all".
 * Returns null if no add-result pattern is found.
 */
function quickExtractAddResults(text: string): number[] | "all" | null {
  const lower = text.toLowerCase();

  // "add all results" / "add all" / "load all" / "add everything"
  if (/(?:add|load|open|show)\s+(?:all|every(?:thing)?)\s*(?:results?|items?|layers?)?/i.test(lower) ||
      /(?:add|load|open|show)\s+(?:results?|items?|layers?)\s*(?:all)/i.test(lower)) {
    return "all";
  }

  // Unified parser: extract everything after the command verb, then parse
  // mixed formats like "1, 3-11", "1-5, 8, 10-12", "1 3 5", "1, 2 and 5-8"
  const afterVerb = text.match(
    /(?:add|load|open|show)\s+(?:results?|items?|layers?|#)?\s*([\d\s,\-–—andto]+)/i
  );
  if (afterVerb) {
    const spec = afterVerb[1];
    const indices = new Set<number>();

    // Split on commas, "and", or whitespace (but not hyphens)
    const parts = spec.split(/[,\s]+(?:and\s+)?/).filter(Boolean);

    for (const part of parts) {
      // Range: "3-11", "3–11", "3 to 11"
      const rangeMatch = part.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        if (start >= 1 && end >= start && end <= 200) {
          for (let i = start; i <= end; i++) indices.add(i);
        }
        continue;
      }
      // Single number
      const num = parseInt(part, 10);
      if (!isNaN(num) && num >= 1) {
        indices.add(num);
      }
    }

    if (indices.size > 0) return [...indices].sort((a, b) => a - b);
  }

  // "load the first/second/third one"
  const ordinals: Record<string, number> = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
    sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  };
  const ordMatch = text.match(
    /(?:add|load|open|show)\s+(?:the\s+)?(\w+)\s+(?:one|result|item|layer)/i
  );
  if (ordMatch && ordinals[ordMatch[1].toLowerCase()]) {
    return [ordinals[ordMatch[1].toLowerCase()]];
  }

  return null;
}

/**
 * Quick regex extraction for scope from user text.
 */
function quickExtractScope(text: string): SearchScope | null {
  const lower = text.toLowerCase();
  if (/\bmy\s+(content|items|layers|data)\b/.test(lower)) return "my-content";
  if (/\b(my\s+)?org(anization)?\s+(content|items|layers|data)\b/.test(lower)) return "my-org";
  if (/\bliving\s*atlas\b/.test(lower)) return "living-atlas";
  if (/\bagol\b|\barcgis\s*online\b/.test(lower)) return "agol";
  return null;
}

/**
 * Quick regex extraction for max results from user text.
 */
function quickExtractMaxResults(text: string): number | null {
  const lower = text.toLowerCase();
  if (/\ball\b/.test(lower)) return 50;
  const match = text.match(/\b(?:top\s+)?(\d+)\s*(?:results?|items?|layers?)?\b/i);
  if (match) {
    const n = parseInt(match[1], 10);
    if (n >= 1 && n <= 100) return n;
  }
  return null;
}

/**
 * Extract the search keyword by stripping command/scope words from user text.
 */
function quickExtractKeyword(text: string): string | null {
  const cleaned = text
    // Strip command verbs
    .replace(/\b(search|find|look\s*up|browse|show|list|get|return|give\s+me|add|load|open|display)\b/gi, "")
    // Strip scope phrases
    .replace(/\b(my\s+content|my\s+org(anization)?|living\s*atlas|agol|arcgis\s*online)\b/gi, "")
    // Strip generic nouns (keep "elevation" — it's a meaningful search term)
    .replace(/\b(layers?|results?|items?|data|services?|content)\b/gi, "")
    // Strip filler words
    .replace(/\b(for|in|from|the|a|an|me|and|or|related\s+to|about|regarding|on|with|to|of|now|where|is|are|it|that|this|map|scene|please|can|you|could|would|every(?:thing)?)\b/gi, "")
    // Strip count phrases
    .replace(/\b(all|top\s+\d+)\b/gi, "")
    // Strip punctuation
    .replace(/[,.:;!?'"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || null;
}

/**
 * Format search results as a readable numbered list.
 */
function formatResults(scopedResults: ScopedSearchResults[]): string {
  const lines: string[] = [];
  let globalIndex = 1;

  for (const { scope, results } of scopedResults) {
    lines.push(`**${scope}** (${results.length} result${results.length === 1 ? "" : "s"}):`);
    for (const r of results) {
      const snippet = r.snippet ? ` — ${r.snippet.slice(0, 80)}` : "";
      const elevTag = isElevationService(r) ? " 🏔️ Elevation" : "";
      lines.push(`  ${globalIndex}. ${r.title} (${r.type}${elevTag})${snippet}`);
      globalIndex++;
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Get the Nth result (1-based) from the flattened scoped results.
 */
function getNthResult(
  scopedResults: ScopedSearchResults[],
  n: number
): PortalSearchResult | null {
  let idx = 1;
  for (const { results } of scopedResults) {
    for (const r of results) {
      if (idx === n) return r;
      idx++;
    }
  }
  return null;
}

/**
 * Get all results flattened into a single array.
 */
function getAllResults(scopedResults: ScopedSearchResults[]): PortalSearchResult[] {
  return scopedResults.flatMap(({ results }) => results);
}

// is3DItemType is now imported from agentHelpers (single source of truth)

/**
 * Add multiple layers to the map. Switches to 3D if any layer requires it.
 * Returns a summary message for each layer.
 */
async function addMultipleResultsToMap(
  targets: PortalSearchResult[]
): Promise<string> {
  if (targets.length === 0) return "No results to add.";

  const t0 = performance.now();
  const messages: string[] = [];

  // Check if any target needs 3D
  const needs3D = targets.some((t) => is3DItemType(t.type));

  if (needs3D && getCurrentViewType() !== "3d") {
    console.log("[ContentSearch] Some layers require 3D, switching...");
    try {
      await requestViewSwitch("3d");
    } catch {
      // Continue in 2D — 3D layers will fail but 2D layers will still load
      messages.push("Could not switch to 3D view. 3D-only layers may fail to load.");
    }
  }

  const view = getCurrentView();
  if (!view?.map) return "No active map view. Please wait for the map to load.";

  // Load all layers concurrently
  const layerPromises = targets.map(async (target) => {
    const lt0 = performance.now();
    try {
      // Web Scenes and Web Maps are entire maps, not layers — load via view switch
      const typeLower = target.type.toLowerCase();
      if (typeLower === "web scene") {
        await requestWebSceneSwitch(target.itemId);
        const elapsedTime = elapsed(lt0);
        return `Opened Web Scene "${target.title}" (${elapsedTime}s)`;
      }
      if (typeLower === "web map") {
        await requestWebMapSwitch(target.itemId);
        const elapsedTime = elapsed(lt0);
        return `Opened Web Map "${target.title}" (${elapsedTime}s)`;
      }

      let layer: any;
      // Oriented Imagery layers must use createLayerFromItemId to get the correct
      // OrientedImageryLayer type — fromArcGISServerUrl misdetects them as FeatureLayer.
      // Check title, snippet, and type for any hint of oriented imagery.
      const oiText = `${target.type} ${target.title} ${target.snippet ?? ""}`;
      const isOI = /oriented\s*imagery/i.test(oiText);
      if (target.url && !isOI) {
        layer = await createLayerFromUrl(target.url, target.title);
      } else {
        layer = await createLayerFromItemId(target.itemId, target.title);
      }

      // If the SDK created an ElevationLayer (runtime type "elevation"),
      // route it to ground.layers instead of operational layers
      if (layer.type === "elevation") {
        const urlOrId = target.url ?? target.itemId;
        const result = await handleElevationRouting(urlOrId, target.title);
        const elapsedTime = elapsed(lt0);
        console.log("[ContentSearch] Elevation routing:", target.title, `(${elapsedTime}s)`);
        return `${result} (${elapsedTime}s)`;
      }

      // Skip 3D-only layers in 2D view
      if (REQUIRES_3D.has(layer.type) && getCurrentViewType() !== "3d") {
        return `Skipped "${target.title}" — requires 3D scene view.`;
      }

      view.map!.layers.add(layer);
      await withTimeout(layer.load(), 30000, `Load "${target.title}"`);

      // Zoom to the layer extent.
      try {
        let zoomTarget: any = null;
        // For queryable layers (Feature, OI sublayer, etc.), queryExtent gives the true data extent
        const queryableLayer = typeof layer.queryExtent === "function"
          ? layer
          // Group layers (OrientedImageryLayer): find a queryable sublayer
          : layer.layers?.toArray?.()?.find((sl: any) => typeof sl.queryExtent === "function") ?? null;
        if (queryableLayer) {
          try {
            if (queryableLayer.loadStatus !== "loaded" && typeof queryableLayer.load === "function") {
              await queryableLayer.load();
            }
            const result = await queryableLayer.queryExtent();
            zoomTarget = result?.extent;
          } catch { /* fall through */ }
        }
        // Fall back to fullExtent or layerView extent
        if (!zoomTarget) zoomTarget = layer.fullExtent;
        if (!zoomTarget) {
          try {
            const lv = await view.whenLayerView(layer);
            if (!lv?.fullExtent) await new Promise((r) => setTimeout(r, 500));
            zoomTarget = lv?.fullExtent || layer.fullExtent;
          } catch { /* continue */ }
        }
        const is3D = getCurrentViewType() === "3d";
        const goToParams = is3D && is3DItemType(target.type)
          ? { target: zoomTarget, tilt: 65 }
          : zoomTarget;
        await view.goTo(goToParams as any, { duration: 2000 });
      } catch { /* non-critical */ }

      const elapsedTime = elapsed(lt0);
      console.log("[ContentSearch] Added:", target.title, layer.type, `(${elapsedTime}s)`);
      return `Loaded "${target.title}" (${elapsedTime}s)`;
    } catch (err: any) {
      console.error("[ContentSearch] Failed to add:", target.title, err);
      return `Failed "${target.title}": ${err?.message ?? String(err)}`;
    }
  });

  const results = await Promise.all(layerPromises);
  messages.push(...results);


  const totalElapsed = elapsed(t0);
  messages.push(`\nAdded ${targets.length} layer${targets.length === 1 ? "" : "s"} in ${totalElapsed}s total.`);
  return messages.join("\n");
}

// ── Agent registration ───────────────────────────────────────────────────────

export function registerContentSearchAgent(assistant: HTMLElement) {
  const agentId = "content-search-agent";

  const createGraph = () => {
    const state = createAgentState();

    async function contentSearchNode(s: any) {
      const text = extractLastUserText(s);
      console.log("[ContentSearch] Starting. User text:", text);

      // ── Bail out: defer to other agents unless this is explicitly a search ──
      // ContentSearchAgent should ONLY handle portal searches. If the user isn't
      // explicitly searching/finding/browsing, check if the request belongs elsewhere.
      const isSearchRequest = AGENT_KEYWORDS.search.test(text);

      if (!isSearchRequest) {
        const bailoutChecks = [
          { pattern: AGENT_KEYWORDS.imagery, label: "ImageryAnalysisAgent" },
          { pattern: AGENT_KEYWORDS.layerInfo, label: "LayerInfoAgent" },
          { pattern: AGENT_KEYWORDS.measurement, label: "MeasurementAgent" },
          { pattern: AGENT_KEYWORDS.elevationOffset, label: "ElevationOffsetAgent" },
          { pattern: AGENT_KEYWORDS.elevationOffsetSimple, label: "ElevationOffsetAgent" },
          { pattern: AGENT_KEYWORDS.pointCloud, label: "PointCloudAgent" },
          { pattern: AGENT_KEYWORDS.swipe, label: "SwipeAgent" },
          { pattern: AGENT_KEYWORDS.orientedImagery, label: "OrientedImageryAgent" },
          { pattern: AGENT_KEYWORDS.capabilities, label: "AllCapabilitiesAgent" },
        ];
        for (const { pattern, label } of bailoutChecks) {
          if (pattern.test(text)) {
            console.log(`[ContentSearch] Skipping — ${label} territory.`);
            return { outputMessage: "" };
          }
        }

        // LoadLayerAgent: remove/delete/zoom commands (not "add" since that overlaps with search results)
        if (/\b(remove|delete|drop|clear|hide)\s*(the\s+)?(layer|all|map)/i.test(text)) {
          console.log("[ContentSearch] Skipping — LoadLayerAgent remove territory.");
          return { outputMessage: "" };
        }
        if (/\b(zoom\s*to|fly\s*to|go\s*to|focus\s*on)\b/i.test(text) && !/\b(search|find|browse)\b/i.test(text)) {
          console.log("[ContentSearch] Skipping — LoadLayerAgent zoom territory.");
          return { outputMessage: "" };
        }
      }

      // ── Fast path: "add result N" / "add results 1-5" / "add all" ─────
      const quickAdd = quickExtractAddResults(text);
      if (quickAdd !== null) {
        if (lastSearchResults.length === 0) {
          return {
            outputMessage:
              "No previous search results. Search for content first, then add results by number.",
          };
        }

        const allFlat = getAllResults(lastSearchResults);
        const total = allFlat.length;

        if (quickAdd === "all") {
          console.log("[ContentSearch] Adding all", total, "cached results");
          const msg = await addMultipleResultsToMap(allFlat);
          return { outputMessage: msg };
        }

        // Array of indices
        const indices = quickAdd as number[];
        const targets: PortalSearchResult[] = [];
        const missing: number[] = [];

        for (const idx of indices) {
          const result = getNthResult(lastSearchResults, idx);
          if (result) {
            targets.push(result);
          } else {
            missing.push(idx);
          }
        }

        if (targets.length === 0) {
          return {
            outputMessage: `No valid results found for ${indices.join(", ")}. The last search had ${total} results (1–${total}).`,
          };
        }

        let msg = await addMultipleResultsToMap(targets);

        if (missing.length > 0) {
          msg += `\n\nNote: Result${missing.length > 1 ? "s" : ""} ${missing.join(", ")} not found (search had ${total} results).`;
        }

        return { outputMessage: msg };
      }

      // ── Extract intent via fast regex (no LLM call) ─────────────────
      const quickScope = quickExtractScope(text);
      const quickMax = quickExtractMaxResults(text);
      const scope: SearchScope = quickScope ?? "all";
      const maxResults = quickMax ?? 10;
      // Detect "add to map" intent
      const hasExplicitAdd = /\b(add\s+to\s+(the\s+)?map|and\s+(add|load)|add\s+it|load\s+it)\b/i.test(text);
      const hasAddVerb = /\b(add|load|open)\b/i.test(text);
      const hasSearchVerb = /\b(search|find|browse|list|discover)\b/i.test(text);
      const wantsAll = /\ball\b/i.test(text);
      const addToMap = hasExplicitAdd || (hasAddVerb && !hasSearchVerb);

      // Extract keyword by stripping known command words.
      // If nothing remains, use "*" to browse top/popular results.
      const keyword: string = quickExtractKeyword(text) ?? "*";

      // ── Detect type-specific filtering ──
      // Maps user phrases to the ArcGIS portal item types they expect.
      // Order matters — more specific patterns first.
      // Maps user phrases to ArcGIS portal item types and optional typekeywords.
      // Some layer sub-types (Point Cloud, Building, Voxel) are stored as "Scene Service"
      // and distinguished only by typeKeywords — the portal search API supports this natively.
      interface TypeFilter {
        itemTypes: string[];
        typeKeywords?: string; // e.g., 'typekeywords:"Point Cloud"'
        stripKeyword?: boolean; // if true, use wildcard instead of user keyword for search text
      }
      const typeFilterMap: [RegExp, TypeFilter][] = [
        // Imagery & raster (specific first)
        [/\boriented\s+imagery/i, { itemTypes: ["Feature Service"], typeKeywords: 'typekeywords:"OrientedImageryLayer"', stripKeyword: true }],
        [/\bcatalog\s*(layer|service)?/i, { itemTypes: ["Feature Service"], typeKeywords: 'typekeywords:"CatalogLayer"', stripKeyword: true }],
        [/\bvideo\s+(service|layer)/i, { itemTypes: ["Video Service"] }],
        [/\bmedia\s+layer/i, { itemTypes: ["Media Layer"] }],
        [/\belevation\s+(service|layer|surface|terrain)/i, { itemTypes: ["Image Service", "Imagery Layer", "Imagery Tile Layer"] }],
        [/\b(imagery|image)\s+(service|layer|tile)/i, { itemTypes: ["Image Service", "Imagery Layer", "Imagery Tile Layer"] }],
        // 3D scene — use typekeywords for sub-types stored as "Scene Service"
        [/\bgaussian\s*splat/i, { itemTypes: ["3DTiles Service"], typeKeywords: 'typekeywords:"GaussianSplat"', stripKeyword: true }],
        [/\b(3d\s*tiles?)\s*(service|layer)?/i, { itemTypes: ["3DTiles Service"], stripKeyword: true }],
        [/\bintegrated\s*mesh\s*(service|layer)?/i, { itemTypes: ["Scene Service", "3DTiles Service"], typeKeywords: 'typekeywords:"IntegratedMesh"', stripKeyword: true }],
        [/\bpoint\s*cloud\s*(service|layer)?/i, { itemTypes: ["Scene Service"], typeKeywords: 'typekeywords:"PointCloud"', stripKeyword: true }],
        [/\bbuilding\s*(scene)?\s*(service|layer)?/i, { itemTypes: ["Scene Service"], typeKeywords: 'typekeywords:"Building"', stripKeyword: true }],
        [/\bvoxel\s*(service|layer)?/i, { itemTypes: ["Scene Service"], typeKeywords: 'typekeywords:"Voxel"', stripKeyword: true }],
        [/\bweb\s*scene/i, { itemTypes: ["Web Scene"], stripKeyword: true }],
        [/\bweb\s*map/i, { itemTypes: ["Web Map"], stripKeyword: true }],
        [/\bscene\s+(service|layer)/i, { itemTypes: ["Scene Service", "Scene Layer"] }],
        // Feature & vector
        [/\bfeature\s+(service|layer)/i, { itemTypes: ["Feature Service", "Feature Layer"] }],
        [/\bgeojson\b/i, { itemTypes: ["GeoJSON"] }],
        [/\bcsv\b/i, { itemTypes: ["CSV"] }],
        [/\bkml\b/i, { itemTypes: ["KML"] }],
        [/\bparquet\b/i, { itemTypes: ["Parquet"] }],
        [/\bgeo\s*rss\b/i, { itemTypes: ["GeoRSS"] }],
        [/\b(ogc\s*feature|ogc\s*api)/i, { itemTypes: ["OGCFeatureServer"] }],
        [/\bstream\s+(service|layer)/i, { itemTypes: ["Stream Service"] }],
        [/\b(wfs|web\s*feature\s*service)\b/i, { itemTypes: ["WFS"] }],
        // Tile & map
        [/\bvector\s*tile/i, { itemTypes: ["Vector Tile Service"] }],
        [/\b(tile|tiled)\s+(service|layer)/i, { itemTypes: ["Tile Service", "Vector Tile Service"] }],
        [/\bmap\s+(service|image)/i, { itemTypes: ["Map Service"] }],
        [/\b(wms|web\s*map\s*service)\b/i, { itemTypes: ["WMS"] }],
        [/\b(wmts)\b/i, { itemTypes: ["WMTS"] }],
        [/\bwcs\b/i, { itemTypes: ["WCS"] }],
      ];

      let matchedTypeFilter: TypeFilter | null = null;
      for (const [pattern, filter] of typeFilterMap) {
        if (pattern.test(text)) {
          matchedTypeFilter = filter;
          break;
        }
      }

      const wantsElevationOnly = /\belevation\s+(service|layer|surface|terrain)/i.test(text);

      // When a type filter uses typekeywords and stripKeyword, use wildcard for text
      // so we rely on the portal's native type/typekeyword filtering instead of keyword matching.
      // Exception: if addToMap is true and the original keyword has a specific name beyond the
      // type filter match, keep it for exact matching (e.g., "add Alcatraz Island Gaussian Splat").
      let searchKeyword: string;
      if (matchedTypeFilter?.stripKeyword) {
        // Check if there's a meaningful name left after stripping the type-filter pattern
        const nameOnly = keyword.replace(matchedTypeFilter ? new RegExp(
          Object.keys(matchedTypeFilter).length > 0 ? "\\b(gaussian\\s*splat|point\\s*cloud|integrated\\s*mesh|building|voxel|oriented\\s*imagery|catalog|web\\s*scene|web\\s*map|3d\\s*tiles?)\\b" : "$^", "gi"
        ) : /$^/, "").trim();
        if (addToMap && nameOnly.length > 2) {
          searchKeyword = `title:"${nameOnly}"`;
        } else {
          searchKeyword = "*";
        }
      } else {
        searchKeyword = keyword;
        // If the keyword looks like a specific layer name (3+ words), use exact title match
        if (addToMap && searchKeyword.split(/\s+/).length >= 3) {
          searchKeyword = `title:"${searchKeyword}"`;
        }
      }

      console.log("[ContentSearch] Searching:", {
        keyword: searchKeyword, scope, maxResults, addToMap, wantsAll,
        typeFilter: matchedTypeFilter ? matchedTypeFilter.itemTypes : "all",
        typeKeywords: matchedTypeFilter?.typeKeywords ?? "none",
      });

      // ── Search ────────────────────────────────────────────────────────
      let scopedResults: ScopedSearchResults[];
      try {
        scopedResults = await searchContentByScope(
          searchKeyword,
          scope,
          maxResults,
          matchedTypeFilter?.typeKeywords,
          matchedTypeFilter?.itemTypes
        );
      } catch (err: any) {
        console.error("[ContentSearch] Search failed:", err);
        return {
          outputMessage: `Search failed: ${err?.message ?? String(err)}`,
        };
      }

      // Post-filter by requested type (client-side, for types without typekeywords support)
      if (matchedTypeFilter && !matchedTypeFilter.typeKeywords) {
        const requestedTypes = new Set(matchedTypeFilter.itemTypes);
        const unfilteredResults = scopedResults;
        if (wantsElevationOnly) {
          scopedResults = scopedResults
            .map((s) => ({
              ...s,
              results: s.results.filter((r) => isElevationService(r)),
            }))
            .filter((s) => s.results.length > 0);
        } else {
          scopedResults = scopedResults
            .map((s) => ({
              ...s,
              results: s.results.filter((r) => requestedTypes.has(r.type)),
            }))
            .filter((s) => s.results.length > 0);
        }

        // Fallback: if type filter removed everything but unfiltered had results,
        // show unfiltered results instead (the type name may not match exactly).
        const filteredTotal = scopedResults.reduce((sum, s) => sum + s.results.length, 0);
        const unfilteredTotal = unfilteredResults.reduce((sum, s) => sum + s.results.length, 0);
        if (filteredTotal === 0 && unfilteredTotal > 0) {
          const actualTypes = new Set(unfilteredResults.flatMap((s) => s.results.map((r) => r.type)));
          console.log("[ContentSearch] Type filter removed all results. Actual types in results:", [...actualTypes]);
          scopedResults = unfilteredResults;
        }
      }

      // Cache results for follow-up "add result N" requests
      lastSearchResults = scopedResults;

      const totalResults = scopedResults.reduce((sum, s) => sum + s.results.length, 0);
      if (totalResults === 0) {
        const scopeLabel = scope === "all" ? "any source" : scope.replace("-", " ");
        const termLabel = keyword === "*" ? "browsing" : `"${keyword}"`;
        return {
          outputMessage:
            `No results found ${keyword === "*" ? "in" : "for " + termLabel + " in"} ${scopeLabel}. ` +
            "Try a different search term or broaden your scope.",
        };
      }

      // ── If addToMap + wantsAll, load ALL results ─────────────────────
      if (addToMap && wantsAll) {
        const allFlat = getAllResults(scopedResults);
        console.log("[ContentSearch] Adding all", allFlat.length, "results for:", keyword);
        const msg = await addMultipleResultsToMap(allFlat);
        return { outputMessage: msg };
      }

      // ── If addToMap (but not "all"), load the top result ─────────────
      if (addToMap) {
        const target = getNthResult(scopedResults, 1);
        if (!target) {
          return { outputMessage: `No results found to add for "${keyword}".` };
        }
        const msg = await addMultipleResultsToMap([target]);
        return { outputMessage: msg };
      }

      // ── Otherwise, list results ────────────────────────────────────────
      const output: string[] = [];
      const heading = keyword === "*"
        ? `Top ${totalResults} result${totalResults === 1 ? "" : "s"}:\n`
        : `Found ${totalResults} result${totalResults === 1 ? "" : "s"} for "${keyword}":\n`;
      output.push(heading);
      output.push(formatResults(scopedResults));
      output.push(
        'To add results, say "add result 1", "add results 1-5", or "add all results".'
      );

      return { outputMessage: output.join("\n") };
    }

    return new StateGraph(state)
      .addNode("contentSearchNode", contentSearchNode)
      .addEdge(START, "contentSearchNode")
      .addEdge("contentSearchNode", END);
  };

  registerAgentElement(assistant, {
    id: agentId,
    name: "Search Content",
    description:
      "Searches for layers and data across multiple ArcGIS sources: the user's own content (My Content), " +
      "their organization's content, ArcGIS Online (public), and Esri's Living Atlas. " +
      "Returns a list of matching results that can be added to the map. " +
      "Use when the user wants to search, find, browse, or discover layers, datasets, or content. " +
      "Also handles adding search results: 'add result 3', 'add results 1-10', 'add all results'. " +
      "Supports 'from my content, add all layers related to X' to search and add all matches. " +
      "Supports scoped searches like 'search my content for thermal' or 'find elevation in Living Atlas'. " +
      "Supports 'find all layers about X' to return more results, or 'top 10' for specific counts. " +
      "Do NOT use for loading a layer from a direct URL or item ID — use the Load Layer agent for that.",
    createGraph,
  });
}
