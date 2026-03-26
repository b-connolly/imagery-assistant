import type { RunnableConfig } from "@langchain/core/runnables";

/**
 * Context for the ContentSearch agent.
 * Empty for Phase 1 — tools use getCurrentView() directly.
 */
export interface ContentSearchContext {
  // Phase 1: empty — tools access view state directly via viewManager
}

const CONTEXT_KEY = "contentSearchContext";

/**
 * Extract ContentSearchContext from a RunnableConfig.
 */
export function getContentSearchContext(
  config?: RunnableConfig
): ContentSearchContext {
  return (config?.configurable?.[CONTEXT_KEY] as ContentSearchContext) ?? {};
}
