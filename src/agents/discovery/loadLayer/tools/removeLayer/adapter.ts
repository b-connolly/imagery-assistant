import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { removeLayer } from "./core";

/**
 * LangChain tool for removing layers from the map.
 */
export const removeLayerTool = tool(
  async (args) => {
    return await removeLayer({
      layerName: args.layerName,
      removeAll: args.removeAll,
    });
  },
  {
    name: "remove_layer",
    description:
      "Remove a layer from the map by name, or remove all layers. " +
      "Set removeAll to true to clear every layer. " +
      "Provide layerName to remove a specific layer.",
    schema: z.object({
      layerName: z
        .optional(z.string())
        .describe("Layer name to remove, or omit for all"),
      removeAll: z
        .boolean()
        .default(false)
        .describe("If true, remove all layers from the map"),
    }),
  },
);
