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

  // Route to handlers based on intent keywords
  // Check more specific patterns first, then broader ones
  if (AGENT_KEYWORDS.elevationOffset.test(text)) return elevationOffsetHandler(text);
  if (AGENT_KEYWORDS.elevationOffsetSimple.test(text)) return elevationOffsetHandler(text);
  if (AGENT_KEYWORDS.pointCloud.test(text)) return pointCloudHandler(text);
  if (AGENT_KEYWORDS.imagery.test(text)) return imageryHandler(text);
  if (AGENT_KEYWORDS.measurement.test(text)) return measurementHandler(text);
  if (AGENT_KEYWORDS.swipe.test(text)) return swipeHandler(text);
  if (AGENT_KEYWORDS.orientedImagery.test(text)) return orientedImageryHandler(text);
  if (AGENT_KEYWORDS.catalogLayer.test(text)) return catalogHandler(text);
  if (AGENT_KEYWORDS.layerInfo.test(text)) return layerInfoHandler(text);

  // Default: try layer info as catch-all
  return layerInfoHandler(text);
}
