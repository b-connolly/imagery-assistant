import { StateGraph, START, END } from "@langchain/langgraph/web";
import { invokeToolPrompt } from "@arcgis/ai-orchestrator";
import { HumanMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getCurrentView, getCurrentViewType, requestViewSwitch, getOperationalLayers, onViewChange } from "../utils/viewManager";
import { REQUIRES_3D, extractLastUserText, createAgentState, registerAgentElement, findLayerByTitle , elapsed } from "../utils/agentHelpers";
import { withTimeout } from "../utils/safeFetch";

// ── Extraction tool ──────────────────────────────────────────────────────────

const elevationOffsetTool = tool(async (args) => JSON.stringify(args), {
  name: "extract_elevation_offset_intent",
  description:
    "Extract parameters for adjusting a 3D layer's elevation offset.",
  schema: z.object({
    layerName: z
      .string()
      .nullable()
      .describe(
        "Name or title of the layer to fix. Null means most recently added layer."
      ),
    manualOffset: z
      .number()
      .nullable()
      .describe(
        "Manual offset in meters if the user provides a specific number. Null means auto-detect."
      ),
    action: z
      .enum(["auto-fix", "set-offset", "add-offset", "check"])
      .describe(
        "auto-fix: detect and apply offset automatically. " +
        "set-offset: set offset to the exact value the user specified (absolute). " +
        "add-offset: add/subtract a relative amount to the current offset (e.g., 'add 5m', 'raise 10m'). " +
        "check: report current offset without changing."
      ),
  }),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

interface OffsetIntent {
  layerName: string | null;
  manualOffset: number | null;
  action: "auto-fix" | "set-offset" | "add-offset" | "check" | "click-to-fix";
}

// Track click handler for cleanup
let elevClickRemove: (() => void) | null = null;
onViewChange(() => {
  if (elevClickRemove) { elevClickRemove(); elevClickRemove = null; }
});

function extractLayerName(text: string): string | null {
  // Strip action suffixes before extracting layer name
  const cleaned = text
    .replace(/\b(by|from|via|with)\s+(click(ing)?|map|point|picking|selecting)\b.*/i, "")
    .trim();
  // "fix elevation on BroncosDrone2cm" / "fix elevation for My Layer"
  const onMatch = cleaned.match(/\b(?:on|for|of|layer)\s+["']?([^"'\n]{2,})["']?\s*$/i);
  if (onMatch) return onMatch[1].trim();
  // "fix BroncosDrone2cm elevation" — layer name before the action keyword
  const beforeMatch = cleaned.match(/^(?:fix|adjust|correct|raise|lower)\s+(?:elevation\s+(?:of|on|for)\s+)?["']?(.+?)["']?\s*$/i);
  if (beforeMatch) {
    const name = beforeMatch[1].replace(/\b(elevation|offset|height|floating)\b.*/i, "").trim();
    if (name.length > 1) return name;
  }
  return null;
}

function quickExtractOffsetIntent(text: string): OffsetIntent | null {
  const layerName = extractLayerName(text);

  if (/check\s*offset|what\s*is\s*the\s*offset|current\s*offset/i.test(text)) {
    return { layerName, manualOffset: null, action: "check" };
  }

  // "fix elevation by clicking" / "click to set ground" / "pick ground point"
  if (/\b(click|pick|select|choose)\s*(a\s+)?(point|location|spot|ground|elevation|place)/i.test(text) ||
      /\b(elevation|ground|offset)\s*(by|from|via)\s*(click|picking|selecting|map)/i.test(text) ||
      /\bfix\s*(elevation|offset)\s*(by|from|with)\s*(click|map|point)/i.test(text)) {
    return { layerName, manualOffset: null, action: "click-to-fix" };
  }

  if (
    /fix\s*(the\s+)?(elevation|offset|height|floating|vertical)/i.test(text) ||
    /align\s*(to|with)\s*(the\s+)?(ground|terrain|surface|elevation)/i.test(text) ||
    /snap\s*to\s*(ground|terrain)/i.test(text) ||
    /elevation\s*fix/i.test(text) ||
    /ground\s*align/i.test(text) ||
    /offset\s*(issue|problem|fix|error)/i.test(text)
  ) {
    return { layerName, manualOffset: null, action: "auto-fix" };
  }

  const numMatch = text.match(/(-?\d+(?:\.\d+)?)\s*(?:m\b|meters?\b|ft\b|feet\b|')/i);
  if (!numMatch) return null;

  let value = parseFloat(numMatch[1]);
  const unitPart = numMatch[0].toLowerCase();
  if (/ft|feet|'/.test(unitPart)) value *= 0.3048;

  const isSubtract = /subtract|lower|drop|move\s*down|reduce|minus|negative/i.test(text);
  if (isSubtract) value = -Math.abs(value);

  const isRelative = /\b(add|raise|lift|subtract|lower|drop|move\s*up|move\s*down)\b/i.test(text);

  return {
    layerName,
    manualOffset: value,
    action: isRelative ? "add-offset" : "set-offset",
  };
}

/**
 * Find a 3D layer that supports elevationInfo.
 */
function findTargetLayer(layerName: string | null): any {
  const eligible = getOperationalLayers().filter((l) => REQUIRES_3D.has(l.type));
  if (eligible.length === 0) return null;
  if (layerName) return findLayerByTitle(eligible, layerName);
  return eligible[eligible.length - 1];
}

/**
 * Force visual refresh by removing and re-adding the layer.
 * Some 3D layer types don't re-render on elevationInfo changes alone.
 */
function refreshLayer(view: any, layer: any): void {
  const map = view.map;
  if (!map?.layers) return;
  const idx = map.layers.indexOf(layer);
  map.layers.remove(layer);
  map.layers.add(layer, idx >= 0 ? idx : undefined);
}

/** Mesh layer types that may not render below ground with negative offsets */
const MESH_TYPES = new Set(["integrated-mesh", "integrated-mesh-3dtiles", "gaussian-splat"]);

// ── Agent registration ───────────────────────────────────────────────────────

export function registerElevationOffsetAgent(assistant: HTMLElement) {
  const agentId = "elevation-offset-agent";

  const createGraph = () => {
    const state = createAgentState();

    async function elevationOffsetNode(s: any) {
      const text = extractLastUserText(s);
      const t0 = performance.now();
      console.log("[ElevOffset] Starting. User text:", text);

      // ── Bail out: measurement/analysis commands belong to MeasurementAgent ──
      if (
        /\b(measure|measurement|measuring|ruler)\b/i.test(text) &&
        !/\b(offset|fix|floating|align|underground)\b/i.test(text)
      ) {
        console.log("[ElevOffset] Skipping — looks like a measurement request for MeasurementAgent.");
        return { outputMessage: "" };
      }
      if (/\b(elevation\s*profile|cross[- ]?section|terrain\s*profile)\b/i.test(text)) {
        console.log("[ElevOffset] Skipping — elevation profile request for MeasurementAgent.");
        return { outputMessage: "" };
      }
      if (
        /\b(distance|area|polygon|acreage|hectare|how\s*far)\b/i.test(text) &&
        !/\b(offset|elevation\s*offset|fix|floating|align)\b/i.test(text)
      ) {
        console.log("[ElevOffset] Skipping — distance/area request for MeasurementAgent.");
        return { outputMessage: "" };
      }

      // ── Bail out: search/content commands belong to ContentSearchAgent ──
      if (/\b(search|find|browse)\s+(for\s+)?(content|layers|items|data|imagery|services)\b/i.test(text)) {
        console.log("[ElevOffset] Skipping — looks like a content search request.");
        return { outputMessage: "" };
      }

      // ── Ensure 3D view ──────────────────────────────────────────────
      if (getCurrentViewType() !== "3d") {
        console.log("[ElevOffset] Switching to 3D view...");
        try {
          await requestViewSwitch("3d");
        } catch {
          return {
            outputMessage:
              "Could not switch to 3D view. Please switch to 3D using the toggle, then ask me again.",
          };
        }
      }

      const view = getCurrentView() as any;
      if (!view) {
        return { outputMessage: "No active scene view. Please wait for the scene to load." };
      }

      const ground = view.map?.ground;
      if (!ground) {
        return {
          outputMessage:
            "The scene has no ground/elevation surface configured. " +
            "Make sure the scene uses world-elevation as its ground.",
        };
      }

      try {
        if (ground.load) await withTimeout(ground.load(), 30000, "Ground surface load");
        // Also load individual elevation layers — ground.load() alone
        // doesn't guarantee the elevation layer data is fetched.
        if (ground.layers?.length > 0) {
          await Promise.all(
            ground.layers.map((l: any) =>
              l.load ? withTimeout(l.load(), 30000, `Elevation layer "${l.title}"`) : Promise.resolve()
            )
          );
        }
      } catch (err) {
        console.warn("[ElevOffset] Ground load failed (non-critical):", err);
      }
      console.log("[ElevOffset] Ground ready:", ground, "elevation layers:", ground.layers?.length);

      // ── Extract intent ──────────────────────────────────────────────
      let intent: OffsetIntent = { layerName: null, manualOffset: null, action: "auto-fix" };

      const quickResult = quickExtractOffsetIntent(text);
      if (quickResult) {
        intent = quickResult;
        console.log("[ElevOffset] Quick-extracted intent:", intent);
      } else {
        console.log("[ElevOffset] Calling invokeToolPrompt...");
        try {
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("LLM extraction timed out")), 15000)
          );
          const response = await Promise.race([
            invokeToolPrompt({
              promptText:
                "You extract parameters for adjusting a 3D layer's elevation offset. " +
                "If the user wants to fix floating or alignment, use auto-fix. " +
                "If they provide a specific number, use set-offset. " +
                "If they want to know the current state, use check.",
              messages: [new HumanMessage(text || "fix elevation offset")],
              tools: [elevationOffsetTool],
              temperature: 0,
            }),
            timeoutPromise,
          ]);
          const call = (
            Array.isArray((response as any)?.tool_calls)
              ? (response as any).tool_calls
              : []
          ).find((tc: any) => tc?.name === "extract_elevation_offset_intent");
          if (call?.args) intent = { ...intent, ...call.args };
        } catch (err) {
          console.error("[ElevOffset] invokeToolPrompt failed:", err);
        }
      }
      console.log("[ElevOffset] Final intent:", intent);

      // ── Find target layer ───────────────────────────────────────────
      const layer = findTargetLayer(intent.layerName);
      if (!layer) {
        return {
          outputMessage:
            intent.layerName
              ? `Could not find a 3D layer matching "${intent.layerName}". ` +
                "Make sure the layer is loaded and is a supported 3D type."
              : "No 3D layers found in the scene. Load a 3D layer first.",
        };
      }

      await withTimeout(layer.load(), 30000, `Load "${layer.title}"`);
      const layerAny = layer as any;
      const currentElevInfo = layerAny.elevationInfo;
      const currentOffset: number = currentElevInfo?.offset ?? 0;
      console.log("[ElevOffset] Target layer:", layer.title, "type:", layer.type, "currentOffset:", currentOffset);

      // ── Click-to-fix: let user pick a ground reference point ─────
      if (intent.action === "click-to-fix") {
        if (getCurrentViewType() !== "3d") {
          return { outputMessage: "Click-to-fix requires a 3D scene view." };
        }

        // Clean up any previous click handler
        if (elevClickRemove) {
          elevClickRemove();
          elevClickRemove = null;
        }

        const targetLayer = layer;
        const targetLayerAny = layerAny;

        const handle = view.on("click", async (event: any) => {
          try {
            // Query terrain elevation at clicked point
            const ground = view.map?.ground;
            if (!ground) return;

            const result = await withTimeout(ground.queryElevation(event.mapPoint), 15000, "Query elevation at click point");
            const terrainZ = result.geometry?.z ?? 0;

            // Apply offset
            const newOffset = terrainZ;
            targetLayerAny.elevationInfo = {
              mode: "absolute-height",
              offset: newOffset,
            };
            refreshLayer(view, targetLayer);

            console.log("[ElevOffset] Click-to-fix: terrain Z =", terrainZ, "applied offset:", newOffset);

            // Show result via popup
            view.popup?.open({
              title: `Elevation Fixed: ${targetLayer.title}`,
              content: `Ground elevation at click: ${terrainZ.toFixed(1)}m\nApplied offset: ${newOffset.toFixed(1)}m`,
              location: event.mapPoint,
            });
          } catch (err: any) {
            console.error("[ElevOffset] Click-to-fix error:", err);
          }

          // Remove handler after single use
          handle.remove();
          elevClickRemove = null;
        });

        elevClickRemove = () => handle.remove();

        return {
          outputMessage: `Click anywhere on the map to set the ground reference elevation for "${layer.title}". The terrain elevation at that point will be used as the offset.`,
        };
      }

      // ── Check action ────────────────────────────────────────────────
      if (intent.action === "check") {
        const fullExt = layer.fullExtent;
        const zInfo = fullExt?.hasZ
          ? `Layer Z range: ${fullExt.zmin?.toFixed(1)}m – ${fullExt.zmax?.toFixed(1)}m. `
          : "Layer Z range not available. ";
        const elapsedTime = elapsed(t0);
        return {
          outputMessage:
            `Layer "${layer.title}" — current elevation offset: ${currentOffset}m. ${zInfo}` +
            `Mode: ${currentElevInfo?.mode ?? "not set"}. (${elapsedTime}s)`,
        };
      }

      // ── Set manual offset (absolute or relative) ─────────────────────
      if ((intent.action === "set-offset" || intent.action === "add-offset") && intent.manualOffset !== null) {
        const newOffset = intent.action === "add-offset"
          ? currentOffset + intent.manualOffset
          : intent.manualOffset;
        layerAny.elevationInfo = {
          mode: "absolute-height",
          offset: newOffset,
        };

        refreshLayer(view, layer);

        const verb = intent.action === "add-offset" ? "adjusted" : "set";
        console.log("[ElevOffset]", verb, "offset:", newOffset, "(was:", currentOffset, "manual:", intent.manualOffset, ")");

        try {
          if (layer.fullExtent) await view.goTo(layer.fullExtent, { duration: 2000 });
        } catch {
          // Non-critical
        }

        const elapsedTime = elapsed(t0);
        const detail = intent.action === "add-offset"
          ? `(previous: ${currentOffset.toFixed(1)}m, ${intent.manualOffset > 0 ? "+" : ""}${intent.manualOffset}m)`
          : `(was ${currentOffset.toFixed(1)}m)`;
        return {
          outputMessage:
            `Set elevation offset to ${newOffset.toFixed(1)}m on "${layer.title}" ${detail} in ${elapsedTime}s.`,
        };
      }

      // ── Auto-fix ────────────────────────────────────────────────────
      const fullExtent = layer.fullExtent;
      if (!fullExtent) {
        return {
          outputMessage: `Layer "${layer.title}" has no extent information. Try setting a manual offset instead (e.g., "set offset to -20").`,
        };
      }

      let terrainZ: number;
      try {
        if (!ground.queryElevation) {
          return {
            outputMessage:
              "The scene's ground surface is not available for elevation queries. " +
              "Try setting a manual offset instead (e.g., \"add 16m to the layer\").",
          };
        }

        const { xmin, xmax, ymin, ymax, spatialReference } = fullExtent;
        const gridSize = 5;
        const sampleCoords: number[][] = [];
        for (let row = 0; row < gridSize; row++) {
          for (let col = 0; col < gridSize; col++) {
            const x = xmin + ((xmax - xmin) * (col + 0.5)) / gridSize;
            const y = ymin + ((ymax - ymin) * (row + 0.5)) / gridSize;
            sampleCoords.push([x, y]);
          }
        }

        const Multipoint = (await import("@arcgis/core/geometry/Multipoint")).default;
        const multipoint = new Multipoint({
          points: sampleCoords,
          spatialReference,
        });
        const result = await withTimeout(ground.queryElevation(multipoint), 30000, "Query terrain elevation samples");
        const sampledPoints = (result.geometry as any).points as number[][];
        const validZs = sampledPoints.map((p: number[]) => p[2]).filter((z: number) => isFinite(z));

        if (validZs.length === 0) {
          return {
            outputMessage: "Could not sample terrain elevations across the layer extent. Try a manual offset.",
          };
        }

        // Filter out water/sea-level samples to get land-only elevations
        const SEA_LEVEL_THRESHOLD = 1.5;
        const landZs = validZs.filter((z: number) => Math.abs(z) > SEA_LEVEL_THRESHOLD);

        if (landZs.length > 0) {
          const sorted = [...landZs].sort((a: number, b: number) => a - b);
          terrainZ = sorted[Math.floor(sorted.length / 2)];
          console.log("[ElevOffset] Land samples:", landZs.length, "/", validZs.length,
            "Median land elevation:", terrainZ.toFixed(2),
            "Min:", Math.min(...landZs).toFixed(2), "Max:", Math.max(...landZs).toFixed(2));
        } else {
          terrainZ = validZs.reduce((sum: number, z: number) => sum + z, 0) / validZs.length;
          console.log("[ElevOffset] All samples near sea level, using raw average:", terrainZ.toFixed(2));
        }
        console.log("[ElevOffset] Sampled", validZs.length, "total points. Final terrain Z:", terrainZ.toFixed(2));
      } catch (err: any) {
        console.error("[ElevOffset] queryElevation failed:", err);
        return {
          outputMessage: `Could not query terrain elevation: ${err?.message ?? String(err)}. Try setting a manual offset instead (e.g., "add 16m to the layer").`,
        };
      }

      const newOffset = currentOffset + terrainZ;
      console.log("[ElevOffset] Calculated offset:", newOffset, "(avgTerrainZ:", terrainZ, "existingOffset:", currentOffset, ")");

      if (MESH_TYPES.has(layer.type) && newOffset < 0) {
        console.warn("[ElevOffset] Negative offset on mesh layer — may not render below ground.");
      }

      layerAny.elevationInfo = {
        mode: "absolute-height",
        offset: newOffset,
      };

      refreshLayer(view, layer);

      console.log("[ElevOffset] Applied auto-fix offset:", newOffset);

      try {
        await view.goTo(layer.fullExtent, { duration: 2000 });
      } catch {
        // Non-critical
      }

      const elapsedTime = elapsed(t0);
      const results = [
        `Fixed elevation for "${layer.title}" in ${elapsedTime}s.`,
        `Avg terrain elevation: ${terrainZ.toFixed(1)}m.`,
        `Applied offset: ${newOffset.toFixed(1)}m.`,
      ];

      if (MESH_TYPES.has(layer.type) && newOffset < 0) {
        results.push(
          "Note: Integrated mesh layers may not render below the ground surface even with negative offsets."
        );
      }

      return { outputMessage: results.join(" ") };
    }

    return new StateGraph(state)
      .addNode("elevationOffsetNode", elevationOffsetNode)
      .addEdge(START, "elevationOffsetNode")
      .addEdge("elevationOffsetNode", END);
  };

  registerAgentElement(assistant, {
    id: agentId,
    name: "Fix Elevation Offset",
    description:
      "Fixes vertical elevation offset for 3D layers that float above or sink below the terrain. " +
      "Auto-detects the offset by comparing the layer's z-position to the ground elevation, " +
      "or lets the user set a manual offset. Works with Integrated Meshes, Gaussian Splats, " +
      "3D Tiles, Scene Layers, and other 3D layer types. " +
      "Use when a 3D layer appears to be floating, underground, or misaligned vertically, " +
      "or when the user wants to check, fix, or adjust elevation offset. " +
      "Also use when the user wants to add, subtract, raise, or lower a layer by a number of meters " +
      "(e.g., 'add 16m to the layer', 'lower the mesh by 20 meters', 'raise the Alcatraz layer 10m').",
    createGraph,
  });
}
