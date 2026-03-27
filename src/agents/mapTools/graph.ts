import { StateGraph, START, END } from "@langchain/langgraph/web";
import type { AgentRegistration } from "@arcgis/ai-components/utils/index.js";
import { MapToolsState } from "./state";
import { mapToolsNode } from "./mapToolsNode";

// ── Graph builder ───────────────────────────────────────────────────────────

const createMapToolsGraph = () =>
  new StateGraph(MapToolsState)
    .addNode("mapToolsNode", mapToolsNode)
    .addEdge(START, "mapToolsNode")
    .addEdge("mapToolsNode", END);

// ── Agent registration ──────────────────────────────────────────────────────

export const MapToolsAgent: AgentRegistration = {
  id: "map-tools-agent",
  name: "Map Tools",
  description:
    // Measurement
    "Activates measurement and analysis tools on the map. " +
    "Supports distance measurement (line length), area measurement (polygon area), " +
    "volume measurement (cut-fill and stockpile volume in 3D), " +
    "and elevation profile (terrain cross-section along a drawn line). " +
    "Works in both 2D and 3D views with appropriate widgets. " +
    "Volume measurement automatically switches to 3D and works on ground, integrated meshes, and 3D tiles. " +
    "Supports unit specification: meters, kilometers, feet, miles, acres, hectares, cubic meters, etc. " +
    "Use when the user wants to measure, calculate distance, area, or volume, draw a ruler, " +
    "see an elevation profile or cross-section, asks 'how far' between points, " +
    "or wants to calculate cut/fill, stockpile, excavation, or earthwork volumes. " +
    "Also use when the user says 'clear measurement' or 'stop measuring'. " +
    // Swipe
    "Activates a swipe tool to visually compare two layers side by side on the map. " +
    "Drag a handle across the map to reveal one layer on each side. " +
    "Supports horizontal (left/right) and vertical (top/bottom) directions. " +
    "Use when the user wants to compare, swipe, split, or see differences between two layers. " +
    "Handles 'compare layer 1 and layer 2', 'compare layer 3 and layer 5', " +
    "'swipe between X and Y', 'side by side', 'versus'. " +
    "Also use when the user says 'clear swipe' or 'stop comparing'. " +
    // Layer Info
    "Query layers for detailed information including fields, attributes, popup configuration, " +
    "metadata, tables, sublayers, capabilities, spatial reference, extent, and processing templates. " +
    "Also computes raster statistics (min, max, mean, standard deviation) for imagery and elevation layers. " +
    "Handles 'what is the layer order', 'list layers', 'describe layer 4', 'describe [layer name]'. " +
    "Use when the user asks about layer properties, attributes, fields, schema, popup info, " +
    "metadata, what data a layer contains, available tables, layer order, draw order, or raster/elevation statistics. " +
    // Oriented Imagery
    "Opens and manages the Oriented Imagery Viewer for exploring non-nadir imagery (photos, 360, oblique, video) " +
    "from camera locations on the map. Supports navigation, image enhancement, coverage footprints, and image gallery. " +
    "Use when the user mentions oriented imagery viewer, show viewer, open viewer, close viewer, " +
    "image viewer, OI viewer, coverage footprint, image gallery, navigation tool, or image enhancement. " +
    // Catalog Layer
    "Opens a filter panel for CatalogLayer items, allowing users to filter by item type " +
    "(Feature Service, Image Service, etc.). Supports multiple catalog layers with a dropdown selector. " +
    "Use when the user mentions catalog filter, filter catalog, catalog items, catalog types, " +
    "item type filter, cd_itemtype, or wants to filter/browse catalog layer contents. " +
    // Imagery
    "Manages imagery layer rendering and analysis. " +
    "Apply server-side processing templates (NDVI, Hillshade, Slope, Color IR, etc.), " +
    "enable click-to-identify pixel values, list available raster functions, and reset rendering. " +
    "Apply stretch renderers (standard deviation, min-max, percent clip, histogram equalization). " +
    "Apply color ramps (inferno, viridis, grayscale, SDK named ramps). " +
    // Elevation Offset
    "Fixes vertical elevation offset for 3D layers that float above or sink below the terrain. " +
    "Auto-detects offset by comparing layer z-position to ground elevation. " +
    "Supports click-to-fix, calculate offset, manual set/adjust, and check current offset. " +
    "Works with Integrated Meshes, Gaussian Splats, 3D Tiles, Scene Layers, Building Scene Layers. " +
    // Point Cloud
    "Manages point cloud layer visualization and filtering. " +
    "Supports changing symbology (class code, elevation, intensity, RGB, return number), " +
    "filtering by classification (ground, vegetation, buildings, water), " +
    "adjusting point size and density, and resetting to defaults. " +
    // Combined keywords
    "Keywords: measure, distance, area, volume, cut fill, stockpile, elevation profile, cross-section, ruler, how far, " +
    "compare, swipe, split, side by side, versus, vs, " +
    "fields, attributes, columns, schema, popup, metadata, tables, info, describe, properties, capabilities, " +
    "band count, pixel type, processing templates, sublayers, layer order, draw order, what layers, list layers, " +
    "statistics, stats, minimum, maximum, lowest, highest, average, mean, elevation value, pixel range, " +
    "oriented imagery viewer, open viewer, close viewer, show viewer, hide viewer, " +
    "image gallery, navigation tool, image enhancement, coverage footprint, OI viewer, " +
    "catalog filter, filter catalog, catalog items, catalog types, item type filter, " +
    "stretch, NDVI, hillshade, slope, aspect, color infrared, false color, identify, pixel values, " +
    "apply, processing template, raster function, reset rendering, clear function, list templates, " +
    "fix elevation, offset, raise, lower, floating, underground, misaligned, click to fix, calculate offset, " +
    "point cloud, lidar, classification, class code, point size, point density, color by, return number, " +
    "open catalog filter, close catalog filter, clear catalog filter, " +
    "save web map, save web scene, save map, save scene.",
  createGraph: createMapToolsGraph,
  workspace: MapToolsState,
};
