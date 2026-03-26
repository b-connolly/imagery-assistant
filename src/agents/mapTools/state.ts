import { Annotation, messagesStateReducer } from "@langchain/langgraph/web";
import type { ChatHistory } from "@arcgis/ai-components/utils/index.js";

export const MapToolsState = Annotation.Root({
  messages: Annotation<ChatHistory>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  outputMessage: Annotation<string>({
    reducer: (current = "", update) =>
      typeof update === "string" && update.trim()
        ? (current ? `${current}\n\n${update}` : update)
        : current,
    default: () => "",
  }),
});

export type MapToolsStateType = typeof MapToolsState.State;
