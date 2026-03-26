import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { searchContent } from "./core";
import type { SearchScope } from "../../../../../utils/portalSearch";

/**
 * LangChain tool for searching ArcGIS content across multiple scopes.
 */
export const searchContentTool = tool(
  async (args) => {
    return await searchContent({
      scope: args.scope as SearchScope,
      keyword: args.keyword,
      maxResults: args.searchAll ? 100 : 5,
      itemType: args.itemType,
      typeKeyword: args.typeKeyword,
    });
  },
  {
    name: "search_content",
    description:
      "Search for layers, datasets, and content across ArcGIS sources. " +
      "Returns the top 5 results by default. Set searchAll to true only when the user explicitly " +
      "says 'search all', 'find all', 'show everything', or asks for more than 5 results. " +
      "Available scopes: " +
      "'my-content' (user's own items), " +
      "'my-org' (organization content), " +
      "'agol' (ArcGIS Online public content), " +
      "'living-atlas' (Esri's curated Living Atlas), " +
      "'all' (search all scopes). " +
      "Common type filters: 'Image Service', 'Feature Service', 'Scene Service', " +
      "'Web Map', 'Web Scene', 'Vector Tile Service', 'Map Service', '3DTiles Service'. " +
      "Common typeKeyword sub-filters: 'PointCloud', 'GaussianSplat', 'IntegratedMesh', " +
      "'Building', 'Voxel', 'CatalogLayer', 'OrientedImageryLayer'.",
    schema: z.object({
      scope: z
        .enum(["my-content", "my-org", "agol", "living-atlas", "all"])
        .describe("Where to search"),
      keyword: z.string().describe("Search keyword from user request"),
      searchAll: z
        .boolean()
        .default(false)
        .describe("Set true only when user explicitly asks for all results"),
      itemType: z
        .optional(z.string())
        .describe("Portal item type, e.g. 'Image Service', 'Web Map'"),
      typeKeyword: z
        .optional(z.string())
        .describe(
          "Portal typeKeyword sub-filter, e.g. 'PointCloud', 'GaussianSplat'",
        ),
    }),
  },
);
