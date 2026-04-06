import { lastSearchResults } from "../searchContent/core";
import {
  createLayerFromUrl,
  createLayerFromItemId,
  handleElevationRouting,
} from "../../../../../utils/layerFactory";
import {
  getCurrentView,
  getCurrentViewType,
  requestViewSwitch,
  requestWebMapSwitch,
  requestWebSceneSwitch,
} from "../../../../../utils/viewManager";
import { REQUIRES_3D, is3DItemType, elapsed } from "../../../../../utils/agentHelpers";
import { withTimeout } from "../../../../../utils/safeFetch";
import type { PortalSearchResult, ScopedSearchResults } from "../../../../../utils/portalSearch";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get the Nth result (1-based) from the flattened scoped results.
 */
function getNthResult(
  scopedResults: ScopedSearchResults[],
  n: number,
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
function getAllResults(
  scopedResults: ScopedSearchResults[],
): PortalSearchResult[] {
  return scopedResults.flatMap(({ results }) => results);
}

// ── Core add-to-map logic ────────────────────────────────────────────────────

/**
 * Add multiple layers to the map. Switches to 3D if any layer requires it.
 * Returns a summary message for each layer.
 */
async function addMultipleResultsToMap(
  targets: PortalSearchResult[],
): Promise<string> {
  if (targets.length === 0) return "No results to add.";

  const t0 = performance.now();
  const messages: string[] = [];

  // Check if any target needs 3D
  const needs3D = targets.some((t) => is3DItemType(t.type));

  if (needs3D && getCurrentViewType() !== "3d") {
    console.log("[ContentSearch] Some layers require 3D, switching...");
    try {
      await withTimeout(requestViewSwitch("3d"), 30000, "Switch to 3D for content results");
    } catch (err) {
      // Continue in 2D — 3D layers will fail but 2D layers will still load
      console.warn("[ContentSearch] 3D switch failed:", err);
      messages.push(
        "Could not switch to 3D view. 3D-only layers may fail to load.",
      );
    }
  }

  const view = getCurrentView();
  if (!view?.map) return "No active map view. Please wait for the map to load.";

  const isBatch = targets.length > 1;
  let firstExtent: any = null;
  let lastLayerType: string | null = null;

  // Load all layers concurrently
  const layerPromises = targets.map(async (target) => {
    const lt0 = performance.now();
    try {
      // Web Scenes and Web Maps are entire maps, not layers — load via view switch
      const typeLower = target.type.toLowerCase();
      if (typeLower === "web scene") {
        await withTimeout(requestWebSceneSwitch(target.itemId), 30000, `Open Web Scene "${target.title}"`);
        const elapsedTime = elapsed(lt0);
        return `Opened Web Scene "${target.title}" (${elapsedTime}s)`;
      }
      if (typeLower === "web map") {
        await withTimeout(requestWebMapSwitch(target.itemId), 30000, `Open Web Map "${target.title}"`);
        const elapsedTime = elapsed(lt0);
        return `Opened Web Map "${target.title}" (${elapsedTime}s)`;
      }

      let layer: any;
      // Oriented Imagery layers must use createLayerFromItemId to get the correct
      // OrientedImageryLayer type — fromArcGISServerUrl misdetects them as FeatureLayer.
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
        console.log(
          "[ContentSearch] Elevation routing:",
          target.title,
          `(${elapsedTime}s)`,
        );
        return `${result} (${elapsedTime}s)`;
      }

      // Skip 3D-only layers in 2D view
      if (REQUIRES_3D.has(layer.type) && getCurrentViewType() !== "3d") {
        return `Skipped "${target.title}" — requires 3D scene view.`;
      }

      view.map!.layers.add(layer);
      await withTimeout(layer.load(), 30000, `Load "${target.title}"`);

      // Get the extent for zooming
      let zoomTarget: any = layer.fullExtent;
      if (!zoomTarget) {
        const queryableLayer =
          typeof layer.queryExtent === "function"
            ? layer
            : layer.layers
                ?.toArray?.()
                ?.find(
                  (sl: any) => typeof sl.queryExtent === "function",
                ) ?? null;
        if (queryableLayer) {
          try {
            if (
              queryableLayer.loadStatus !== "loaded" &&
              typeof queryableLayer.load === "function"
            ) {
              await queryableLayer.load();
            }
            const result: any = await withTimeout(
              queryableLayer.queryExtent(),
              5000,
              "queryExtent",
            );
            zoomTarget = result?.extent;
          } catch (err) {
            console.warn("[ContentSearch] queryExtent failed:", err);
          }
        }
      }
      if (!zoomTarget) {
        try {
          const lv = await view.whenLayerView(layer);
          if (!lv?.fullExtent)
            await new Promise((r) => setTimeout(r, 500));
          zoomTarget = lv?.fullExtent || layer.fullExtent;
        } catch (err) {
          console.warn("[ContentSearch] whenLayerView fallback failed:", err);
        }
      }

      // Single layer: zoom immediately. Batch: capture first extent, zoom after all load.
      if (!isBatch && zoomTarget) {
        try {
          const is3D = getCurrentViewType() === "3d";
          const goToParams =
            is3D && is3DItemType(target.type)
              ? { target: zoomTarget, tilt: 65 }
              : zoomTarget;
          await view.goTo(goToParams as any, { duration: 2000 });
        } catch (err) {
          console.warn("[ContentSearch] goTo failed:", err);
        }
      } else if (isBatch && zoomTarget && !firstExtent) {
        firstExtent = { extent: zoomTarget, type: target.type };
      }

      lastLayerType = layer.type;
      const elapsedTime = elapsed(lt0);
      console.log(
        "[ContentSearch] Added:",
        target.title,
        layer.type,
        `(${elapsedTime}s)`,
      );
      return `Loaded "${target.title}" (${elapsedTime}s)`;
    } catch (err: any) {
      console.error("[ContentSearch] Failed to add:", target.title, err);
      return `Failed "${target.title}": ${err?.message ?? String(err)}`;
    }
  });

  const results = await Promise.all(layerPromises);
  messages.push(...results);

  // Batch: zoom to the first layer's extent after all are loaded
  if (isBatch && firstExtent) {
    try {
      const is3D = getCurrentViewType() === "3d";
      const goToParams =
        is3D && is3DItemType(firstExtent.type)
          ? { target: firstExtent.extent, tilt: 65 }
          : firstExtent.extent;
      await view.goTo(goToParams as any, { duration: 2000 });
    } catch (err) {
      console.warn("[ContentSearch] Batch goTo failed:", err);
    }
  }

  const totalElapsed = elapsed(t0);
  messages.push(
    `\nAdded ${targets.length} layer${targets.length === 1 ? "" : "s"} in ${totalElapsed}s total.`,
  );

  // Notify the UI that layers were added — include the last layer type for contextual prompts
  window.dispatchEvent(new CustomEvent("imagery-assistant-layers-added", {
    detail: { layerType: lastLayerType, count: targets.length },
  }));

  return messages.join("\n");
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Add cached search results to the map by indices or all.
 */
export async function addResultsToMap(params: {
  indices: number[];
  addAll: boolean;
}): Promise<string> {
  const { indices, addAll } = params;

  if (lastSearchResults.length === 0) {
    return "No previous search results. Search for content first, then add results by number.";
  }

  const allFlat = getAllResults(lastSearchResults);
  const total = allFlat.length;

  if (addAll) {
    console.log("[ContentSearch] Adding all", total, "cached results");
    return await addMultipleResultsToMap(allFlat);
  }

  // Filter by specific indices
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
    return `No valid results found for ${indices.join(", ")}. The last search had ${total} results (1–${total}).`;
  }

  let msg = await addMultipleResultsToMap(targets);

  if (missing.length > 0) {
    msg += `\n\nNote: Result${missing.length > 1 ? "s" : ""} ${missing.join(", ")} not found (search had ${total} results).`;
  }

  return msg;
}
