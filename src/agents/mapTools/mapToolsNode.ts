import type { RunnableConfig } from "@langchain/core/runnables";
import { sendTraceMessage } from "@arcgis/ai-components/utils/index.js";
import { extractLastUserText, AGENT_KEYWORDS } from "../../utils/agentHelpers";
import type { MapToolsStateType } from "./state";
import { measurementHandler } from "./handlers/measurement";
import { swipeHandler } from "./handlers/swipe";
import { layerInfoHandler } from "./handlers/layerInfo";
import { orientedImageryHandler } from "./handlers/orientedImagery";
import { catalogHandler } from "./handlers/catalog";
import { elevationOffsetHandler } from "./handlers/elevationOffset";
import { imageryHandler } from "./handlers/imagery";
import { pointCloudHandler } from "./handlers/pointCloud";
import { saveHandler } from "./handlers/save";
import { coordinateHandler } from "./handlers/coordinate";

export async function mapToolsNode(s: MapToolsStateType, config?: RunnableConfig) {
  await sendTraceMessage({ text: "MapTools: processing request" }, config);

  const text = extractLastUserText(s);
  console.log("[MapTools] Starting. User text:", text);

  // Bail out if another agent owns this request
  const bailouts = [
    { pattern: AGENT_KEYWORDS.search, label: "ContentSearchAgent" },
  ];
  for (const { pattern, label } of bailouts) {
    if (pattern.test(text)) {
      console.log(`[MapTools] Skipping — ${label} territory.`);
      return { outputMessage: "" };
    }
  }

  // Capabilities / help — answer before any handler tries to run
  if (AGENT_KEYWORDS.capabilities.test(text)) {
    return {
      outputMessage:
        "Here's what I can help you with:\n\n" +
        "**Search & Discovery**\n" +
        "- Search ArcGIS Online, your organization, or Living Atlas for layers and services\n" +
        "- Search STAC catalogs (Earth Search, Planetary Computer) for satellite imagery like Sentinel-2, Landsat, and NAIP\n\n" +
        "**Layer Management**\n" +
        "- Load layers by name, URL, or item ID and zoom to them\n" +
        "- List, describe, and inspect layer metadata, fields, and statistics\n" +
        "- Remove layers or clear the map\n\n" +
        "**Imagery & Visualization**\n" +
        "- Apply processing templates (NDVI, Hillshade, Slope, Color IR, and more)\n" +
        "- Change stretch renderers and color ramps\n" +
        "- Identify pixel values by clicking the map\n\n" +
        "**Measurement & Analysis**\n" +
        "- Measure distance, area, and volume\n" +
        "- Generate elevation profiles and cross-sections\n" +
        "- Calculate cut/fill and stockpile volumes (3D)\n\n" +
        "**3D Tools**\n" +
        "- Fix elevation offsets for meshes, splats, and scene layers\n" +
        "- Visualize and filter point clouds by classification, elevation, or intensity\n\n" +
        "**Compare & Explore**\n" +
        "- Swipe between two layers to compare them side by side\n" +
        "- Open the Oriented Imagery Viewer for oblique and 360° photos\n" +
        "- Browse and filter Catalog Layer contents\n\n" +
        "**Save**\n" +
        "- Save your work as a web map or web scene to ArcGIS Online\n\n" +
        "Try asking something like *\"Search for Sentinel-2 imagery over Denver\"* or *\"Apply NDVI to the imagery layer\"*.",
    };
  }

  // Route to handlers based on intent keywords
  // Check more specific patterns first, then broader ones
  if (/\b(save)\s+(web\s*map|web\s*scene|map|scene)\b/i.test(text)) return saveHandler(text);
  if (/\b(clear|reset|new)\s+(web\s*)?(map|scene)\b/i.test(text)) return saveHandler(text);
  if (AGENT_KEYWORDS.elevationOffset.test(text)) return elevationOffsetHandler(text);
  if (AGENT_KEYWORDS.elevationOffsetSimple.test(text)) return elevationOffsetHandler(text);
  if (AGENT_KEYWORDS.pointCloud.test(text)) return pointCloudHandler(text);
  if (AGENT_KEYWORDS.imagery.test(text)) return imageryHandler(text);
  if (AGENT_KEYWORDS.measurement.test(text)) return measurementHandler(text);
  if (AGENT_KEYWORDS.swipe.test(text)) return swipeHandler(text);
  if (AGENT_KEYWORDS.orientedImagery.test(text)) return orientedImageryHandler(text);
  if (AGENT_KEYWORDS.catalogLayer.test(text)) return catalogHandler(text);
  if (AGENT_KEYWORDS.coordinate.test(text)) return coordinateHandler(text);
  if (AGENT_KEYWORDS.layerInfo.test(text)) return layerInfoHandler(text);

  // Default: try layer info as catch-all
  return layerInfoHandler(text);
}
