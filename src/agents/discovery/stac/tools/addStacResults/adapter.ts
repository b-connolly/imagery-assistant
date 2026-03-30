import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { addStacResultsToMap } from "./core";

export const addStacResultsTool = tool(
  async (args) => {
    return await addStacResultsToMap({
      indices: args.indices,
      addAll: args.addAll,
    });
  },
  {
    name: "add_stac_results",
    description:
      "Add previously searched STAC results to the map as layers. " +
      "COG (Cloud Optimized GeoTIFF) assets are loaded as ImageryTileLayer. " +
      "Use 'indices' to specify 1-based result numbers (e.g., [1, 3, 5]) " +
      "or set 'addAll' to true to add every result from the last STAC search.",
    schema: z.object({
      indices: z
        .array(z.number())
        .describe("1-based result indices to add"),
      addAll: z
        .boolean()
        .default(false)
        .describe("If true, add all cached STAC results"),
    }),
  },
);
