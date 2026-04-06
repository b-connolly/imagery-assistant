import { getCurrentView, getMapSceneElement, onViewChange } from "../../../utils/viewManager";
import { findLayerByTitle, elapsed } from "../../../utils/agentHelpers";

// ── Active viewer tracking ──────────────────────────────────────────────────

let activePanel: HTMLElement | null = null;
let activeViewer: any = null;

function clearViewer(): boolean {
  if (!activePanel) return false;
  try {
    activePanel.remove();
  } catch (err) {
    console.warn("[OrientedImagery] Panel cleanup failed:", err);
  }
  activePanel = null;
  activeViewer = null;
  return true;
}

// Clear viewer when view changes (e.g., switching 2D/3D or loading a different map)
onViewChange(() => clearViewer());

// ── Drag helper ─────────────────────────────────────────────────────────────

function makeDraggable(panel: HTMLElement, handle: HTMLElement) {
  let offsetX = 0;
  let offsetY = 0;
  handle.addEventListener("mousedown", (e: MouseEvent) => {
    e.preventDefault();
    const rect = panel.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    const onMove = (ev: MouseEvent) => {
      panel.style.left = `${ev.clientX - offsetX}px`;
      panel.style.top = `${ev.clientY - offsetY}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

// ── Viewer panel creation ───────────────────────────────────────────────────

function createViewerPanel(layer: any, view: any, parent: HTMLElement): HTMLElement {
  // Container wrapper
  const container = document.createElement("div");
  container.className = "oi-viewer-panel";

  // Title bar (draggable)
  const titleBar = document.createElement("div");
  titleBar.className = "oi-viewer-titlebar";
  const titleText = document.createElement("span");
  titleText.textContent = `Oriented Imagery — ${layer.title || "Viewer"}`;
  titleBar.appendChild(titleText);

  // Close button
  const closeBtn = document.createElement("calcite-button") as any;
  closeBtn.setAttribute("appearance", "transparent");
  closeBtn.setAttribute("icon-start", "x");
  closeBtn.setAttribute("scale", "s");
  closeBtn.addEventListener("click", () => clearViewer());
  titleBar.appendChild(closeBtn);

  // Viewer component
  const viewer = document.createElement("arcgis-oriented-imagery-viewer") as any;
  viewer.layer = layer;
  viewer.view = view;
  viewer.currentCoverageVisible = true;
  viewer.navigationToolActive = false;
  viewer.mapImageConversionToolState = false;
  viewer.imageEnhancementToolActive = false;
  viewer.preloadMedia = true;

  container.appendChild(titleBar);
  container.appendChild(viewer);
  parent.appendChild(container);

  // Make draggable via title bar
  makeDraggable(container, titleBar);

  // Focus-to-front: bring this panel above others on click
  container.addEventListener("mousedown", () => {
    document.querySelectorAll(".panel-focused").forEach((el) => el.classList.remove("panel-focused"));
    container.classList.add("panel-focused");
  });

  activePanel = container;
  activeViewer = viewer;

  return container;
}

// ── Intent extraction ───────────────────────────────────────────────────────

type OIAction = "open" | "close" | "toggle-navigation" | "toggle-measurement" | "toggle-enhancement" | "toggle-coverage" | "toggle-gallery" | "help";

function extractOIIntent(text: string): { action: OIAction; layerName: string | null } {
  const lower = text.toLowerCase();
  let layerName: string | null = null;

  // Extract layer name from "open viewer for X" or "show viewer on X"
  const nameMatch = text.match(/(?:viewer|imagery)\s+(?:for|on|of)\s+(?:the\s+)?(.+?)(?:\s+layer)?$/i);
  if (nameMatch) layerName = nameMatch[1].trim();

  // Close / remove
  if (/\b(close|remove|hide|clear|stop|disable|dismiss)\s*(viewer|oriented|imagery|oi)/i.test(lower) ||
      /\b(viewer|oriented\s*imagery)\s*(close|off|remove|hide|clear)/i.test(lower)) {
    return { action: "close", layerName };
  }

  // Toggle specific features (only when viewer is already open)
  if (activeViewer) {
    if (/\b(navigation|compass|navigate)\s*(tool)?/i.test(lower) && /\b(toggle|enable|disable|turn|switch)/i.test(lower)) {
      return { action: "toggle-navigation", layerName };
    }
    if (/\b(measurement|map[\s-]*image|conversion|coordinate)/i.test(lower)) {
      return { action: "toggle-measurement", layerName };
    }
    if (/\b(enhancement|brightness|contrast|sharpness)/i.test(lower)) {
      return { action: "toggle-enhancement", layerName };
    }
    if (/\b(coverage|footprint)/i.test(lower) && /\b(toggle|show|hide|enable|disable)/i.test(lower)) {
      return { action: "toggle-coverage", layerName };
    }
    if (/\b(gallery|thumbnail)/i.test(lower)) {
      return { action: "toggle-gallery", layerName };
    }
  }

  // Help
  if (/\b(help|how|what)\b/i.test(lower) && /\b(oriented|viewer|oi)\b/i.test(lower)) {
    return { action: "help", layerName };
  }

  // Default: open viewer
  return { action: "open", layerName };
}

// ── Find oriented imagery layer on the map ──────────────────────────────────

function findOILayer(view: any, layerName: string | null): any | null {
  const layers = view.map?.layers?.toArray() ?? [];

  // If user specified a name, try that first
  if (layerName) {
    const match = findLayerByTitle(layers, layerName);
    if (match?.type === "oriented-imagery") return match;
  }

  // Find any OI layer on the map
  return layers.find((l: any) => l.type === "oriented-imagery") ?? null;
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function orientedImageryHandler(text: string): Promise<{ outputMessage: string }> {
  const t0 = performance.now();
  console.log("[OrientedImagery] Starting. User text:", text);

  const view = getCurrentView() as any;
  if (!view?.map) {
    return { outputMessage: "No active map view." };
  }

  const { action, layerName } = extractOIIntent(text);
  console.log("[OrientedImagery] Action:", action, "LayerName:", layerName);

  switch (action) {
    case "close": {
      if (clearViewer()) {
        return { outputMessage: "Oriented Imagery Viewer closed." };
      }
      return { outputMessage: "No Oriented Imagery Viewer is currently open." };
    }

    case "toggle-navigation": {
      if (!activeViewer) return { outputMessage: "No viewer is open. Say \"open oriented imagery viewer\" first." };
      activeViewer.navigationToolActive = !activeViewer.navigationToolActive;
      return { outputMessage: `Navigation tool ${activeViewer.navigationToolActive ? "enabled" : "disabled"}.` };
    }

    case "toggle-measurement": {
      if (!activeViewer) return { outputMessage: "No viewer is open. Say \"open oriented imagery viewer\" first." };
      activeViewer.mapImageConversionToolState = !activeViewer.mapImageConversionToolState;
      return { outputMessage: `Map-image conversion tool ${activeViewer.mapImageConversionToolState ? "enabled" : "disabled"}.` };
    }

    case "toggle-enhancement": {
      if (!activeViewer) return { outputMessage: "No viewer is open. Say \"open oriented imagery viewer\" first." };
      activeViewer.imageEnhancementToolActive = !activeViewer.imageEnhancementToolActive;
      return { outputMessage: `Image enhancement tools ${activeViewer.imageEnhancementToolActive ? "enabled" : "disabled"}.` };
    }

    case "toggle-coverage": {
      if (!activeViewer) return { outputMessage: "No viewer is open. Say \"open oriented imagery viewer\" first." };
      activeViewer.currentCoverageVisible = !activeViewer.currentCoverageVisible;
      return { outputMessage: `Coverage footprint ${activeViewer.currentCoverageVisible ? "shown" : "hidden"}.` };
    }

    case "toggle-gallery": {
      if (!activeViewer) return { outputMessage: "No viewer is open. Say \"open oriented imagery viewer\" first." };
      activeViewer.galleryOpened = !activeViewer.galleryOpened;
      return { outputMessage: `Image gallery ${activeViewer.galleryOpened ? "opened" : "closed"}.` };
    }

    case "help": {
      return {
        outputMessage:
          "**Oriented Imagery Viewer**\n\n" +
          "View and explore oriented (non-nadir) imagery by clicking camera locations on the map.\n\n" +
          "- \"open oriented imagery viewer\" — open the viewer\n" +
          "- \"close viewer\" — close the viewer\n" +
          "- \"toggle navigation tool\" — compass navigation\n" +
          "- \"toggle image enhancement\" — brightness/contrast/sharpness\n" +
          "- \"show coverage footprint\" — show/hide image footprint\n" +
          "- \"show gallery\" — browse image thumbnails\n\n" +
          "The viewer panel can be dragged by its title bar and resized from the bottom-right corner.",
      };
    }

    case "open": {
      // Find the OI layer
      const layer = findOILayer(view, layerName);
      if (!layer) {
        return {
          outputMessage:
            "No Oriented Imagery Layer found on the map. " +
            "Load an oriented imagery layer first, then say \"open oriented imagery viewer\".",
        };
      }

      // Clear any existing viewer
      clearViewer();

      const parent = getMapSceneElement();
      if (!parent) {
        return { outputMessage: "Could not find the map element to attach the viewer." };
      }

      createViewerPanel(layer, view, parent);

      const elapsedTime = elapsed(t0);
      return {
        outputMessage:
          `Oriented Imagery Viewer opened for "${layer.title}" (${elapsedTime}s).\n\n` +
          "Click a camera location on the map to view imagery. " +
          "The panel can be dragged and resized.\n\n" +
          "Say \"close viewer\" to remove, or \"help oriented imagery\" for all commands.",
      };
    }
  }

  // Fallback (should not be reached)
  return { outputMessage: "" };
}
