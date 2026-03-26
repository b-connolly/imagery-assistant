import type { RunnableConfig } from "@langchain/core/runnables";
import { sendTraceMessage } from "@arcgis/ai-components/utils/index.js";
import { invokeToolPrompt } from "@arcgis/ai-orchestrator";
import { contentSearchTools } from "../tools";
import type { ContentSearchStateType } from "../state";

const prompt = `You are a content search tool for ArcGIS geospatial data. You ONLY search for and add layers.

IMPORTANT: You must ONLY respond by calling one of your tools. Do NOT generate text responses, explanations, tutorials, or help text. If the user's request is not about searching for or adding content, respond with an empty string — another agent will handle it.

Use the search_content tool when the user wants to find, search, browse, or discover layers.
Use the add_search_results tool when the user wants to add previously found results to the map.

Available scopes: "my-content", "my-org", "agol", "living-atlas", "all" (default).
Common item types: Image Service, Feature Service, Scene Service, Web Map, Web Scene, 3DTiles Service.
Common typeKeyword sub-filters: PointCloud, GaussianSplat, IntegratedMesh, Building, Voxel, CatalogLayer, OrientedImageryLayer.`;

/**
 * LLM node — invokes the model with the content search tools.
 */
export async function contentSearchLLM(
  state: ContentSearchStateType,
  config?: RunnableConfig,
): Promise<Partial<ContentSearchStateType>> {
  await sendTraceMessage(
    { text: "ContentSearch: processing request" },
    config,
  );

  const response = await invokeToolPrompt({
    promptText: prompt,
    messages: state.messages,
    modelTier: "default",
    tools: contentSearchTools,
  });

  return {
    ...state,
    messages: [...state.messages, response],
    outputMessage: response.content?.toString() ?? "",
  };
}
