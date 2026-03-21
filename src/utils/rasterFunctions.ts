import ImageryLayer from "@arcgis/core/layers/ImageryLayer";
import RasterFunction from "@arcgis/core/layers/support/RasterFunction";
import RasterStretchRenderer from "@arcgis/core/renderers/RasterStretchRenderer";
import MultipartColorRamp from "@arcgis/core/rest/support/MultipartColorRamp";
import AlgorithmicColorRamp from "@arcgis/core/rest/support/AlgorithmicColorRamp";
import Color from "@arcgis/core/Color";

// ── Stretch types ────────────────────────────────────────────────────────────

export type StretchType =
  | "none"
  | "standard-deviation"
  | "min-max"
  | "percent-clip";

export function applyStretch(
  layer: ImageryLayer,
  stretchType: StretchType,
  stdDevs: number = 2,
  includeColorRamp: boolean = false
): void {
  const opts: any = {
    stretchType: stretchType,
    numberOfStandardDeviations: stdDevs,
  };
  if (includeColorRamp) {
    opts.colorRamp = createInfernoRamp();
  }

  layer.renderer = new RasterStretchRenderer(opts);
  layer.refresh();
}

// ── Color ramps ──────────────────────────────────────────────────────────────

const INFERNO_STOPS = [
  [0, 0, 4],
  [31, 12, 72],
  [85, 15, 109],
  [136, 34, 106],
  [186, 54, 85],
  [227, 89, 51],
  [249, 140, 10],
  [249, 201, 50],
  [252, 255, 164],
  [255, 255, 234],
];

const VIRIDIS_STOPS = [
  [68, 1, 84],
  [72, 36, 117],
  [65, 68, 135],
  [53, 95, 141],
  [42, 120, 142],
  [33, 145, 140],
  [34, 168, 132],
  [68, 191, 112],
  [122, 209, 81],
  [189, 223, 38],
  [253, 231, 37],
];

const GRAYSCALE_STOPS = [
  [0, 0, 0],
  [255, 255, 255],
];

export type ColorRampName = "inferno" | "viridis" | "grayscale";

function stopsToRamp(stops: number[][]): MultipartColorRamp {
  const ramps: AlgorithmicColorRamp[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    ramps.push(
      new AlgorithmicColorRamp({
        fromColor: new Color(stops[i]),
        toColor: new Color(stops[i + 1]),
        algorithm: "lab-lch",
      })
    );
  }
  return new MultipartColorRamp({ colorRamps: ramps });
}

export function createInfernoRamp(): MultipartColorRamp {
  return stopsToRamp(INFERNO_STOPS);
}

export function createViridisRamp(): MultipartColorRamp {
  return stopsToRamp(VIRIDIS_STOPS);
}

export function createGrayscaleRamp(): MultipartColorRamp {
  return stopsToRamp(GRAYSCALE_STOPS);
}

export function getColorRamp(name: ColorRampName): MultipartColorRamp {
  switch (name) {
    case "inferno":
      return createInfernoRamp();
    case "viridis":
      return createViridisRamp();
    case "grayscale":
      return createGrayscaleRamp();
  }
}

export function applyColorRamp(
  layer: ImageryLayer,
  rampName: ColorRampName,
  stretchType: StretchType = "standard-deviation",
  stdDevs: number = 2
): void {
  const renderer = new RasterStretchRenderer({
    stretchType: stretchType as any,
    numberOfStandardDeviations: stdDevs,
    colorRamp: getColorRamp(rampName),
  });
  layer.renderer = renderer;
  layer.refresh();
}

// ── Raster functions (server-side processing templates) ──────────────────────

export type RasterFunctionName =
  | "NDVI"
  | "Hillshade"
  | "Slope"
  | "Aspect"
  | "ColorIR"
  | "None";

export function applyRasterFunction(
  layer: ImageryLayer,
  functionName: RasterFunctionName
): void {
  if (functionName === "None") {
    layer.rasterFunction = null as any;
    layer.refresh();
    return;
  }

  if (functionName === "ColorIR") {
    layer.rasterFunction = new RasterFunction({
      functionName: "CompositeBand",
      functionArguments: {
        Bands: [4, 1, 2], // NIR, Red, Green
      },
    });
    layer.refresh();
    return;
  }

  // Standard named server-side functions
  layer.rasterFunction = new RasterFunction({
    functionName,
  });
  layer.refresh();
}

/**
 * Get available raster function names from an ImageryLayer's service metadata.
 */
export function getAvailableRasterFunctions(
  layer: ImageryLayer
): string[] {
  const infos = (layer as any).rasterFunctionInfos;
  if (!Array.isArray(infos)) return [];
  return infos.map((info: any) => info.name as string);
}

/**
 * Apply a named server-side raster function by exact name from rasterFunctionInfos.
 */
export function applyServerRasterFunction(
  layer: ImageryLayer,
  functionName: string
): void {
  layer.rasterFunction = new RasterFunction({ functionName });
  layer.refresh();
}

// ── Pixel identification ─────────────────────────────────────────────────────

export interface PixelIdentifyResult {
  values: number[];
  location: { longitude: number; latitude: number };
  layerTitle: string;
}

/**
 * Identify pixel values at a map point on an ImageryLayer.
 * Uses the ImageServer REST identify endpoint directly.
 */
export async function identifyPixel(
  layer: ImageryLayer,
  point: any,
  _view: any
): Promise<PixelIdentifyResult | null> {
  try {
    if (!layer.url) return null;

    const geometry = JSON.stringify({
      x: point.x,
      y: point.y,
      spatialReference: point.spatialReference?.toJSON?.() ?? point.spatialReference,
    });

    const params = new URLSearchParams({
      geometry,
      geometryType: "esriGeometryPoint",
      returnGeometry: "false",
      returnCatalogItems: "false",
      f: "json",
    });

    // Include raster function if one is applied
    if (layer.rasterFunction) {
      params.set("renderingRule", JSON.stringify(layer.rasterFunction.toJSON()));
    }

    const resp = await fetch(`${layer.url}/identify?${params}`);
    const data = await resp.json();

    if (!data || data.value === undefined || data.value === "NoData") return null;

    const values =
      typeof data.value === "string"
        ? data.value.split(", ").map(Number).filter((v: number) => !isNaN(v))
        : [Number(data.value)];

    if (values.length === 0) return null;

    return {
      values,
      location: {
        longitude: point.longitude,
        latitude: point.latitude,
      },
      layerTitle: layer.title ?? "Imagery Layer",
    };
  } catch (err) {
    console.error("[identifyPixel] Failed:", err);
    return null;
  }
}

// ── Inferno pixel filter (client-side) ───────────────────────────────────────

/**
 * Create a pixel filter function that applies an inferno color ramp.
 * Useful for single-band thermal data rendered client-side.
 */
export function createInfernoPixelFilter(
  minVal: number = 0,
  maxVal: number = 255
): (pixelData: any) => void {
  return (pixelData: any) => {
    const pb = pixelData.pixelBlock;
    if (!pb || !pb.pixels || !pb.pixels[0]) return;

    const src = pb.pixels[0];
    const count = src.length;
    const r = new Uint8Array(count);
    const g = new Uint8Array(count);
    const b = new Uint8Array(count);
    const mask = pb.mask || new Uint8Array(count).fill(1);

    const range = maxVal - minVal || 1;

    for (let i = 0; i < count; i++) {
      const t = src[i];
      if (t < minVal || t > maxVal) {
        mask[i] = 0;
        continue;
      }
      mask[i] = 1;
      const norm = (t - minVal) / range;
      const idx = Math.floor(norm * (INFERNO_STOPS.length - 1));
      const frac =
        norm * (INFERNO_STOPS.length - 1) - idx;
      const c0 = INFERNO_STOPS[Math.min(idx, INFERNO_STOPS.length - 1)];
      const c1 =
        INFERNO_STOPS[Math.min(idx + 1, INFERNO_STOPS.length - 1)];
      r[i] = Math.round(c0[0] + frac * (c1[0] - c0[0]));
      g[i] = Math.round(c0[1] + frac * (c1[1] - c0[1]));
      b[i] = Math.round(c0[2] + frac * (c1[2] - c0[2]));
    }

    pb.pixels = [r, g, b];
    pb.mask = mask;
    pb.pixelType = "u8";
  };
}
