import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { addResultsToMap } from "./core";

/**
 * LangChain tool for adding cached search results to the map.
 */
export const addSearchResultsTool = tool(
  async (args) => {
    return await addResultsToMap({
      indices: args.indices,
      addAll: args.addAll,
    });
  },
  {
    name: "add_search_results",
    description:
      "Add previously searched content results to the map. " +
      "Use 'indices' to specify 1-based result numbers (e.g., [1, 3, 5]) " +
      "or set 'addAll' to true to add every result from the last search.",
    schema: z.object({
      indices: z
        .array(z.number())
        .describe("1-based result indices to add"),
      addAll: z
        .boolean()
        .default(false)
        .describe("If true, add all cached results"),
    }),
  },
);
