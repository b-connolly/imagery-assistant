// ── Imagery & raster layer types ─────────────────────────────────────────────

export type ImageryLayerType =
  | "ImageryLayer"
  | "ImageryTileLayer"
  | "OrientedImageryLayer"
  | "WCSLayer"
  | "VideoLayer"
  | "MediaLayer";

// ── 3D scene layer types ─────────────────────────────────────────────────────

export type Scene3DLayerType =
  | "IntegratedMeshLayer"
  | "IntegratedMesh3DTilesLayer"
  | "SceneLayer"
  | "PointCloudLayer"
  | "BuildingSceneLayer"
  | "3DTilesLayer"
  | "GaussianSplatLayer"
  | "VoxelLayer"
  | "DimensionLayer";

// ── Elevation layer types ────────────────────────────────────────────────────

export type ElevationLayerType =
  | "ElevationLayer"
  | "BaseElevationLayer";

// ── Feature & vector layer types ─────────────────────────────────────────────

export type FeatureLayerType =
  | "FeatureLayer"
  | "GeoJSONLayer"
  | "CSVLayer"
  | "OGCFeatureLayer"
  | "WFSLayer"
  | "StreamLayer"
  | "KMLLayer"
  | "GeoRSSLayer"
  | "ParquetLayer"
  | "KnowledgeGraphLayer"
  | "RouteLayer"
  | "GraphicsLayer";

// ── Tile & map layer types ───────────────────────────────────────────────────

export type TileLayerType =
  | "TileLayer"
  | "VectorTileLayer"
  | "MapImageLayer"
  | "WMSLayer"
  | "WMTSLayer"
  | "WebTileLayer"
  | "OpenStreetMapLayer"
  | "BingMapsLayer";

// ── Group & container layer types ────────────────────────────────────────────

export type GroupLayerType =
  | "GroupLayer"
  | "SubtypeGroupLayer"
  | "CatalogLayer"
  | "MapNotesLayer"
  | "LinkChartLayer";

// ── Union of all supported layer types ───────────────────────────────────────

export type AnyLayerType =
  | ImageryLayerType
  | Scene3DLayerType
  | ElevationLayerType
  | FeatureLayerType
  | TileLayerType
  | GroupLayerType;
