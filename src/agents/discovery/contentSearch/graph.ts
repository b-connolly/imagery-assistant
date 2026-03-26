import { StateGraph, START, END } from "@langchain/langgraph/web";
import type { AgentRegistration } from "@arcgis/ai-components/utils/index.js";
import { ContentSearchState } from "./state";
import { contentSearchRouter } from "./nodes/contentSearchRouter";
import { contentSearchLLM } from "./nodes/contentSearchLLM";
import { contentSearchToolCalling } from "./nodes/contentSearchTools";

// ── Graph builder ────────────────────────────────────────────────────────────

const createContentSearchGraph = () => {
  return new StateGraph(ContentSearchState)
    .addNode("contentSearchRouter", contentSearchRouter)
    .addNode("contentSearchLLM", contentSearchLLM)
    .addNode("contentSearchToolCalling", contentSearchToolCalling)
    .addEdge(START, "contentSearchRouter")
    .addConditionalEdges("contentSearchRouter", (state: any) => {
      // If the router produced output (fast-path handled it), go straight to END
      if (state.outputMessage && state.outputMessage.trim().length > 0) {
        return "end";
      }
      // Otherwise, route to the LLM node
      return "llm";
    }, {
      end: END,
      llm: "contentSearchLLM",
    })
    .addEdge("contentSearchLLM", "contentSearchToolCalling")
    .addEdge("contentSearchToolCalling", END);
};

// ── Agent registration ───────────────────────────────────────────────────────

export const ContentSearchAgent: AgentRegistration = {
  id: "content-search-agent",
  name: "Search Content",
  description:
    "Searches for layers and data across multiple ArcGIS sources: the user's own content (My Content), " +
    "their organization's content, ArcGIS Online (public), and Esri's Living Atlas. " +
    "Returns a list of matching results that can be added to the map. " +
    "Use when the user wants to search, find, browse, or discover layers, datasets, or content. " +
    "Also handles adding search results: 'add result 3', 'add results 1-10', 'add all results'. " +
    "Supports 'from my content, add all layers related to X' to search and add all matches. " +
    "Supports scoped searches like 'search my content for thermal' or 'find elevation in Living Atlas'. " +
    "Supports 'find all layers about X' to return more results, or 'top 10' for specific counts. " +
    "Do NOT use for loading a layer from a direct URL or item ID — use the Load Layer agent for that.",
  createGraph: createContentSearchGraph,
  workspace: ContentSearchState,
};
