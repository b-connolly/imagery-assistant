/**
 * Centralized registry of ArcGIS portal item type filters.
 * Used by ContentSearchAgent, LoadLayerAgent, and portalSearch.ts.
 */

// ── Type filter interface ────────────────────────────────────────────────────

export interface TypeFilter {
  itemTypes: string[];
  typeKeyword?: string;       // Portal typeKeywords clause, e.g. 'typekeywords:"PointCloud"'
  stripKeyword?: boolean;     // If true, use wildcard instead of user keyword for search text
}

export interface TypeFilterEntry {
  pattern: RegExp;
  filter: TypeFilter;
  label: string;
}

// ── Type filter map ──────────────────────────────────────────────────────────
// Order matters — more specific patterns must come first.

export const TYPE_FILTERS: TypeFilterEntry[] = [
  // Imagery & raster (specific first)
  { pattern: /\boriented\s+imagery/i, filter: { itemTypes: ["Feature Service"], typeKeyword: 'typekeywords:"OrientedImageryLayer"', stripKeyword: true }, label: "Oriented Imagery" },
  { pattern: /\bcatalog\s*(layer|service)?/i, filter: { itemTypes: ["Feature Service"], typeKeyword: 'typekeywords:"CatalogLayer"', stripKeyword: true }, label: "Catalog Layer" },
  { pattern: /\bvideo\s+(service|layer)/i, filter: { itemTypes: ["Video Service"] }, label: "Video Service" },
  { pattern: /\bmedia\s+layer/i, filter: { itemTypes: ["Media Layer"] }, label: "Media Layer" },
  { pattern: /\belevation\s+(service|layer|surface|terrain)/i, filter: { itemTypes: ["Image Service", "Imagery Layer", "Imagery Tile Layer"] }, label: "Elevation" },
  { pattern: /\b(imagery|image)\s+(service|layer|tile)/i, filter: { itemTypes: ["Image Service", "Imagery Layer", "Imagery Tile Layer"] }, label: "Imagery" },
  // 3D scene — use typeKeywords for sub-types stored as "Scene Service"
  { pattern: /\bgaussian\s*splat/i, filter: { itemTypes: ["3DTiles Service", "Scene Service"], typeKeyword: 'typekeywords:"GaussianSplat"', stripKeyword: true }, label: "Gaussian Splat" },
  { pattern: /\b(3d\s*tiles?)\s*(service|layer)?/i, filter: { itemTypes: ["3DTiles Service"], stripKeyword: true }, label: "3D Tiles" },
  { pattern: /\bintegrated\s*mesh\s*(service|layer)?/i, filter: { itemTypes: ["Scene Service", "3DTiles Service"], typeKeyword: 'typekeywords:"IntegratedMesh"', stripKeyword: true }, label: "Integrated Mesh" },
  { pattern: /\bpoint\s*cloud\s*(service|layer)?/i, filter: { itemTypes: ["Scene Service"], typeKeyword: 'typekeywords:"PointCloud"', stripKeyword: true }, label: "Point Cloud" },
  { pattern: /\bbuilding\s*(scene)?\s*(service|layer)?/i, filter: { itemTypes: ["Scene Service"], typeKeyword: 'typekeywords:"Building"', stripKeyword: true }, label: "Building Scene" },
  { pattern: /\bvoxel\s*(service|layer)?/i, filter: { itemTypes: ["Scene Service"], typeKeyword: 'typekeywords:"Voxel"', stripKeyword: true }, label: "Voxel" },
  { pattern: /\bweb\s*scene/i, filter: { itemTypes: ["Web Scene"], stripKeyword: true }, label: "Web Scene" },
  { pattern: /\bweb\s*map/i, filter: { itemTypes: ["Web Map"], stripKeyword: true }, label: "Web Map" },
  { pattern: /\bscene\s+(service|layer)/i, filter: { itemTypes: ["Scene Service", "Scene Layer"] }, label: "Scene Service" },
  // Feature & vector
  { pattern: /\bfeature\s+(service|layer)/i, filter: { itemTypes: ["Feature Service", "Feature Layer"] }, label: "Feature Service" },
  { pattern: /\bgeojson\b/i, filter: { itemTypes: ["GeoJSON"] }, label: "GeoJSON" },
  { pattern: /\bcsv\b/i, filter: { itemTypes: ["CSV"] }, label: "CSV" },
  { pattern: /\bkml\b/i, filter: { itemTypes: ["KML"] }, label: "KML" },
  { pattern: /\bparquet\b/i, filter: { itemTypes: ["Parquet"] }, label: "Parquet" },
  { pattern: /\bgeo\s*rss\b/i, filter: { itemTypes: ["GeoRSS"] }, label: "GeoRSS" },
  { pattern: /\b(ogc\s*feature|ogc\s*api)/i, filter: { itemTypes: ["OGCFeatureServer"] }, label: "OGC Feature" },
  { pattern: /\bstream\s+(service|layer)/i, filter: { itemTypes: ["Stream Service"] }, label: "Stream Service" },
  { pattern: /\b(wfs|web\s*feature\s*service)\b/i, filter: { itemTypes: ["WFS"] }, label: "WFS" },
  // Tile & map
  { pattern: /\bvector\s*tile/i, filter: { itemTypes: ["Vector Tile Service"] }, label: "Vector Tile" },
  { pattern: /\b(tile|tiled)\s+(service|layer)/i, filter: { itemTypes: ["Tile Service", "Vector Tile Service"] }, label: "Tile Service" },
  { pattern: /\bmap\s+(service|image)/i, filter: { itemTypes: ["Map Service"] }, label: "Map Service" },
  { pattern: /\b(wms|web\s*map\s*service)\b/i, filter: { itemTypes: ["WMS"] }, label: "WMS" },
  { pattern: /\b(wmts)\b/i, filter: { itemTypes: ["WMTS"] }, label: "WMTS" },
  { pattern: /\bwcs\b/i, filter: { itemTypes: ["WCS"] }, label: "WCS" },
];

/** Match user text to a TypeFilter. First match wins. Returns null if no specific type detected. */
export function matchTypeFilter(text: string): TypeFilterEntry | null {
  for (const entry of TYPE_FILTERS) {
    if (entry.pattern.test(text)) return entry;
  }
  return null;
}

/**
 * Strip type-filter pattern words from text, leaving only the substantive keyword.
 * E.g., "Phoenix web maps" → "Phoenix", "point cloud layers" → "".
 */
export function stripTypeFilterWords(text: string): string {
  return text.replace(
    /\b(gaussian\s*splat|point\s*cloud|integrated\s*mesh|building|voxel|oriented\s*imagery|catalog|web\s*scenes?|web\s*maps?|3d\s*tiles?|feature\s*(service|layer)|scene\s*(service|layer)|image\s*(service|layer)|imagery|elevation|tile|tiled|vector\s*tile|map\s*service|wms|wmts|wfs|wcs|kml|csv|geojson|parquet|geo\s*rss|ogc|stream|video|media)\b/gi,
    ""
  ).trim();
}

// ── All portal layer item types ──────────────────────────────────────────────
// Reference: https://developers.arcgis.com/rest/users-groups-and-items/items-and-item-types/

export const ALL_LAYER_TYPES = [
  // Imagery & raster
  "Image Service",
  "Imagery Layer",
  "Imagery Tile Layer",
  "WCS",
  "Media Layer",
  // 3D scene
  "Scene Service",
  "Scene Layer",
  "3DTiles Service",
  // Oriented Imagery
  "Oriented Imagery Layer",
  // Feature & vector
  "Feature Service",
  "Feature Layer",
  "GeoJSON",
  "CSV",
  "KML",
  "WFS",
  "OGCFeatureServer",
  "GeoRSS",
  "Stream Service",
  // Tile & map
  "Map Service",
  "Vector Tile Service",
  "Tile Service",
  "WMTS",
  "WMS",
];

/** Build a description of available type filters for LLM tool descriptions. */
export function getTypeFilterDescription(): string {
  const groups: Record<string, string[]> = {};
  for (const entry of TYPE_FILTERS) {
    const category = entry.filter.itemTypes[0];
    if (!groups[category]) groups[category] = [];
    groups[category].push(entry.label);
  }
  return Object.entries(groups)
    .map(([type, labels]) => `${type}: ${labels.join(", ")}`)
    .join("; ");
}
