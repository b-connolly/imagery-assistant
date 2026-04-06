import { getCurrentView } from "../../../utils/viewManager";
import { findLayerByTitle } from "../../../utils/agentHelpers";
import { safeFetchJson, withTimeout } from "../../../utils/safeFetch";

// ── Types ────────────────────────────────────────────────────────────────────

interface FieldInfo {
  name: string;
  alias: string;
  type: string;
}

interface LayerSummary {
  title: string;
  type: string;
  url?: string;
  geometryType?: string;
  spatialReference?: string;
  fullExtent?: string;
  featureCount?: number;
  fields: FieldInfo[];
  popupFields: string[];
  popupTitle?: string;
  capabilities?: string;
  tables?: string[];
  // Imagery-specific
  bandCount?: number;
  pixelType?: string;
  rasterFunctions?: string[];
  minScale?: number;
  maxScale?: number;
  copyright?: string;
  description?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Best-effort layer load so we can read all properties. */
async function ensureLoaded(layer: any): Promise<void> {
  if (typeof layer.load === "function" && layer.loadStatus !== "loaded") {
    try {
      await withTimeout(layer.load(), 30000, `Load "${layer.title ?? "layer"}"`);
    } catch (err) {
      // Some layers may fail to load fully; continue with whatever is available
      console.warn("[LayerInfo] Layer load failed (continuing with partial data):", err);
    }
  }
}

/** Collect detailed info from a single layer. */
async function summarizeLayer(layer: any): Promise<LayerSummary> {
  await ensureLoaded(layer);

  const fields: FieldInfo[] = (layer.fields ?? []).map((f: any) => ({
    name: f.name,
    alias: f.alias || f.name,
    type: f.type?.replace("esriFieldType", "") ?? "unknown",
  }));

  // Popup info
  const popup = layer.popupTemplate;
  let popupFields: string[] = [];
  let popupTitle: string | undefined;
  if (popup) {
    popupTitle = typeof popup.title === "string" ? popup.title : undefined;
    popupFields = (popup.fieldInfos ?? [])
      .filter((fi: any) => fi.visible !== false)
      .map((fi: any) => fi.fieldName);
    if (popupFields.length === 0 && popup.content) {
      // Try to extract field names from content
      const contentArr = Array.isArray(popup.content) ? popup.content : [popup.content];
      for (const c of contentArr) {
        if (c?.type === "fields" && Array.isArray(c.fieldInfos)) {
          popupFields.push(
            ...c.fieldInfos
              .filter((fi: any) => fi.visible !== false)
              .map((fi: any) => fi.fieldName)
          );
        }
      }
    }
  }

  // Spatial reference
  let srText: string | undefined;
  const sr = layer.spatialReference ?? layer.fullExtent?.spatialReference;
  if (sr) {
    srText = sr.wkid ? `WKID ${sr.wkid}` : sr.wkt?.substring(0, 60);
  }

  // Extent
  let extentText: string | undefined;
  const ext = layer.fullExtent;
  if (ext) {
    extentText = `[${ext.xmin?.toFixed(4)}, ${ext.ymin?.toFixed(4)}] → [${ext.xmax?.toFixed(4)}, ${ext.ymax?.toFixed(4)}]`;
  }

  // Tables (sublayers on MapImageLayer, related tables on FeatureLayer)
  const tables: string[] = [];
  if (Array.isArray(layer.tables)) {
    for (const t of layer.tables) {
      tables.push(t.title || t.name || `Table ${t.id}`);
    }
  }
  // Sublayers
  if (layer.sublayers) {
    try {
      const subs = layer.sublayers.toArray?.() ?? [];
      for (const sub of subs) {
        tables.push(`Sublayer: ${sub.title || sub.id}`);
      }
    } catch (err) { console.warn("[LayerInfo] Sublayers read failed:", err); }
  }

  // Capabilities
  let capText: string | undefined;
  if (layer.capabilities) {
    const caps = layer.capabilities;
    const parts: string[] = [];
    if (caps.operations) {
      const ops = caps.operations;
      if (ops.supportsQuery) parts.push("Query");
      if (ops.supportsEditing || ops.supportsAdd) parts.push("Edit");
      if (ops.supportsExportImage) parts.push("Export Image");
      if (ops.supportsIdentify) parts.push("Identify");
    }
    if (caps.query) {
      if (caps.query.supportsStatistics) parts.push("Statistics");
      if (caps.query.supportsPagination) parts.push("Pagination");
    }
    if (parts.length > 0) capText = parts.join(", ");
    // Fallback: capabilities as comma-separated string
    if (!capText && typeof caps === "string") capText = caps;
  }

  // Imagery-specific
  let bandCount: number | undefined;
  let pixelType: string | undefined;
  let rasterFunctions: string[] | undefined;
  if (layer.type === "imagery" || layer.type === "imagery-tile") {
    bandCount = layer.bandCount ?? undefined;
    pixelType = layer.pixelType ?? undefined;
    if (layer.rasterFunctionInfos && Array.isArray(layer.rasterFunctionInfos)) {
      rasterFunctions = layer.rasterFunctionInfos.map((rf: any) => rf.name);
    }
  }

  return {
    title: layer.title || "Untitled",
    type: layer.type || "unknown",
    url: layer.url || undefined,
    geometryType: layer.geometryType || undefined,
    spatialReference: srText,
    fullExtent: extentText,
    featureCount: typeof layer.featureCount === "number" ? layer.featureCount : undefined,
    fields,
    popupFields,
    popupTitle,
    capabilities: capText,
    tables: tables.length > 0 ? tables : undefined,
    bandCount,
    pixelType,
    rasterFunctions,
    minScale: layer.minScale || undefined,
    maxScale: layer.maxScale || undefined,
    copyright: layer.copyright || undefined,
    description: layer.description || undefined,
  };
}

/** Format a layer summary into readable markdown. */
function formatSummary(s: LayerSummary): string {
  const lines: string[] = [];
  lines.push(`### ${s.title}`);
  lines.push(`**Type:** ${s.type}`);
  if (s.url) lines.push(`**URL:** ${s.url}`);
  if (s.description) lines.push(`**Description:** ${s.description}`);
  if (s.copyright) lines.push(`**Copyright:** ${s.copyright}`);
  if (s.geometryType) lines.push(`**Geometry:** ${s.geometryType}`);
  if (s.spatialReference) lines.push(`**Spatial Reference:** ${s.spatialReference}`);
  if (s.fullExtent) lines.push(`**Extent:** ${s.fullExtent}`);
  if (s.featureCount != null) lines.push(`**Feature Count:** ${s.featureCount.toLocaleString()}`);
  if (s.minScale || s.maxScale) {
    lines.push(`**Scale Range:** ${s.minScale ?? "∞"} → ${s.maxScale ?? "∞"}`);
  }
  if (s.capabilities) lines.push(`**Capabilities:** ${s.capabilities}`);

  // Imagery info
  if (s.bandCount != null) lines.push(`**Band Count:** ${s.bandCount}`);
  if (s.pixelType) lines.push(`**Pixel Type:** ${s.pixelType}`);

  // Fields
  if (s.fields.length > 0) {
    lines.push("");
    lines.push(`**Fields (${s.fields.length}):**`);
    const maxShow = 30;
    const shown = s.fields.slice(0, maxShow);
    for (const f of shown) {
      const alias = f.alias !== f.name ? ` (${f.alias})` : "";
      lines.push(`- \`${f.name}\`${alias} — ${f.type}`);
    }
    if (s.fields.length > maxShow) {
      lines.push(`- _...and ${s.fields.length - maxShow} more_`);
    }
  }

  // Popup
  if (s.popupTitle || s.popupFields.length > 0) {
    lines.push("");
    lines.push("**Popup Configuration:**");
    if (s.popupTitle) lines.push(`- Title: ${s.popupTitle}`);
    if (s.popupFields.length > 0) {
      lines.push(`- Visible fields: ${s.popupFields.join(", ")}`);
    }
  }

  // Processing templates (imagery)
  if (s.rasterFunctions && s.rasterFunctions.length > 0) {
    lines.push("");
    lines.push(`**Processing Templates (${s.rasterFunctions.length}):**`);
    for (const fn of s.rasterFunctions) {
      lines.push(`- ${fn}`);
    }
  }

  // Tables / sublayers
  if (s.tables && s.tables.length > 0) {
    lines.push("");
    lines.push("**Tables / Sublayers:**");
    for (const t of s.tables) {
      lines.push(`- ${t}`);
    }
  }

  return lines.join("\n");
}

// ── Raster statistics ────────────────────────────────────────────────────────

interface BandStats {
  bandIndex: number;
  min: number;
  max: number;
  mean: number;
  stdDev: number;
}

/**
 * Query raster statistics from an Image Service using the REST API.
 * Works for any ImageServer URL regardless of how the layer was loaded.
 */
async function fetchRasterStatistics(serviceUrl: string): Promise<BandStats[]> {
  const base = serviceUrl.replace(/\/$/, "");
  const statsUrl = `${base}/computeStatisticsHistograms`;

  // Get token if needed
  let token = "";
  try {
    const IM = (await import("@arcgis/core/identity/IdentityManager")).default;
    const credential = await IM.getCredential(base);
    token = credential.token;
  } catch {
    // Public service — no token needed
  }

  const form = new FormData();
  form.append("f", "json");
  if (token) form.append("token", token);

  const data = await safeFetchJson<{ statistics?: any[]; error?: { message: string } }>(
    statsUrl, { method: "POST", body: form }, 30000
  );

  const stats: BandStats[] = [];
  const bandStats = data.statistics ?? [];
  for (let i = 0; i < bandStats.length; i++) {
    const s = bandStats[i];
    stats.push({
      bandIndex: i + 1,
      min: s.min,
      max: s.max,
      mean: s.mean,
      stdDev: s.standardDeviation ?? s.stddev ?? 0,
    });
  }
  return stats;
}

/** Check if the user is asking about raster statistics. */
function wantsStatistics(text: string): boolean {
  return /\b(lowest|highest|minimum|maximum|min|max|average|mean|std\s*dev|standard\s*deviation|statistics|stats|range|elevation\s+value|pixel\s+range)\b/i.test(text);
}

/** Find a layer across both map.layers and ground.layers by title hint. */
function findAnyLayerByHint(view: any, hint: string): any | null {
  const mapLayers = view.map?.layers?.toArray?.() ?? [];
  const groundLayers = view.map?.ground?.layers?.toArray?.() ?? [];
  const all = [...mapLayers, ...groundLayers];
  return findLayerByTitle(all, hint);
}

/** Get Image Service URL from a layer (works for imagery, imagery-tile, elevation). */
function getImageServiceUrl(layer: any): string | null {
  const url = layer.url;
  if (!url) return null;
  if (/ImageServer/i.test(url)) return url;
  return null;
}

function formatStats(stats: BandStats[], layerTitle: string): string {
  const lines: string[] = [`**Raster Statistics for "${layerTitle}":**\n`];
  for (const s of stats) {
    const bandLabel = stats.length === 1 ? "" : `**Band ${s.bandIndex}:** `;
    lines.push(
      `${bandLabel}Min: **${s.min.toFixed(2)}** | Max: **${s.max.toFixed(2)}** | Mean: **${s.mean.toFixed(2)}** | Std Dev: **${s.stdDev.toFixed(2)}**`
    );
  }
  return lines.join("\n");
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function layerInfoHandler(text: string): Promise<{ outputMessage: string }> {
  const view = getCurrentView();

  if (!view?.map) {
    return { outputMessage: "No map view is currently available." };
  }

  // ── Quick layer order / list ──────────────────────────────────────
  if (/\b(layer\s*order|draw\s*order|stacking|what\s*layers|list\s*layers|layers?\s*on\s*the\s*map)\b/i.test(text)) {
    const layers = view.map.layers.toArray();
    if (layers.length === 0) {
      return { outputMessage: "No layers on the map." };
    }
    // #1 = bottom layer (first in array), highest number = top
    const lines = layers.map((l: any, i: number) =>
      `${i + 1}. ${l.title || "Untitled"} _(${l.type})_`
    );
    return {
      outputMessage:
        `**Layer order** (bottom → top):\n\n${lines.join("\n")}\n\n` +
        `${layers.length} layer${layers.length > 1 ? "s" : ""} total.`,
    };
  }

  // ── Create/configure popup with specific fields ──
  if (/\b(create|add|set|configure|enable|make)\b.*\bpop\s*up\b/i.test(text) ||
      /\bpop\s*up\b.*\b(with|using|for|fields?|showing)\b/i.test(text)) {
    const layers = view.map.layers.toArray();
    if (layers.length === 0) {
      return { outputMessage: "No layers on the map. Add a layer first." };
    }

    // Extract field names from the request
    const fieldMatch = text.match(/(?:fields?|with|:)\s*[:.]?\s*(.+)/i);
    let fieldNames: string[] = [];
    if (fieldMatch) {
      fieldNames = fieldMatch[1]
        .split(/[,\s]+/)
        .map((f: string) => f.trim())
        .filter((f: string) => f.length > 0 && !/^(and|the|for|layer|popup|pop|up)$/i.test(f));
    }

    // Find the target layer — try to extract name, default to topmost
    const layerHint = text
      .replace(/\b(create|add|set|configure|enable|make|pop\s*up|popup|with|fields?|using|for|showing|layer)\b/gi, "")
      .replace(/[:.,!?]/g, "")
      .replace(fieldNames.join("|"), "")
      .trim();

    let targetLayer: any = layerHint.length > 1
      ? findLayerByTitle(layers, layerHint)
      : null;
    if (!targetLayer) {
      targetLayer = layers[layers.length - 1]; // topmost layer
    }

    // Layer type determines popup approach:
    // - Imagery layers → redirect to ImageryAnalysisAgent (pixel identify)
    // - Mesh/splat layers → no attributes, popups not supported
    // - Feature-based, scene, point cloud → field-based PopupTemplate
    const NO_POPUP_TYPES = new Set([
      "integrated-mesh", "integrated-mesh-3dtiles", "gaussian-splat",
      "elevation", "tile", "vector-tile", "web-tile",
      "open-street-map", "bing-maps", "media", "group",
      "dimension", "voxel",
    ]);
    const IMAGERY_TYPES = new Set(["imagery", "imagery-tile"]);

    if (IMAGERY_TYPES.has(targetLayer.type)) {
      // For imagery layers, enable click-to-identify pixel values directly
      const imgView = getCurrentView() as any;
      if (imgView) {
        const { identifyPixel } = await import("../../../utils/rasterFunctions");
        // Remove any existing click handler
        if ((window as any).__imgIdentifyRemove) {
          (window as any).__imgIdentifyRemove();
        }
        // Disable default popup so our custom identify popup works
        imgView.popupEnabled = false;
        const handler = imgView.on("click", async (event: any) => {
          event.stopPropagation();
          const result = await identifyPixel(targetLayer as any, event.mapPoint, imgView);
          if (!result) return;
          imgView.openPopup({
            title: result.layerTitle,
            content: `Pixel values: ${result.values.join(", ")}<br>Location: ${result.location.longitude.toFixed(5)}, ${result.location.latitude.toFixed(5)}`,
            location: event.mapPoint,
          });
        });
        (window as any).__imgIdentifyRemove = () => {
          handler.remove();
          imgView.popupEnabled = true;
        };
        return {
          outputMessage: `Click-to-identify enabled on "${targetLayer.title}". Click any location to see pixel/band values.`,
        };
      }
      return {
        outputMessage: `"${targetLayer.title}" is an imagery layer. Say **"identify"** to click and see pixel values.`,
      };
    }

    if (NO_POPUP_TYPES.has(targetLayer.type)) {
      return {
        outputMessage: `"${targetLayer.title}" (type: ${targetLayer.type}) does not support attribute popups.`,
      };
    }

    // Ensure layer is loaded so fields are available
    try { await withTimeout(targetLayer.load(), 30000, `Load "${targetLayer.title}"`); } catch (err) { console.warn("[LayerInfo] Target layer load failed:", err); }

    // If no fields specified, use all available fields
    if (fieldNames.length === 0 && targetLayer.fields) {
      fieldNames = targetLayer.fields
        .filter((f: any) => f.type !== "oid" && f.type !== "global-id" && f.type !== "geometry")
        .map((f: any) => f.name);
    }

    // Point cloud layers have embedded attributes (ClassCode, Elevation, Intensity, etc.)
    // exposed via layer.fields after load. Auto-populate all available fields.
    if (targetLayer.type === "point-cloud" && fieldNames.length === 0) {
      if (targetLayer.fields && targetLayer.fields.length > 0) {
        fieldNames = targetLayer.fields.map((f: any) => f.name);
      } else {
        // Fallback: common point cloud attributes
        fieldNames = ["CLASS_CODE", "ELEVATION", "INTENSITY", "NUMBER_OF_RETURNS", "RETURN_NUMBER", "RGB"];
      }
    }

    if (fieldNames.length === 0) {
      return {
        outputMessage: `"${targetLayer.title}" has no attribute fields available for a popup. ` +
          `This layer type may not support field-based popups.`,
      };
    }

    // Build popup template
    const PopupTemplate = (await import("@arcgis/core/PopupTemplate")).default;
    const fieldInfos = fieldNames.map((name: string) => ({
      fieldName: name,
      label: name,
      visible: true,
    }));

    targetLayer.popupTemplate = new PopupTemplate({
      title: targetLayer.title ?? "Feature",
      content: [{
        type: "fields",
        fieldInfos,
      }],
    });
    targetLayer.popupEnabled = true;

    return {
      outputMessage: `Popup configured for "${targetLayer.title}" with ${fieldNames.length} fields: ${fieldNames.join(", ")}`,
    };
  }

  // ── Raster statistics query ──
  if (wantsStatistics(text)) {
    // Extract layer name hint — strip statistics keywords
    const statsHint = text
      .replace(
        /\b(what|is|are|the|lowest|highest|minimum|maximum|min|max|average|mean|std\s*dev|standard\s*deviation|statistics|stats|range|elevation|value|pixel|of|in|for|on|show|tell|me|about|get|compute|calculate)\b/gi,
        ""
      )
      .replace(/[?.,!]/g, "")
      .trim();

    const mapLayers = view.map.layers?.toArray?.() ?? [];
    const groundLayers = view.map.ground?.layers?.toArray?.() ?? [];
    const allLayers = [...mapLayers, ...groundLayers];

    // Find the target layer
    let targetLayer = statsHint.length > 1
      ? findAnyLayerByHint(view, statsHint)
      : null;

    // Fallback: find any imagery/elevation layer
    if (!targetLayer) {
      targetLayer = allLayers.find((l: any) =>
        /^(imagery|imagery-tile|elevation)$/.test(l.type)
      );
    }

    if (!targetLayer) {
      return {
        outputMessage: "No imagery or elevation layer found on the map to compute statistics for.",
      };
    }

    const serviceUrl = getImageServiceUrl(targetLayer);
    if (!serviceUrl) {
      return {
        outputMessage: `"${targetLayer.title}" is not an Image Service — statistics are only available for imagery and elevation layers.`,
      };
    }

    try {
      const stats = await fetchRasterStatistics(serviceUrl);
      if (stats.length === 0) {
        return {
          outputMessage: `No statistics available for "${targetLayer.title}". The service may not support statistics computation.`,
        };
      }
      return { outputMessage: formatStats(stats, targetLayer.title || "Untitled") };
    } catch (err: any) {
      return {
        outputMessage: `Failed to compute statistics for "${targetLayer.title}": ${err.message}`,
      };
    }
  }

  const layers = view.map.layers.toArray();
  if (layers.length === 0) {
    return {
      outputMessage:
        "There are no layers on the map yet. Add a layer first, then ask me about it.",
    };
  }

  // ── Determine which layer(s) to describe ──
  const lower = text.toLowerCase();

  // "all layers" or generic info request → summarize all
  const wantsAll =
    /\ball\s*(layers|data)\b/i.test(text) ||
    /\bwhat('?s| is)\s*(on|in)\s*(the\s+)?(map|view)\b/i.test(text) ||
    /\blist\s*(all\s*)?(layers|data)\b/i.test(text);

  let targetLayers: any[];

  if (wantsAll) {
    targetLayers = layers;
  } else {
    // Check for numeric layer reference: "describe layer 4", "info on layer 2"
    const numMatch = text.match(/\blayer\s*#?\s*(\d+)\b/i);
    if (numMatch) {
      const idx = parseInt(numMatch[1], 10) - 1; // 1-based → 0-based
      if (idx >= 0 && idx < layers.length) {
        targetLayers = [layers[idx]];
      } else {
        return {
          outputMessage: `Layer ${numMatch[1]} does not exist. There are ${layers.length} layers on the map.`,
        };
      }
    } else {
      // Try to extract a layer name from the user text
      const stripped = lower
        .replace(
          /\b(tell|me|about|show|info|information|details|describe|query|what|are|the|fields|attributes|metadata|popup|for|of|on|in|layer|table|tables|data|get|list|properties)\b/gi,
          ""
        )
        .trim();

      const matched = stripped.length > 1 ? findLayerByTitle(layers, stripped) : null;

      if (matched) {
        targetLayers = [matched];
      } else if (layers.length === 1) {
        // Only one layer — describe it
        targetLayers = layers;
      } else {
        // Default: summarize all layers
        targetLayers = layers;
      }
    }
  }

  // ── Build summaries ──
  const summaries: string[] = [];
  for (const layer of targetLayers) {
    try {
      const summary = await summarizeLayer(layer);
      summaries.push(formatSummary(summary));
    } catch (err: any) {
      summaries.push(`### ${layer.title || "Untitled"}\n_Error loading info: ${err.message}_`);
    }
  }

  const header =
    targetLayers.length === 1
      ? `Layer information for **${targetLayers[0].title || "Untitled"}**:\n`
      : `Found **${targetLayers.length} layers** on the map:\n`;

  return { outputMessage: header + "\n" + summaries.join("\n\n---\n\n") };
}
