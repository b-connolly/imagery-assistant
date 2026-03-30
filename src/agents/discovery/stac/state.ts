import { Annotation, messagesStateReducer } from "@langchain/langgraph/web";
import type { ChatHistory } from "@arcgis/ai-components/utils/index.js";

// ── State ────────────────────────────────────────────────────────────────────

export const StacSearchState = Annotation.Root({
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

export type StacSearchStateType = typeof StacSearchState.State;
