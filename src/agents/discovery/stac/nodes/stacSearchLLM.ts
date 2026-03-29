import type { RunnableConfig } from "@langchain/core/runnables";
import { sendTraceMessage } from "@arcgis/ai-components/utils/index.js";
import { invokeToolPrompt } from "@arcgis/ai-orchestrator";
import { stacSearchTools } from "../tools";
import { getStacEndpoints } from "../../../../utils/stacClient";
import type { StacSearchStateType } from "../state";

function buildPrompt(): string {
  const endpoints = getStacEndpoints();
  const endpointList = endpoints
    .map((ep) => `- "${ep.id}" — ${ep.name}`)
    .join("\n");

  const today = new Date().toISOString().split("T")[0];

  return `You are a STAC (SpatioTemporal Asset Catalog) search tool for satellite imagery and remote sensing data. You ONLY search STAC catalogs and manage STAC results.

IMPORTANT: You must ONLY respond by calling one of your tools. Do NOT generate text responses, explanations, or help text. If the request is not about STAC catalogs or external satellite/remote sensing data, respond with an empty string.

Use the search_stac tool when the user wants to find satellite imagery, remote sensing data, or specific STAC collections.
Use the browse_stac_collections tool when the user wants to see what collections/datasets are available.
Use the add_stac_results tool when the user wants to add STAC search results to the map.

Available STAC catalogs:
${endpointList}

Common collection IDs:
- Earth Search: sentinel-2-l2a, sentinel-2-c1-l2a, landsat-c2-l2, naip, cop-dem-glo-30
- Planetary Computer: sentinel-2-l2a, landsat-c2-l2, aster-l1t, modis-09A1-061, naip

Date filtering:
- For "last month" or "past year", calculate actual ISO dates. Today is ${today}.
- Use datetime parameter with ISO 8601 intervals: "2024-01-01/2024-06-30" or "2024-03-15/.." for open-ended.
- "last 30 days" → "${new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0]}/${today}"

Cloud cover filtering:
- Use maxCloudCover for "less than X% clouds", "clear imagery", "low cloud cover", etc.
- "clear imagery" or "cloud-free" → maxCloudCover: 10
- "less than 20% cloud cover" → maxCloudCover: 20
- Works with Sentinel-2, Landsat, and other optical imagery collections.

When the user says "here" or "in this area", set useBbox to true to use the current map extent.
Default to earth-search if the user does not specify a catalog.`;
}

export async function stacSearchLLM(
  state: StacSearchStateType,
  config?: RunnableConfig,
): Promise<Partial<StacSearchStateType>> {
  await sendTraceMessage(
    { text: "StacSearch: processing request" },
    config,
  );

  const response = await invokeToolPrompt({
    promptText: buildPrompt(),
    messages: state.messages,
    modelTier: "default",
    tools: stacSearchTools,
  });

  return {
    ...state,
    messages: [...state.messages, response],
    outputMessage: response.content?.toString() ?? "",
  };
}
