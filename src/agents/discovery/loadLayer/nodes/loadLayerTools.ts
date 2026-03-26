import type { RunnableConfig } from "@langchain/core/runnables";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { sendTraceMessage } from "@arcgis/ai-components/utils/index.js";
import { loadLayerTools } from "../tools";
import type { LoadLayerStateType } from "../state";

/**
 * Tool-calling node — executes tool calls produced by the LLM node.
 */
export async function loadLayerToolCalling(
  state: LoadLayerStateType,
  config?: RunnableConfig,
): Promise<Partial<LoadLayerStateType>> {
  const toolNode = new ToolNode(loadLayerTools);
  const res = await toolNode.invoke({ messages: state.messages }, config);

  await sendTraceMessage({ text: "LoadLayer: finished" }, config);

  return {
    ...state,
    messages: [...state.messages, ...res.messages],
    outputMessage: res.messages
      .map((m: any) => m.content?.toString() ?? "")
      .join("\n"),
  };
}
