import type { RunnableConfig } from "@langchain/core/runnables";
import { extractLastUserText, AGENT_KEYWORDS } from "../../../../utils/agentHelpers";
import {
  getCurrentView,
  getCurrentViewType,
  requestViewSwitch,
} from "../../../../utils/viewManager";
import { removeLayer, extractRemoveLayerName } from "../tools/removeLayer/core";
import { zoomToLayer, extractZoomTarget } from "../tools/zoomToLayer/core";
import { geocodePlace } from "../tools/geocodePlace/core";
import { tryLoadWebMapOrScene } from "../tools/loadLayer/core";
import type { LoadLayerStateType } from "../state";

// ── Router node ──────────────────────────────────────────────────────────────

/**
 * Fast-path handler for remove, zoom, view switch, and bailout patterns.
 * If the user text matches a fast-path pattern, executes directly and
 * returns the result. Otherwise, passes through to the LLM node.
 */
export async function loadLayerRouter(
  state: LoadLayerStateType,
  _config?: RunnableConfig,
): Promise<Partial<LoadLayerStateType>> {
  const text = extractLastUserText(state);
  console.log("[LoadLayer] Router processing:", text);

  // ── View switching: 2D / 3D ────────────────────────────────────────
  const switchTo3D =
    /\b(switch|change|toggle|go)\s*(to\s*)?(3d|scene|three\s*d)\b/i.test(text);
  const switchTo2D =
    /\b(switch|change|toggle|go)\s*(to\s*)?(2d|map\s*view|two\s*d)\b/i.test(text);

  if (switchTo3D || switchTo2D) {
    const targetType = switchTo3D ? "3d" : "2d";
    if (getCurrentViewType() === targetType) {
      return { outputMessage: `Already in ${targetType.toUpperCase()} view.`, routerHandled: true };
    }
    try {
      await requestViewSwitch(targetType);
      return {
        outputMessage: `Switched to ${targetType.toUpperCase()} view.`,
        routerHandled: true,
      };
    } catch (err) {
      console.warn("[LoadLayerRouter] View switch failed:", err);
      return {
        outputMessage: `Failed to switch to ${targetType.toUpperCase()}. Please use the 2D/3D toggle.`,
        routerHandled: true,
      };
    }
  }

  // ── Remove / delete layer ──────────────────────────────────────────
  const removeMatch = text.match(
    /\b(?:remove|delete|drop|clear|hide|take\s+off|get\s+rid\s+of)\b/i
  );
  if (removeMatch) {
    // "remove all layers"
    if (/\ball\s*(layers?|data)?\b/i.test(text)) {
      const msg = await removeLayer({ removeAll: true });
      return { outputMessage: msg, routerHandled: true };
    }

    // Try to match a specific layer by name
    const stripped = extractRemoveLayerName(text);
    const msg = await removeLayer({ layerName: stripped, removeAll: false });
    return { outputMessage: msg, routerHandled: true };
  }

  // ── Zoom to layer / place ──────────────────────────────────────────
  const zoomMatch = text.match(
    /\b(?:zoom\s+to|fly\s+to|go\s+to|focus\s+on|extent\s+of|zoom\s+(?:in\s+)?(?:on|to))\b/i
  );
  if (zoomMatch && !/\b(load|add|open|display)\b/i.test(text)) {
    const activeView = getCurrentView();
    if (!activeView?.map) {
      return { outputMessage: "No active map view.", routerHandled: true };
    }

    const stripped = extractZoomTarget(text);
    const result = await zoomToLayer({ layerName: stripped });

    // If zoomToLayer found a layer, return its result
    if (result !== null) {
      return { outputMessage: result, routerHandled: true };
    }

    // No layer matched — geocode as a place name (e.g., "zoom to Phoenix")
    const geocodeResult = await geocodePlace({
      placeName:
        stripped ||
        text
          .replace(
            /\b(zoom|go|fly|navigate)\s*(to|at|in)?\s*/gi,
            ""
          )
          .trim(),
    });
    return { outputMessage: geocodeResult, routerHandled: true };
  }

  // ── Web Map / Web Scene by name ────────────────────────────────────
  const webMapResult = await tryLoadWebMapOrScene(text);
  if (webMapResult !== null) {
    return { outputMessage: webMapResult, routerHandled: true };
  }

  // ── "add result N" bailout → ContentSearch handles ─────────────────
  if (
    /(?:add|load|open|show)\s+(?:result|results|#|number|item)?\s*\d+/i.test(text) ||
    /(?:add|load|open|show)\s+(?:all|everything)\s*(?:results?|items?|layers?)?/i.test(text) ||
    /(?:add|load|open|show)\s+(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:one|result|item|layer)/i.test(text)
  ) {
    console.log("[LoadLayer] Skipping — 'add result N' for ContentSearchAgent.");
    return { outputMessage: "", routerHandled: true };
  }

  // ── Scoped content requests → ContentSearch ────────────────────────
  if (
    AGENT_KEYWORDS.scopedContent.test(text) ||
    /\b(search|find|browse|discover)\s+(for\s+)?(layers?|items?|content|data|services?)\b/i.test(text)
  ) {
    console.log("[LoadLayer] Skipping — scoped content search for ContentSearchAgent.");
    return { outputMessage: "", routerHandled: true };
  }

  // ── Bail out: save commands belong to the app UI, not load agent ──
  if (/\b(save)\s+(web\s*map|web\s*scene|map|scene)\b/i.test(text)) {
    console.log("[LoadLayer] Skipping — save command.");
    return { outputMessage: "", routerHandled: true };
  }

  // ── Pre-compute flags for bailout checks ──────────────────────────
  const hasUrl = /(https?:\/\/)/i.test(text);
  const hasItemId = /\b[0-9a-f]{32}\b/i.test(text);
  const hasDirectRef = hasUrl || hasItemId;

  if (!hasDirectRef) {
    // ── Agent keyword bailouts ──────────────────────────────────────
    const bailoutChecks = [
      { pattern: AGENT_KEYWORDS.layerInfo, label: "LayerInfoAgent" },
      { pattern: AGENT_KEYWORDS.measurement, label: "MeasurementAgent" },
      { pattern: AGENT_KEYWORDS.imagery, label: "ImageryAnalysisAgent" },
      { pattern: AGENT_KEYWORDS.pointCloud, label: "PointCloudAgent" },
      { pattern: AGENT_KEYWORDS.elevationOffset, label: "ElevationOffsetAgent" },
      { pattern: AGENT_KEYWORDS.elevationOffsetSimple, label: "ElevationOffsetAgent" },
      { pattern: AGENT_KEYWORDS.swipe, label: "SwipeAgent" },
      { pattern: AGENT_KEYWORDS.orientedImagery, label: "OrientedImageryAgent" },
      { pattern: AGENT_KEYWORDS.catalogLayer, label: "CatalogLayerAgent" },
      { pattern: AGENT_KEYWORDS.capabilities, label: "AllCapabilitiesAgent" },
      { pattern: AGENT_KEYWORDS.stac, label: "StacSearchAgent" },
      { pattern: AGENT_KEYWORDS.coordinate, label: "CoordinateHandler" },
    ];
    for (const { pattern, label } of bailoutChecks) {
      if (pattern.test(text)) {
        console.log(`[LoadLayer] Skipping — ${label} territory.`);
        return { outputMessage: "", routerHandled: true };
      }
    }

    // Generic catch-all: no URL/ID and no load verb, but has offset/analysis keywords
    const hasLoadVerb = /\b(load|open|show|display)\b/i.test(text);
    const hasOffsetKeyword =
      /\b(offset|elevation|stretch|raster|ndvi|hillshade|slope|aspect|fix|align|floating)\b/i.test(text);
    const hasNumberWithUnit =
      /\d+(?:\.\d+)?\s*(?:m\b|meters?\b|ft\b|feet\b|')/i.test(text);

    if (!hasLoadVerb && (hasOffsetKeyword || hasNumberWithUnit)) {
      console.log("[LoadLayer] Skipping — no URL/ID/load-verb, looks like offset/adjustment request.");
      return { outputMessage: "", routerHandled: true };
    }
  }

  // ── No fast-path matched — pass through to LLM node ────────────────
  return {};
}
