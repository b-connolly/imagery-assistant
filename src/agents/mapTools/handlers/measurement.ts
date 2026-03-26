import { getCurrentView, getCurrentViewType, onViewChange, requestViewSwitch } from "../../../utils/viewManager";
import { elapsed } from "../../../utils/agentHelpers";
import Collection from "@arcgis/core/core/Collection";
import ElevationProfileLineGround from "@arcgis/core/analysis/ElevationProfile/ElevationProfileLineGround";
import ElevationProfileLineScene from "@arcgis/core/analysis/ElevationProfile/ElevationProfileLineScene";

// ── Active widget tracking ──────────────────────────────────────────────────

let activeElement: HTMLElement | null = null;
let activeWidgetType: MeasureAction | null = null;

// Clear stale measurement widgets when the view changes (2D↔3D toggle)
onViewChange(() => clearActiveWidget());

function clearActiveWidget(): void {
  if (activeElement) {
    try {
      const view = getCurrentView() as any;
      if (view?.ui) {
        view.ui.remove(activeElement);
      }
      activeElement.remove();
    } catch {
      // Element may already be removed
    }
    activeElement = null;
    activeWidgetType = null;
  }
}

// ── Intent extraction ───────────────────────────────────────────────────────

type MeasureAction =
  | "distance"
  | "area"
  | "elevation-profile"
  | "volume"
  | "clear"
  | "help";

function extractMeasureIntent(text: string): MeasureAction {
  // Clear / stop / remove
  if (/\b(clear|stop|remove|close|cancel|end|done|finish)\s*(measur|tool|widget)?/i.test(text)) {
    return "clear";
  }

  // Volume measurement (must check before area — "volume" often co-occurs with area keywords)
  if (/\b(volume|cut\s*(?:and|&)?\s*fill|stockpile|excavat|earthwork|grading)\b/i.test(text)) {
    return "volume";
  }

  // Elevation profile
  if (/\b(elevation\s*profile|profile|cross[\s-]*section|terrain\s*profile)\b/i.test(text)) {
    return "elevation-profile";
  }

  // Area
  if (/\b(area|polygon|region|acreage|square|hectare|sq\s)/i.test(text)) {
    return "area";
  }

  // Distance (default measurement action)
  if (/\b(distance|length|measure|line|ruler|how\s*far|between)\b/i.test(text)) {
    return "distance";
  }

  return "help";
}

// ── Unit extraction ─────────────────────────────────────────────────────────

type LinearUnit = "meters" | "kilometers" | "feet" | "miles" | "yards" | "nautical-miles";
type AreaUnit = "square-meters" | "square-kilometers" | "square-feet" | "square-miles" | "acres" | "hectares";

function extractLinearUnit(text: string): LinearUnit | null {
  if (/\b(kilometer|km)\b/i.test(text)) return "kilometers";
  if (/\b(mile(?!l)|mi\b)/i.test(text) && !/nautical/i.test(text)) return "miles";
  if (/\bnautical\s*mile/i.test(text)) return "nautical-miles";
  if (/\b(yard|yd)\b/i.test(text)) return "yards";
  if (/\b(feet|foot|ft)\b/i.test(text)) return "feet";
  if (/\b(meter|metre|m\b)/i.test(text)) return "meters";
  return null;
}

function extractAreaUnit(text: string): AreaUnit | null {
  if (/\b(acre)\b/i.test(text)) return "acres";
  if (/\b(hectare|ha\b)/i.test(text)) return "hectares";
  if (/\b(sq(uare)?\s*(km|kilo))/i.test(text)) return "square-kilometers";
  if (/\b(sq(uare)?\s*(mi(?!l)|mile))/i.test(text)) return "square-miles";
  if (/\b(sq(uare)?\s*(ft|feet|foot))/i.test(text)) return "square-feet";
  if (/\b(sq(uare)?\s*(m\b|meter|metre))/i.test(text)) return "square-meters";
  return null;
}

type VolumeUnit = "metric" | "imperial" | "cubic-meters" | "cubic-feet" | "cubic-yards" | "liters";

function extractVolumeUnit(text: string): VolumeUnit | null {
  if (/\b(cubic\s*(feet|foot|ft))\b/i.test(text)) return "cubic-feet";
  if (/\b(cubic\s*(yard|yd))\b/i.test(text)) return "cubic-yards";
  if (/\b(cubic\s*(meter|metre|m\b))\b/i.test(text)) return "cubic-meters";
  if (/\bliter/i.test(text)) return "liters";
  if (/\bimperial\b/i.test(text)) return "imperial";
  if (/\bmetric\b/i.test(text)) return "metric";
  return null;
}

type VolumeMeasureMode = "cut-fill" | "stockpile";

function extractVolumeMode(text: string): VolumeMeasureMode {
  if (/\bstockpile\b/i.test(text)) return "stockpile";
  return "cut-fill";
}

// ── Web component creation ──────────────────────────────────────────────────

/**
 * Create and attach a measurement web component to the view's UI,
 * wrapped in a container with a close button.
 * Uses view.ui.add() to position correctly in the view's layout system.
 * Returns the wrapper element (stored as activeElement for cleanup).
 */
function createMeasurementComponent(
  tagName: string,
  unit: string | null,
  position = "bottom-left"
): HTMLElement | null {
  const view = getCurrentView() as any;
  if (!view?.ui) return null;

  // Wrapper — inline styles ensure they aren't overridden by the ArcGIS UI system
  const wrapper = document.createElement("div");
  wrapper.classList.add("measurement-wrapper");
  wrapper.style.cssText = `
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 280px;
    max-width: 360px;
    border-radius: 8px;
    background: #2b2b2b;
    border: 1px solid #404040;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    overflow: hidden;
  `;

  // Close button
  const closeBtn = document.createElement("calcite-action");
  closeBtn.setAttribute("icon", "x");
  closeBtn.setAttribute("scale", "s");
  closeBtn.setAttribute("text", "Close");
  closeBtn.setAttribute("appearance", "transparent");
  closeBtn.classList.add("measurement-close-btn");
  closeBtn.addEventListener("click", () => clearActiveWidget());

  // Header bar with close button
  const header = document.createElement("div");
  header.classList.add("measurement-header");
  header.appendChild(closeBtn);

  // The actual measurement component
  const el = document.createElement(tagName);
  el.style.cssText = "padding: 12px 16px; display: block; width: 100%; box-sizing: border-box;";
  if (unit) {
    el.setAttribute("unit", unit);
  }
  // Bind the component to this view
  (el as any).view = view;

  wrapper.appendChild(header);
  wrapper.appendChild(el);

  // Use the view's UI system for correct positioning
  view.ui.add(wrapper, position);
  return wrapper;
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function measurementHandler(text: string): Promise<{ outputMessage: string }> {
  const t0 = performance.now();

  const view = getCurrentView() as any;
  if (!view) {
    return { outputMessage: "No active map or scene view. Please wait for the view to load." };
  }

  const action = extractMeasureIntent(text);
  const is3D = getCurrentViewType() === "3d";

  console.log("[Measurement] Action:", action, "3D:", is3D);

  switch (action) {
    case "clear": {
      if (!activeElement) {
        return { outputMessage: "No measurement tool is currently active." };
      }
      const was = activeWidgetType;
      clearActiveWidget();
      return { outputMessage: `Cleared the ${was} measurement tool.` };
    }

    case "help": {
      return {
        outputMessage:
          "Available measurement tools:\n" +
          "- **Distance**: \"measure distance\" — click points on the map to measure length\n" +
          "- **Area**: \"measure area\" — draw a polygon to measure area\n" +
          "- **Volume**: \"measure volume\" — draw a polygon in 3D to calculate cut/fill or stockpile volume\n" +
          "- **Elevation Profile**: \"elevation profile\" — draw a line to see elevation changes\n" +
          "- **Clear**: \"clear measurement\" or click the **X** button to close the active tool\n\n" +
          "You can specify units: \"measure distance in kilometers\", \"measure area in acres\".\n" +
          "For volume, specify mode: \"measure stockpile volume\" or \"cut and fill volume\".",
      };
    }

    case "distance": {
      clearActiveWidget();

      const linearUnit = extractLinearUnit(text);
      const tagName = is3D
        ? "arcgis-direct-line-measurement-3d"
        : "arcgis-distance-measurement-2d";

      const el = createMeasurementComponent(tagName, linearUnit);
      if (!el) {
        return { outputMessage: "Could not find the map/scene element to attach the measurement tool." };
      }

      activeElement = el;
      activeWidgetType = "distance";

      const elapsedTime = elapsed(t0);
      const unitMsg = linearUnit ? ` (${linearUnit})` : "";
      return {
        outputMessage: `Distance measurement tool activated${unitMsg} in ${elapsedTime}s. Click on the map to measure.`,
      };
    }

    case "area": {
      clearActiveWidget();

      const areaUnit = extractAreaUnit(text);
      const tagName = is3D
        ? "arcgis-area-measurement-3d"
        : "arcgis-area-measurement-2d";

      const el = createMeasurementComponent(tagName, areaUnit);
      if (!el) {
        return { outputMessage: "Could not find the map/scene element to attach the measurement tool." };
      }

      activeElement = el;
      activeWidgetType = "area";

      const elapsedTime = elapsed(t0);
      const unitMsg = areaUnit ? ` (${areaUnit.replace("-", " ")})` : "";
      return {
        outputMessage: `Area measurement tool activated${unitMsg} in ${elapsedTime}s. Click on the map to draw a polygon.`,
      };
    }

    case "elevation-profile": {
      clearActiveWidget();

      const linearUnit = extractLinearUnit(text);
      const wrapper = createMeasurementComponent("arcgis-elevation-profile", linearUnit);
      if (!wrapper) {
        return { outputMessage: "Could not find the map/scene element to attach the elevation profile tool." };
      }

      // Configure profiles on the inner component to include both
      // ground terrain and 3D scene objects (buildings, meshes, etc.)
      const profileEl = wrapper.querySelector("arcgis-elevation-profile") as any;
      if (profileEl) {
        profileEl.profiles = new Collection([
          new ElevationProfileLineGround(),
          new ElevationProfileLineScene(),
        ]);
      }

      activeElement = wrapper;
      activeWidgetType = "elevation-profile";

      const elapsedTime = elapsed(t0);
      return {
        outputMessage: `Elevation profile tool activated in ${elapsedTime}s. Draw a line on the map to see elevation for both terrain and 3D objects.`,
      };
    }

    case "volume": {
      clearActiveWidget();

      // Volume measurement requires 3D — switch automatically if needed
      if (!is3D) {
        try {
          await requestViewSwitch("3d");
        } catch {
          return {
            outputMessage:
              "Volume measurement requires a 3D scene view. Please switch to 3D using the toggle and try again.",
          };
        }
      }

      const volumeMode = extractVolumeMode(text);
      const volumeUnit = extractVolumeUnit(text);

      const wrapper = createMeasurementComponent("arcgis-volume-measurement", null);
      if (!wrapper) {
        return { outputMessage: "Could not attach the volume measurement tool to the scene." };
      }

      // Configure the inner volume measurement component
      const volumeEl = wrapper.querySelector("arcgis-volume-measurement") as any;
      if (volumeEl) {
        volumeEl.mode = volumeMode;
        if (volumeUnit) {
          volumeEl.volumeDisplayUnit = volumeUnit;
        }
      }

      activeElement = wrapper;
      activeWidgetType = "volume";

      const elapsedTime = elapsed(t0);
      const modeLabel = volumeMode === "stockpile" ? "Stockpile" : "Cut & Fill";
      return {
        outputMessage:
          `Volume measurement tool activated (${modeLabel} mode) in ${elapsedTime}s. ` +
          "Draw a polygon on the scene to measure volume. " +
          (volumeMode === "cut-fill"
            ? "Use the shift manipulator to set the target elevation, or press Tab to type a value."
            : "The volume will be calculated relative to the polygon boundary surface."),
      };
    }
  }
}
