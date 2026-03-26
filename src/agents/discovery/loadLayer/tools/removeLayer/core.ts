import { getCurrentView } from "../../../../../utils/viewManager";
import { findLayerByTitle } from "../../../../../utils/agentHelpers";

/**
 * Remove a layer by name, or remove all layers from the active map.
 */
export async function removeLayer(params: {
  layerName?: string;
  removeAll: boolean;
}): Promise<string> {
  const activeView = getCurrentView();
  if (!activeView?.map) {
    return "No active map view.";
  }

  const layers = activeView.map.layers.toArray();
  if (layers.length === 0) {
    return "There are no layers on the map to remove.";
  }

  // ── Remove all layers ──
  if (params.removeAll) {
    const count = layers.length;
    activeView.map.layers.removeAll();
    console.log("[LoadLayer] Removed all", count, "layers.");
    window.dispatchEvent(new CustomEvent("imagery-assistant-layers-removed"));
    return `Removed all ${count} layer${count > 1 ? "s" : ""} from the map.`;
  }

  // ── Remove by name ──
  const name = (params.layerName ?? "").trim();
  let target: any = name.length > 1 ? findLayerByTitle(layers, name) : null;

  // If only one layer and no specific name given, remove it
  if (!target && layers.length === 1 && name.length <= 1) {
    target = layers[0];
  }

  if (target) {
    const title = target.title || "Untitled";
    activeView.map.layers.remove(target);
    console.log("[LoadLayer] Removed layer:", title);
    if (activeView.map.layers.length === 0) {
      window.dispatchEvent(new CustomEvent("imagery-assistant-layers-removed"));
    }
    return `Removed "${title}" from the map.`;
  }

  // List available layers if we couldn't match
  const names = layers.map((l: any) => `"${l.title || "Untitled"}"`).join(", ");
  return `Couldn't identify which layer to remove. Available layers: ${names}. Please specify the layer name.`;
}

/**
 * Extract the layer name from user text for remove operations.
 * Strips common verbs and filler words to isolate the layer name.
 */
export function extractRemoveLayerName(text: string): string {
  return text
    .toLowerCase()
    .replace(
      /\b(remove|delete|drop|clear|hide|take|off|get|rid|of|the|layer|layers|from|map|please)\b/g,
      ""
    )
    .trim();
}
