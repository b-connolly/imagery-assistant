import { StateGraph, START, END } from "@langchain/langgraph/web";
import { registerAgentElement, createAgentState , elapsed } from "../utils/agentHelpers";

// Human-friendly capability summaries with example prompts
const CAPABILITIES = [
  {
    name: "Search & Discovery",
    summary: "Find layers across My Content, My Org, ArcGIS Online, or Living Atlas.",
    examples: ["search my content for Phoenix imagery", "find elevation data in Living Atlas"],
  },
  {
    name: "Load Layers",
    summary: "Add, remove, or zoom to layers. Supports URLs, item IDs, or keywords.",
    examples: ["load world imagery", "zoom to the imagery layer"],
  },
  {
    name: "Imagery Analysis",
    summary: "Apply stretches, color ramps, NDVI, hillshade, and raster functions.",
    examples: ["apply standard deviation stretch", "apply NDVI", "take a screenshot"],
  },
  {
    name: "Measurement",
    summary: "Measure distance, area, or draw an elevation profile.",
    examples: ["measure distance in km", "measure area in acres", "elevation profile"],
  },
  {
    name: "Swipe / Compare",
    summary: "Compare two layers side-by-side with a swipe handle.",
    examples: ["compare layer 1 and layer 2", "swipe", "vertical swipe"],
  },
  {
    name: "3D Elevation Offset",
    summary: "Fix floating or underground 3D layers.",
    examples: ["fix the floating mesh", "raise the layer by 10m"],
  },
  {
    name: "Layer Info",
    summary: "Query layer fields, attributes, popup config, metadata, tables, and processing templates.",
    examples: ["describe the imagery layer", "what fields does this layer have?"],
  },
  {
    name: "Point Cloud",
    summary: "Filter, restyle, and configure point cloud (LiDAR/LAS) layers.",
    examples: [
      "color by class code",
      "filter ground points",
      "show only buildings",
      "color by elevation",
      "bigger points",
    ],
  },
  {
    name: "Navigation",
    summary: "Zoom to places, change basemaps, adjust the view.",
    examples: ["zoom to San Francisco", "switch to satellite basemap"],
  },
  {
    name: "Data Exploration",
    summary: "Query layers, inspect features, and summarize map content.",
    examples: ["what layers are on the map?", "summarize this layer"],
  },
];

export function registerAllCapabilitiesAgent(assistant: HTMLElement) {
  const agentId = "all-capabilities-agent";

  const createGraph = () => {
    const state = createAgentState();

    function summarizeNode() {
      const lines = ["Here's what I can do:\n"];
      for (const cap of CAPABILITIES) {
        lines.push(`**${cap.name}** — ${cap.summary}`);
        lines.push(`  _Try:_ "${cap.examples[0]}"\n`);
      }
      lines.push("Just describe what you need in plain language.");
      return { outputMessage: lines.join("\n") };
    }

    return new StateGraph(state)
      .addNode("summarizeNode", summarizeNode)
      .addEdge(START, "summarizeNode")
      .addEdge("summarizeNode", END);
  };

  registerAgentElement(assistant, {
    id: agentId,
    name: "All Capabilities",
    description:
      "Lists all available assistant capabilities. Use when users ask what you can do, what tools are available, or ask for help.",
    createGraph,
  });
}
