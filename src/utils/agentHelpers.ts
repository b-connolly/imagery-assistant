import {
  Annotation as ANNOTATION,
} from "@langchain/langgraph/web";

// ── Layer type constants ────────────────────────────────────────────────────

/** Layer types that require a 3D SceneView (runtime type strings from the SDK) */
export const REQUIRES_3D = new Set([
  "scene",
  "integrated-mesh",
  "integrated-mesh-3dtiles",
  "gaussian-splat",
  "point-cloud",
  "building-scene",
  "voxel",
  "dimension",
]);

// ── Message extraction ──────────────────────────────────────────────────────

/**
 * Extract the last user (HumanMessage) text from the agent state.
 * Handles all the LangChain message format variations.
 */
export function extractLastUserText(state: any): string {
  const rawMessages = Array.isArray(state?.messages) ? state.messages : [];
  const messages =
    rawMessages.length > 0 && Array.isArray(rawMessages[0])
      ? rawMessages.flat()
      : rawMessages;

  function isHuman(msg: any): boolean {
    if (msg?._getType?.() === "human") return true;
    if (msg?.constructor?.name === "HumanMessage") return true;
    const id = msg?.lc_id ?? msg?.id;
    if (Array.isArray(id) && id.some((s: any) => typeof s === "string" && s.includes("HumanMessage"))) return true;
    if (typeof msg?.lc_kwargs?.type === "string" && msg.lc_kwargs.type === "human") return true;
    return false;
  }

  function getContent(msg: any): string {
    if (typeof msg?.lc_kwargs?.content === "string") return msg.lc_kwargs.content.trim();
    if (typeof msg?.kwargs?.content === "string") return msg.kwargs.content.trim();
    if (typeof msg?.content === "string") return msg.content.trim();
    return "";
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    if (isHuman(msg)) {
      const content = getContent(msg);
      if (content) return content;
    }
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const content = getContent(messages[i]);
    if (content) return content;
  }
  return "";
}

// ── Layer matching ──────────────────────────────────────────────────────────

/**
 * Find a layer by title using exact match first, then substring match.
 * Returns null if no match is found.
 */
export function findLayerByTitle(layers: any[], query: string): any | null {
  const q = query.toLowerCase();
  return (
    layers.find((l: any) => (l.title || "").toLowerCase() === q) ??
    layers.find((l: any) => (l.title || "").toLowerCase().includes(q)) ??
    null
  );
}

// ── Agent state & registration ──────────────────────────────────────────────

/**
 * Create the standard agent state annotation with messages + outputMessage.
 */
export function createAgentState() {
  return ANNOTATION.Root({
    messages: ANNOTATION({
      reducer: (cur: any[] = [], update: any) => [...cur, update],
      default: () => [],
    }),
    outputMessage: ANNOTATION({
      reducer: (current: string = "", update: any) =>
        typeof update === "string" && update.trim()
          ? current
            ? `${current}\n\n${update}`
            : update
          : current,
      default: () => "",
    }),
  });
}

/**
 * Register an agent element on the arcgis-assistant DOM element.
 * Removes any existing agent with the same ID before adding.
 */
export function registerAgentElement(
  assistant: HTMLElement,
  agent: { id: string; name: string; description: string; createGraph: () => any; workspace?: any }
): void {
  const existing = assistant.querySelector(`[data-agent-id="${agent.id}"]`);
  if (existing) existing.remove();

  const agentEl = document.createElement("arcgis-assistant-agent") as any;
  agentEl.setAttribute("data-agent-id", agent.id);
  agentEl.agent = agent;
  assistant.appendChild(agentEl);
}

/** Format elapsed time from a performance.now() start timestamp. */
export function elapsed(startMs: number): string {
  return ((performance.now() - startMs) / 1000).toFixed(1);
}
