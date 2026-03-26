import { getCurrentView } from "../../../../../utils/viewManager";
import { findLayerByTitle } from "../../../../../utils/agentHelpers";
import { withTimeout } from "../../../../../utils/safeFetch";

/**
 * Zoom to a layer's extent. Supports operational layers and ground/elevation layers.
 * Falls back to queryExtent and whenLayerView if fullExtent is not available.
 */
export async function zoomToLayer(params: {
  layerName: string;
}): Promise<string> {
  const activeView = getCurrentView();
  if (!activeView?.map) {
    return "No active map view.";
  }

  const layers = activeView.map.layers.toArray();
  const groundLayers = activeView.map?.ground?.layers?.toArray?.() ?? [];
  const allLayers = [...layers, ...groundLayers];

  if (allLayers.length === 0) {
    return "There are no layers on the map to zoom to.";
  }

  const name = (params.layerName ?? "").trim();

  // "zoom to all layers"
  if (/\ball\s*(layers?|data)?\b/i.test(name)) {
    const extents = allLayers
      .filter((l: any) => l.fullExtent)
      .map((l: any) => l.fullExtent);
    if (extents.length === 0) {
      return "None of the layers have a valid extent to zoom to.";
    }
    let combined = extents[0].clone();
    for (let i = 1; i < extents.length; i++) {
      combined = combined.union(extents[i]);
    }
    await activeView.goTo(combined, { duration: 2000 });
    return `Zoomed to the combined extent of all ${allLayers.length} layers.`;
  }

  // Try to match a specific layer by title
  let target: any = name.length > 1 ? findLayerByTitle(allLayers, name) : null;

  // Auto-select the only operational layer when no specific name given
  if (!target && name.length <= 2) {
    const operationalLayers = layers.filter(
      (l: any) => l.type !== "group" || !l.title?.includes("(Elevation)")
    );
    if (operationalLayers.length === 1) {
      target = operationalLayers[0];
    }
  }

  if (target) {
    return await zoomToLayerExtent(activeView, target);
  }

  return null as any; // Signal that no layer was found — caller should try geocode
}

/**
 * Zoom to a specific layer's extent with multiple fallback strategies.
 */
export async function zoomToLayerExtent(activeView: any, target: any): Promise<string> {
  const title = target.title || "Untitled";

  if (typeof target.load === "function" && target.loadStatus !== "loaded") {
    try {
      await withTimeout(target.load(), 30000, `Load "${target.title}"`);
    } catch {
      /* continue */
    }
  }

  let zoomExtent: any = target.fullExtent;

  if (!zoomExtent) {
    const qLayer =
      typeof target.queryExtent === "function"
        ? target
        : target.layers
            ?.toArray?.()
            ?.find((sl: any) => typeof sl.queryExtent === "function") ?? null;
    if (qLayer) {
      try {
        if (qLayer.loadStatus !== "loaded" && typeof qLayer.load === "function")
          await qLayer.load();
        const result: any = await withTimeout(
          qLayer.queryExtent(),
          5000,
          "queryExtent"
        );
        zoomExtent = result?.extent;
      } catch {
        /* timeout or error */
      }
    }
  }

  if (!zoomExtent) {
    try {
      const lv = await activeView.whenLayerView(target);
      if (!lv?.fullExtent)
        await new Promise((r) => setTimeout(r, 500));
      zoomExtent = lv?.fullExtent || target.fullExtent;
    } catch {
      /* continue */
    }
  }

  if (zoomExtent) {
    await activeView.goTo(zoomExtent, { duration: 2000 });
    return `Zoomed to "${title}".`;
  }

  return `Layer "${title}" does not have a valid extent to zoom to.`;
}

/**
 * Extract the layer/place name from user text for zoom operations.
 * Strips common verbs and filler words to isolate the name.
 */
export function extractZoomTarget(text: string): string {
  return text
    .toLowerCase()
    .replace(
      /\b(zoom|to|fly|go|focus|on|in|extent|of|the|layer|layers|please)\b/g,
      ""
    )
    .trim();
}
