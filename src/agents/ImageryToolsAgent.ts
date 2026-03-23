import { StateGraph, START, END } from "@langchain/langgraph/web";
import ImageryLayer from "@arcgis/core/layers/ImageryLayer";
import RasterStretchRenderer from "@arcgis/core/renderers/RasterStretchRenderer";
import { getCurrentView, getMapSceneElement, onViewChange } from "../utils/viewManager";
import {
  extractLastUserText,
  createAgentState,
  registerAgentElement,
  findLayerByTitle,
  elapsed,
  AGENT_KEYWORDS,
} from "../utils/agentHelpers";
import {
  applyStretch,
  applyColorRamp,
  applyClientRasterFunction,
  applyServerTemplate,
  applyNamedFunction,
  clearRasterFunction,
  getServerTemplates,
  identifyPixel,
  getBandInfos,
  resolvePresetBands,
  getColorRampByName,
  SPECTRAL_INDICES,
  SDK_COLOR_RAMPS,
  BAND_PRESETS,
  type StretchType,
} from "../utils/rasterFunctions";

// ── Active panel & click handler tracking ───────────────────────────────────

let activePanel: HTMLElement | null = null;
let activeImageryLayer: ImageryLayer | null = null;
let clickHandlerRemove: (() => void) | null = null;

function clearPanel(): boolean {
  if (!activePanel) return false;
  try { activePanel.remove(); } catch { /* ok */ }
  activePanel = null;
  return true;
}

function clearClickHandler(): void {
  if (clickHandlerRemove) {
    clickHandlerRemove();
    clickHandlerRemove = null;
  }
}

onViewChange(() => {
  clearPanel();
  clearClickHandler();
});

// ── Drag helper ─────────────────────────────────────────────────────────────

function makeDraggable(panel: HTMLElement, handle: HTMLElement) {
  let offsetX = 0, offsetY = 0;
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

// ── Find imagery layer ──────────────────────────────────────────────────────

function findImageryLayer(view: any, layerName: string | null): ImageryLayer | null {
  const layers = view.map?.layers?.toArray() ?? [];
  if (layerName) {
    const match = findLayerByTitle(layers, layerName);
    if (match?.type === "imagery" || match?.type === "imagery-tile") return match;
  }
  // Find any imagery layer (prefer most recently added)
  const imgLayers = layers.filter((l: any) => l.type === "imagery" || l.type === "imagery-tile");
  return imgLayers.length > 0 ? imgLayers[imgLayers.length - 1] : null;
}

// ── Panel: Renderer tab ─────────────────────────────────────────────────────

function buildRendererTab(layer: ImageryLayer): HTMLElement {
  const container = document.createElement("div");
  container.className = "imagery-tab-content";

  // Stretch type
  const stretchLabel = document.createElement("div");
  stretchLabel.className = "imagery-field-label";
  stretchLabel.textContent = "Stretch Type:";
  container.appendChild(stretchLabel);

  const stretchSelect = document.createElement("calcite-select") as any;
  stretchSelect.setAttribute("scale", "s");
  const stretchTypes: { value: StretchType; label: string }[] = [
    { value: "none", label: "None" },
    { value: "standard-deviation", label: "Standard Deviation" },
    { value: "min-max", label: "Min-Max" },
    { value: "percent-clip", label: "Percent Clip" },
    { value: "histogram-equalization", label: "Histogram Equalization" },
    { value: "sigmoid", label: "Sigmoid" },
  ];
  for (const st of stretchTypes) {
    const opt = document.createElement("calcite-option") as any;
    opt.value = st.value;
    opt.textContent = st.label;
    if (st.value === "standard-deviation") opt.selected = true;
    stretchSelect.appendChild(opt);
  }
  container.appendChild(stretchSelect);

  // Color ramp
  const rampLabel = document.createElement("div");
  rampLabel.className = "imagery-field-label";
  rampLabel.textContent = "Color Ramp:";
  rampLabel.style.marginTop = "8px";
  container.appendChild(rampLabel);

  const rampSelect = document.createElement("calcite-select") as any;
  rampSelect.setAttribute("scale", "s");
  const noneOpt = document.createElement("calcite-option") as any;
  noneOpt.value = "";
  noneOpt.textContent = "None (Default)";
  noneOpt.selected = true;
  rampSelect.appendChild(noneOpt);
  for (const name of SDK_COLOR_RAMPS) {
    const opt = document.createElement("calcite-option") as any;
    opt.value = name;
    opt.textContent = name;
    rampSelect.appendChild(opt);
  }
  container.appendChild(rampSelect);

  // Band selection
  const bands = getBandInfos(layer);
  if (bands.length > 1) {
    const bandLabel = document.createElement("div");
    bandLabel.className = "imagery-field-label";
    bandLabel.textContent = `Band Combination (${bands.length} bands available):`;
    bandLabel.style.marginTop = "8px";
    container.appendChild(bandLabel);

    // Presets dropdown — resolved dynamically from band names
    const resolvedPresets = BAND_PRESETS
      .map((p) => ({ preset: p, resolved: resolvePresetBands(p, bands) }))
      .filter((r) => r.resolved !== null);
    if (resolvedPresets.length > 0) {
      const presetSelect = document.createElement("calcite-select") as any;
      presetSelect.setAttribute("scale", "s");
      presetSelect.style.marginBottom = "4px";
      const presetNone = document.createElement("calcite-option") as any;
      presetNone.value = "";
      presetNone.textContent = "Custom...";
      presetSelect.appendChild(presetNone);
      for (const { preset, resolved } of resolvedPresets) {
        const opt = document.createElement("calcite-option") as any;
        opt.value = resolved!.join(",");
        opt.textContent = preset.label;
        presetSelect.appendChild(opt);
      }
      presetSelect.addEventListener("calciteSelectChange", () => {
        const val = presetSelect.selectedOption?.value;
        if (!val) return;
        const ids = val.split(",").map(Number);
        // Update the R/G/B dropdowns
        ids.forEach((id: number, c: number) => {
          if (bandSelects[c]) {
            const opts = bandSelects[c].querySelectorAll("calcite-option");
            opts.forEach((o: any) => { o.selected = parseInt(o.value, 10) === id; });
          }
        });
        // Auto-apply immediately
        layer.bandIds = ids;
        layer.refresh();
      });
      container.appendChild(presetSelect);
    }

    // R / G / B channel selectors — each lists ALL available bands
    const channelLabels = ["Red", "Green", "Blue"];
    const bandSelects: any[] = [];
    for (let c = 0; c < 3; c++) {
      const row = document.createElement("div");
      row.style.cssText = "display: flex; align-items: center; gap: 4px; margin-bottom: 2px;";
      const label = document.createElement("span");
      label.style.cssText = "font-size: 11px; color: var(--calcite-color-text-2, #aaa); width: 40px;";
      label.textContent = channelLabels[c] + ":";
      row.appendChild(label);

      const bs = document.createElement("calcite-select") as any;
      bs.setAttribute("scale", "s");
      bs.style.flex = "1";
      for (const b of bands) {
        const opt = document.createElement("calcite-option") as any;
        opt.value = String(b.index);
        opt.textContent = `${b.index + 1} — ${b.name}`;
        if (layer.bandIds?.[c] === b.index || (!layer.bandIds && b.index === c)) opt.selected = true;
        bs.appendChild(opt);
      }
      bandSelects.push(bs);
      row.appendChild(bs);
      container.appendChild(row);
    }

    (container as any)._getBandIds = () =>
      bandSelects.map((s: any) => parseInt(s.selectedOption?.value ?? "0", 10));
  }

  // Apply button
  const actions = document.createElement("div");
  actions.style.cssText = "display: flex; gap: 8px; margin-top: 12px;";

  const applyBtn = document.createElement("calcite-button") as any;
  applyBtn.setAttribute("scale", "s");
  applyBtn.setAttribute("width", "half");
  applyBtn.textContent = "Apply";
  applyBtn.addEventListener("click", () => {
    // Set band combination
    const getBands = (container as any)._getBandIds;
    if (getBands) {
      layer.bandIds = getBands();
    }
    // Apply stretch — but don't call refresh twice
    const stretch = stretchSelect.selectedOption?.value as StretchType;
    const ramp = rampSelect.selectedOption?.value;
    const stretchOpts: any = {
      stretchType: stretch,
      numberOfStandardDeviations: 2,
    };
    if (ramp) {
      stretchOpts.colorRamp = getColorRampByName(ramp);
    }
    layer.renderer = new RasterStretchRenderer(stretchOpts);
    layer.refresh();
  });

  const resetBtn = document.createElement("calcite-button") as any;
  resetBtn.setAttribute("scale", "s");
  resetBtn.setAttribute("width", "half");
  resetBtn.setAttribute("appearance", "outline");
  resetBtn.textContent = "Reset";
  resetBtn.addEventListener("click", () => {
    layer.renderer = null as any;
    layer.bandIds = null as any;
    layer.refresh();
  });

  actions.appendChild(applyBtn);
  actions.appendChild(resetBtn);
  container.appendChild(actions);

  return container;
}

// ── Panel: Functions tab ────────────────────────────────────────────────────

function buildFunctionsTab(layer: ImageryLayer): HTMLElement {
  const container = document.createElement("div");
  container.className = "imagery-tab-content";

  // Server processing templates (TOP PRIORITY)
  const templates = getServerTemplates(layer);
  const serverSection = document.createElement("div");

  const serverLabel = document.createElement("div");
  serverLabel.className = "imagery-field-label";
  serverLabel.textContent = `Server Templates (${templates.length}):`;
  serverSection.appendChild(serverLabel);

  if (templates.length > 0) {
    // "None / Default" option
    const noneBtn = document.createElement("calcite-button") as any;
    noneBtn.setAttribute("scale", "s");
    noneBtn.setAttribute("appearance", "outline");
    noneBtn.setAttribute("width", "full");
    noneBtn.textContent = "None (Default)";
    noneBtn.style.marginBottom = "4px";
    noneBtn.addEventListener("click", () => {
      clearRasterFunction(layer);
      highlightActive(serverSection, null);
    });
    serverSection.appendChild(noneBtn);

    for (const t of templates) {
      const btn = document.createElement("calcite-button") as any;
      btn.setAttribute("scale", "s");
      btn.setAttribute("appearance", "outline");
      btn.setAttribute("width", "full");
      btn.textContent = t.name;
      if (t.description) btn.title = t.description;
      btn.style.marginBottom = "4px";
      btn.dataset.templateName = t.name;
      btn.addEventListener("click", () => {
        applyServerTemplate(layer, t.name);
        highlightActive(serverSection, t.name);
      });
      serverSection.appendChild(btn);
    }
  } else {
    const noTemplates = document.createElement("div");
    noTemplates.style.cssText = "color: var(--calcite-color-text-3, #888); font-size: 12px; padding: 4px 0;";
    noTemplates.textContent = "No server templates available.";
    serverSection.appendChild(noTemplates);
  }

  container.appendChild(serverSection);

  // Spectral indices
  const indexLabel = document.createElement("div");
  indexLabel.className = "imagery-field-label";
  indexLabel.textContent = "Spectral Indices:";
  indexLabel.style.marginTop = "12px";
  container.appendChild(indexLabel);

  const indexSelect = document.createElement("calcite-select") as any;
  indexSelect.setAttribute("scale", "s");

  const defaultOpt = document.createElement("calcite-option") as any;
  defaultOpt.value = "";
  defaultOpt.textContent = "Select an index...";
  defaultOpt.selected = true;
  indexSelect.appendChild(defaultOpt);

  for (const [category, indices] of Object.entries(SPECTRAL_INDICES)) {
    const group = document.createElement("calcite-option-group") as any;
    group.label = category;
    for (const idx of indices) {
      const opt = document.createElement("calcite-option") as any;
      opt.value = idx.fn;
      opt.textContent = idx.label;
      group.appendChild(opt);
    }
    indexSelect.appendChild(group);
  }
  container.appendChild(indexSelect);

  const applyIndexBtn = document.createElement("calcite-button") as any;
  applyIndexBtn.setAttribute("scale", "s");
  applyIndexBtn.setAttribute("width", "full");
  applyIndexBtn.textContent = "Apply Index";
  applyIndexBtn.style.marginTop = "4px";
  applyIndexBtn.addEventListener("click", () => {
    const fn = indexSelect.selectedOption?.value;
    if (!fn) return;
    applyClientRasterFunction(layer, fn);
  });
  container.appendChild(applyIndexBtn);

  // Clear button
  const clearBtn = document.createElement("calcite-button") as any;
  clearBtn.setAttribute("scale", "s");
  clearBtn.setAttribute("width", "full");
  clearBtn.setAttribute("appearance", "outline");
  clearBtn.textContent = "Clear Function";
  clearBtn.style.marginTop = "8px";
  clearBtn.addEventListener("click", () => {
    clearRasterFunction(layer);
    highlightActive(serverSection, null);
  });
  container.appendChild(clearBtn);

  return container;
}

function highlightActive(container: HTMLElement, activeName: string | null) {
  container.querySelectorAll("calcite-button").forEach((btn: any) => {
    const name = btn.dataset?.templateName;
    btn.setAttribute("appearance", name === activeName ? "solid" : "outline");
  });
}

// ── Panel: Placeholder tabs for Phase 2/3 ───────────────────────────────────

function buildPlaceholderTab(title: string, description: string): HTMLElement {
  const container = document.createElement("div");
  container.className = "imagery-tab-content";
  container.style.cssText = "display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--calcite-color-text-3, #888); text-align: center; padding: 24px;";
  container.innerHTML = `<calcite-icon icon="information" scale="l"></calcite-icon><div style="margin-top:8px;font-size:13px;"><strong>${title}</strong><br>${description}</div>`;
  return container;
}

// ── Main panel builder ──────────────────────────────────────────────────────

function createImageryPanel(layer: ImageryLayer, parent: HTMLElement): HTMLElement {
  const container = document.createElement("div");
  container.className = "imagery-tools-panel";

  // Title bar
  const titleBar = document.createElement("div");
  titleBar.className = "imagery-tools-titlebar";
  const titleText = document.createElement("span");
  titleText.textContent = `Imagery Tools — ${layer.title || "Layer"}`;
  titleBar.appendChild(titleText);

  const closeBtn = document.createElement("calcite-button") as any;
  closeBtn.setAttribute("appearance", "transparent");
  closeBtn.setAttribute("icon-start", "x");
  closeBtn.setAttribute("scale", "s");
  closeBtn.addEventListener("click", () => clearPanel());
  titleBar.appendChild(closeBtn);

  container.appendChild(titleBar);
  makeDraggable(container, titleBar);

  // Tabs
  const tabNav = document.createElement("calcite-tab-nav") as any;
  tabNav.setAttribute("slot", "title-group");
  const tabs = [
    { id: "renderer", label: "Renderer", icon: "palette" },
    { id: "functions", label: "Functions", icon: "layers-editable" },
    { id: "catalog", label: "Catalog", icon: "catalog" },
    { id: "multidim", label: "MultiDim", icon: "clock" },
    { id: "analysis", label: "Analysis", icon: "analysis" },
  ];

  const tabsContainer = document.createElement("calcite-tabs") as any;
  tabsContainer.setAttribute("layout", "center");
  tabsContainer.style.flex = "1";
  tabsContainer.style.overflow = "hidden";

  const tabNavEl = document.createElement("calcite-tab-nav") as any;
  tabNavEl.setAttribute("slot", "title-group");

  for (const tab of tabs) {
    const tabTitle = document.createElement("calcite-tab-title") as any;
    tabTitle.setAttribute("tab", tab.id);
    tabTitle.setAttribute("icon-start", tab.icon);
    tabTitle.textContent = tab.label;
    if (tab.id === "renderer") tabTitle.selected = true;
    tabNavEl.appendChild(tabTitle);
  }
  tabsContainer.appendChild(tabNavEl);

  // Tab content
  const rendererTab = document.createElement("calcite-tab") as any;
  rendererTab.setAttribute("tab", "renderer");
  rendererTab.selected = true;
  rendererTab.appendChild(buildRendererTab(layer));
  tabsContainer.appendChild(rendererTab);

  const functionsTab = document.createElement("calcite-tab") as any;
  functionsTab.setAttribute("tab", "functions");
  functionsTab.appendChild(buildFunctionsTab(layer));
  tabsContainer.appendChild(functionsTab);

  const catalogTab = document.createElement("calcite-tab") as any;
  catalogTab.setAttribute("tab", "catalog");
  catalogTab.appendChild(buildPlaceholderTab("Catalog / Mosaic", "Coming in Phase 2 — mosaic rules, image selection, date filtering."));
  tabsContainer.appendChild(catalogTab);

  const multidimTab = document.createElement("calcite-tab") as any;
  multidimTab.setAttribute("tab", "multidim");
  multidimTab.appendChild(buildPlaceholderTab("Multidimensional", "Coming in Phase 2 — variable selection, dimension slicing, time slider."));
  tabsContainer.appendChild(multidimTab);

  const analysisTab = document.createElement("calcite-tab") as any;
  analysisTab.setAttribute("tab", "analysis");
  analysisTab.appendChild(buildPlaceholderTab("Analysis & Deep Learning", "Coming in Phase 3 — statistics, mensuration, object detection, pixel classification."));
  tabsContainer.appendChild(analysisTab);

  container.appendChild(tabsContainer);
  parent.appendChild(container);

  activePanel = container;
  activeImageryLayer = layer;

  return container;
}

// ── Intent extraction ───────────────────────────────────────────────────────

type ImageryAction =
  | "open-panel" | "close-panel"
  | "apply-stretch" | "apply-ramp" | "apply-function" | "clear-function"
  | "identify" | "screenshot"
  | "list-templates"
  | "help";

interface ImageryIntent {
  action: ImageryAction;
  layerName: string | null;
  stretchType?: StretchType;
  rampName?: string;
  functionName?: string;
}

function extractImageryIntent(text: string): ImageryIntent {
  const lower = text.toLowerCase();
  let layerName: string | null = null;

  // Extract layer name from "apply X to Y" or "on Y layer"
  const onMatch = text.match(/\b(?:to|on|for)\s+(?:the\s+)?(.+?)(?:\s+layer)?$/i);
  if (onMatch) layerName = onMatch[1].trim();

  // Close panel
  if (/\b(close|remove|hide|dismiss)\s*(imagery|tools|panel)/i.test(lower)) {
    return { action: "close-panel", layerName };
  }

  // Open panel
  if (/\b(open|show|display)\s*(imagery|tools|panel)/i.test(lower) ||
      /\bimagery\s*(tools|panel)\b/i.test(lower)) {
    return { action: "open-panel", layerName };
  }

  // Screenshot
  if (/\bscreenshot\b/i.test(lower)) {
    return { action: "screenshot", layerName };
  }

  // Identify
  if (/\b(identify|pixel\s*values?|click.?to.?identify|popup)\b/i.test(lower)) {
    return { action: "identify", layerName };
  }

  // List templates
  if (/\b(list|show|what|available)\s*(raster\s*)?(?:function|template|processing)/i.test(lower)) {
    return { action: "list-templates", layerName };
  }

  // Clear/reset
  if (/\b(clear|reset|remove|none)\s*(raster|function|rendering|stretch|all)/i.test(lower)) {
    return { action: "clear-function", layerName };
  }

  // Stretch types
  const stretchMap: Record<string, StretchType> = {
    "std dev": "standard-deviation", "standard deviation": "standard-deviation",
    "min max": "min-max", "min-max": "min-max",
    "percent clip": "percent-clip", "percent-clip": "percent-clip",
    "histogram": "histogram-equalization",
    "sigmoid": "sigmoid",
  };
  for (const [key, type] of Object.entries(stretchMap)) {
    if (lower.includes(key)) {
      return { action: "apply-stretch", layerName, stretchType: type };
    }
  }
  if (/\bstretch\b/i.test(lower)) {
    return { action: "apply-stretch", layerName, stretchType: "standard-deviation" };
  }

  // Color ramps
  const rampMatch = SDK_COLOR_RAMPS.find((r) => lower.includes(r.toLowerCase()));
  if (rampMatch && /\b(ramp|color|apply)\b/i.test(lower)) {
    return { action: "apply-ramp", layerName, rampName: rampMatch };
  }

  // Named function (NDVI, Hillshade, etc.)
  const allFns = Object.values(SPECTRAL_INDICES).flat();
  const fnMatch = allFns.find((f) => lower.includes(f.label.toLowerCase()));
  if (fnMatch) {
    return { action: "apply-function", layerName, functionName: fnMatch.label };
  }

  // Generic "apply X" — try matching against server templates
  const applyMatch = text.match(/\bapply\s+(.+?)(?:\s+to\b|$)/i);
  if (applyMatch) {
    return { action: "apply-function", layerName, functionName: applyMatch[1].trim() };
  }

  // Default: open panel
  return { action: "open-panel", layerName };
}

// ── Agent registration ──────────────────────────────────────────────────────

export function registerImageryToolsAgent(assistant: HTMLElement) {
  const agentId = "imagery-tools-agent";

  const createGraph = () => {
    const state = createAgentState();

    async function imageryNode(s: any) {
      const text = extractLastUserText(s);
      const t0 = performance.now();
      console.log("[ImageryTools] Starting. User text:", text);

      // Bail out for other agents
      const bailoutChecks = [
        { pattern: AGENT_KEYWORDS.pointCloud, label: "PointCloudAgent" },
        { pattern: AGENT_KEYWORDS.measurement, label: "MeasurementAgent" },
        { pattern: AGENT_KEYWORDS.elevationOffset, label: "ElevationOffsetAgent" },
        { pattern: AGENT_KEYWORDS.swipe, label: "SwipeAgent" },
        { pattern: AGENT_KEYWORDS.orientedImagery, label: "OrientedImageryAgent" },
        { pattern: AGENT_KEYWORDS.catalogLayer, label: "CatalogLayerAgent" },
        { pattern: AGENT_KEYWORDS.search, label: "ContentSearchAgent" },
      ];
      for (const { pattern, label } of bailoutChecks) {
        if (pattern.test(text)) {
          console.log(`[ImageryTools] Skipping — ${label} territory.`);
          return { outputMessage: "" };
        }
      }

      const view = getCurrentView() as any;
      if (!view?.map) return { outputMessage: "No active map view." };

      const intent = extractImageryIntent(text);
      console.log("[ImageryTools] Intent:", intent);

      // Find imagery layer
      const layer = findImageryLayer(view, intent.layerName);

      switch (intent.action) {
        case "close-panel": {
          if (clearPanel()) return { outputMessage: "Imagery tools panel closed." };
          return { outputMessage: "No imagery tools panel is open." };
        }

        case "open-panel": {
          if (!layer) return { outputMessage: "No imagery layer on the map. Load an imagery layer first." };
          clearPanel();
          const parent = getMapSceneElement();
          if (!parent) return { outputMessage: "Could not find the map element." };
          createImageryPanel(layer, parent);
          const elapsedTime = elapsed(t0);
          const templates = getServerTemplates(layer);
          return {
            outputMessage:
              `Imagery tools opened for "${layer.title}" (${elapsedTime}s).\n` +
              `${templates.length} server processing template${templates.length !== 1 ? "s" : ""} available.\n\n` +
              "Use the tabs to adjust rendering, apply raster functions, or say quick commands like \"apply NDVI\".",
          };
        }

        case "apply-stretch": {
          if (!layer) return { outputMessage: "No imagery layer on the map." };
          applyStretch(layer, intent.stretchType!);
          return { outputMessage: `Applied **${intent.stretchType}** stretch to "${layer.title}".` };
        }

        case "apply-ramp": {
          if (!layer) return { outputMessage: "No imagery layer on the map." };
          applyColorRamp(layer, intent.rampName!);
          return { outputMessage: `Applied **${intent.rampName}** color ramp to "${layer.title}".` };
        }

        case "apply-function": {
          if (!layer) return { outputMessage: "No imagery layer on the map." };
          const result = applyNamedFunction(layer, intent.functionName!);
          return { outputMessage: `${result} on "${layer.title}".` };
        }

        case "clear-function": {
          if (!layer) return { outputMessage: "No imagery layer on the map." };
          clearRasterFunction(layer);
          layer.renderer = null as any;
          layer.refresh();
          return { outputMessage: `Reset rendering and raster functions on "${layer.title}".` };
        }

        case "list-templates": {
          if (!layer) return { outputMessage: "No imagery layer on the map." };
          const templates = getServerTemplates(layer);
          if (templates.length === 0) {
            return { outputMessage: `"${layer.title}" has no server processing templates.` };
          }
          const list = templates.map((t, i) => `${i + 1}. **${t.name}**${t.description ? ` — ${t.description}` : ""}`).join("\n");
          return { outputMessage: `**Processing templates for "${layer.title}":**\n\n${list}\n\nSay "apply [name]" to use one.` };
        }

        case "identify": {
          if (!layer) return { outputMessage: "No imagery layer on the map." };
          clearClickHandler();
          // Disable default popup so our custom identify popup works
          view.popupEnabled = false;
          const handler = view.on("click", async (event: any) => {
            event.stopPropagation();
            const result = await identifyPixel(layer, event.mapPoint, view);
            if (!result) return;
            view.openPopup({
              title: result.layerTitle,
              content: `Pixel values: ${result.values.join(", ")}<br>Location: ${result.location.longitude.toFixed(5)}, ${result.location.latitude.toFixed(5)}`,
              location: event.mapPoint,
            });
          });
          clickHandlerRemove = () => {
            handler.remove();
            view.popupEnabled = true;
          };
          return { outputMessage: `Click-to-identify enabled on "${layer.title}". Click any location to see pixel values.` };
        }

        case "screenshot": {
          try {
            const screenshot = await view.takeScreenshot({ format: "png" });
            const link = document.createElement("a");
            link.download = "screenshot.png";
            link.href = screenshot.dataUrl;
            link.click();
            return { outputMessage: "Screenshot saved." };
          } catch {
            return { outputMessage: "Failed to take screenshot." };
          }
        }

        case "help": {
          return {
            outputMessage:
              "**Imagery Tools**\n\n" +
              "- \"open imagery tools\" — tabbed panel\n" +
              "- \"apply NDVI / Hillshade / Slope\" — raster function\n" +
              "- \"stretch std dev / min max\" — stretch renderer\n" +
              "- \"apply inferno / viridis\" — color ramp\n" +
              "- \"list templates\" — server processing templates\n" +
              "- \"apply [template name]\" — server template\n" +
              "- \"identify\" — click-to-identify pixels\n" +
              "- \"screenshot\" — capture view\n" +
              "- \"reset rendering\" — clear all",
          };
        }
      }
    }

    return new StateGraph(state)
      .addNode("imageryNode", imageryNode)
      .addEdge(START, "imageryNode")
      .addEdge("imageryNode", END);
  };

  registerAgentElement(assistant, {
    id: agentId,
    name: "Imagery Tools",
    description:
      "Comprehensive imagery layer analysis and rendering tools. " +
      "Apply stretch renderers (standard deviation, min-max, percent clip, histogram equalization, sigmoid), " +
      "color ramps (60+ options including inferno, viridis, elevation, temperature), " +
      "raster functions (NDVI, Hillshade, Slope, Aspect, SAVI, NDWI, NBR, and 25+ spectral indices), " +
      "server-side processing templates, band combinations, and pixel identification. " +
      "Opens a tabbed panel for visual control or accepts chat commands for quick actions. " +
      "Use when user mentions stretch, NDVI, hillshade, color ramp, raster function, processing template, " +
      "spectral index, band arithmetic, identify, pixel values, screenshot, imagery tools, imagery panel, " +
      "rendering, visualize, false color, color IR, inferno, viridis, grayscale. " +
      "Keywords: stretch, standard deviation, min-max, percent clip, NDVI, hillshade, slope, aspect, " +
      "color ramp, inferno, viridis, raster function, processing template, identify, screenshot, " +
      "imagery tools, imagery panel, spectral index, band arithmetic, rendering, visualize.",
    createGraph,
  });
}
