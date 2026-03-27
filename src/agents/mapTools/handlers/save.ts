import { getCurrentView, getCurrentViewType } from "../../../utils/viewManager";
import { saveAsWebMap, saveAsWebScene, updateWebMap, updateWebScene } from "../../../utils/saveMap";
import { DEFAULT_WEBMAP_ID } from "../../../utils/arcgisAuth";

/**
 * Handle "save web map [title]", "save web scene [title]",
 * and "clear map" / "clear scene" / "new map" commands.
 */
export async function saveHandler(text: string): Promise<{ outputMessage: string }> {
  // ── Clear/reset map ────────────────────────────────────────────────
  if (/\b(clear|reset|new)\s+(web\s*)?(map|scene)\b/i.test(text)) {
    const view = getCurrentView();
    if (!view) return { outputMessage: "No active view." };
    const count = view.map.layers.length;
    view.map.layers.removeAll();
    // Clear session so next visit starts fresh
    localStorage.removeItem("imagery-assistant-webmap-id");
    window.dispatchEvent(new CustomEvent("imagery-assistant-layers-removed"));
    return { outputMessage: `Cleared ${count} layer${count !== 1 ? "s" : ""}. Map reset to empty.` };
  }
  const view = getCurrentView();
  if (!view) return { outputMessage: "No active map view." };

  const vt = getCurrentViewType();
  const typeLabel = vt === "3d" ? "web scene" : "web map";

  // Extract title from text: "save web map My Title" → "My Title"
  // Also handles quoted titles: save web map "Denver Sentinel 2"
  const titleMatch = text
    .replace(/\b(save|save\s*as)\b/i, "")
    .replace(/\b(web\s*map|web\s*scene|map|scene)\b/i, "")
    .replace(/["""'']/g, "")
    .trim();

  // Check if user has a saved map (not the read-only default)
  const portalItemId = (view.map as any)?.portalItem?.id;
  const isUserSaved = portalItemId && portalItemId !== DEFAULT_WEBMAP_ID;

  try {
    if (isUserSaved && !titleMatch) {
      // Update existing user-saved map
      const result = vt === "3d"
        ? await updateWebScene(view as any)
        : await updateWebMap(view as any);
      return { outputMessage: `Updated "${result.title}".` };
    }

    // Save As — new item
    const title = titleMatch || (vt === "3d" ? "My Web Scene" : "My Web Map");
    const result = vt === "3d"
      ? await saveAsWebScene(view as any, title)
      : await saveAsWebMap(view as any, title);

    // Notify App.tsx so it can track the saved map ID
    window.dispatchEvent(new CustomEvent("imagery-assistant-map-saved", {
      detail: { id: result.id, title: result.title, viewType: vt },
    }));

    return { outputMessage: `Saved "${result.title}" as a new ${typeLabel}.` };
  } catch (err: any) {
    console.error("[Save] Failed:", err);
    return { outputMessage: `Save failed: ${err?.message ?? String(err)}` };
  }
}
