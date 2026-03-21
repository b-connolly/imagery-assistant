import type MapView from "@arcgis/core/views/MapView";
import type SceneView from "@arcgis/core/views/SceneView";
import type Layer from "@arcgis/core/layers/Layer";
import type Viewpoint from "@arcgis/core/Viewpoint";

export type ViewType = "2d" | "3d";
export type AnyView = MapView | SceneView;

type ViewChangeListener = (view: AnyView, viewType: ViewType) => void;

let currentView: AnyView | null = null;
let currentViewType: ViewType = "2d";
const listeners: ViewChangeListener[] = [];

export function setCurrentView(view: AnyView, viewType: ViewType): void {
  currentView = view;
  currentViewType = viewType;
  listeners.forEach((fn) => fn(view, viewType));
}

export function getCurrentView(): AnyView | null {
  if (currentView) return currentView;

  // Fallback: try to grab the view directly from the map/scene DOM element
  const mapEl = document.querySelector("arcgis-map") as any;
  if (mapEl?.view) {
    currentView = mapEl.view;
    currentViewType = "2d";
    return currentView;
  }
  const sceneEl = document.querySelector("arcgis-scene") as any;
  if (sceneEl?.view) {
    currentView = sceneEl.view;
    currentViewType = "3d";
    return currentView;
  }

  return null;
}

export function getCurrentViewType(): ViewType {
  return currentViewType;
}

export function onViewChange(listener: ViewChangeListener): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

/**
 * Capture the current viewpoint for transfer between views.
 * Returns the SDK's Viewpoint object which works for both 2D (center+scale)
 * and 3D (camera) view restoration.
 */
export function captureViewpoint(): Viewpoint | null {
  if (!currentView?.viewpoint) return null;
  return currentView.viewpoint.clone();
}

/**
 * Get all user-added layers from the current view's map.
 * Excludes the basemap layers.
 */
export function getOperationalLayers(): Layer[] {
  if (!currentView?.map) return [];
  return currentView.map.layers.toArray();
}

/**
 * Get the active map or scene DOM element for the current view type.
 */
export function getMapSceneElement(): HTMLElement | null {
  const is3D = currentViewType === "3d";
  return document.querySelector(is3D ? "arcgis-scene" : "arcgis-map") as HTMLElement | null;
}

// ── Programmatic view switching ──────────────────────────────────────────────

type ViewSwitchHandler = (targetType: ViewType) => void;
let viewSwitchHandler: ViewSwitchHandler | null = null;

/**
 * Register the React callback that triggers view type changes.
 * Called once from App.tsx so agents can request view switches.
 */
export function registerViewSwitchHandler(handler: ViewSwitchHandler): void {
  viewSwitchHandler = handler;
}

/**
 * Request a switch to the given view type.
 * Returns a promise that resolves with the new view once it's ready.
 * If already in the target view type, resolves immediately.
 */
export function requestViewSwitch(targetType: ViewType): Promise<AnyView> {
  // Already in the right mode
  if (currentViewType === targetType && currentView) {
    return Promise.resolve(currentView);
  }

  if (!viewSwitchHandler) {
    return Promise.reject(new Error("View switch handler not registered."));
  }

  return new Promise((resolve) => {
    // Listen for the next view change event
    const unlisten = onViewChange((view, vt) => {
      if (vt === targetType) {
        unlisten();
        resolve(view);
      }
    });
    // Trigger the switch via the React handler
    viewSwitchHandler!(targetType);
  });
}

// ── Programmatic web map / web scene switching ───────────────────────────────

type PortalItemSwitchHandler = (itemId: string) => void;
let webMapSwitchHandler: PortalItemSwitchHandler | null = null;
let webSceneSwitchHandler: PortalItemSwitchHandler | null = null;

/**
 * Register the React callback that loads a different web map by item ID.
 * Called once from App.tsx.
 */
export function registerWebMapSwitchHandler(handler: PortalItemSwitchHandler): void {
  webMapSwitchHandler = handler;
}

/**
 * Register the React callback that loads a different web scene by item ID.
 * Called once from App.tsx.
 */
export function registerWebSceneSwitchHandler(handler: PortalItemSwitchHandler): void {
  webSceneSwitchHandler = handler;
}

/**
 * Switch the active web map to the given portal item ID.
 * Returns a promise that resolves with the new view once it's ready.
 */
export function requestWebMapSwitch(itemId: string): Promise<AnyView> {
  if (!webMapSwitchHandler) {
    return Promise.reject(new Error("Web map switch handler not registered."));
  }

  return new Promise((resolve) => {
    const unlisten = onViewChange((view) => {
      unlisten();
      resolve(view);
    });
    webMapSwitchHandler!(itemId);
  });
}

/**
 * Switch the active web scene to the given portal item ID.
 * Automatically switches to 3D view.
 * Returns a promise that resolves with the new view once it's ready.
 */
export function requestWebSceneSwitch(itemId: string): Promise<AnyView> {
  if (!webSceneSwitchHandler) {
    return Promise.reject(new Error("Web scene switch handler not registered."));
  }

  return new Promise((resolve) => {
    const unlisten = onViewChange((view) => {
      unlisten();
      resolve(view);
    });
    webSceneSwitchHandler!(itemId);
  });
}
