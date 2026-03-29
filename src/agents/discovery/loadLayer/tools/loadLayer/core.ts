import {
  createLayerFromUrl,
  createLayerFromItemId,
  handleElevationRouting,
} from "../../../../../utils/layerFactory";
import {
  searchAllItems,
  searchWebMaps,
  searchWebScenes,
  getPortalItemUrl,
} from "../../../../../utils/portalSearch";
import {
  getCurrentView,
  getCurrentViewType,
  requestViewSwitch,
  requestWebMapSwitch,
  requestWebSceneSwitch,
} from "../../../../../utils/viewManager";
import ImageryLayer from "@arcgis/core/layers/ImageryLayer";
import {
  applyStretch,
  applyServerTemplate,
  getServerTemplates,
  type StretchType,
} from "../../../../../utils/rasterFunctions";
import { REQUIRES_3D, elapsed } from "../../../../../utils/agentHelpers";
import { withTimeout } from "../../../../../utils/safeFetch";
import { zoomToLayerExtent } from "../zoomToLayer/core";

// ── Quick intent extraction ──────────────────────────────────────────────────

/**
 * Fast regex-based extraction of URL or item ID from user text.
 * Bypasses the LLM call for obvious inputs.
 */
export function quickExtractIntent(text: string): {
  keyword: string | null;
  itemId: string | null;
  serviceUrl: string | null;
} | null {
  const urlMatch = text.match(/(https?:\/\/[^\s]+)/i);
  if (urlMatch) {
    return { keyword: null, itemId: null, serviceUrl: urlMatch[1] };
  }

  const idMatch = text.match(/\b([0-9a-f]{32})\b/i);
  if (idMatch) {
    return { keyword: null, itemId: idMatch[1], serviceUrl: null };
  }

  return null;
}

// ── Web Map / Web Scene loading ──────────────────────────────────────────────

/**
 * Detect and load a Web Map or Web Scene by name from user text.
 * Returns a result message, or null if the text doesn't match a web map/scene request.
 */
export async function tryLoadWebMapOrScene(text: string): Promise<string | null> {
  const isSceneRequest =
    /\b(web\s*scene|scene\s+(?:titled?|named?|called)|3d\s+(?:map|scene))\b/i.test(text);
  const isMapRequest =
    /\b(web\s*map|map\s+(?:titled?|named?|called)|2d\s+map)\b/i.test(text);
  const hasLoadVerb =
    /\b(?:load|open|show|display|switch\s+to|use)\b/i.test(text);

  if (!(isSceneRequest || isMapRequest) || !(hasLoadVerb || isSceneRequest || isMapRequest)) {
    return null;
  }

  const t0 = performance.now();

  // Extract the item name — strip action verbs and type keywords
  const itemName = text
    .replace(
      /\b(load|open|show|display|switch\s+to|use|the|a|my|web\s*map|web\s*scene|map|scene|2d|3d|titled?|named?|called)\b/gi,
      ""
    )
    .trim();

  if (!itemName) {
    return `Please specify the name of the ${isSceneRequest ? "web scene" : "web map"} to load.`;
  }

  const typeLabel = isSceneRequest ? "web scene" : "web map";
  console.log(`[LoadLayer] Searching for ${typeLabel}:`, itemName);

  try {
    const results = isSceneRequest
      ? await searchWebScenes(itemName, 5)
      : await searchWebMaps(itemName, 5);

    if (results.length === 0) {
      return `No ${typeLabel}s found matching "${itemName}".`;
    }

    // Try exact title match first, then substring, then first result
    const nameLower = itemName.toLowerCase();
    const best =
      results.find((r) => r.title.toLowerCase() === nameLower) ||
      results.find((r) => r.title.toLowerCase().includes(nameLower)) ||
      results[0];

    console.log(`[LoadLayer] Loading ${typeLabel}:`, best.title, best.itemId);

    if (isSceneRequest) {
      await requestWebSceneSwitch(best.itemId);
    } else {
      await requestWebMapSwitch(best.itemId);
    }

    const elapsedTime = elapsed(t0);
    return `Loaded ${typeLabel} "${best.title}" in ${elapsedTime}s.`;
  } catch (err: any) {
    console.error(`[LoadLayer] ${typeLabel} load failed:`, err);
    return `Failed to load ${typeLabel}: ${err?.message ?? String(err)}`;
  }
}

// ── Main layer loading ───────────────────────────────────────────────────────

/**
 * Load a layer from a URL, item ID, or keyword search, then add it to the map.
 * Handles elevation routing, 3D switch, post-load imagery settings, and zoom.
 */
export async function loadLayer(
  params: {
    keyword?: string;
    itemId?: string;
    serviceUrl?: string;
  },
  userText: string
): Promise<string> {
  const t0 = performance.now();
  const view = getCurrentView();
  if (!view) {
    return "No active map or scene view. Please wait for the view to load.";
  }

  let layer: any;
  let displayName: string;

  try {
    if (params.serviceUrl) {
      console.log("[LoadLayer] Creating layer from URL:", params.serviceUrl);
      layer = await createLayerFromUrl(params.serviceUrl);
      displayName = layer.title || params.serviceUrl;
    } else if (params.itemId) {
      // Check if the item is a Web Map or Web Scene before trying to create a layer
      console.log("[LoadLayer] Looking up item type for ID:", params.itemId);
      const itemInfo = await getPortalItemUrl(params.itemId);
      if (itemInfo && itemInfo.type === "Web Map") {
        console.log("[LoadLayer] Item is a Web Map, switching...");
        await requestWebMapSwitch(params.itemId);
        const elapsedTime = elapsed(t0);
        return `Loaded web map "${itemInfo.title}" in ${elapsedTime}s.`;
      }
      if (itemInfo && itemInfo.type === "Web Scene") {
        console.log("[LoadLayer] Item is a Web Scene, switching...");
        await requestWebSceneSwitch(params.itemId);
        const elapsedTime = elapsed(t0);
        return `Loaded web scene "${itemInfo.title}" in ${elapsedTime}s.`;
      }

      console.log("[LoadLayer] Creating layer from item ID:", params.itemId);
      layer = await createLayerFromItemId(params.itemId);
      displayName = layer.title || params.itemId;
    } else if (params.keyword) {
      console.log("[LoadLayer] Searching portal for:", params.keyword);
      const results = await searchAllItems(params.keyword, 5);
      if (results.length === 0) {
        return `No layers found matching "${params.keyword}". Try a different search term or provide a direct URL.`;
      }

      const best = results[0];
      console.log(
        "[LoadLayer] Best search result:",
        best.title,
        best.type,
        best.url
      );

      if (best.url) {
        layer = await createLayerFromUrl(best.url, best.title);
      } else {
        layer = await createLayerFromItemId(best.itemId, best.title);
      }
      displayName = best.title;
    } else {
      return "Please provide a layer name, item ID, or service URL to load a layer.";
    }
  } catch (err: any) {
    console.error("[LoadLayer] Layer creation failed:", err);
    return `Failed to create layer: ${err?.message ?? String(err)}`;
  }

  // ── Elevation handling ──────────────────────────────────────────
  const userWantsElevation =
    /\b(as\s*terrain|as\s*elevation|ground\s*surface|elevation\s*(surface|source)|add\s*to\s*ground|terrain\s*layer)\b/i.test(
      userText
    );
  const isElevationLayer = layer.type === "elevation";

  if (isElevationLayer || (userWantsElevation && /^imagery/.test(layer.type))) {
    const urlOrId = params.serviceUrl ?? params.itemId ?? "";
    const result = await handleElevationRouting(urlOrId, displayName);
    const elapsedTime = elapsed(t0);
    return `${result} (${elapsedTime}s)`;
  }

  // ── Ensure correct view type ──────────────────────────────────────
  if (REQUIRES_3D.has(layer.type) && getCurrentViewType() !== "3d") {
    console.log(
      "[LoadLayer] Layer type",
      layer.type,
      "requires 3D. Switching..."
    );
    try {
      await requestViewSwitch("3d");
    } catch {
      return (
        `Layer "${displayName}" requires a 3D scene view. ` +
        "Please switch to 3D using the toggle, then ask me again."
      );
    }
  }

  // ── Add to map ────────────────────────────────────────────────────
  try {
    const activeView = getCurrentView();
    if (!activeView?.map) {
      return "View not ready after switch. Please try again.";
    }
    activeView.map.layers.add(layer);
    console.log("[LoadLayer] Layer added, loading...");

    await withTimeout(layer.load(), 30000, `Load "${displayName}"`);
    console.log("[LoadLayer] Layer loaded. Type:", layer.type);

    // Zoom to layer extent
    await zoomToLayerExtent(activeView, layer).catch(() => {
      /* best-effort zoom */
    });

    const elapsedTime = elapsed(t0);
    const results: string[] = [`Loaded "${displayName}" in ${elapsedTime}s.`];

    // ── 3D layer post-load: elevation offset ─────────────────────
    if (REQUIRES_3D.has(layer.type)) {
      const numMatch = userText.match(
        /(-?\d+(?:\.\d+)?)\s*(?:m\b|meters?\b|ft\b|feet\b|')/i
      );
      let offsetValue: number | null = null;
      if (
        numMatch &&
        /offset|elevation|height|raise|lift|add|subtract|lower|drop/i.test(
          userText
        )
      ) {
        offsetValue = parseFloat(numMatch[1]);
        const unitPart = numMatch[0].toLowerCase();
        if (/ft|feet|'/.test(unitPart)) offsetValue *= 0.3048;
        if (/subtract|lower|drop|minus|negative/i.test(userText))
          offsetValue = -Math.abs(offsetValue);
      }

      if (offsetValue !== null) {
        (layer as any).elevationInfo = {
          mode: "absolute-height",
          offset: offsetValue,
        };
        results.push(`Applied ${offsetValue}m elevation offset.`);
        console.log("[LoadLayer] Applied elevation offset:", offsetValue);
        if (layer.fullExtent) {
          try {
            await activeView.goTo(layer.fullExtent, { duration: 1500 });
          } catch {
            /* ok */
          }
        }
      }
    }

    // ── Imagery post-load analysis ────────────────────────────────
    if (layer.type === "imagery") {
      const imgLayer = layer as ImageryLayer;
      const textLower = userText.toLowerCase();

      const templates = getServerTemplates(imgLayer);
      if (templates.length > 0) {
        const matchedFn = templates.find(
          (t) =>
            t.name !== "None" && textLower.includes(t.name.toLowerCase())
        );
        if (matchedFn) {
          applyServerTemplate(imgLayer, matchedFn.name);
          results.push(`Applied "${matchedFn.name}" processing template.`);
        }
      }

      const stretchMap: [string[], StretchType][] = [
        [
          ["standard deviation", "std dev", "stddev"],
          "standard-deviation",
        ],
        [["min-max", "min max", "minmax"], "min-max"],
        [["percent clip", "percent-clip"], "percent-clip"],
      ];
      for (const [keywords, stretchType] of stretchMap) {
        if (keywords.some((k) => textLower.includes(k))) {
          const stdMatch = textLower.match(/(\d+(?:\.\d+)?)\s*(?:std\s*dev|standard\s*deviation)/);
          const stdDevs = stdMatch ? parseFloat(stdMatch[1]) : 2;
          applyStretch(imgLayer, stretchType, { stdDevs });
          results.push(`Applied ${stretchType} stretch${stdDevs !== 2 ? ` (${stdDevs} std devs)` : ""}.`);
          break;
        }
      }
    }

    // Notify UI that layers were added
    window.dispatchEvent(new CustomEvent("imagery-assistant-layers-added"));

    return results.join(" ");
  } catch (err: any) {
    console.error("[LoadLayer] Failed to load layer:", err);
    return `Failed to load layer: ${err?.message ?? String(err)}`;
  }
}
