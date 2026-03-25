import { Annotation, messagesStateReducer, StateGraph, START, END } from "@langchain/langgraph/web";
import type { RunnableConfig } from "@langchain/core/runnables";
import { sendTraceMessage } from "@arcgis/ai-components/utils/index.js";
import type { AgentRegistration, ChatHistory } from "@arcgis/ai-components/utils/index.js";
import { getCurrentView, getCurrentViewType } from "../../utils/viewManager";
import {
  extractLastUserText,
  findLayerByTitle,
  elapsed,
} from "../../utils/agentHelpers";

// ── State ────────────────────────────────────────────────────────────────────

const PointCloudState = Annotation.Root({
  messages: Annotation<ChatHistory>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  outputMessage: Annotation<string>({
    reducer: (current = "", update) =>
      typeof update === "string" && update.trim()
        ? (current ? `${current}\n\n${update}` : update)
        : current,
    default: () => "",
  }),
});

type PointCloudStateType = typeof PointCloudState.State;

// ── Types ────────────────────────────────────────────────────────────────────

type SymbologyMode = "class-code" | "elevation" | "intensity" | "rgb" | "return-number";

interface PointCloudIntent {
  action: "filter" | "symbology" | "point-size" | "density" | "modulation" | "reset" | "reset-filter" | "reset-symbology" | "info";
  layerName: string | null;
  symbology: SymbologyMode | null;
  filterField: string | null;
  filterValues: number[] | null;
  filterMode: "include" | "exclude";
  pointSize: number | null;
  density: number | null;
}

// ── Quick extraction via regex ───────────────────────────────────────────────

// Hoisted to module level to avoid re-creating on every call
const SYM_MAP: [RegExp, SymbologyMode][] = [
  [/\b(class[\s_-]?code|classification|land[\s_-]?cover)\b/i, "class-code"],
  [/\b(elevation|height|z[\s_-]?value)\b/i, "elevation"],
  [/\b(intensity|reflectance)\b/i, "intensity"],
  [/\b(rgb|true[\s_-]?color|natural[\s_-]?color|photo)\b/i, "rgb"],
  [/\b(return[\s_-]?number|returns?)\b/i, "return-number"],
];

const CLASS_NAME_MAP: Record<string, number[]> = {
  "ground": [2],
  "vegetation": [3, 4, 5],
  "low vegetation": [3],
  "medium vegetation": [4],
  "high vegetation": [5],
  "building": [6],
  "buildings": [6],
  "water": [9],
  "unclassified": [1],
  "noise": [7],
  "bridge": [17],
  "overhead": [18],
};

function quickExtract(text: string): PointCloudIntent | null {
  const lower = text.toLowerCase();

  const noFilter: Pick<PointCloudIntent, "filterField" | "filterValues" | "filterMode"> = { filterField: null, filterValues: null, filterMode: "include" };

  // Reset / clear everything
  if (/\b(reset|clear|remove)\s*(all|everything)/i.test(text)) {
    return { action: "reset", layerName: null, symbology: null, ...noFilter, pointSize: null, density: null };
  }
  // Reset / clear filter only
  if (/\b(reset|clear|remove)\s*filter/i.test(text)) {
    return { action: "reset-filter", layerName: null, symbology: null, ...noFilter, pointSize: null, density: null };
  }
  // Reset / clear symbology only
  if (/\b(reset|clear|remove)\s*(symbology|renderer|color|style)/i.test(text)) {
    return { action: "reset-symbology", layerName: null, symbology: null, ...noFilter, pointSize: null, density: null };
  }

  // Intensity modulation: overlay intensity shading on current renderer
  // Must be checked BEFORE symbology so "apply intensity modulation" doesn't become a full renderer swap
  if (/\b(modulat|modification)\b/i.test(lower) && /\bintensity\b/i.test(lower)) {
    return { action: "modulation", layerName: null, symbology: null, ...noFilter, pointSize: null, density: null };
  }
  // Toggle modulation on/off
  if (/\b(toggle|enable|disable|turn\s*(on|off))\b/i.test(lower) && /\b(modulation|intensity\s*overlay)\b/i.test(lower)) {
    return { action: "modulation", layerName: null, symbology: null, ...noFilter, pointSize: null, density: null };
  }

  // Detect exclude intent: "hide class 1", "remove class 1", "all but class 1", "exclude class 1"
  const isExclude = /\b(hide|remove|exclude|without|except|all\s+but|everything\s+but|everything\s+except|show\s+all\s+but|show\s+all\s+except|filter\s+out)\b/i.test(text);

  if (/\b(color|render(?:ing)?|symbolog|symbol|show|display|style|visuali[sz]e|apply|change|set|use|switch\s*to)\b/i.test(lower)) {
    for (const [re, mode] of SYM_MAP) {
      if (re.test(text)) {
        return { action: "symbology", layerName: null, symbology: mode, ...noFilter, pointSize: null, density: null };
      }
    }
  }

  // Filter by field + values: "filter class_code = 2" / "hide class code 1" / "all but class 7"
  const filterMatch = text.match(
    /\b(class[\s_-]?code|elevation|intensity|return[\s_-]?number|number[\s_-]?of[\s_-]?returns|class)\b[^\d]*([\d,\s]+)/i
  );
  if (filterMatch) {
    const field = normalizeFieldName(filterMatch[1]);
    const values = filterMatch[2].match(/\d+/g)?.map(Number) ?? [];
    if (values.length > 0) {
      const mode = isExclude ? "exclude" : "include";
      return { action: "filter", layerName: null, symbology: null, filterField: field, filterValues: values, filterMode: mode, pointSize: null, density: null };
    }
  }

  for (const [name, codes] of Object.entries(CLASS_NAME_MAP)) {
    if (lower.includes(name) && /\b(filter|show|hide|remove|exclude|isolate|all\s+but|except)\b/i.test(lower)) {
      const mode = isExclude ? "exclude" : "include";
      return { action: "filter", layerName: null, symbology: null, filterField: "CLASS_CODE", filterValues: codes, filterMode: mode, pointSize: null, density: null };
    }
  }

  // Point size: "set point size to 4" / "point cloud size to 4" / "bigger points"
  const sizeMatch = text.match(/\bpoint\s*(?:cloud\s*)?size\b[^\d]*(\d+)/i);
  if (sizeMatch) {
    return { action: "point-size", layerName: null, symbology: null, ...noFilter, pointSize: parseInt(sizeMatch[1], 10), density: null };
  }
  if (/\b(bigger|larger|increase)\s*(point|size)/i.test(text)) {
    return { action: "point-size", layerName: null, symbology: null, ...noFilter, pointSize: -1, density: null };
  }
  if (/\b(smaller|reduce|decrease)\s*(point|size)/i.test(text)) {
    return { action: "point-size", layerName: null, symbology: null, ...noFilter, pointSize: -2, density: null };
  }
  // Catch "size to N" when preceded by point cloud context
  const genericSizeMatch = text.match(/\bsize\b[^\d]*(\d+)/i);
  if (genericSizeMatch && /point\s*cloud/i.test(text)) {
    return { action: "point-size", layerName: null, symbology: null, ...noFilter, pointSize: parseInt(genericSizeMatch[1], 10), density: null };
  }

  // Density: "set density to 20" / "more points" / "fewer points"
  const densityMatch = text.match(/\b(density|points\s*per\s*inch)\b[^\d]*(\d+)/i);
  if (densityMatch) {
    return { action: "density", layerName: null, symbology: null, ...noFilter, pointSize: null, density: parseInt(densityMatch[2], 10) };
  }
  if (/\b(more|increase|denser)\s*points?\b/i.test(text)) {
    return { action: "density", layerName: null, symbology: null, ...noFilter, pointSize: null, density: -1 };
  }
  if (/\b(fewer|less|reduce|decrease|sparser)\s*points?\b/i.test(text)) {
    return { action: "density", layerName: null, symbology: null, ...noFilter, pointSize: null, density: -2 };
  }

  return null;
}

function normalizeFieldName(raw: string): string {
  const lower = raw.toLowerCase().replace(/[\s-]+/g, "_");
  if (lower.includes("class")) return "CLASS_CODE";
  if (lower.includes("elevation") || lower === "height" || lower === "z_value") return "ELEVATION";
  if (lower.includes("intensity") || lower === "reflectance") return "INTENSITY";
  if (lower.includes("return_number")) return "RETURN_NUMBER";
  if (lower.includes("number_of_returns")) return "NUMBER_OF_RETURNS";
  return raw.toUpperCase();
}

// ── Find the target point cloud layer ────────────────────────────────────────

function findPointCloudLayer(view: any, layerName: string | null): any {
  const layers = view.map?.layers?.toArray() ?? [];
  if (layerName) {
    const matched = findLayerByTitle(layers, layerName);
    if (matched?.type === "point-cloud") return matched;
  }
  // Default: find the first (or only) point cloud layer
  return layers.find((l: any) => l.type === "point-cloud") ?? null;
}

// ── Apply symbology ──────────────────────────────────────────────────────────

async function applySymbology(layer: any, mode: SymbologyMode): Promise<string> {
  const PC = await import("@arcgis/core/renderers/PointCloudStretchRenderer");
  const PCUnique = await import("@arcgis/core/renderers/PointCloudUniqueValueRenderer");
  const PCRGB = await import("@arcgis/core/renderers/PointCloudRGBRenderer");

  switch (mode) {
    case "class-code": {
      // LAS classification color scheme
      const colorInfos = [
        { value: 1, label: "Unclassified", color: [200, 200, 200] },
        { value: 2, label: "Ground", color: [139, 90, 43] },
        { value: 3, label: "Low Vegetation", color: [144, 238, 144] },
        { value: 4, label: "Medium Vegetation", color: [34, 139, 34] },
        { value: 5, label: "High Vegetation", color: [0, 100, 0] },
        { value: 6, label: "Building", color: [255, 0, 0] },
        { value: 7, label: "Noise", color: [255, 105, 180] },
        { value: 9, label: "Water", color: [0, 100, 255] },
        { value: 17, label: "Bridge Deck", color: [128, 128, 128] },
        { value: 18, label: "High Noise", color: [255, 0, 255] },
      ];
      layer.renderer = new PCUnique.default({
        field: "CLASS_CODE",
        colorUniqueValueInfos: colorInfos.map((c) => ({
          values: [String(c.value)],
          label: c.label,
          color: c.color,
        })),
      });
      return `Symbology set to **class code** with ${colorInfos.length} classification colors.`;
    }
    case "elevation": {
      layer.renderer = new PC.default({
        field: "ELEVATION",
        fieldTransformType: "none",
        stops: [
          { value: 0, color: [0, 100, 0] },
          { value: 50, color: [255, 255, 0] },
          { value: 200, color: [255, 0, 0] },
          { value: 500, color: [255, 255, 255] },
        ],
      });
      return `Symbology set to **elevation** (green → yellow → red → white).`;
    }
    case "intensity": {
      layer.renderer = new PC.default({
        field: "INTENSITY",
        fieldTransformType: "none",
        stops: [
          { value: 0, color: [0, 0, 0] },
          { value: 128, color: [128, 128, 128] },
          { value: 255, color: [255, 255, 255] },
        ],
      });
      return `Symbology set to **intensity** (dark → light).`;
    }
    case "rgb": {
      layer.renderer = new PCRGB.default({
        field: "RGB",
      });
      return `Symbology set to **true color (RGB)**.`;
    }
    case "return-number": {
      layer.renderer = new PCUnique.default({
        field: "RETURN_NUMBER",
        colorUniqueValueInfos: [
          { values: ["1"], label: "First Return", color: [255, 0, 0] },
          { values: ["2"], label: "Second Return", color: [0, 255, 0] },
          { values: ["3"], label: "Third Return", color: [0, 0, 255] },
          { values: ["4"], label: "Fourth Return", color: [255, 255, 0] },
          { values: ["5"], label: "Fifth+ Return", color: [255, 0, 255] },
        ],
      });
      return `Symbology set to **return number** (1st=red, 2nd=green, 3rd=blue, 4th=yellow, 5th+=magenta).`;
    }
  }
}

// ── Apply filter ─────────────────────────────────────────────────────────────

// All standard LAS classification codes
const ALL_CLASS_CODES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

async function applyFilter(layer: any, field: string, values: number[], mode: "include" | "exclude"): Promise<string> {
  const PCFilter = (await import("@arcgis/core/layers/pointCloudFilters/PointCloudValueFilter")).default;

  // PointCloudValueFilter only supports "include" mode.
  // For "exclude", invert: include all codes EXCEPT the excluded ones.
  let includeValues: number[];
  if (mode === "exclude" && field === "CLASS_CODE") {
    const excludeSet = new Set(values);
    includeValues = ALL_CLASS_CODES.filter((c) => !excludeSet.has(c));
  } else {
    includeValues = values;
  }

  layer.filters = [
    new PCFilter({
      field,
      mode: "include",
      values: includeValues,
    }),
  ];
  const modeLabel = mode === "exclude" ? "excluding" : "showing only";
  return `Filtered "${layer.title}" — ${modeLabel} **${field}** [${values.join(", ")}].`;
}

// ── Agent ────────────────────────────────────────────────────────────────────

const createPointCloudGraph = () => {
    async function pointCloudNode(s: PointCloudStateType, config?: RunnableConfig) {
      await sendTraceMessage({ text: "PointCloud: processing request" }, config);
      const text = extractLastUserText(s);
      console.log("[PointCloud] Starting. User text:", text);

      const view = getCurrentView();
      if (!view?.map) {
        return { outputMessage: "No map view is currently available." };
      }

      // Bail out for non-point-cloud requests
      if (/\b(search|find|browse|load|add|open|remove|delete)\b/i.test(text) &&
          !/\b(filter|symbolog|color|render|point\s*size|density|reset|class|elevation|intensity|rgb|return)\b/i.test(text)) {
        return { outputMessage: "" };
      }

      const intent = quickExtract(text);
      if (!intent) {
        return { outputMessage: "" };
      }

      console.log("[PointCloud] Intent:", intent);

      const layer = findPointCloudLayer(view, intent.layerName);
      if (!layer) {
        return {
          outputMessage: "No point cloud layer found on the map. Add a point cloud layer first.",
        };
      }

      const t0 = performance.now();

      try {
        switch (intent.action) {
          case "symbology": {
            if (!intent.symbology) {
              return { outputMessage: "Please specify a symbology: class-code, elevation, intensity, rgb, or return-number." };
            }
            const msg = await applySymbology(layer, intent.symbology);
            const elapsedTime = elapsed(t0);
            return { outputMessage: `${msg} (${elapsedTime}s)` };
          }

          case "filter": {
            if (!intent.filterField || !intent.filterValues?.length) {
              return { outputMessage: "Please specify a field and values to filter by. Example: \"filter CLASS_CODE = 2, 6\"" };
            }
            const msg = await applyFilter(layer, intent.filterField, intent.filterValues, intent.filterMode);
            const elapsedTime = elapsed(t0);
            return { outputMessage: `${msg} (${elapsedTime}s)` };
          }

          case "point-size": {
            // pointSizeAlgorithm lives on the renderer, not the layer
            const renderer = layer.renderer as any;
            const current = renderer?.pointSizeAlgorithm?.size ?? 3;
            let newSize: number;
            if (intent.pointSize === -1) newSize = Math.min(current + 2, 20);
            else if (intent.pointSize === -2) newSize = Math.max(current - 2, 1);
            else newSize = Math.max(1, Math.min(intent.pointSize!, 30));

            if (renderer) {
              renderer.pointSizeAlgorithm = {
                type: "fixed-size",
                useRealWorldSymbolSizes: false,
                size: newSize,
              };
              // Null-swap to force reactivity (clone() not implemented on PointCloudRenderer)
              layer.renderer = null as any;
              layer.renderer = renderer;
            }
            return { outputMessage: `Point size set to **${newSize}** for "${layer.title}".` };
          }

          case "density": {
            // pointsPerInch lives on the renderer, not the layer
            const densRenderer = layer.renderer as any;
            const currentDensity = densRenderer?.pointsPerInch ?? 10;
            let newDensity: number;
            if (intent.density === -1) newDensity = Math.min(currentDensity + 10, 100);
            else if (intent.density === -2) newDensity = Math.max(currentDensity - 10, 1);
            else newDensity = Math.max(1, Math.min(intent.density!, 100));

            if (densRenderer) {
              densRenderer.pointsPerInch = newDensity;
              layer.renderer = null as any;
              layer.renderer = densRenderer;
            }
            return { outputMessage: `Point density set to **${newDensity} points/inch** for "${layer.title}".` };
          }

          case "modulation": {
            // Toggle intensity modulation on/off on the current renderer.
            // PointCloudRenderer.clone() is not implemented in SDK 5.x.
            // Setting a property on the same object reference doesn't trigger reactivity,
            // so we null-swap the renderer to force the SDK to re-render.
            const modRenderer = layer.renderer as any;
            if (!modRenderer) return { outputMessage: "No renderer on this layer to modulate." };
            const wasEnabled = !!modRenderer.colorModulation?.field;
            if (wasEnabled) {
              modRenderer.colorModulation = null;
            } else {
              modRenderer.colorModulation = { field: "INTENSITY", minValue: 0, maxValue: 255 };
            }
            // Null-swap to force reactivity
            layer.renderer = null as any;
            layer.renderer = modRenderer;
            return {
              outputMessage: wasEnabled
                ? `Intensity modulation **disabled** for "${layer.title}".`
                : `Intensity modulation **enabled** for "${layer.title}". Points are now shaded by intensity on top of the current symbology.`,
            };
          }

          case "reset-filter": {
            (layer as any).filters = null;
            return { outputMessage: `Cleared filters for "${layer.title}".` };
          }

          case "reset-symbology": {
            layer.renderer = null as any;
            return { outputMessage: `Reset symbology for "${layer.title}" to defaults.` };
          }

          case "reset": {
            (layer as any).filters = null;
            layer.renderer = null as any;
            return { outputMessage: `Reset filters and symbology for "${layer.title}" to defaults.` };
          }

          case "info": {
            const fields = layer.fields?.map((f: any) => f.name).join(", ") ?? "N/A";
            const infoRenderer = layer.renderer as any;
            const ppi = infoRenderer?.pointsPerInch ?? "default";
            return {
              outputMessage:
                `**${layer.title}** (point-cloud)\n` +
                `- Fields: ${fields}\n` +
                `- Points/inch: ${ppi}\n` +
                `- Filters active: ${layer.filters?.length ?? 0}`,
            };
          }
        }
      } catch (err: any) {
        console.error("[PointCloud] Error:", err);
        return { outputMessage: `Point cloud operation failed: ${err?.message ?? String(err)}` };
      }

      return { outputMessage: "" };
    }

    return new StateGraph(PointCloudState)
      .addNode("pointCloudNode", pointCloudNode)
      .addEdge(START, "pointCloudNode")
      .addEdge("pointCloudNode", END);
};

export const PointCloudAgent: AgentRegistration = {
  id: "point-cloud-agent",
  name: "Point Cloud Agent",
  description:
    "Manages point cloud layer visualization and filtering. " +
    "Supports changing symbology (class code, elevation, intensity, RGB, return number), " +
    "filtering by classification (ground, vegetation, buildings, water), " +
    "adjusting point size and density, and resetting to defaults. " +
    "Use when the user mentions point cloud, LiDAR, LAS, classification, class code, " +
    "point size, point density, return number, or wants to filter/color point cloud data. " +
    "Keywords: point cloud, lidar, las, classification, class code, filter points, " +
    "color by elevation, intensity, rgb, return number, point size, point density, " +
    "reset filter, clear filter, reset symbology, remove filter, clear symbology.",
  createGraph: createPointCloudGraph,
  workspace: PointCloudState,
};
