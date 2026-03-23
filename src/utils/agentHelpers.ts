import {
  Annotation as ANNOTATION,
} from "@langchain/langgraph/web";

// ── Debug logging ───────────────────────────────────────────────────────────

const DEBUG = import.meta.env.DEV;

/** Log only in development mode. Use instead of console.log for non-error output. */
export const log = (...args: any[]) => {
  if (DEBUG) console.log("[ImageryAssistant]", ...args);
};

// ── Layer type constants ────────────────────────────────────────────────────

/** Layer types that require a 3D SceneView (runtime type strings from the SDK) */
export const REQUIRES_3D = new Set([
  "scene",
  "integrated-mesh",
  "integrated-mesh-3dtiles",
  "gaussian-splat",
  "point-cloud",
  "building-scene",
  "voxel",
  "dimension",
]);

/**
 * Check if a portal item type string represents a 3D-only layer.
 * Uses REQUIRES_3D as the source of truth, plus portal type name heuristics.
 */
export function is3DItemType(itemType: string): boolean {
  const lower = itemType.toLowerCase();
  // Check against canonical runtime types
  for (const t of REQUIRES_3D) {
    if (lower.includes(t)) return true;
  }
  // Portal type names use different conventions than SDK runtime types
  return (
    lower.includes("scene") ||
    lower.includes("3dtiles") ||
    lower.includes("gaussian") ||
    lower.includes("point cloud") ||
    lower.includes("building") ||
    lower.includes("voxel")
  );
}

// ── Agent keyword patterns for bailout checks ──────────────────────────────
// Each agent defines the keywords it owns. Other agents test against these
// to decide whether to bail out and let the owning agent handle the request.
// Centralized here so keyword changes only need to happen in one place.

export const AGENT_KEYWORDS = {
  imagery: /\b(stretch|std\s*dev|standard\s*deviation|min[\s-]*max|percent[\s-]*clip|histogram\s*equal|sigmoid|color\s*ramp|inferno|viridis|grayscale|ndvi|savi|ndwi|ndbi|ndsi|nbr|hillshade|slope|aspect|curvature|identify|pixel\s*values?|popup|screenshot|raster\s*function|processing\s*template|render|visualize|color\s*ir|false\s*color|spectral\s*index|band\s*arithmetic|imagery\s*tools|imagery\s*panel|list\s*templates?)\b/i,
  layerInfo: /\b(describe|info|information|details|metadata|fields|attributes|schema|properties|capabilities|statistics|stats|band\s*count|pixel\s*type|sublayers?|what\s*(is|are)|tell\s*me\s*about|query|filter|where\s*clause|select\b|create\s*pop|add\s*pop|set\s*pop|configure\s*pop|pop\s*up)\b/i,
  measurement: /\b(measure|measurement|measuring|ruler|elevation\s*profile|cross[- ]?section|distance|area|volume|cut\s*(?:and|&)?\s*fill|stockpile|excavat|earthwork|grading|how\s*far)\b/i,
  elevationOffset: /\b(fix|adjust|correct|offset|raise|lower|shift)\s*(the\s+)?(elevation|height|altitude|z[- ]?offset|vertical|floating|underground|mesh|layer)/i,
  elevationOffsetSimple: /\b(floating|underground|misaligned)\b/i,
  pointCloud: /\b(class[\s_-]?code|classification|filter\s*(point|class|ground|vegetation|building|water)|color\s*by\s*(elevation|intensity|class|rgb|return)|point\s*(?:cloud\s*)?size|point\s*(?:cloud\s*)?density|points?\s*per\s*inch|lidar|las\b|return[\s_-]?number|point\s*cloud\b|intensity\s*(modulat|modifi))/i,
  orientedImagery: /\b(oriented\s*imagery\s*viewer|oi\s*viewer|imagery\s*viewer|show\s*viewer|open\s*viewer|close\s*viewer|hide\s*viewer|coverage\s*footprint|image\s*gallery|navigation\s*tool|image\s*enhancement)\b/i,
  catalogLayer: /\b(catalog\s*(filter|browse|query|panel|items?|types?)|filter\s*catalog|item[\s_]*type\s*filter|cd_itemtype|open\s*catalog|close\s*catalog|clear\s*catalog)\b/i,
  swipe: /\b(compare|swipe|split|side\s*by\s*side|versus|vs\.?)\b/i,
  capabilities: /\b(what\s*can\s*you\s*do|capabilities|help me|what\s*tools|what\s*agents)\b/i,
  search: /\b(search|find|browse|discover|look\s*up)\b/i,
  scopedContent: /\b(my\s+content|my\s+org|living\s*atlas|arcgis\s*online)\b/i,
} as const;

// ── Message extraction ──────────────────────────────────────────────────────

/**
 * Extract the last user (HumanMessage) text from the agent state.
 * Handles all the LangChain message format variations.
 */
export function extractLastUserText(state: any): string {
  const rawMessages = Array.isArray(state?.messages) ? state.messages : [];
  const messages =
    rawMessages.length > 0 && Array.isArray(rawMessages[0])
      ? rawMessages.flat()
      : rawMessages;

  function isHuman(msg: any): boolean {
    if (msg?._getType?.() === "human") return true;
    if (msg?.constructor?.name === "HumanMessage") return true;
    const id = msg?.lc_id ?? msg?.id;
    if (Array.isArray(id) && id.some((s: any) => typeof s === "string" && s.includes("HumanMessage"))) return true;
    if (typeof msg?.lc_kwargs?.type === "string" && msg.lc_kwargs.type === "human") return true;
    return false;
  }

  function getContent(msg: any): string {
    if (typeof msg?.lc_kwargs?.content === "string") return msg.lc_kwargs.content.trim();
    if (typeof msg?.kwargs?.content === "string") return msg.kwargs.content.trim();
    if (typeof msg?.content === "string") return msg.content.trim();
    return "";
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    if (isHuman(msg)) {
      const content = getContent(msg);
      if (content) return content;
    }
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const content = getContent(messages[i]);
    if (content) return content;
  }
  return "";
}

// ── Layer matching ──────────────────────────────────────────────────────────

/**
 * Map of user-friendly type names to SDK runtime layer type strings.
 * Allows users to refer to layers by type (e.g., "the gaussian splat layer").
 */
const LAYER_TYPE_ALIASES: Record<string, string[]> = {
  "gaussian splat": ["gaussian-splat"],
  "splat": ["gaussian-splat"],
  "point cloud": ["point-cloud"],
  "lidar": ["point-cloud"],
  "imagery": ["imagery", "imagery-tile"],
  "image": ["imagery", "imagery-tile"],
  "feature": ["feature"],
  "scene": ["scene"],
  "integrated mesh": ["integrated-mesh", "integrated-mesh-3dtiles"],
  "mesh": ["integrated-mesh", "integrated-mesh-3dtiles"],
  "building": ["building-scene"],
  "voxel": ["voxel"],
  "oriented imagery": ["oriented-imagery"],
  "elevation": ["elevation"],
  "catalog": ["catalog"],
};

/**
 * Find a layer by title or by type reference.
 * Tries: exact title → substring title → type alias match.
 * When only one layer of a referenced type exists, returns it directly.
 */
export function findLayerByTitle(layers: any[], query: string): any | null {
  const q = query.toLowerCase();

  // 1. Exact title match
  const exact = layers.find((l: any) => (l.title || "").toLowerCase() === q);
  if (exact) return exact;

  // 2. Substring title match
  const sub = layers.find((l: any) => (l.title || "").toLowerCase().includes(q));
  if (sub) return sub;

  // 3. Type alias match — "the gaussian splat layer" → find by layer.type
  // Strip common filler words to isolate the type reference
  const stripped = q.replace(/\b(the|layer|layers|my|this|that|current|loaded|active)\b/g, "").trim();
  for (const [alias, types] of Object.entries(LAYER_TYPE_ALIASES)) {
    if (stripped.includes(alias)) {
      const matches = layers.filter((l: any) => types.includes(l.type));
      if (matches.length === 1) return matches[0];
      // If multiple, return the most recently added (last in array)
      if (matches.length > 1) return matches[matches.length - 1];
    }
  }

  return null;
}

// ── Agent state & registration ──────────────────────────────────────────────

/**
 * Create the standard agent state annotation with messages + outputMessage.
 */
export function createAgentState() {
  return ANNOTATION.Root({
    messages: ANNOTATION({
      reducer: (cur: any[] = [], update: any) => [...cur, update],
      default: () => [],
    }),
    outputMessage: ANNOTATION({
      reducer: (current: string = "", update: any) =>
        typeof update === "string" && update.trim()
          ? current
            ? `${current}\n\n${update}`
            : update
          : current,
      default: () => "",
    }),
  });
}

/**
 * Register an agent element on the arcgis-assistant DOM element.
 * Removes any existing agent with the same ID before adding.
 */
export function registerAgentElement(
  assistant: HTMLElement,
  agent: { id: string; name: string; description: string; createGraph: () => any; workspace?: any }
): void {
  const existing = assistant.querySelector(`[data-agent-id="${agent.id}"]`);
  if (existing) existing.remove();

  const agentEl = document.createElement("arcgis-assistant-agent") as any;
  agentEl.setAttribute("data-agent-id", agent.id);
  agentEl.agent = agent;
  assistant.appendChild(agentEl);
}

/** Format elapsed time from a performance.now() start timestamp. */
export function elapsed(startMs: number): string {
  return ((performance.now() - startMs) / 1000).toFixed(1);
}
