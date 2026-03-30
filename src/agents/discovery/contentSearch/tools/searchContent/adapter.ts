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
      maxResults: args.maxResults,
      itemType: args.itemType,
      typeKeyword: args.typeKeyword,
      sortBy: args.sortBy as any,
    });
  },
  {
    name: "search_content",
    description:
      "Search for layers, datasets, and content across ArcGIS sources. " +
      "Returns 5 results by default. Use maxResults to return a specific number " +
      "(e.g. 'top 10' → maxResults: 10, 'find all' → maxResults: 100). " +
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
      maxResults: z
        .number()
        .default(10)
        .describe("Number of results to return. Default 10. Use specific count when user specifies (e.g. 'top 5', 'show 20'). Use 100 for 'find all' or 'show everything'."),
      itemType: z
        .optional(z.string())
        .describe("Portal item type, e.g. 'Image Service', 'Web Map'"),
      typeKeyword: z
        .optional(z.string())
        .describe(
          "Portal typeKeyword sub-filter, e.g. 'PointCloud', 'GaussianSplat'",
        ),
      sortBy: z
        .optional(z.enum(["popular", "recent", "title"]))
        .describe(
          "Sort results by: 'popular' (most views, default), 'recent' (newest first), 'title' (alphabetical). " +
          "Use 'recent' when user says 'newest', 'latest', 'most recent', 'sorted by date'.",
        ),
    }),
  },
);
