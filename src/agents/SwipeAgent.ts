import { StateGraph, START, END } from "@langchain/langgraph/web";
import { getCurrentView, getMapSceneElement } from "../utils/viewManager";
import { extractLastUserText, createAgentState, registerAgentElement, findLayerByTitle , elapsed } from "../utils/agentHelpers";

// ── Active swipe tracking ───────────────────────────────────────────────────

let activeSwipeElement: HTMLElement | null = null;

function clearSwipe(): boolean {
  if (!activeSwipeElement) return false;
  try {
    activeSwipeElement.remove();
  } catch {
    // Element may already be removed
  }
  activeSwipeElement = null;
  return true;
}

// ── Intent extraction ───────────────────────────────────────────────────────

type SwipeAction = "activate" | "clear" | "direction" | "help";

function extractSwipeIntent(text: string): {
  action: SwipeAction;
  direction?: "horizontal" | "vertical";
  layerNames?: string[];
} {
  const lower = text.toLowerCase();

  // Clear / stop / remove
  if (/\b(clear|stop|remove|close|cancel|end|done|disable)\s*(swipe|compar|split)?/i.test(lower)) {
    return { action: "clear" };
  }

  // Change direction only
  if (/\b(vertical|top.?bottom|up.?down)\b/i.test(lower) && activeSwipeElement) {
    return { action: "direction", direction: "vertical" };
  }
  if (/\b(horizontal|left.?right|side.?by.?side)\b/i.test(lower) && activeSwipeElement) {
    return { action: "direction", direction: "horizontal" };
  }

  // Help
  if (/\b(help|how|what)\b/i.test(lower) && /\bswipe\b/i.test(lower)) {
    return { action: "help" };
  }

  // Activate swipe — extract direction preference
  let direction: "horizontal" | "vertical" = "horizontal";
  if (/\b(vertical|top.?bottom|up.?down)\b/i.test(lower)) {
    direction = "vertical";
  }

  // Try to extract layer names from "compare X and Y" or "swipe X with Y"
  const layerNames: string[] = [];
  const compareMatch = text.match(
    /(?:compare|swipe|split)\s+(?:the\s+)?(.+?)\s+(?:and|with|vs\.?|versus|against)\s+(?:the\s+)?(.+?)(?:\s+layers?)?$/i
  );
  if (compareMatch) {
    layerNames.push(compareMatch[1].trim(), compareMatch[2].trim());
  }

  // "swipe layer 1 and layer 2" / "compare layer 1 and 2"
  const numMatch = text.match(
    /(?:compare|swipe|split)\s+(?:layers?\s+)?(\d+)\s+(?:and|with|vs\.?)\s+(?:layers?\s+)?(\d+)/i
  );
  if (numMatch) {
    layerNames.length = 0; // override any earlier match
    layerNames.push(`#${numMatch[1]}`, `#${numMatch[2]}`);
  }

  return { action: "activate", direction, layerNames: layerNames.length > 0 ? layerNames : undefined };
}

// ── Layer matching ──────────────────────────────────────────────────────────

function findLayerByName(layers: any[], name: string): any | null {
  // Match by number reference (e.g., "#1" means first layer)
  const numMatch = name.match(/^#(\d+)$/);
  if (numMatch) {
    const idx = parseInt(numMatch[1], 10) - 1;
    return layers[idx] ?? null;
  }
  return findLayerByTitle(layers, name);
}

function formatLayerList(layers: any[]): string {
  return layers
    .map((l: any, i: number) => `  ${i + 1}. ${l.title || "Untitled"}`)
    .join("\n");
}

// ── Agent registration ──────────────────────────────────────────────────────

export function registerSwipeAgent(assistant: HTMLElement) {
  const agentId = "swipe-agent";

  const createGraph = () => {
    const state = createAgentState();

    async function swipeNode(s: any) {
      const text = extractLastUserText(s);
      const t0 = performance.now();
      console.log("[Swipe] Starting. User text:", text);

      const view = getCurrentView() as any;
      if (!view) {
        return { outputMessage: "No active map or scene view. Please wait for the view to load." };
      }

      const { action, direction, layerNames } = extractSwipeIntent(text);
      console.log("[Swipe] Action:", action, "Direction:", direction, "Layers:", layerNames);

      switch (action) {
        case "clear": {
          if (clearSwipe()) {
            return { outputMessage: "Swipe tool removed." };
          }
          return { outputMessage: "No swipe tool is currently active." };
        }

        case "help": {
          return {
            outputMessage:
              "**Swipe / Compare Tool**\n\n" +
              "Compare two layers by swiping between them.\n\n" +
              "- \"compare layer 1 and layer 2\"\n" +
              "- \"swipe\" (uses last two layers)\n" +
              "- \"vertical swipe\" (top/bottom split)\n" +
              "- \"clear swipe\" (remove the tool)",
          };
        }

        case "direction": {
          if (activeSwipeElement && direction) {
            (activeSwipeElement as any).direction = direction;
            return { outputMessage: `Swipe direction changed to ${direction}.` };
          }
          return { outputMessage: "No swipe tool is active to change direction." };
        }

        case "activate": {
          const layers = view.map?.layers?.toArray() ?? [];
          if (layers.length < 2) {
            return {
              outputMessage:
                "Need at least 2 layers on the map to compare. " +
                "Load some layers first, then try again.",
            };
          }

          // Resolve which layers to compare
          let startLayer: any;
          let endLayer: any;

          if (layerNames && layerNames.length >= 2) {
            startLayer = findLayerByName(layers, layerNames[0]);
            endLayer = findLayerByName(layers, layerNames[1]);

            if (!startLayer || !endLayer) {
              const missing = !startLayer ? layerNames[0] : layerNames[1];
              return {
                outputMessage:
                  `Could not find layer "${missing}". Available layers:\n` +
                  formatLayerList(layers) +
                  '\n\nTry "compare layer 1 and layer 2" using the numbers above.',
              };
            }
          } else {
            // Default: use the last two layers added
            startLayer = layers[layers.length - 2];
            endLayer = layers[layers.length - 1];
          }

          // Clear any existing swipe
          clearSwipe();

          // Create the arcgis-swipe web component
          const parent = getMapSceneElement();
          if (!parent) {
            return { outputMessage: "Could not find the map element to attach the swipe tool." };
          }

          const el = document.createElement("arcgis-swipe") as any;
          el.direction = direction ?? "horizontal";
          el.position = 50;
          parent.appendChild(el);

          // Set layers after the element is connected to the DOM
          // Use requestAnimationFrame to ensure the component initializes
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
              try {
                el.startLayers = [startLayer];
                el.endLayers = [endLayer];
              } catch {
                // Fallback: try setting via the widget property
                try {
                  if (el.widget) {
                    el.widget.leadingLayers.add(startLayer);
                    el.widget.trailingLayers.add(endLayer);
                  }
                } catch (e2) {
                  console.warn("[Swipe] Could not set layers:", e2);
                }
              }
              resolve();
            });
          });

          activeSwipeElement = el;

          const elapsedTime = elapsed(t0);
          const dirLabel = (direction ?? "horizontal") === "horizontal" ? "left/right" : "top/bottom";
          return {
            outputMessage:
              `Swipe tool activated (${dirLabel}) in ${elapsedTime}s.\n\n` +
              `**Left/Start:** ${startLayer.title || "Untitled"}\n` +
              `**Right/End:** ${endLayer.title || "Untitled"}\n\n` +
              "Drag the handle to compare. Say \"clear swipe\" to remove, or \"vertical swipe\" to change direction.",
          };
        }
      }
    }

    return new StateGraph(state)
      .addNode("swipeNode", swipeNode)
      .addEdge(START, "swipeNode")
      .addEdge("swipeNode", END);
  };

  registerAgentElement(assistant, {
    id: agentId,
    name: "Swipe / Compare",
    description:
      "Activates a swipe tool to compare two layers side by side. " +
      "Drag a handle across the map to reveal one layer on each side. " +
      "Supports horizontal (left/right) and vertical (top/bottom) directions. " +
      "Use when the user wants to compare, swipe, split, or see differences between two layers. " +
      "Also use when the user says 'clear swipe' or 'stop comparing'.",
    createGraph,
  });
}
