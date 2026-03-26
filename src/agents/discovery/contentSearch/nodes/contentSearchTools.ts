import type { RunnableConfig } from "@langchain/core/runnables";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { sendTraceMessage } from "@arcgis/ai-components/utils/index.js";
import { contentSearchTools } from "../tools";
import type { ContentSearchStateType } from "../state";

/**
 * Tool-calling node — executes tool calls produced by the LLM node.
 */
export async function contentSearchToolCalling(
  state: ContentSearchStateType,
  config?: RunnableConfig,
): Promise<Partial<ContentSearchStateType>> {
  const toolNode = new ToolNode(contentSearchTools);
  const res = await toolNode.invoke({ messages: state.messages }, config);

  await sendTraceMessage({ text: "ContentSearch: finished" }, config);

  return {
    ...state,
    messages: [...state.messages, ...res.messages],
    outputMessage: res.messages
      .map((m: any) => m.content?.toString() ?? "")
      .join("\n"),
  };
}
