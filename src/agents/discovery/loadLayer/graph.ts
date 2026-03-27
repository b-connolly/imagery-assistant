import { StateGraph, START, END } from "@langchain/langgraph/web";
import type { AgentRegistration } from "@arcgis/ai-components/utils/index.js";
import { LoadLayerState } from "./state";
import { loadLayerRouter } from "./nodes/loadLayerRouter";
import { loadLayerLLM } from "./nodes/loadLayerLLM";
import { loadLayerToolCalling } from "./nodes/loadLayerTools";

// ── Graph builder ────────────────────────────────────────────────────────────

const createLoadLayerGraph = () => {
  return new StateGraph(LoadLayerState)
    .addNode("loadLayerRouter", loadLayerRouter)
    .addNode("loadLayerLLM", loadLayerLLM)
    .addNode("loadLayerToolCalling", loadLayerToolCalling)
    .addEdge(START, "loadLayerRouter")
    .addConditionalEdges("loadLayerRouter", (state: any) => {
      // If the router handled the request (fast-path with content, or bailout),
      // go straight to END. The router sets routerHandled=true for both cases.
      if (state.routerHandled) {
        return "end";
      }
      // Otherwise, route to the LLM node for intent extraction
      return "llm";
    }, {
      end: END,
      llm: "loadLayerLLM",
    })
    .addEdge("loadLayerLLM", "loadLayerToolCalling")
    .addEdge("loadLayerToolCalling", END);
};

// ── Agent registration ───────────────────────────────────────────────────────

export const LoadLayerAgent: AgentRegistration = {
  id: "load-layer-agent",
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
    "Also handles switching between 2D map view and 3D scene view. " +
    "Handles navigation: 'zoom to Denver', 'go to Paris', 'fly to Tokyo' — geocodes place names " +
    "and navigates the map or scene to that location. Works in both 2D and 3D. " +
    "Keywords: load, add, open, show, display, remove, delete, drop, clear, hide, " +
    "zoom to, fly to, go to, navigate to, focus on, extent, " +
    "web map, web scene, 2d map, 3d scene, switch to 3d, switch to 2d, toggle 3d, toggle 2d, change to scene, change to map. " +
    "Do NOT use for adjusting elevation, offset, stretch, or other properties of already-loaded layers.",
  createGraph: createLoadLayerGraph,
  workspace: LoadLayerState,
};
