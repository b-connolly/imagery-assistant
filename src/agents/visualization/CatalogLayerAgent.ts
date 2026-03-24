import { StateGraph, START, END } from "@langchain/langgraph/web";
import { getCurrentView, getMapSceneElement, onViewChange } from "../../utils/viewManager";
import {
  extractLastUserText,
  createAgentState,
  registerAgentElement,
  findLayerByTitle,
  elapsed,
  AGENT_KEYWORDS,
} from "../../utils/agentHelpers";

// ── Active panel tracking ───────────────────────────────────────────────────

let activePanel: HTMLElement | null = null;
let activeCatalogLayer: any = null;

function clearPanel(): boolean {
  if (!activePanel) return false;
  try { activePanel.remove(); } catch { /* already removed */ }
  activePanel = null;
  activeCatalogLayer = null;
  return true;
}

onViewChange(() => clearPanel());

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

// ── Query distinct item types with counts ───────────────────────────────────

interface ItemTypeInfo {
  type: string;
  count: number;
}

async function queryItemTypes(catalogLayer: any): Promise<ItemTypeInfo[]> {
  const query = catalogLayer.createQuery();
  query.where = "1=1";
  query.outStatistics = [{
    statisticType: "count",
    onStatisticField: "cd_itemtype",
    outStatisticFieldName: "type_count",
  }];
  query.groupByFieldsForStatistics = ["cd_itemtype"];
  query.orderByFields = ["type_count DESC"];

  const result = await catalogLayer.queryFeatures(query);
  return result.features
    .map((f: any) => ({
      type: f.attributes.cd_itemtype as string,
      count: f.attributes.type_count as number,
    }))
    .filter((t: ItemTypeInfo) => t.type);
}

// ── Find catalog layers on map ──────────────────────────────────────────────

function findCatalogLayers(view: any): any[] {
  return (view.map?.layers?.toArray() ?? []).filter((l: any) => l.type === "catalog");
}

// ── Build filter panel ──────────────────────────────────────────────────────

async function createFilterPanel(
  catalogLayer: any,
  allCatalogLayers: any[],
  parent: HTMLElement
): Promise<HTMLElement> {
  const container = document.createElement("div");
  container.className = "catalog-filter-panel";

  // Title bar
  const titleBar = document.createElement("div");
  titleBar.className = "catalog-filter-titlebar";
  const titleText = document.createElement("span");
  titleText.textContent = "Catalog Filter";
  titleBar.appendChild(titleText);

  const closeBtn = document.createElement("calcite-button") as any;
  closeBtn.setAttribute("appearance", "transparent");
  closeBtn.setAttribute("icon-start", "x");
  closeBtn.setAttribute("scale", "s");
  closeBtn.addEventListener("click", () => clearPanel());
  titleBar.appendChild(closeBtn);

  container.appendChild(titleBar);
  makeDraggable(container, titleBar);

  // Content area
  const content = document.createElement("div");
  content.className = "catalog-filter-content";

  // Layer selector (if multiple catalog layers)
  if (allCatalogLayers.length > 1) {
    const layerLabel = document.createElement("div");
    layerLabel.style.cssText = "font-size: 12px; color: var(--calcite-color-text-2, #aaa); margin-bottom: 4px;";
    layerLabel.textContent = "Layer:";
    content.appendChild(layerLabel);

    const select = document.createElement("calcite-select") as any;
    select.setAttribute("scale", "s");
    select.style.marginBottom = "12px";
    for (const cl of allCatalogLayers) {
      const option = document.createElement("calcite-option") as any;
      option.value = cl.uid ?? cl.id ?? cl.title;
      option.textContent = cl.title || "Untitled Catalog";
      if (cl === catalogLayer) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener("calciteSelectChange", async () => {
      const selectedIdx = select.selectedOption?.value;
      const newLayer = allCatalogLayers.find(
        (cl: any) => (cl.uid ?? cl.id ?? cl.title) === selectedIdx
      );
      if (newLayer && newLayer !== activeCatalogLayer) {
        activeCatalogLayer = newLayer;
        await rebuildCheckboxes(newLayer, checkboxContainer, selectedTypes);
      }
    });
    content.appendChild(select);
  }

  // Item type label
  const typeLabel = document.createElement("div");
  typeLabel.style.cssText = "font-size: 12px; color: var(--calcite-color-text-2, #aaa); margin-bottom: 8px;";
  typeLabel.textContent = "Item Type:";
  content.appendChild(typeLabel);

  // Checkbox container
  const checkboxContainer = document.createElement("div");
  checkboxContainer.className = "catalog-filter-checkboxes";
  content.appendChild(checkboxContainer);

  // Track selected types
  const selectedTypes = new Set<string>();

  // Build checkboxes for item types
  async function rebuildCheckboxes(layer: any, container: HTMLElement, selected: Set<string>) {
    container.innerHTML = "";
    selected.clear();
    try {
      const types = await queryItemTypes(layer);
      for (const { type, count } of types) {
        selected.add(type);
        const label = document.createElement("calcite-label") as any;
        label.setAttribute("layout", "inline");
        label.setAttribute("scale", "s");
        label.style.cssText = "display: flex; align-items: center; margin-bottom: 4px;";

        const cb = document.createElement("calcite-checkbox") as any;
        cb.checked = true;
        cb.dataset.itemType = type;
        cb.addEventListener("calciteCheckboxChange", () => {
          if (cb.checked) {
            selected.add(type);
          } else {
            selected.delete(type);
          }
        });

        label.appendChild(cb);
        label.appendChild(document.createTextNode(` ${type} (${count})`));
        container.appendChild(label);
      }
      if (types.length === 0) {
        container.textContent = "No item types found.";
      }
    } catch (err) {
      container.textContent = "Failed to query item types.";
      console.error("[CatalogFilter] queryItemTypes failed:", err);
    }
  }

  await rebuildCheckboxes(catalogLayer, checkboxContainer, selectedTypes);

  container.appendChild(content);

  // Action buttons
  const actions = document.createElement("div");
  actions.className = "catalog-filter-actions";

  const applyBtn = document.createElement("calcite-button") as any;
  applyBtn.setAttribute("scale", "s");
  applyBtn.setAttribute("width", "half");
  applyBtn.textContent = "Apply";
  applyBtn.addEventListener("click", () => {
    if (!activeCatalogLayer) return;
    if (selectedTypes.size === 0) {
      activeCatalogLayer.definitionExpression = "1=0"; // hide all
    } else {
      const typeList = [...selectedTypes].map((t) => `'${t.replace(/'/g, "''")}'`).join(", ");
      activeCatalogLayer.definitionExpression = `cd_itemtype IN (${typeList})`;
    }
    console.log("[CatalogFilter] Applied filter:", activeCatalogLayer.definitionExpression);
  });

  const clearBtn = document.createElement("calcite-button") as any;
  clearBtn.setAttribute("scale", "s");
  clearBtn.setAttribute("width", "half");
  clearBtn.setAttribute("appearance", "outline");
  clearBtn.textContent = "Clear";
  clearBtn.addEventListener("click", async () => {
    if (!activeCatalogLayer) return;
    activeCatalogLayer.definitionExpression = null;
    // Re-check all checkboxes
    const cbs = checkboxContainer.querySelectorAll("calcite-checkbox");
    cbs.forEach((cb: any) => {
      cb.checked = true;
      if (cb.dataset.itemType) selectedTypes.add(cb.dataset.itemType);
    });
    console.log("[CatalogFilter] Cleared filter.");
  });

  actions.appendChild(applyBtn);
  actions.appendChild(clearBtn);
  container.appendChild(actions);

  parent.appendChild(container);
  return container;
}

// ── Intent extraction ───────────────────────────────────────────────────────

type CatalogAction = "open" | "close" | "filter" | "clear" | "help";

function extractCatalogIntent(text: string): { action: CatalogAction; filterTypes: string[] } {
  const lower = text.toLowerCase();

  // Close
  if (/\b(close|remove|hide|dismiss)\s*(catalog|filter|panel)/i.test(lower) ||
      /\b(catalog|filter)\s*(close|remove|hide)/i.test(lower)) {
    return { action: "close", filterTypes: [] };
  }

  // Clear filter
  if (/\b(clear|reset|remove|show\s*all)\s*(filter|catalog|definition)/i.test(lower)) {
    return { action: "clear", filterTypes: [] };
  }

  // Direct filter via chat: "filter catalog to imagery" / "show only feature services"
  const filterMatch = lower.match(/\b(filter|show\s*only|display\s*only)\b.*?\b(feature|image|imagery|map\s*service|wms|wfs|raster|tile|scene|3d\s*tiles|vector)/i);
  if (filterMatch) {
    const typeMap: Record<string, string> = {
      "feature": "Feature Service",
      "image": "Image Service",
      "imagery": "Image Service",
      "map service": "Map Service",
      "wms": "WMS",
      "wfs": "WFS",
      "raster": "Raster Dataset",
      "tile": "Tile Service",
      "scene": "Scene Service",
      "3d tiles": "3D Tiles Service",
      "vector": "Vector Tile Service",
    };
    const types: string[] = [];
    for (const [key, value] of Object.entries(typeMap)) {
      if (lower.includes(key)) types.push(value);
    }
    if (types.length > 0) return { action: "filter", filterTypes: types };
  }

  // Help
  if (/\b(help|how|what)\b/i.test(lower) && /\bcatalog/i.test(lower)) {
    return { action: "help", filterTypes: [] };
  }

  // Default: open panel
  return { action: "open", filterTypes: [] };
}

// ── Agent registration ──────────────────────────────────────────────────────

export function registerCatalogLayerAgent(assistant: HTMLElement) {
  const agentId = "catalog-layer-agent";

  const createGraph = () => {
    const state = createAgentState();

    async function catalogNode(s: any) {
      const text = extractLastUserText(s);
      const t0 = performance.now();
      console.log("[CatalogFilter] Starting. User text:", text);

      // Bail out for other agents
      const bailoutChecks = [
        { pattern: AGENT_KEYWORDS.imagery, label: "ImageryAnalysisAgent" },
        { pattern: AGENT_KEYWORDS.measurement, label: "MeasurementAgent" },
        { pattern: AGENT_KEYWORDS.pointCloud, label: "PointCloudAgent" },
        { pattern: AGENT_KEYWORDS.elevationOffset, label: "ElevationOffsetAgent" },
        { pattern: AGENT_KEYWORDS.swipe, label: "SwipeAgent" },
        { pattern: AGENT_KEYWORDS.orientedImagery, label: "OrientedImageryAgent" },
        { pattern: AGENT_KEYWORDS.search, label: "ContentSearchAgent" },
      ];
      for (const { pattern, label } of bailoutChecks) {
        if (pattern.test(text)) {
          console.log(`[CatalogFilter] Skipping — ${label} territory.`);
          return { outputMessage: "" };
        }
      }

      const view = getCurrentView() as any;
      if (!view?.map) return { outputMessage: "No active map view." };

      const { action, filterTypes } = extractCatalogIntent(text);
      console.log("[CatalogFilter] Action:", action, "FilterTypes:", filterTypes);

      switch (action) {
        case "close": {
          if (clearPanel()) return { outputMessage: "Catalog filter panel closed." };
          return { outputMessage: "No catalog filter panel is open." };
        }

        case "clear": {
          const catalogs = findCatalogLayers(view);
          if (catalogs.length === 0) return { outputMessage: "No catalog layers on the map." };
          // Clear filter on active or all catalog layers
          const target = activeCatalogLayer ?? catalogs[catalogs.length - 1];
          target.definitionExpression = null;
          return { outputMessage: `Cleared filter on "${target.title}". All items are now visible.` };
        }

        case "filter": {
          const catalogs = findCatalogLayers(view);
          if (catalogs.length === 0) return { outputMessage: "No catalog layers on the map. Load a catalog layer first." };
          const target = activeCatalogLayer ?? catalogs[catalogs.length - 1];
          const typeList = filterTypes.map((t) => `'${t.replace(/'/g, "''")}'`).join(", ");
          target.definitionExpression = `cd_itemtype IN (${typeList})`;
          return { outputMessage: `Filtered "${target.title}" to: ${filterTypes.join(", ")}.` };
        }

        case "help": {
          return {
            outputMessage:
              "**Catalog Layer Filter**\n\n" +
              "Filter catalog items by type to find specific data.\n\n" +
              "- \"open catalog filter\" — open the filter panel\n" +
              "- \"close catalog filter\" — close the panel\n" +
              "- \"filter catalog to imagery\" — filter by type via chat\n" +
              "- \"clear catalog filter\" — show all items\n\n" +
              "The panel shows checkboxes for each item type with counts. " +
              "Select/deselect types and click Apply.",
          };
        }

        case "open": {
          const catalogs = findCatalogLayers(view);
          if (catalogs.length === 0) {
            return { outputMessage: "No catalog layers on the map. Load a catalog layer first, then say \"open catalog filter\"." };
          }

          clearPanel();

          const parent = getMapSceneElement();
          if (!parent) return { outputMessage: "Could not find the map element." };

          const targetLayer = catalogs[catalogs.length - 1];
          activeCatalogLayer = targetLayer;

          // Ensure layer is loaded before querying
          if (targetLayer.loadStatus !== "loaded") {
            await targetLayer.load();
          }

          activePanel = await createFilterPanel(targetLayer, catalogs, parent);

          const elapsedTime = elapsed(t0);
          return {
            outputMessage:
              `Catalog filter opened for "${targetLayer.title}" (${elapsedTime}s).\n\n` +
              "Select item types and click **Apply** to filter. " +
              "The panel can be dragged and resized.",
          };
        }
      }
    }

    return new StateGraph(state)
      .addNode("catalogNode", catalogNode)
      .addEdge(START, "catalogNode")
      .addEdge("catalogNode", END);
  };

  registerAgentElement(assistant, {
    id: agentId,
    name: "Catalog Layer Filter",
    description:
      "Opens a filter panel for CatalogLayer items, allowing users to filter by item type " +
      "(Feature Service, Image Service, etc.). Supports multiple catalog layers with a dropdown selector. " +
      "Use when the user mentions catalog filter, filter catalog, catalog items, catalog types, " +
      "item type filter, cd_itemtype, or wants to filter/browse catalog layer contents. " +
      "Keywords: catalog filter, filter catalog, catalog items, catalog types, item type filter, " +
      "open catalog filter, close catalog filter, clear catalog filter.",
    createGraph,
  });
}
