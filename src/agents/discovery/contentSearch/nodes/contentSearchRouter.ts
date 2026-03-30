import type { RunnableConfig } from "@langchain/core/runnables";
import { extractLastUserText, AGENT_KEYWORDS } from "../../../../utils/agentHelpers";
import { lastSearchResults, hasValidSearchResults } from "../tools/searchContent/core";
import { addResultsToMap } from "../tools/addResults/core";
import type { ContentSearchStateType } from "../state";

// ── Result extraction regex ──────────────────────────────────────────────────

/**
 * Detect "add result N", "add results 1-5", "add all results", "add all".
 * Returns null if no add-result pattern is found.
 */
function quickExtractAddResults(text: string): number[] | "all" | null {
  const lower = text.toLowerCase();

  // "add all results" / "add all" / "load all" / "add everything"
  if (
    /(?:add|load|open|show)\s+(?:all|every(?:thing)?)\s*(?:results?|items?|layers?)?/i.test(lower) ||
    /(?:add|load|open|show)\s+(?:results?|items?|layers?)\s*(?:all)/i.test(lower)
  ) {
    return "all";
  }

  // Unified parser: extract everything after the command verb, then parse
  // mixed formats like "1, 3-11", "1-5, 8, 10-12", "1 3 5", "1, 2 and 5-8"
  const afterVerb = text.match(
    /(?:add|load|open|show)\s+(?:results?|items?|layers?|#)?\s*([\d\s,\-\u2013\u2014andto]+)/i,
  );
  if (afterVerb) {
    const spec = afterVerb[1];
    const indices = new Set<number>();

    // Split on commas, "and", or whitespace (but not hyphens)
    const parts = spec.split(/[,\s]+(?:and\s+)?/).filter(Boolean);

    for (const part of parts) {
      // Range: "3-11", "3\u201311", "3\u201411"
      const rangeMatch = part.match(/^(\d+)\s*[-\u2013\u2014]\s*(\d+)$/);
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

  // "load the first/second/third"
  const ordinals: Record<string, number> = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10,
  };
  const ordMatch = text.match(
    /(?:add|load|open|show)\s+(?:the\s+)?(\w+)\s+(?:one|result|item|layer)/i,
  );
  if (ordMatch && ordinals[ordMatch[1].toLowerCase()]) {
    return [ordinals[ordMatch[1].toLowerCase()]];
  }

  return null;
}

// ── Router node ──────────────────────────────────────────────────────────────

/**
 * Fast-path handler for "add result N" patterns.
 * If the user text matches an add-result pattern, executes directly and
 * returns the result. Otherwise, passes through to the LLM node.
 *
 * Returns the state with outputMessage set if handled, or unchanged if not.
 */
export async function contentSearchRouter(
  state: ContentSearchStateType,
  _config?: RunnableConfig,
): Promise<Partial<ContentSearchStateType>> {
  const text = extractLastUserText(state);
  const quickAdd = quickExtractAddResults(text);

  // ── Bail out: save commands ──
  if (/\b(save)\s+(web\s*map|web\s*scene|map|scene)\b/i.test(text)) {
    console.log("[ContentSearch] Skipping — save command.");
    return { outputMessage: "" };
  }

  // ── Bail out if another agent owns this request ──
  if (quickAdd === null) {
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
      { pattern: AGENT_KEYWORDS.stac, label: "StacSearchAgent" },
      { pattern: AGENT_KEYWORDS.coordinate, label: "CoordinateHandler" },
    ];
    for (const { pattern, label } of bailouts) {
      if (pattern.test(text)) {
        console.log(`[ContentSearch] Skipping — ${label} territory.`);
        return { outputMessage: "" };
      }
    }

    // Not an add-result or bailout — pass through to LLM
    return {};
  }

  // Handle add-result request directly (no LLM call needed)
  if (!hasValidSearchResults()) {
    return {
      outputMessage:
        "No previous search results. Search for content first, then add results by number.",
    };
  }

  const addAll = quickAdd === "all";
  const indices = addAll ? [] : (quickAdd as number[]);

  const msg = await addResultsToMap({ indices, addAll });

  return { outputMessage: msg };
}
