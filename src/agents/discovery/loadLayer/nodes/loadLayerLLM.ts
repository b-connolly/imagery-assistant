import type { RunnableConfig } from "@langchain/core/runnables";
import { sendTraceMessage } from "@arcgis/ai-components/utils/index.js";
import { invokeToolPrompt } from "@arcgis/ai-orchestrator";
import { HumanMessage } from "@langchain/core/messages";
import { loadLayerTools } from "../tools";
import { quickExtractIntent, loadLayer } from "../tools/loadLayer/core";
import { extractLastUserText } from "../../../../utils/agentHelpers";
import type { LoadLayerStateType } from "../state";

const prompt =
  "You extract parameters to load, remove, zoom to layers, or geocode places on a map. " +
  "The user may provide a keyword/name, item ID, or service URL for loading. " +
  "This supports ALL ArcGIS layer types: imagery, feature, tile, scene, " +
  "map image, WMS, WFS, KML, GeoJSON, 3D tiles, and more.\n\n" +
  "Available tools:\n" +
  "- load_layer: Load a new layer from keyword search, item ID, or service URL\n" +
  "- remove_layer: Remove a layer by name or remove all layers\n" +
  "- zoom_to_layer: Zoom to a layer's extent\n" +
  "- geocode_place: Navigate to a place by name (city, address, landmark)\n\n" +
  "Always call the appropriate tool. If the user provides a URL, use load_layer with serviceUrl. " +
  "If they provide a 32-char hex ID, use load_layer with itemId. " +
  "Otherwise, use load_layer with keyword.";

/**
 * LLM node — uses quick-extraction first, falls back to invokeToolPrompt.
 * For load operations, directly calls loadLayer core to avoid double tool invocation.
 */
export async function loadLayerLLM(
  state: LoadLayerStateType,
  config?: RunnableConfig,
): Promise<Partial<LoadLayerStateType>> {
  const text = extractLastUserText(state);
  await sendTraceMessage({ text: "LoadLayer: processing request" }, config);
  console.log("[LoadLayer] LLM node starting. User text:", text);

  // ── Quick extraction — bypass LLM for obvious URL/item ID ──────────
  const quickResult = quickExtractIntent(text);
  if (quickResult) {
    console.log("[LoadLayer] Quick-extracted intent:", quickResult);
    const msg = await loadLayer(
      {
        keyword: quickResult.keyword ?? undefined,
        itemId: quickResult.itemId ?? undefined,
        serviceUrl: quickResult.serviceUrl ?? undefined,
      },
      text
    );
    return { outputMessage: msg };
  }

  // ── LLM extraction ─────────────────────────────────────────────────
  console.log("[LoadLayer] Calling invokeToolPrompt...");
  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("LLM extraction timed out")), 15000)
    );

    const response = await Promise.race([
      invokeToolPrompt({
        promptText: prompt,
        messages: [new HumanMessage(text || "load layer")],
        tools: loadLayerTools,
        temperature: 0,
      }),
      timeoutPromise,
    ]);

    return {
      ...state,
      messages: [...state.messages, response as any],
      outputMessage: (response as any).content?.toString() ?? "",
    };
  } catch (err) {
    console.error("[LoadLayer] invokeToolPrompt failed:", err);
    // Fall back to keyword search with the raw text
    if (text) {
      console.log("[LoadLayer] Falling back to keyword search:", text);
      const msg = await loadLayer({ keyword: text }, text);
      return { outputMessage: msg };
    }
    return {
      outputMessage:
        "Please provide a layer name, item ID, or service URL to load a layer.",
    };
  }
}
