import type { RunnableConfig } from "@langchain/core/runnables";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { sendTraceMessage } from "@arcgis/ai-components/utils/index.js";
import { stacSearchTools } from "../tools";
import type { StacSearchStateType } from "../state";

export async function stacSearchToolCalling(
  state: StacSearchStateType,
  config?: RunnableConfig,
): Promise<Partial<StacSearchStateType>> {
  const toolNode = new ToolNode(stacSearchTools);
  const res = await toolNode.invoke({ messages: state.messages }, config);

  await sendTraceMessage({ text: "StacSearch: finished" }, config);

  return {
    ...state,
    messages: [...state.messages, ...res.messages],
    outputMessage: res.messages
      .map((m: any) => m.content?.toString() ?? "")
      .join("\n"),
  };
}
