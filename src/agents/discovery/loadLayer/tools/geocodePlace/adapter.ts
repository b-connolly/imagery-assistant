import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { geocodePlace } from "./core";

/**
 * LangChain tool for geocoding a place name and navigating to it.
 */
export const geocodePlaceTool = tool(
  async (args) => {
    return await geocodePlace({ placeName: args.placeName });
  },
  {
    name: "geocode_place",
    description:
      "Geocode a place or city name and navigate the map to that location. " +
      "Use when the user wants to zoom to, fly to, or go to a geographic place (not a layer).",
    schema: z.object({
      placeName: z.string().describe("Place or city name to navigate to"),
    }),
  },
);
