import { createRoot } from "react-dom/client";

// Calcite component registrations
import "@esri/calcite-components/main.css";
import "@esri/calcite-components/components/calcite-shell";
import "@esri/calcite-components/components/calcite-shell-panel";
import "@esri/calcite-components/components/calcite-panel";
import "@esri/calcite-components/components/calcite-button";
import "@esri/calcite-components/components/calcite-icon";
import "@esri/calcite-components/components/calcite-loader";
import "@esri/calcite-components/components/calcite-segmented-control";
import "@esri/calcite-components/components/calcite-segmented-control-item";

// ArcGIS Map component registrations
import "@arcgis/map-components/main.css";
import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-scene";
import "@arcgis/map-components/components/arcgis-zoom";
import "@arcgis/map-components/components/arcgis-home";
import "@arcgis/map-components/components/arcgis-expand";
import "@arcgis/map-components/components/arcgis-legend";
import "@arcgis/map-components/components/arcgis-layer-list";
import "@arcgis/map-components/components/arcgis-basemap-gallery";
import "@arcgis/map-components/components/arcgis-distance-measurement-2d";
import "@arcgis/map-components/components/arcgis-direct-line-measurement-3d";
import "@arcgis/map-components/components/arcgis-area-measurement-2d";
import "@arcgis/map-components/components/arcgis-area-measurement-3d";
import "@arcgis/map-components/components/arcgis-elevation-profile";
import "@arcgis/map-components/components/arcgis-volume-measurement";
import "@arcgis/map-components/components/arcgis-swipe";
import "@arcgis/map-components/components/arcgis-compass";

// ArcGIS AI Assistant registrations
import "@arcgis/ai-components/components/arcgis-assistant";
import "@arcgis/ai-components/components/arcgis-assistant-agent";
import "@arcgis/ai-components/components/arcgis-assistant-help-agent";
import "@arcgis/ai-components/components/arcgis-assistant-navigation-agent";
import "@arcgis/ai-components/components/arcgis-assistant-data-exploration-agent";

import ErrorBoundary from "./components/ErrorBoundary";
import App from "./App";
import "./styles.css";

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
