import type { RunnableConfig } from "@langchain/core/runnables";

/**
 * Context for the LoadLayer agent.
 * Empty for Phase 1 — tools use getCurrentView() directly.
 */
export interface LoadLayerContext {
  // Phase 1: empty — tools access view state directly via viewManager
}

const CONTEXT_KEY = "loadLayerContext";

/**
 * Extract LoadLayerContext from a RunnableConfig.
 */
export function getLoadLayerContext(
  config?: RunnableConfig
): LoadLayerContext {
  return (config?.configurable?.[CONTEXT_KEY] as LoadLayerContext) ?? {};
}
