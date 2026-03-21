import { StateGraph, START, END } from "@langchain/langgraph/web";
import { invokeToolPrompt } from "@arcgis/ai-orchestrator";
import { HumanMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import ImageryLayer from "@arcgis/core/layers/ImageryLayer";
import { getCurrentView, onViewChange } from "../utils/viewManager";
import { extractLastUserText, createAgentState, registerAgentElement , elapsed } from "../utils/agentHelpers";
import {
  applyStretch,
  applyColorRamp,
  applyRasterFunction,
  applyServerRasterFunction,
  getAvailableRasterFunctions,
  identifyPixel,
  type StretchType,
  type ColorRampName,
  type RasterFunctionName,
} from "../utils/rasterFunctions";

// ── Extraction tool ──────────────────────────────────────────────────────────

const analysisToolSchema = z.object({
  action: z
    .enum([
      "apply_stretch",
      "apply_color_ramp",
      "apply_raster_function",
      "apply_server_function",
      "setup_click_popup",
      "identify_center",
      "take_screenshot",
      "list_functions",
    ])
    .describe(
      "Action to perform. " +
      "apply_stretch: apply a stretch renderer (standard-deviation, min-max, percent-clip). " +
      "apply_color_ramp: apply a color ramp (inferno, viridis, grayscale) with optional stretch. " +
      "apply_raster_function: apply a built-in raster function (NDVI, Hillshade, Slope, Aspect, ColorIR, None). " +
      "apply_server_function: apply a named server-side processing template by exact name. " +
      "setup_click_popup: enable click-to-identify popup showing pixel values. " +
      "identify_center: identify pixel values at the current map center. " +
      "take_screenshot: capture the current view as an image. " +
      "list_functions: list available server-side raster functions for the imagery layer."
    ),
  stretchType: z
    .enum(["none", "standard-deviation", "min-max", "percent-clip"])
    .nullable()
    .describe("Stretch type for apply_stretch or apply_color_ramp."),
  stdDevs: z
    .number()
    .nullable()
    .describe("Number of standard deviations (default 2). Only for standard-deviation stretch."),
  colorRamp: z
    .enum(["inferno", "viridis", "grayscale"])
    .nullable()
    .describe("Color ramp name for apply_color_ramp."),
  rasterFunction: z
    .enum(["NDVI", "Hillshade", "Slope", "Aspect", "ColorIR", "None"])
    .nullable()
    .describe("Built-in raster function for apply_raster_function."),
  serverFunctionName: z
    .string()
    .nullable()
    .describe("Exact server-side raster function name for apply_server_function."),
  layerTitle: z
    .string()
    .nullable()
    .describe("Title of the target imagery layer. If null, uses the first imagery layer found."),
});

const analysisTool = tool(async (args) => JSON.stringify(args), {
  name: "extract_analysis_intent",
  description:
    "Extract the imagery analysis action and parameters from the user message.",
  schema: analysisToolSchema,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Find an ImageryLayer in the current view, optionally matching a title.
 */
function findImageryLayer(titleHint?: string | null): ImageryLayer | null {
  const view = getCurrentView();
  if (!view?.map) return null;

  const layers = view.map.layers.toArray();
  const imageryLayers = layers.filter(
    (l) => l.type === "imagery" || l.type === "imagery-tile"
  ) as ImageryLayer[];

  if (imageryLayers.length === 0) return null;

  if (titleHint) {
    const lower = titleHint.toLowerCase();
    const match = imageryLayers.find(
      (l) => l.title?.toLowerCase().includes(lower)
    );
    if (match) return match;
  }

  // Return the topmost (last added) imagery layer
  return imageryLayers[imageryLayers.length - 1];
}

// Track click handler so we can add/remove it
let clickHandlerRemove: (() => void) | null = null;

// Clean up click handler when view switches (2D↔3D)
onViewChange(() => {
  if (clickHandlerRemove) {
    clickHandlerRemove();
    clickHandlerRemove = null;
  }
});

// ── Agent registration ───────────────────────────────────────────────────────

export function registerImageryAnalysisAgent(assistant: HTMLElement) {
  const agentId = "imagery-analysis-agent";

  const createGraph = () => {
    const state = createAgentState();

    async function analysisNode(s: any) {
      const text = extractLastUserText(s);
      const t0 = performance.now();

      const view = getCurrentView();
      if (!view) {
        return {
          outputMessage:
            "No active map or scene view. Please wait for the map to load.",
        };
      }

      // ── Bail out: PointCloudAgent territory ──
      if (/\b(class[\s_-]?code|classification|point\s*cloud|lidar|point\s*size|point\s*density|points?\s*per\s*inch|return[\s_-]?number)\b/i.test(text) ||
          (/\bfilter\b/i.test(text) && /\b(class|ground|vegetation|building|water|noise)\b/i.test(text))) {
        return { outputMessage: "" };
      }

      // ── Extract intent ──────────────────────────────────────────────────
      let intent: z.infer<typeof analysisToolSchema> = {
        action: "apply_stretch",
        stretchType: null,
        stdDevs: null,
        colorRamp: null,
        rasterFunction: null,
        serverFunctionName: null,
        layerTitle: null,
      };

      try {
        const response = await invokeToolPrompt({
          promptText:
            "You extract parameters for imagery analysis actions. " +
            "Always call extract_analysis_intent with the action and relevant parameters.\n\n" +
            "Mapping guide:\n" +
            "- 'standard deviation stretch' / 'std dev stretch' → apply_stretch with stretchType='standard-deviation'\n" +
            "- 'min-max stretch' → apply_stretch with stretchType='min-max'\n" +
            "- 'percent clip' → apply_stretch with stretchType='percent-clip'\n" +
            "- 'inferno' / 'render with inferno' / 'inferno color ramp' → apply_color_ramp with colorRamp='inferno'\n" +
            "- 'viridis' → apply_color_ramp with colorRamp='viridis'\n" +
            "- 'grayscale' → apply_color_ramp with colorRamp='grayscale'\n" +
            "- 'NDVI' / 'vegetation index' → apply_raster_function with rasterFunction='NDVI'\n" +
            "- 'hillshade' / 'shaded relief' → apply_raster_function with rasterFunction='Hillshade'\n" +
            "- 'slope' → apply_raster_function with rasterFunction='Slope'\n" +
            "- 'aspect' → apply_raster_function with rasterFunction='Aspect'\n" +
            "- 'color infrared' / 'color IR' / 'false color' → apply_raster_function with rasterFunction='ColorIR'\n" +
            "- 'reset' / 'remove function' / 'original' → apply_raster_function with rasterFunction='None'\n" +
            "- 'click popup' / 'identify on click' / 'pixel popup' → setup_click_popup\n" +
            "- 'identify pixel' / 'pixel value at center' → identify_center\n" +
            "- 'screenshot' / 'capture view' / 'export image' → take_screenshot\n" +
            "- 'list functions' / 'available functions' / 'processing templates' → list_functions\n" +
            "- If user references a specific named template like 'NDVI (Colorized)', 'NDVI (Raw)', 'Color IR', 'RGB' → apply_server_function with that exact serverFunctionName\n" +
            "- If user says 'apply [exact name]' or 'change to [name]' where name matches a processing template → apply_server_function with serverFunctionName\n",
          messages: [new HumanMessage(text || "analyze imagery")],
          tools: [analysisTool],
          temperature: 0,
        });
        const call = (
          Array.isArray((response as any)?.tool_calls)
            ? (response as any).tool_calls
            : []
        ).find((tc: any) => tc?.name === "extract_analysis_intent");
        if (call?.args) intent = { ...intent, ...call.args };
      } catch {
        // fall through
      }

      // ── Auto-match server-side raster functions ────────────────────────
      // Prefer server-side processing templates when available.
      // Searches ALL imagery layers for a matching template, preferring the title-matched layer.
      {
        const skipActions = new Set(["setup_click_popup", "identify_center", "take_screenshot", "list_functions"]);
        if (!skipActions.has(intent.action)) {
          const allImageryLayers = (view.map?.layers?.toArray() ?? []).filter(
            (l: any) => l.type === "imagery" || l.type === "imagery-tile"
          ) as ImageryLayer[];

          // Put the title-matched layer first so it's preferred
          const preferredLayer = findImageryLayer(intent.layerTitle);
          const orderedLayers = preferredLayer
            ? [preferredLayer, ...allImageryLayers.filter((l) => l !== preferredLayer)]
            : allImageryLayers;

          const textLower = text.toLowerCase();

          for (const layer of orderedLayers) {
            const availableFns = getAvailableRasterFunctions(layer);
            if (availableFns.length === 0) continue;

            let matchedFn: string | null = null;

            // 1) Direct name match — user text contains a server function name
            matchedFn = availableFns.find(
              (fn) => fn !== "None" && textLower.includes(fn.toLowerCase())
            ) ?? null;

            // 2) Stretch-type keyword match — map user stretch terms to server function names
            if (!matchedFn && (intent.action === "apply_stretch" || /\bstretch\b/i.test(text))) {
              const stretchPatterns: [RegExp, RegExp][] = [
                [/\b(std\s*dev|standard\s*deviation)\b/i, /std\s*dev|standard.?deviation/i],
                [/\bmin[\s-]*max\b/i, /min[\s_-]*max/i],
                [/\bpercent[\s-]*clip\b/i, /percent[\s_-]*clip/i],
              ];
              for (const [textPattern, fnPattern] of stretchPatterns) {
                if (textPattern.test(text)) {
                  matchedFn = availableFns.find((fn) => fnPattern.test(fn)) ?? null;
                  if (matchedFn) break;
                }
              }
              if (!matchedFn) {
                matchedFn = availableFns.find((fn) => /\bstretch\b/i.test(fn)) ?? null;
              }
            }

            if (matchedFn) {
              applyServerRasterFunction(layer, matchedFn);
              const elapsedTime = elapsed(t0);
              return {
                outputMessage: `Applied server processing template "${matchedFn}" to "${layer.title}" in ${elapsedTime}s.`,
              };
            }
          }
        }
      }

      // ── Execute action ──────────────────────────────────────────────────

      switch (intent.action) {
        case "apply_stretch": {
          const layer = findImageryLayer(intent.layerTitle);
          if (!layer) {
            return {
              outputMessage:
                "No imagery layer found on the map. Load an imagery layer first.",
            };
          }
          // Fall back to client-side stretch (no matching server function was found above)
          const stretch = (intent.stretchType ?? "standard-deviation") as StretchType;
          const devs = intent.stdDevs ?? 2;
          applyStretch(layer, stretch, devs);
          const elapsedTime = elapsed(t0);
          return {
            outputMessage: `Applied ${stretch} stretch${stretch === "standard-deviation" ? ` (${devs} std devs)` : ""} to "${layer.title}" in ${elapsedTime}s.`,
          };
        }

        case "apply_color_ramp": {
          const layer = findImageryLayer(intent.layerTitle);
          if (!layer) {
            return {
              outputMessage:
                "No imagery layer found on the map. Load an imagery layer first.",
            };
          }
          const ramp = (intent.colorRamp ?? "inferno") as ColorRampName;
          const stretch = (intent.stretchType ?? "standard-deviation") as StretchType;
          const devs = intent.stdDevs ?? 2;
          applyColorRamp(layer, ramp, stretch, devs);
          const elapsedTime = elapsed(t0);
          return {
            outputMessage: `Applied ${ramp} color ramp with ${stretch} stretch to "${layer.title}" in ${elapsedTime}s.`,
          };
        }

        case "apply_raster_function": {
          const layer = findImageryLayer(intent.layerTitle);
          if (!layer) {
            return {
              outputMessage:
                "No imagery layer found on the map. Load an imagery layer first.",
            };
          }
          const fn = (intent.rasterFunction ?? "None") as RasterFunctionName;
          applyRasterFunction(layer, fn);
          const elapsedTime = elapsed(t0);
          if (fn === "None") {
            return {
              outputMessage: `Removed raster function from "${layer.title}" in ${elapsedTime}s.`,
            };
          }
          return {
            outputMessage: `Applied ${fn} raster function to "${layer.title}" in ${elapsedTime}s.`,
          };
        }

        case "apply_server_function": {
          const layer = findImageryLayer(intent.layerTitle);
          if (!layer) {
            return {
              outputMessage:
                "No imagery layer found on the map. Load an imagery layer first.",
            };
          }
          const fnName = intent.serverFunctionName;
          if (!fnName) {
            return {
              outputMessage:
                "Please specify the exact name of the server-side processing template to apply.",
            };
          }
          applyServerRasterFunction(layer, fnName);
          const elapsedTime = elapsed(t0);
          return {
            outputMessage: `Applied server processing template "${fnName}" to "${layer.title}" in ${elapsedTime}s.`,
          };
        }

        case "setup_click_popup": {
          const layer = findImageryLayer(intent.layerTitle);
          if (!layer) {
            return {
              outputMessage:
                "No imagery layer found on the map. Load an imagery layer first.",
            };
          }

          // Remove existing handler if any
          if (clickHandlerRemove) {
            clickHandlerRemove();
            clickHandlerRemove = null;
          }

          const layerRef = layer;
          const popupTitle = layer.title ?? "Imagery Layer";
          const handle = view.on("click", async (event: any) => {
            const point = event.mapPoint;
            if (!point) return;

            const result = await identifyPixel(layerRef, point, view);
            if (!result) {
              view.popup!.open({
                title: popupTitle,
                content: "No pixel values found at this location.",
                location: point,
              });
              return;
            }

            const values = result.values;
            let content: string;

            if (values.length === 1) {
              content = `<b>Pixel Value:</b> ${values[0].toFixed(2)}`;
            } else {
              content =
                `<b>Band Values:</b><br>` +
                values.map((v, i) => `Band ${i + 1}: ${v.toFixed(2)}`).join("<br>");
            }

            view.popup!.open({
              title: result.layerTitle,
              content,
              location: point,
            });
          });

          clickHandlerRemove = () => handle.remove();

          const elapsedTime = elapsed(t0);
          return {
            outputMessage: `Click-to-identify popup enabled for "${layer.title}" in ${elapsedTime}s. Click anywhere on the imagery to see pixel values.`,
          };
        }

        case "identify_center": {
          const layer = findImageryLayer(intent.layerTitle);
          if (!layer) {
            return {
              outputMessage:
                "No imagery layer found on the map. Load an imagery layer first.",
            };
          }
          const center = view.center;
          if (!center) {
            return { outputMessage: "Cannot determine map center." };
          }
          const result = await identifyPixel(layer, center, view);
          if (!result) {
            return {
              outputMessage: `No pixel values found at the current map center for "${layer.title}".`,
            };
          }
          const vals = result.values
            .map((v, i) => `Band ${i + 1}: ${v.toFixed(2)}`)
            .join(", ");
          const elapsedTime = elapsed(t0);
          return {
            outputMessage:
              `Pixel values at center (${center.longitude!.toFixed(5)}, ${center.latitude!.toFixed(5)}) ` +
              `on "${layer.title}": ${vals} (${elapsedTime}s)`,
          };
        }

        case "take_screenshot": {
          try {
            const screenshot = await view.takeScreenshot({ format: "png" });
            // Open in a new tab since we can't directly send binary back
            const win = window.open();
            if (win) {
              win.document.write(
                `<img src="${screenshot.dataUrl}" style="max-width:100%;background:#222" />`
              );
              win.document.title = "View Screenshot";
            }
            const elapsedTime = elapsed(t0);
            return {
              outputMessage: `Screenshot captured and opened in a new tab in ${elapsedTime}s.`,
            };
          } catch (err: any) {
            return {
              outputMessage: `Failed to take screenshot: ${err?.message ?? String(err)}`,
            };
          }
        }

        case "list_functions": {
          const layer = findImageryLayer(intent.layerTitle);
          if (!layer) {
            return {
              outputMessage:
                "No imagery layer found on the map. Load an imagery layer first.",
            };
          }
          const fns = getAvailableRasterFunctions(layer);
          const elapsedTime = elapsed(t0);
          if (fns.length === 0) {
            return {
              outputMessage: `"${layer.title}" has no server-side raster functions available. You can still apply client-side stretches and color ramps. (${elapsedTime}s)`,
            };
          }
          return {
            outputMessage:
              `Available processing templates for "${layer.title}":\n` +
              fns.map((f) => `• ${f}`).join("\n") +
              `\n\nAsk me to apply any of these by name. (${elapsedTime}s)`,
          };
        }

        default:
          return {
            outputMessage:
              "I didn't understand that analysis request. Try asking to:\n" +
              "• Apply a stretch (standard deviation, min-max, percent clip)\n" +
              "• Apply a color ramp (inferno, viridis, grayscale)\n" +
              "• Apply a raster function (NDVI, Hillshade, Slope, Aspect, Color IR)\n" +
              "• Enable click-to-identify popup for pixel values\n" +
              "• Take a screenshot of the current view",
          };
      }
    }

    return new StateGraph(state)
      .addNode("analysisNode", analysisNode)
      .addEdge(START, "analysisNode")
      .addEdge("analysisNode", END);
  };

  registerAgentElement(assistant, {
    id: agentId,
    name: "Imagery Analysis",
    description:
      "Analyzes, renders, and visualizes ALREADY-LOADED imagery layers on the map. " +
      "Use when the user wants to change how an existing layer looks or extract information from it. " +
      "Capabilities: apply stretch renderers (standard deviation, min-max, percent clip), " +
      "apply color ramps (inferno, viridis, grayscale), " +
      "apply raster functions (NDVI, Hillshade, Slope, Aspect, Color Infrared), " +
      "apply server-side processing templates by name, " +
      "enable click-to-identify popups showing pixel values, " +
      "identify pixel values at map center, take screenshots, list available processing templates. " +
      "Keywords: render, stretch, colorize, inferno, viridis, NDVI, hillshade, slope, " +
      "popup, identify, pixel, screenshot, processing template, color ramp, " +
      "raster function, analyze, visualize, style.",
    createGraph,
  });
}
