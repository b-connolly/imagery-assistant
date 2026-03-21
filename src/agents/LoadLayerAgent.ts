import { StateGraph, START, END } from "@langchain/langgraph/web";
import { invokeToolPrompt } from "@arcgis/ai-orchestrator";
import { HumanMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  createLayerFromUrl,
  createLayerFromItemId,
  isElevationService,
  addElevationLayerToGround,
} from "../utils/layerFactory";
import { searchAllItems, searchWebMaps, searchWebScenes, getPortalItemUrl } from "../utils/portalSearch";
import { getCurrentView, getCurrentViewType, requestViewSwitch, requestWebMapSwitch, requestWebSceneSwitch } from "../utils/viewManager";
import ImageryLayer from "@arcgis/core/layers/ImageryLayer";
import {
  applyStretch,
  applyServerRasterFunction,
  getAvailableRasterFunctions,
  type StretchType,
} from "../utils/rasterFunctions";
import { REQUIRES_3D, extractLastUserText, createAgentState, registerAgentElement, findLayerByTitle , elapsed } from "../utils/agentHelpers";

// ── Extraction tool ──────────────────────────────────────────────────────────

const loadLayerTool = tool(async (args) => JSON.stringify(args), {
  name: "extract_layer_intent",
  description:
    "Extract parameters needed to load a layer from the user message.",
  schema: z.object({
    keyword: z
      .string()
      .nullable()
      .describe(
        "Search keyword (e.g., 'Phoenix thermal', 'buildings', 'traffic', 'world imagery'). " +
        "Extract if user mentions a topic, place, or dataset name."
      ),
    itemId: z
      .string()
      .nullable()
      .describe(
        "ArcGIS Online item ID (32-char hex string). Extract if user provides one."
      ),
    serviceUrl: z
      .string()
      .nullable()
      .describe(
        "Full service URL (ImageServer, SceneServer, FeatureServer, MapServer, 3DTilesServer, etc). " +
        "Extract if user pastes a URL."
      ),
  }),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Fast regex-based extraction of URL or item ID from user text.
 * Bypasses the LLM call for obvious inputs.
 */
function quickExtractIntent(text: string): {
  keyword: string | null;
  itemId: string | null;
  serviceUrl: string | null;
} | null {
  const urlMatch = text.match(/(https?:\/\/[^\s]+)/i);
  if (urlMatch) {
    return { keyword: null, itemId: null, serviceUrl: urlMatch[1] };
  }

  const idMatch = text.match(/\b([0-9a-f]{32})\b/i);
  if (idMatch) {
    return { keyword: null, itemId: idMatch[1], serviceUrl: null };
  }

  return null;
}

// ── Agent registration ───────────────────────────────────────────────────────

export function registerLoadLayerAgent(assistant: HTMLElement) {
  const agentId = "load-layer-agent";

  const createGraph = () => {
    const state = createAgentState();

    async function loadLayerNode(s: any) {
      const text = extractLastUserText(s);
      console.log("[LoadLayer] Starting. User text:", text);

      // ── Remove / delete layer ──────────────────────────────────────────
      const removeMatch = text.match(
        /\b(?:remove|delete|drop|clear|hide|take\s+off|get\s+rid\s+of)\b/i
      );
      if (removeMatch) {
        const activeView = getCurrentView();
        if (!activeView?.map) {
          return { outputMessage: "No active map view." };
        }
        const layers = activeView.map.layers.toArray();
        if (layers.length === 0) {
          return { outputMessage: "There are no layers on the map to remove." };
        }

        // "remove all layers"
        if (/\ball\s*(layers?|data)?\b/i.test(text)) {
          const count = layers.length;
          activeView.map.layers.removeAll();
          console.log("[LoadLayer] Removed all", count, "layers.");
          return { outputMessage: `Removed all ${count} layer${count > 1 ? "s" : ""} from the map.` };
        }

        // Try to match a specific layer by title
        const stripped = text.toLowerCase()
          .replace(
            /\b(remove|delete|drop|clear|hide|take|off|get|rid|of|the|layer|layers|from|map|please)\b/g,
            ""
          )
          .trim();

        let target: any = stripped.length > 1 ? findLayerByTitle(layers, stripped) : null;

        // If only one layer and no specific name given, remove it
        if (!target && layers.length === 1 && stripped.length <= 1) {
          target = layers[0];
        }

        if (target) {
          const title = target.title || "Untitled";
          activeView.map.layers.remove(target);
          console.log("[LoadLayer] Removed layer:", title);
          return { outputMessage: `Removed "${title}" from the map.` };
        }

        // List available layers if we couldn't match
        const names = layers.map((l: any) => `"${l.title || "Untitled"}"`).join(", ");
        return {
          outputMessage: `Couldn't identify which layer to remove. Available layers: ${names}. Please specify the layer name.`,
        };
      }

      // ── Zoom to layer ──────────────────────────────────────────────────
      const zoomMatch = text.match(
        /\b(?:zoom\s+to|fly\s+to|go\s+to|focus\s+on|extent\s+of|zoom\s+(?:in\s+)?(?:on|to))\b/i
      );
      if (zoomMatch && !/\b(load|add|open|display)\b/i.test(text)) {
        const activeView = getCurrentView();
        if (!activeView?.map) {
          return { outputMessage: "No active map view." };
        }
        const layers = activeView.map.layers.toArray();
        // Include ground/elevation layers so "zoom to" works for them
        const groundLayers = activeView.map?.ground?.layers?.toArray?.() ?? [];
        const allLayers = [...layers, ...groundLayers];
        if (allLayers.length === 0) {
          return { outputMessage: "There are no layers on the map to zoom to." };
        }

        // "zoom to all layers"
        if (/\ball\s*(layers?|data)?\b/i.test(text)) {
          const extents = allLayers
            .filter((l: any) => l.fullExtent)
            .map((l: any) => l.fullExtent);
          if (extents.length === 0) {
            return { outputMessage: "None of the layers have a valid extent to zoom to." };
          }
          let combined = extents[0].clone();
          for (let i = 1; i < extents.length; i++) {
            combined = combined.union(extents[i]);
          }
          await activeView.goTo(combined, { duration: 2000 });
          return { outputMessage: `Zoomed to the combined extent of all ${allLayers.length} layers.` };
        }

        // Try to match a specific layer by title
        const stripped = text.toLowerCase()
          .replace(
            /\b(zoom|to|fly|go|focus|on|in|extent|of|the|layer|layers|please)\b/g,
            ""
          )
          .trim();

        let target: any = stripped.length > 1 ? findLayerByTitle(allLayers, stripped) : null;

        // If only one layer and no specific name, zoom to it
        if (!target && allLayers.length === 1) {
          target = allLayers[0];
        }

        if (target) {
          const title = target.title || "Untitled";
          if (typeof target.load === "function" && target.loadStatus !== "loaded") {
            try { await target.load(); } catch { /* continue */ }
          }
          if (target.fullExtent) {
            await activeView.goTo(target.fullExtent, { duration: 2000 });
            return { outputMessage: `Zoomed to "${title}".` };
          }
          return { outputMessage: `Layer "${title}" does not have a valid extent to zoom to.` };
        }

        const names = allLayers.map((l: any) => `"${l.title || "Untitled"}"`).join(", ");
        return {
          outputMessage: `Couldn't identify which layer to zoom to. Available layers: ${names}. Please specify the layer name.`,
        };
      }

      // ── Load a Web Map or Web Scene by name ────────────────────────────
      const isSceneRequest = /\b(web\s*scene|scene\s+(?:titled?|named?|called)|3d\s+(?:map|scene))\b/i.test(text);
      const isMapRequest = /\b(web\s*map|map\s+(?:titled?|named?|called)|2d\s+map)\b/i.test(text);
      const hasLoadVerb2 = /\b(?:load|open|show|display|switch\s+to|use)\b/i.test(text);

      if ((isSceneRequest || isMapRequest) && (hasLoadVerb2 || isSceneRequest || isMapRequest)) {
        const t0 = performance.now();

        // Extract the item name — strip action verbs and type keywords
        const itemName = text
          .replace(/\b(load|open|show|display|switch\s+to|use|the|a|my|web\s*map|web\s*scene|map|scene|2d|3d|titled?|named?|called)\b/gi, "")
          .trim();

        if (!itemName) {
          return { outputMessage: `Please specify the name of the ${isSceneRequest ? "web scene" : "web map"} to load.` };
        }

        const typeLabel = isSceneRequest ? "web scene" : "web map";
        console.log(`[LoadLayer] Searching for ${typeLabel}:`, itemName);

        try {
          const results = isSceneRequest
            ? await searchWebScenes(itemName, 5)
            : await searchWebMaps(itemName, 5);

          if (results.length === 0) {
            return { outputMessage: `No ${typeLabel}s found matching "${itemName}".` };
          }

          // Try exact title match first, then substring, then first result
          const nameLower = itemName.toLowerCase();
          const best =
            results.find((r) => r.title.toLowerCase() === nameLower) ||
            results.find((r) => r.title.toLowerCase().includes(nameLower)) ||
            results[0];

          console.log(`[LoadLayer] Loading ${typeLabel}:`, best.title, best.itemId);

          if (isSceneRequest) {
            await requestWebSceneSwitch(best.itemId);
          } else {
            await requestWebMapSwitch(best.itemId);
          }

          const elapsedTime = elapsed(t0);
          return {
            outputMessage: `Loaded ${typeLabel} "${best.title}" in ${elapsedTime}s.`,
          };
        } catch (err: any) {
          console.error(`[LoadLayer] ${typeLabel} load failed:`, err);
          return {
            outputMessage: `Failed to load ${typeLabel}: ${err?.message ?? String(err)}`,
          };
        }
      }

      // ── Pre-compute flags for bailout checks ──────────────────────────
      const hasUrl = /(https?:\/\/)/i.test(text);
      const hasItemId = /\b[0-9a-f]{32}\b/i.test(text);
      const hasDirectRef = hasUrl || hasItemId;

      // ── Bail out: defer to other agents when no direct URL/item ID ──
      // LoadLayerAgent should only handle loading NEW layers (from URL, item ID, or keyword)
      // and removing/zooming to existing layers. Everything else belongs to other agents.

      // "add result N" / "add 3" / "add 1, 3-5" belongs to ContentSearchAgent when there are cached search results
      if (/(?:add|load|open|show)\s+(?:result|results|#|number|item)?\s*\d+/i.test(text) ||
          /(?:add|load|open|show)\s+(?:all|everything)\s*(?:results?|items?|layers?)?/i.test(text) ||
          /(?:add|load|open|show)\s+(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:one|result|item|layer)/i.test(text)) {
        console.log("[LoadLayer] Skipping — 'add result N' for ContentSearchAgent.");
        return { outputMessage: "" };
      }

      // Scoped content requests belong to ContentSearchAgent
      if (
        /\b(my\s+content|my\s+org|living\s*atlas|arcgis\s*online)\b/i.test(text) ||
        /\b(search|find|browse|discover)\s+(for\s+)?(layers?|items?|content|data|services?)\b/i.test(text)
      ) {
        console.log("[LoadLayer] Skipping — scoped content search for ContentSearchAgent.");
        return { outputMessage: "" };
      }

      if (!hasDirectRef) {
        // LayerInfoAgent keywords
        if (/\b(describe|info|information|details|metadata|fields|attributes|schema|popup|properties|capabilities|statistics|stats|band\s*count|pixel\s*type|tell\s*me\s*about)\b/i.test(text)) {
          console.log("[LoadLayer] Skipping — LayerInfoAgent territory.");
          return { outputMessage: "" };
        }

        // MeasurementAgent keywords
        if (/\b(measure|measurement|measuring|ruler|elevation\s*profile|cross[- ]?section|volume|cut\s*(?:and|&)?\s*fill|stockpile|excavat|earthwork|grading|how\s*far)\b/i.test(text)) {
          console.log("[LoadLayer] Skipping — MeasurementAgent territory.");
          return { outputMessage: "" };
        }

        // ImageryAnalysisAgent keywords
        if (/\b(stretch|std\s*dev|standard\s*deviation|min[\s-]*max|percent[\s-]*clip|color\s*ramp|inferno|viridis|grayscale|ndvi|hillshade|slope|aspect|identify|popup|screenshot|raster\s*function|processing\s*template|render|visualize|color\s*ir|false\s*color)\b/i.test(text)) {
          console.log("[LoadLayer] Skipping — ImageryAnalysisAgent territory.");
          return { outputMessage: "" };
        }

        // PointCloudAgent keywords
        if (/\b(class[\s_-]?code|classification|filter\s*(point|class|ground|vegetation|building|water)|color\s*by|point\s*size|point\s*density|points?\s*per\s*inch|return[\s_-]?number)\b/i.test(text) ||
            (/\bfilter\b/i.test(text) && /\b(class|elevation|intensity|return|ground|vegetation|building|water|noise)\b/i.test(text))) {
          console.log("[LoadLayer] Skipping — PointCloudAgent territory.");
          return { outputMessage: "" };
        }

        // ElevationOffsetAgent keywords
        if (/\b(fix|adjust|correct|offset|raise|lower|shift)\s*(the\s+)?(elevation|height|altitude|z[- ]?offset|vertical|floating|underground|mesh|layer)/i.test(text) ||
            /\b(floating|underground|misaligned)\b/i.test(text)) {
          console.log("[LoadLayer] Skipping — ElevationOffsetAgent territory.");
          return { outputMessage: "" };
        }

        // SwipeAgent keywords
        if (/\b(compare|swipe|split|side\s*by\s*side|versus|vs\.?)\b/i.test(text)) {
          console.log("[LoadLayer] Skipping — SwipeAgent territory.");
          return { outputMessage: "" };
        }

        // AllCapabilitiesAgent keywords
        if (/\b(what\s*can\s*you\s*do|capabilities|help me|what\s*tools|what\s*agents)\b/i.test(text)) {
          console.log("[LoadLayer] Skipping — AllCapabilitiesAgent territory.");
          return { outputMessage: "" };
        }

        // Generic catch-all: no URL/ID and no load verb, but has offset/analysis keywords
        const hasLoadVerb = /\b(load|open|show|display)\b/i.test(text);
        const hasOffsetKeyword = /\b(offset|elevation|stretch|raster|ndvi|hillshade|slope|aspect|fix|align|floating)\b/i.test(text);
        const hasNumberWithUnit = /\d+(?:\.\d+)?\s*(?:m\b|meters?\b|ft\b|feet\b|')/i.test(text);

        if (!hasLoadVerb && (hasOffsetKeyword || hasNumberWithUnit)) {
          console.log("[LoadLayer] Skipping — no URL/ID/load-verb, looks like offset/adjustment request.");
          return { outputMessage: "" };
        }
      }

      // ── Extract intent ────────────────────────────────────────────────
      let intent: {
        keyword: string | null;
        itemId: string | null;
        serviceUrl: string | null;
      } = { keyword: null, itemId: null, serviceUrl: null };

      const quickResult = quickExtractIntent(text);
      if (quickResult) {
        intent = quickResult;
        console.log("[LoadLayer] Quick-extracted intent:", intent);
      } else {
        console.log("[LoadLayer] Calling invokeToolPrompt...");
        try {
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("LLM extraction timed out")), 15000)
          );
          const response = await Promise.race([
            invokeToolPrompt({
              promptText:
                "You extract parameters to load a layer onto a map. " +
                "The user may provide a keyword/name, item ID, or service URL. " +
                "This supports ALL ArcGIS layer types: imagery, feature, tile, scene, " +
                "map image, WMS, WFS, KML, GeoJSON, 3D tiles, and more. " +
                "Always call extract_layer_intent with everything you find.",
              messages: [new HumanMessage(text || "load layer")],
              tools: [loadLayerTool],
              temperature: 0,
            }),
            timeoutPromise,
          ]);
          const call = (
            Array.isArray((response as any)?.tool_calls)
              ? (response as any).tool_calls
              : []
          ).find((tc: any) => tc?.name === "extract_layer_intent");
          if (call?.args) intent = { ...intent, ...call.args };
        } catch (err) {
          console.error("[LoadLayer] invokeToolPrompt failed:", err);
          if (text) {
            intent.keyword = text;
            console.log("[LoadLayer] Falling back to keyword search:", text);
          }
        }
      }
      console.log("[LoadLayer] Final intent:", intent);

      // ── Resolve & create layer ────────────────────────────────────────
      const t0 = performance.now();
      const view = getCurrentView();
      if (!view) {
        return {
          outputMessage: "No active map or scene view. Please wait for the view to load.",
        };
      }

      let layer: any;
      let displayName: string;

      try {
        if (intent.serviceUrl) {
          console.log("[LoadLayer] Creating layer from URL:", intent.serviceUrl);
          layer = await createLayerFromUrl(intent.serviceUrl);
          displayName = layer.title || intent.serviceUrl;
        } else if (intent.itemId) {
          // Check if the item is a Web Map or Web Scene before trying to create a layer
          console.log("[LoadLayer] Looking up item type for ID:", intent.itemId);
          const itemInfo = await getPortalItemUrl(intent.itemId);
          if (itemInfo && itemInfo.type === "Web Map") {
            console.log("[LoadLayer] Item is a Web Map, switching...");
            await requestWebMapSwitch(intent.itemId);
            const elapsedTime = elapsed(t0);
            return {
              outputMessage: `Loaded web map "${itemInfo.title}" in ${elapsedTime}s.`,
            };
          }
          if (itemInfo && itemInfo.type === "Web Scene") {
            console.log("[LoadLayer] Item is a Web Scene, switching...");
            await requestWebSceneSwitch(intent.itemId);
            const elapsedTime = elapsed(t0);
            return {
              outputMessage: `Loaded web scene "${itemInfo.title}" in ${elapsedTime}s.`,
            };
          }

          console.log("[LoadLayer] Creating layer from item ID:", intent.itemId);
          layer = await createLayerFromItemId(intent.itemId);
          displayName = layer.title || intent.itemId;
        } else if (intent.keyword) {
          console.log("[LoadLayer] Searching portal for:", intent.keyword);
          const results = await searchAllItems(intent.keyword, 5);
          if (results.length === 0) {
            return {
              outputMessage: `No layers found matching "${intent.keyword}". Try a different search term or provide a direct URL.`,
            };
          }

          const best = results[0];
          console.log("[LoadLayer] Best search result:", best.title, best.type, best.url);

          if (best.url) {
            layer = await createLayerFromUrl(best.url, best.title);
          } else {
            layer = await createLayerFromItemId(best.itemId, best.title);
          }
          displayName = best.title;
        } else {
          return {
            outputMessage:
              "Please provide a layer name, item ID, or service URL to load a layer.",
          };
        }
      } catch (err: any) {
        console.error("[LoadLayer] Layer creation failed:", err);
        return {
          outputMessage: `Failed to create layer: ${err?.message ?? String(err)}`,
        };
      }

      // ── Elevation handling ──────────────────────────────────────────
      // Two cases:
      // 1) SDK created an ElevationLayer (runtime type "elevation") → always route to ground
      // 2) User explicitly asks to add an imagery service as terrain → route to ground
      // Image Services with elevation data (DSM, DEM) are normal operational layers
      // unless the user explicitly says "as terrain", "add to ground", etc.
      const userWantsElevation = /\b(as\s*terrain|as\s*elevation|ground\s*surface|elevation\s*(surface|source)|add\s*to\s*ground|terrain\s*layer)\b/i.test(text);
      const isElevationLayer = layer.type === "elevation";

      if (isElevationLayer || (userWantsElevation && /^imagery/.test(layer.type))) {
        // Switch to 3D for terrain surfaces — elevation only renders in SceneView
        if (getCurrentViewType() !== "3d") {
          try {
            await requestViewSwitch("3d");
            // Give the new SceneView a moment to fully initialize
            await new Promise((r) => setTimeout(r, 1000));
          } catch {
            return {
              outputMessage:
                `"${displayName}" is an elevation surface and requires 3D. ` +
                "Please switch to 3D using the toggle, then try again.",
            };
          }
        }
        const activeView = getCurrentView() as any;
        if (!activeView?.map?.ground) {
          return { outputMessage: "No active 3D scene view. Switch to 3D and try again." };
        }
        const urlOrId = intent.serviceUrl ?? intent.itemId ?? "";
        const elevLayer = addElevationLayerToGround(activeView, urlOrId, displayName);
        await elevLayer.load();

        // Zoom to the elevation layer's extent and tilt camera to show terrain
        if (elevLayer.fullExtent) {
          try {
            await activeView.goTo(
              { target: elevLayer.fullExtent, tilt: 65 } as any,
              { duration: 2000 }
            );
          } catch { /* non-critical */ }
        }

        const elapsedTime = elapsed(t0);
        return {
          outputMessage:
            `Added "${displayName}" as a terrain elevation surface in ${elapsedTime}s. ` +
            "The elevation data is now applied to the scene's ground.",
        };
      }

      // ── Ensure correct view type ──────────────────────────────────────
      if (REQUIRES_3D.has(layer.type) && getCurrentViewType() !== "3d") {
        console.log("[LoadLayer] Layer type", layer.type, "requires 3D. Switching...");
        try {
          await requestViewSwitch("3d");
        } catch {
          return {
            outputMessage:
              `Layer "${displayName}" requires a 3D scene view. ` +
              "Please switch to 3D using the toggle, then ask me again.",
          };
        }
      }

      // ── Add to map ────────────────────────────────────────────────────
      try {
        const activeView = getCurrentView();
        if (!activeView?.map) {
          return { outputMessage: "View not ready after switch. Please try again." };
        }
        activeView.map.layers.add(layer);
        console.log("[LoadLayer] Layer added, loading...");

        await layer.load();
        console.log("[LoadLayer] Layer loaded. Type:", layer.type);

        if (layer.fullExtent) {
          await activeView.goTo(layer.fullExtent, { duration: 2000 });
        }

        const elapsedTime = elapsed(t0);
        const results: string[] = [
          `Loaded "${displayName}" in ${elapsedTime}s.`,
        ];

        // ── 3D layer post-load: elevation offset ─────────────────────
        if (REQUIRES_3D.has(layer.type)) {
          const numMatch = text.match(/(-?\d+(?:\.\d+)?)\s*(?:m\b|meters?\b|ft\b|feet\b|')/i);
          let offsetValue: number | null = null;
          if (numMatch && /offset|elevation|height|raise|lift|add|subtract|lower|drop/i.test(text)) {
            offsetValue = parseFloat(numMatch[1]);
            const unitPart = numMatch[0].toLowerCase();
            if (/ft|feet|'/.test(unitPart)) offsetValue *= 0.3048;
            if (/subtract|lower|drop|minus|negative/i.test(text)) offsetValue = -Math.abs(offsetValue);
          }

          if (offsetValue !== null) {
            (layer as any).elevationInfo = {
              mode: "absolute-height",
              offset: offsetValue,
            };
            results.push(`Applied ${offsetValue}m elevation offset.`);
            console.log("[LoadLayer] Applied elevation offset:", offsetValue);
            if (layer.fullExtent) {
              try { await activeView.goTo(layer.fullExtent, { duration: 1500 }); } catch { /* ok */ }
            }
          }
        }

        // ── Imagery post-load analysis ────────────────────────────────
        if (layer.type === "imagery") {
          const imgLayer = layer as ImageryLayer;
          const textLower = text.toLowerCase();

          let serverFnApplied = false;
          const availableFns = getAvailableRasterFunctions(imgLayer);
          if (availableFns.length > 0) {
            const matchedFn = availableFns.find(
              (fn) => fn !== "None" && textLower.includes(fn.toLowerCase())
            );
            if (matchedFn) {
              applyServerRasterFunction(imgLayer, matchedFn);
              results.push(`Applied "${matchedFn}" processing template.`);
              serverFnApplied = true;
            }
          }

          const stretchMap: [string[], StretchType][] = [
            [["standard deviation", "std dev", "stddev"], "standard-deviation"],
            [["min-max", "min max", "minmax"], "min-max"],
            [["percent clip", "percent-clip"], "percent-clip"],
          ];
          for (const [keywords, stretchType] of stretchMap) {
            if (keywords.some((k) => textLower.includes(k))) {
              applyStretch(imgLayer, stretchType, 2, !serverFnApplied);
              results.push(`Applied ${stretchType} stretch.`);
              break;
            }
          }
        }

        return { outputMessage: results.join(" ") };
      } catch (err: any) {
        console.error("[LoadLayer] Failed to load layer:", err);
        return {
          outputMessage: `Failed to load layer: ${err?.message ?? String(err)}`,
        };
      }
    }

    return new StateGraph(state)
      .addNode("loadLayerNode", loadLayerNode)
      .addEdge(START, "loadLayerNode")
      .addEdge("loadLayerNode", END);
  };

  registerAgentElement(assistant, {
    id: agentId,
    name: "Load Layer",
    description:
      "Loads or removes layers on the map or scene, or loads a saved Web Map. " +
      "Supports all ArcGIS layer types: Feature Layers, Imagery Layers, Imagery Tile Layers, " +
      "Oriented Imagery, Tile Layers, Map Image Layers, Vector Tile Layers, Scene Layers, " +
      "Integrated Meshes, Gaussian Splats, 3D Tiles, Point Clouds, Building Scene Layers, " +
      "WMS, WFS, WMTS, KML, GeoJSON, CSV, and more. " +
      "Automatically detects the correct layer type from the URL or portal item. " +
      "Auto-switches to 3D view when loading 3D-only layer types. " +
      "Use when the user wants to load, show, display, or open a NEW layer onto the map, " +
      "OR when the user wants to remove, delete, hide, or clear layers from the map. " +
      "OR when the user wants to zoom to, fly to, or focus on an existing layer's extent. " +
      "Can also load saved Web Maps and Web Scenes from portal by name " +
      "(e.g., 'Load Phoenix 2D Map', 'Open my 3D scene called Downtown'). " +
      "Keywords: load, add, open, show, display, remove, delete, drop, clear, hide, zoom to, fly to, focus on, extent, web map, web scene, 2d map, 3d scene. " +
      "Do NOT use for adjusting elevation, offset, stretch, or other properties of already-loaded layers.",
    createGraph,
  });
}
