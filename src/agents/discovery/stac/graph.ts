import { StateGraph, START, END } from "@langchain/langgraph/web";
import type { AgentRegistration } from "@arcgis/ai-components/utils/index.js";
import { StacSearchState } from "./state";
import { stacSearchRouter } from "./nodes/stacSearchRouter";
import { stacSearchLLM } from "./nodes/stacSearchLLM";
import { stacSearchToolCalling } from "./nodes/stacSearchTools";

// ── Graph builder ────────────────────────────────────────────────────────────

const createStacSearchGraph = () => {
  return new StateGraph(StacSearchState)
    .addNode("stacSearchRouter", stacSearchRouter)
    .addNode("stacSearchLLM", stacSearchLLM)
    .addNode("stacSearchToolCalling", stacSearchToolCalling)
    .addEdge(START, "stacSearchRouter")
    .addConditionalEdges("stacSearchRouter", (state: any) => {
      if (state.outputMessage && state.outputMessage.trim().length > 0) {
        return "end";
      }
      return "llm";
    }, {
      end: END,
      llm: "stacSearchLLM",
    })
    .addEdge("stacSearchLLM", "stacSearchToolCalling")
    .addEdge("stacSearchToolCalling", END);
};

// ── Agent registration ───────────────────────────────────────────────────────

export const StacSearchAgent: AgentRegistration = {
  id: "stac-search-agent",
  name: "STAC Search",
  description:
    "Searches STAC (SpatioTemporal Asset Catalog) APIs for satellite imagery, " +
    "remote sensing data, and geospatial assets from external catalogs. " +
    "Supports Element84 Earth Search (Sentinel-2, Landsat, NAIP, COP-DEM) and " +
    "Microsoft Planetary Computer (Sentinel-2, Landsat, ASTER, MODIS, NAIP). " +
    "Can search by location (current map extent), date range, collection name, and attributes. " +
    "Browse available collections to see what data a catalog offers. " +
    "Loads Cloud Optimized GeoTIFF (COG) assets directly as ImageryTileLayer on the map. " +
    "Use when the user mentions: STAC, satellite imagery, Sentinel, Landsat, NAIP, " +
    "Earth Search, Planetary Computer, COG, cloud optimized, remote sensing, " +
    "or wants to search external data catalogs outside of ArcGIS. " +
    "Also handles adding STAC search results: 'add STAC result 3', 'add all STAC results'. " +
    "Do NOT use for ArcGIS portal content — use the Search Content agent for that.",
  createGraph: createStacSearchGraph,
  workspace: StacSearchState,
};
