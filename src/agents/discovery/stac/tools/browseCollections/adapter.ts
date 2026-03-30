import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { browseCollections } from "./core";

export const browseCollectionsTool = tool(
  async (args) => {
    return await browseCollections({
      endpoint: args.endpoint,
      keyword: args.keyword,
    });
  },
  {
    name: "browse_stac_collections",
    description:
      "List available collections (datasets) from a STAC catalog. " +
      "Optionally filter by keyword to find specific datasets. " +
      "Use this when the user wants to see what data is available " +
      "before searching for specific items.",
    schema: z.object({
      endpoint: z
        .string()
        .describe("STAC catalog ID: 'earth-search' or 'planetary-computer'"),
      keyword: z
        .optional(z.string())
        .describe(
          "Optional filter keyword to match against collection titles and descriptions",
        ),
    }),
  },
);
