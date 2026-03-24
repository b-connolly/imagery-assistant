import ImageryLayer from "@arcgis/core/layers/ImageryLayer";
import RasterFunction from "@arcgis/core/layers/support/RasterFunction";
import RasterStretchRenderer from "@arcgis/core/renderers/RasterStretchRenderer";
import MultipartColorRamp from "@arcgis/core/rest/support/MultipartColorRamp";
import AlgorithmicColorRamp from "@arcgis/core/rest/support/AlgorithmicColorRamp";
import Color from "@arcgis/core/Color";
import * as rasterFunctionUtils from "@arcgis/core/layers/support/rasterFunctionUtils";

// ── Stretch types ────────────────────────────────────────────────────────────

export type StretchType =
  | "none"
  | "standard-deviation"
  | "min-max"
  | "percent-clip"
  | "histogram-equalization"
  | "sigmoid";

export interface StretchOptions {
  stdDevs?: number;
  minPercent?: number;
  maxPercent?: number;
  sigmoidStrength?: number;
  dynamicRangeAdjustment?: boolean;
  gamma?: number[];
  colorRampName?: string;
}

export function applyStretch(
  layer: ImageryLayer,
  stretchType: StretchType,
  options: StretchOptions = {}
): void {
  // SDK named ramps must be applied as a raster function, not on the renderer
  if (options.colorRampName && !isCustomRamp(options.colorRampName)) {
    applySDKColorRamp(layer, options.colorRampName);
    return;
  }

  const opts: any = {
    stretchType,
    numberOfStandardDeviations: options.stdDevs ?? 2,
    dynamicRangeAdjustment: options.dynamicRangeAdjustment ?? false,
  };

  if (stretchType === "percent-clip") {
    opts.minPercent = options.minPercent ?? 0.25;
    opts.maxPercent = options.maxPercent ?? 0.25;
  }
  if (stretchType === "sigmoid") {
    opts.sigmoidStrengthLevel = options.sigmoidStrength ?? 3;
  }
  if (options.gamma) {
    opts.gamma = options.gamma;
    opts.useGamma = true;
  }
  if (options.colorRampName) {
    opts.colorRamp = getColorRampByName(options.colorRampName);
  }

  layer.renderer = new RasterStretchRenderer(opts);
  layer.refresh();
}

// ── Color ramps ──────────────────────────────────────────────────────────────

// Custom ramp color stops for backward compatibility
const INFERNO_STOPS = [
  [0, 0, 4], [31, 12, 72], [85, 15, 109], [136, 34, 106],
  [186, 54, 85], [227, 89, 51], [249, 140, 10], [249, 201, 50],
  [252, 255, 164], [255, 255, 234],
];

const VIRIDIS_STOPS = [
  [68, 1, 84], [72, 36, 117], [65, 68, 135], [53, 95, 141],
  [42, 120, 142], [33, 145, 140], [34, 168, 132], [68, 191, 112],
  [122, 209, 81], [189, 223, 38], [253, 231, 37],
];

function stopsToRamp(stops: number[][]): MultipartColorRamp {
  const ramps: AlgorithmicColorRamp[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    ramps.push(new AlgorithmicColorRamp({
      fromColor: new Color(stops[i]),
      toColor: new Color(stops[i + 1]),
      algorithm: "lab-lch",
    }));
  }
  return new MultipartColorRamp({ colorRamps: ramps });
}

/** Custom ramp names that we build from hardcoded color stops. */
const CUSTOM_RAMPS: Record<string, number[][]> = {
  inferno: INFERNO_STOPS,
  viridis: VIRIDIS_STOPS,
  grayscale: [[0, 0, 0], [255, 255, 255]],
};

/**
 * Get a color ramp by name. Supports custom names (inferno, viridis, grayscale).
 * Returns null for SDK named ramps — those must be applied via applySDKColorRamp().
 */
export function getColorRampByName(name: string): MultipartColorRamp | null {
  const stops = CUSTOM_RAMPS[name.toLowerCase()];
  return stops ? stopsToRamp(stops) : null;
}

/** Whether a ramp name is a custom ramp (can be set on renderer.colorRamp). */
export function isCustomRamp(name: string): boolean {
  return name.toLowerCase() in CUSTOM_RAMPS;
}

/**
 * Apply an SDK named color ramp via rasterFunctionUtils.colormap as a raster function.
 * This is the official SDK way to apply named ramps like "prediction", "elevation1", etc.
 */
export function applySDKColorRamp(layer: ImageryLayer, rampName: string): void {
  layer.rasterFunction = rasterFunctionUtils.colormap({ colorRampName: rampName as any });
  layer.renderer = null as any; // Clear custom renderer so the colormap is visible
  layer.refresh();
}

/** All SDK-supported color ramp names. */
export const SDK_COLOR_RAMPS = [
  "aspect", "black-to-white", "blue-bright", "blue-light-to-dark",
  "blue-green-bright", "brown-light-to-dark", "cold-to-hot-diverging",
  "cyan-to-purple", "elevation1", "elevation2", "errors",
  "gray-light-to-dark", "green-bright", "green-light-to-dark",
  "green-to-blue", "orange-bright", "orange-light-to-dark",
  "partial-spectrum", "precipitation", "prediction", "purple-bright",
  "purple-to-green-diverging", "red-bright", "red-light-to-dark",
  "red-to-blue-diverging", "red-to-green", "slope",
  "spectrum-full-bright", "surface", "temperature",
  "white-to-black", "yellow-to-dark-red", "yellow-to-red",
  "yellow-green-bright", "inferno", "viridis", "grayscale",
];

export function applyColorRamp(
  layer: ImageryLayer,
  rampName: string,
  stretchType: StretchType = "standard-deviation",
  stdDevs: number = 2
): void {
  // SDK named ramps go through colormap raster function
  if (!isCustomRamp(rampName)) {
    applySDKColorRamp(layer, rampName);
    return;
  }
  applyStretch(layer, stretchType, { stdDevs, colorRampName: rampName });
}

// ── Server-side processing templates ─────────────────────────────────────────

export interface ServerTemplate {
  name: string;
  description: string;
  help?: string;
}

/**
 * Get available server-side processing templates from the imagery layer.
 */
export function getServerTemplates(layer: ImageryLayer): ServerTemplate[] {
  const infos = (layer as any).rasterFunctionInfos;
  if (!Array.isArray(infos)) return [];
  return infos.map((info: any) => ({
    name: info.name ?? "",
    description: info.description ?? "",
    help: info.help ?? "",
  }));
}

/**
 * Apply a server-side processing template by name.
 */
export function applyServerTemplate(layer: ImageryLayer, templateName: string): void {
  if (!templateName || templateName === "None") {
    layer.rasterFunction = null as any;
  } else {
    layer.rasterFunction = new RasterFunction({ functionName: templateName });
  }
  layer.refresh();
}

/**
 * Find a server template by fuzzy name match.
 */
export function findServerTemplate(layer: ImageryLayer, query: string): string | null {
  const templates = getServerTemplates(layer);
  const q = query.toLowerCase();
  const exact = templates.find((t) => t.name.toLowerCase() === q);
  if (exact) return exact.name;
  const sub = templates.find((t) => t.name.toLowerCase().includes(q));
  return sub?.name ?? null;
}

// ── Client-side spectral indices ─────────────────────────────────────────────

/**
 * All available client-side spectral index functions from rasterFunctionUtils.
 * Grouped by category for UI display.
 * `defaultArgs` provides default band mappings for common 4-band (R=0, G=1, B=2, NIR=3) sensors.
 * Users can override band assignments via the panel.
 */
export interface SpectralIndexDef {
  fn: string;
  label: string;
  defaultArgs: Record<string, any>;
  minBands: number;
}

export const SPECTRAL_INDICES: Record<string, SpectralIndexDef[]> = {
  "Vegetation": [
    { fn: "bandArithmeticNDVI", label: "NDVI", defaultArgs: { nirBandId: 3, redBandId: 0 }, minBands: 4 },
    { fn: "bandArithmeticSAVI", label: "SAVI", defaultArgs: { nirBandId: 3, redBandId: 0, soilBrightnessCorrectionFactor: 0.5 }, minBands: 4 },
    { fn: "bandArithmeticMSAVI", label: "MSAVI", defaultArgs: { nirBandId: 3, redBandId: 0 }, minBands: 4 },
    { fn: "bandArithmeticGEMI", label: "GEMI", defaultArgs: { nirBandId: 3, redBandId: 0 }, minBands: 4 },
    { fn: "bandArithmeticSR", label: "Simple Ratio", defaultArgs: { nirBandId: 3, redBandId: 0 }, minBands: 4 },
    { fn: "bandArithmeticGNDVI", label: "GNDVI", defaultArgs: { nirBandId: 3, greenBandId: 1 }, minBands: 4 },
    { fn: "bandArithmeticVARI", label: "VARI", defaultArgs: { redBandId: 0, greenBandId: 1, blueBandId: 2 }, minBands: 3 },
    { fn: "bandArithmeticMTVI2", label: "MTVI2", defaultArgs: { nirBandId: 3, redBandId: 0, greenBandId: 1 }, minBands: 4 },
    { fn: "bandArithmeticEVI", label: "EVI", defaultArgs: { nirBandId: 3, redBandId: 0, blueBandId: 2 }, minBands: 4 },
  ],
  "Water & Moisture": [
    { fn: "bandArithmeticNDWI", label: "NDWI", defaultArgs: { nirBandId: 3, greenBandId: 1 }, minBands: 4 },
    { fn: "bandArithmeticNDMI", label: "NDMI", defaultArgs: { nirBandId: 3, swirBandId: 4 }, minBands: 5 },
  ],
  "Built-up": [
    { fn: "bandArithmeticNDBI", label: "NDBI", defaultArgs: { nirBandId: 3, swirBandId: 4 }, minBands: 5 },
  ],
  "Snow & Ice": [
    { fn: "bandArithmeticNDSI", label: "NDSI", defaultArgs: { nirBandId: 3, swirBandId: 4 }, minBands: 5 },
  ],
  "Fire": [
    { fn: "bandArithmeticNBR", label: "NBR", defaultArgs: { nirBandId: 3, swirBandId: 5 }, minBands: 6 },
  ],
  "Minerals & Geology": [
    { fn: "bandArithmeticIronOxide", label: "Iron Oxide", defaultArgs: { redBandId: 0, blueBandId: 2 }, minBands: 3 },
    { fn: "bandArithmeticFerrousMinerals", label: "Ferrous Minerals", defaultArgs: { swirBandId: 4, nirBandId: 3 }, minBands: 5 },
    { fn: "bandArithmeticClayMinerals", label: "Clay Minerals", defaultArgs: { swir1BandId: 4, swir2BandId: 5 }, minBands: 6 },
  ],
  "Terrain": [
    { fn: "slope", label: "Slope", defaultArgs: { slopeType: "degree", zFactor: 1 }, minBands: 1 },
    { fn: "hillshade", label: "Hillshade", defaultArgs: { altitude: 45, azimuth: 315, zFactor: 1 }, minBands: 1 },
    { fn: "curvature", label: "Curvature", defaultArgs: { curvatureType: "standard", zFactor: 1 }, minBands: 1 },
  ],
};

/** Common band name patterns for resolving band IDs dynamically from service metadata. */
const BAND_PATTERNS: Record<string, string> = {
  nirBandId: "b8.?near|nearinfra|^nir|band.?4$",
  redBandId: "b4.?red|^red|band.?1$",
  greenBandId: "b3.?green|^green|band.?2$",
  blueBandId: "b2.?blue|^blue|band.?3$",
  swirBandId: "b11.?short|shortwave|^swir|band.?5$",
  swir1BandId: "b11.?short|shortwave",
  swir2BandId: "b12.?short",
  redEdgeBandId: "b5.?rededge|rededge",
};

/**
 * Resolve band IDs for a spectral index by matching band names from the layer.
 * Falls back to the hardcoded defaultArgs if name matching fails.
 */
function resolveBandArgs(layer: ImageryLayer, defaultArgs: Record<string, any>): Record<string, any> {
  const bands = getBandInfos(layer);
  if (bands.length === 0) return defaultArgs;

  const resolved: Record<string, any> = { ...defaultArgs };
  for (const [key, value] of Object.entries(defaultArgs)) {
    if (!key.endsWith("BandId") || typeof value !== "number") continue;
    const pattern = BAND_PATTERNS[key];
    if (!pattern) continue;
    const regex = new RegExp(pattern, "i");
    const match = bands.find((b) => regex.test(b.name.replace(/[\s_]+/g, "")));
    if (match) {
      resolved[key] = match.index;
    }
  }
  return resolved;
}

/**
 * Apply a client-side raster function by name from rasterFunctionUtils.
 * Dynamically resolves band IDs from the layer's band names.
 */
export function applyClientRasterFunction(
  layer: ImageryLayer,
  functionName: string,
  args?: Record<string, any>
): boolean {
  const fn = (rasterFunctionUtils as any)[functionName];
  if (typeof fn !== "function") return false;

  // Look up default args and resolve band IDs dynamically
  let finalArgs = args;
  if (!finalArgs) {
    const allIndices = Object.values(SPECTRAL_INDICES).flat();
    const match = allIndices.find((idx) => idx.fn === functionName);
    finalArgs = match?.defaultArgs ?? {};
  }
  finalArgs = resolveBandArgs(layer, finalArgs);

  try {
    console.log(`[rasterFunctions] Applying ${functionName} with args:`, finalArgs);
    layer.rasterFunction = fn(finalArgs);
    layer.refresh();
    return true;
  } catch (err) {
    console.error(`[rasterFunctions] Failed to apply ${functionName}:`, err);
    return false;
  }
}

/**
 * Apply a named raster function — tries server template first, then client-side.
 */
export function applyNamedFunction(layer: ImageryLayer, name: string): string {
  // Try server template match first
  const serverMatch = findServerTemplate(layer, name);
  if (serverMatch) {
    applyServerTemplate(layer, serverMatch);
    return `Applied server template "${serverMatch}".`;
  }

  // Try client-side spectral index
  const allIndices = Object.values(SPECTRAL_INDICES).flat();
  const match = allIndices.find(
    (idx) => idx.label.toLowerCase() === name.toLowerCase() ||
             idx.fn.toLowerCase().includes(name.toLowerCase().replace(/\s+/g, ""))
  );
  if (match) {
    if (applyClientRasterFunction(layer, match.fn)) {
      return `Applied ${match.label}.`;
    }
    return `Failed to apply ${match.label}.`;
  }

  // Try as raw RasterFunction name
  layer.rasterFunction = new RasterFunction({ functionName: name });
  layer.refresh();
  return `Applied raster function "${name}".`;
}

/**
 * Clear raster function — reset to default rendering.
 */
export function clearRasterFunction(layer: ImageryLayer): void {
  layer.rasterFunction = null as any;
  layer.refresh();
}

// ── Pixel identification ─────────────────────────────────────────────────────

export interface PixelIdentifyResult {
  values: number[];
  location: { longitude: number; latitude: number };
  layerTitle: string;
}

export async function identifyPixel(
  layer: ImageryLayer,
  point: any,
  _view: any
): Promise<PixelIdentifyResult | null> {
  try {
    if (!layer.url) return null;

    // Use the SDK's built-in identify — handles auth, mosaic rules, and projections automatically
    const ImageIdentifyParameters = (await import("@arcgis/core/rest/support/ImageIdentifyParameters")).default;

    const params = new ImageIdentifyParameters({
      geometry: point,
      returnGeometry: false,
      returnCatalogItems: false,
      returnPixelValues: true,
    });

    // Include the current mosaic rule so the correct image is identified
    if ((layer as any).mosaicRule) {
      params.mosaicRule = (layer as any).mosaicRule;
    }

    // Include the current rendering rule so processed values are returned
    if (layer.rasterFunction) {
      (params as any).renderingRule = layer.rasterFunction;
    }

    const result = await (layer as any).identify(params);
    console.log("[identifyPixel] SDK result:", result);

    if (!result) return null;

    // Extract pixel values from the result
    const pixelValue = result.value;
    if (pixelValue === undefined || pixelValue === null || pixelValue === "NoData") return null;

    const values =
      typeof pixelValue === "string"
        ? pixelValue.split(", ").map(Number).filter((v: number) => !isNaN(v))
        : Array.isArray(pixelValue)
          ? pixelValue.map(Number).filter((v: number) => !isNaN(v))
          : [Number(pixelValue)];

    if (values.length === 0) return null;

    return {
      values,
      location: { longitude: point.longitude, latitude: point.latitude },
      layerTitle: layer.title ?? "Imagery Layer",
    };
  } catch (err) {
    console.error("[identifyPixel] Failed:", err);
    return null;
  }
}

// ── Band info helpers ────────────────────────────────────────────────────────

export interface BandInfo {
  index: number;
  name: string;
}

export function getBandInfos(layer: ImageryLayer): BandInfo[] {
  // The canonical path is layer.serviceRasterInfo.bandInfos (ArcGISImageService mixin).
  // serviceRasterInfo is only available after the layer is loaded.
  const rasterInfo = (layer as any).serviceRasterInfo;

  if (rasterInfo?.bandInfos && Array.isArray(rasterInfo.bandInfos) && rasterInfo.bandInfos.length > 0) {
    return rasterInfo.bandInfos.map((b: any, i: number) => ({
      index: i,
      name: b.name ?? `Band ${i + 1}`,
    }));
  }

  // Fall back to band count
  const count = rasterInfo?.bandCount ?? (layer as any).sourceJSON?.bandCount ?? 0;
  if (count > 0) {
    // Try to get band names from sourceJSON
    const srcBands = (layer as any).sourceJSON?.bandInfos;
    if (Array.isArray(srcBands) && srcBands.length === count) {
      return srcBands.map((b: any, i: number) => ({
        index: i,
        name: b.bandName ?? b.name ?? `Band ${i + 1}`,
      }));
    }
    return Array.from({ length: count }, (_, i) => ({ index: i, name: `Band ${i + 1}` }));
  }

  return [];
}

/** Band combination preset — uses band name patterns to find correct indices dynamically. */
export interface BandPreset {
  label: string;
  /** Band name patterns for [R, G, B] channels. Matched against band names case-insensitively. */
  bandPatterns: [string, string, string];
}

export const BAND_PRESETS: BandPreset[] = [
  { label: "Natural Color", bandPatterns: ["b4.?red|^red", "b3.?green|^green", "b2.?blue|^blue"] },
  { label: "Color Infrared (CIR)", bandPatterns: ["b8.?near|nearinfra|^nir", "b4.?red|^red", "b3.?green|^green"] },
  { label: "False Color (vegetation)", bandPatterns: ["b8.?near|nearinfra|^nir", "b3.?green|^green", "b2.?blue|^blue"] },
  { label: "Short-Wave IR", bandPatterns: ["b11.?short|shortwave|^swir", "b8.?near|nearinfra|^nir", "b4.?red|^red"] },
  { label: "Agriculture", bandPatterns: ["b11.?short|shortwave|^swir", "b8.?near|nearinfra|^nir", "b3.?green|^green"] },
  { label: "Geology", bandPatterns: ["b12.?short|shortwave", "b11.?short|shortwave", "b4.?red|^red"] },
];

/**
 * Resolve a band preset to actual 0-based band indices using the layer's band names.
 * Returns null if any band pattern can't be matched.
 */
export function resolvePresetBands(preset: BandPreset, bands: BandInfo[]): number[] | null {
  const result: number[] = [];
  for (const pattern of preset.bandPatterns) {
    const regex = new RegExp(pattern, "i");
    const match = bands.find((b) => regex.test(b.name.replace(/[\s_]+/g, "")));
    if (!match) return null;
    result.push(match.index);
  }
  return result;
}

export function applyBandCombination(layer: ImageryLayer, bandIds: number[]): void {
  layer.bandIds = bandIds;
  layer.refresh();
}
