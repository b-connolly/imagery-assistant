import { loadLayerTool } from "./loadLayer/adapter";
import { removeLayerTool } from "./removeLayer/adapter";
import { zoomToLayerTool } from "./zoomToLayer/adapter";
import { geocodePlaceTool } from "./geocodePlace/adapter";

export const loadLayerTools = [
  loadLayerTool,
  removeLayerTool,
  zoomToLayerTool,
  geocodePlaceTool,
];
