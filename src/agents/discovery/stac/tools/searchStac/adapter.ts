import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { searchStac } from "./core";

export const searchStacTool = tool(
  async (args) => {
    // Build property query from explicit params
    const query: Record<string, Record<string, number | string>> = {};
    if (args.propertyFilters) {
      for (const filter of args.propertyFilters) {
        query[filter.property] = { [filter.operator]: filter.value };
      }
    }
    return await searchStac({
      endpoint: args.endpoint,
      collections: args.collections,
      useBbox: args.useBbox,
      datetime: args.datetime,
      limit: args.limit,
      maxCloudCover: args.maxCloudCover,
      query: Object.keys(query).length > 0 ? query : undefined,
    });
  },
  {
    name: "search_stac",
    description:
      "Search a STAC catalog for satellite imagery, remote sensing data, and geospatial assets. " +
      "Returns items with COG (Cloud Optimized GeoTIFF) assets that can be added to the map. " +
      "Available catalogs: 'earth-search' (Sentinel-2, Landsat, NAIP, COP-DEM), " +
      "'planetary-computer' (Sentinel-2, Landsat, ASTER, MODIS, NAIP). " +
      "Set useBbox to true to search within the current map extent. " +
      "Use maxCloudCover to filter by cloud coverage percentage (e.g. 20 for less than 20%). " +
      "Use datetime for date filtering (ISO 8601 intervals). " +
      "Use propertyFilters for advanced STAC property queries.",
    schema: z.object({
      endpoint: z
        .string()
        .describe("STAC catalog ID: 'earth-search' or 'planetary-computer'"),
      collections: z
        .optional(z.array(z.string()))
        .describe(
          "Collection IDs to filter, e.g. ['sentinel-2-l2a'], ['landsat-c2-l2']",
        ),
      useBbox: z
        .boolean()
        .default(false)
        .describe(
          "Use current map extent as search bounds. Set true ONLY when user explicitly references " +
          "the current area: 'here', 'this area', 'in view', 'my extent', 'current map'. Default false for global searches.",
        ),
      datetime: z
        .optional(z.string())
        .describe(
          "ISO 8601 date or interval, e.g. '2024-01-01/2024-06-30' or '2024-03-15'. " +
          "Use '..' for open-ended ranges, e.g. '2024-01-01/..' for everything after Jan 2024",
        ),
      limit: z
        .number()
        .default(5)
        .describe("Max results to return (default 5, max 20)"),
      maxCloudCover: z
        .optional(z.number())
        .describe(
          "Maximum cloud cover percentage (0-100). E.g. 20 means only images with <= 20% clouds. " +
          "Works with collections that have eo:cloud_cover (Sentinel-2, Landsat, etc.)",
        ),
      propertyFilters: z
        .optional(
          z.array(
            z.object({
              property: z.string().describe(
                "STAC property name, e.g. 'eo:cloud_cover', 'view:sun_elevation', 'platform'",
              ),
              operator: z.enum(["eq", "lt", "lte", "gt", "gte"]).describe(
                "Comparison operator: eq (equals), lt (less than), lte (less or equal), gt (greater than), gte (greater or equal)",
              ),
              value: z.union([z.number(), z.string()]).describe("Value to compare against"),
            }),
          ),
        )
        .describe(
          "Advanced property filters. Common properties: " +
          "'eo:cloud_cover' (0-100), 'view:sun_elevation' (degrees), " +
          "'view:off_nadir' (degrees), 'platform' (e.g. 'sentinel-2a')",
        ),
    }),
  },
);
