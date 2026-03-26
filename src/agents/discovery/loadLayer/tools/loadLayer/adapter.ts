import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { loadLayer } from "./core";

/**
 * LangChain tool for loading a layer onto the map.
 * Accepts a keyword, item ID, or service URL.
 *
 * Note: The core loadLayer function also needs the original user text
 * for post-load settings (stretch, templates, elevation offset).
 * The adapter stores the user text contextually via the tool invocation.
 */
export const loadLayerTool = tool(
  async (args) => {
    return await loadLayer(
      {
        keyword: args.keyword ?? undefined,
        itemId: args.itemId ?? undefined,
        serviceUrl: args.serviceUrl ?? undefined,
      },
      args._userText ?? ""
    );
  },
  {
    name: "load_layer",
    description:
      "Load a layer onto the map from a keyword search, item ID, or service URL. " +
      "Supports all ArcGIS layer types: imagery, feature, tile, scene, " +
      "map image, WMS, WFS, KML, GeoJSON, 3D tiles, and more. " +
      "Provide exactly one of: keyword, itemId, or serviceUrl.",
    schema: z.object({
      keyword: z
        .optional(z.string())
        .describe(
          "Search keyword if no URL/ID provided (e.g., 'Phoenix thermal', 'buildings', 'traffic')"
        ),
      itemId: z
        .optional(z.string())
        .describe("32-char ArcGIS Online portal item ID"),
      serviceUrl: z
        .optional(z.string())
        .describe(
          "Full service URL (ImageServer, FeatureServer, MapServer, SceneServer, 3DTilesServer, etc)"
        ),
      _userText: z
        .optional(z.string())
        .describe("Internal: original user text for post-load settings"),
    }),
  },
);
