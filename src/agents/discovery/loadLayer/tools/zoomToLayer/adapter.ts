import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { zoomToLayer } from "./core";

/**
 * LangChain tool for zooming to a layer's extent on the map.
 */
export const zoomToLayerTool = tool(
  async (args) => {
    const result = await zoomToLayer({ layerName: args.layerName });
    return result ?? `Could not find a layer named "${args.layerName}".`;
  },
  {
    name: "zoom_to_layer",
    description:
      "Zoom to a layer's extent on the map. " +
      "Provide the layer name to zoom to, or 'all' to zoom to all layers.",
    schema: z.object({
      layerName: z.string().describe("Name of layer to zoom to"),
    }),
  },
);
