import { lastStacSearchResults, lastStacEndpoint } from "../searchStac/core";
import {
  getCogAssets,
  getCopcAssets,
  getBestDataAsset,
  signAssetUrl,
  type StacItem,
} from "../../../../../utils/stacClient";
import { createLayerFromCogUrl } from "../../../../../utils/layerFactory";
import {
  getCurrentView,
  getCurrentViewType,
} from "../../../../../utils/viewManager";
import { withTimeout } from "../../../../../utils/safeFetch";
import { elapsed } from "../../../../../utils/agentHelpers";
import Extent from "@arcgis/core/geometry/Extent";

// ── Helpers ──────────────────────────────────────────────────────────────────

function itemTitle(item: StacItem): string {
  return item.properties.title || item.id;
}

function bboxToExtent(bbox: number[]): Extent | null {
  if (!bbox || bbox.length < 4) return null;
  return new Extent({
    xmin: bbox[0],
    ymin: bbox[1],
    xmax: bbox[2],
    ymax: bbox[3],
    spatialReference: { wkid: 4326 },
  });
}

// ── Core add-to-map logic ────────────────────────────────────────────────────

async function addStacItemToMap(item: StacItem): Promise<string> {
  const t0 = performance.now();
  const title = itemTitle(item);

  const best = getBestDataAsset(item);
  if (!best) {
    return `No loadable data asset found for "${title}".`;
  }

  // S3-only assets (requester-pays buckets like naip-analytic)
  if (best.asset.href?.startsWith("s3://")) {
    return (
      `Cannot load "${title}" — this collection uses requester-pays S3 storage (${best.asset.href.split("/")[2]}). ` +
      `Direct browser access is not supported. Try this collection on Planetary Computer instead, ` +
      `or use a STAC catalog that provides HTTPS asset URLs.`
    );
  }

  // COPC — not yet supported in ArcGIS JS SDK v5 (deck.gl/arcgis peer dep gap)
  if (best.type === "copc") {
    const cogFallback = getCogAssets(item);
    if (cogFallback.length === 0) {
      return (
        `Cannot load "${title}" — COPC/LAZ point cloud files require a Scene Service endpoint. ` +
        `ArcGIS Maps SDK does not yet support direct COPC file URLs.\n` +
        `Asset URL: ${best.asset.href}`
      );
    }
    // Has both COPC and COG — load the COG
    const cog = cogFallback[0];
    const signedCogUrl = await withTimeout(signAssetUrl(cog[1].href, item.collection, lastStacEndpoint), 15000, "Sign COG asset URL");
    return await loadCogAsset(signedCogUrl, title, item, t0);
  }

  if (best.type === "cog") {
    const signedUrl = await withTimeout(signAssetUrl(best.asset.href, item.collection, lastStacEndpoint), 15000, "Sign COG asset URL");
    return await loadCogAsset(signedUrl, title, item, t0);
  }

  // Other asset type — try loading as COG anyway (common for unlabeled GeoTIFFs)
  if (best.asset.href.match(/\.tiff?$/i)) {
    const signedUrl = await withTimeout(signAssetUrl(best.asset.href, item.collection, lastStacEndpoint), 15000, "Sign TIFF asset URL");
    return await loadCogAsset(signedUrl, title, item, t0);
  }

  return `Cannot load "${title}" — unsupported asset type: ${best.asset.type ?? "unknown"}. URL: ${best.asset.href}`;
}

async function loadCogAsset(
  url: string,
  title: string,
  item: StacItem,
  t0: number,
): Promise<string> {
  const view = getCurrentView();
  if (!view?.map) return "No active map view. Please wait for the map to load.";

  try {
    const layer = createLayerFromCogUrl(url, title);
    view.map.layers.add(layer);
    await withTimeout(layer.load(), 30000, `Load "${title}"`);

    // Zoom to item bbox
    const extent = bboxToExtent(item.bbox ?? []);
    if (extent) {
      try {
        await view.goTo(extent, { duration: 2000 });
      } catch (err) { console.warn("[StacSearch] goTo extent failed:", err); }
    }

    const time = elapsed(t0);
    console.log("[StacSearch] Added COG:", title, `(${time}s)`);
    return `Loaded "${title}" as ImageryTileLayer (${time}s)`;
  } catch (err: any) {
    console.error("[StacSearch] Failed to load COG:", title, err);
    return `Failed to load "${title}": ${err?.message ?? String(err)}`;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function addStacResultsToMap(params: {
  indices: number[];
  addAll: boolean;
}): Promise<string> {
  const { indices, addAll } = params;

  if (lastStacSearchResults.length === 0) {
    return "No previous STAC search results. Search a STAC catalog first, then add results by number.";
  }

  const total = lastStacSearchResults.length;
  let targets: StacItem[];

  if (addAll) {
    targets = [...lastStacSearchResults];
  } else {
    targets = [];
    const missing: number[] = [];
    for (const idx of indices) {
      if (idx >= 1 && idx <= total) {
        targets.push(lastStacSearchResults[idx - 1]);
      } else {
        missing.push(idx);
      }
    }
    if (targets.length === 0) {
      return `No valid results for ${indices.join(", ")}. Last STAC search had ${total} results (1–${total}).`;
    }
    if (missing.length > 0) {
      console.log("[StacSearch] Missing indices:", missing);
    }
  }

  const t0 = performance.now();
  const messages: string[] = [];

  for (const item of targets) {
    const msg = await addStacItemToMap(item);
    messages.push(msg);
  }

  const totalElapsed = elapsed(t0);
  messages.push(
    `\nProcessed ${targets.length} STAC item${targets.length === 1 ? "" : "s"} in ${totalElapsed}s.`,
  );

  // Determine if any COGs were actually loaded for contextual prompts
  const hasLoadedCog = messages.some((m) => m.includes("ImageryTileLayer"));
  if (hasLoadedCog) {
    window.dispatchEvent(
      new CustomEvent("imagery-assistant-layers-added", {
        detail: { layerType: "imagery-tile", count: targets.length },
      }),
    );
  }

  return messages.join("\n");
}
