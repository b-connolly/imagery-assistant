import Layer from "@arcgis/core/layers/Layer";
import ElevationLayer from "@arcgis/core/layers/ElevationLayer";
import ImageryLayer from "@arcgis/core/layers/ImageryLayer";
import ImageryTileLayer from "@arcgis/core/layers/ImageryTileLayer";
import IntegratedMeshLayer from "@arcgis/core/layers/IntegratedMeshLayer";
import IntegratedMesh3DTilesLayer from "@arcgis/core/layers/IntegratedMesh3DTilesLayer";
import GaussianSplatLayer from "@arcgis/core/layers/GaussianSplatLayer";
import SceneLayer from "@arcgis/core/layers/SceneLayer";
import PointCloudLayer from "@arcgis/core/layers/PointCloudLayer";
import BuildingSceneLayer from "@arcgis/core/layers/BuildingSceneLayer";
import VoxelLayer from "@arcgis/core/layers/VoxelLayer";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import OrientedImageryLayer from "@arcgis/core/layers/OrientedImageryLayer";
import CatalogLayer from "@arcgis/core/layers/CatalogLayer";
import GroupLayer from "@arcgis/core/layers/GroupLayer";

// ── Design principle ─────────────────────────────────────────────────────────
//
// Always prefer the ArcGIS Maps SDK's built-in methods first:
//   - Layer.fromPortalItem()    → for portal item IDs
//   - Layer.fromArcGISServerUrl → for ArcGIS service URLs
//
// Only intercept when the SDK is known to mis-detect the layer type.
// Known SDK gaps (as of 5.0.x):
//   - GaussianSplat items (3DTiles Service + "GaussianSplat" typeKeyword)
//     → SDK creates IntegratedMesh3DTilesLayer instead of GaussianSplatLayer
//   - PointCloud items (Scene Service + "PointCloud" typeKeyword)
//     → SDK creates SceneLayer instead of PointCloudLayer
//   - IntegratedMesh items (Scene Service + "IntegratedMesh" typeKeyword)
//     → SDK creates SceneLayer instead of IntegratedMeshLayer
//   - Building items (Scene Service + "Building" typeKeyword)
//     → SDK creates SceneLayer instead of BuildingSceneLayer
//   - Voxel items (Scene Service + "Voxel" typeKeyword)
//     → SDK creates SceneLayer instead of VoxelLayer
//   - Oriented Imagery Layer (Feature Service + "OrientedImageryLayer" typeKeyword)
//     → Load as FeatureLayer (sublayer /0 = point features) for popup/identify support.
//       OrientedImageryLayer creates a group layer that doesn't support popups.
//   - Catalog Layer (Feature Service + "CatalogLayer" typeKeyword)
//     → SDK creates FeatureLayer instead of CatalogLayer.
//       Use CatalogLayer for proper "Layers in View" dynamic grouping.
//   - External OGC 3D Tiles (tileset.json URLs)
//     → Not an ArcGIS service, SDK can't auto-detect
//
// Portal item types reference:
//   https://developers.arcgis.com/rest/users-groups-and-items/items-and-item-types/
// SDK layer classes reference:
//   https://developers.arcgis.com/javascript/latest/references/core/#layers

// ── Universal layer creation from URL ────────────────────────────────────────

/**
 * Create a layer from a URL, auto-detecting the correct layer type.
 * Handles 3D Tiles and external tileset.json URLs that the SDK can't auto-detect,
 * then falls back to Layer.fromArcGISServerUrl for everything else.
 */
export async function createLayerFromUrl(
  url: string,
  title?: string
): Promise<Layer> {
  const lower = url.toLowerCase();
  const titleLower = (title ?? "").toLowerCase();

  // ── 3D Tiles (ArcGIS-hosted or external tileset.json) ──────────────────
  // The SDK's fromArcGISServerUrl doesn't handle 3DTilesServer or tileset.json
  if (lower.includes("/3dtilesserver") || /tileset\.json/i.test(lower)) {
    const tilesetUrl = ensure3DTilesTilesetUrl(url);
    if (/gaussiansplat|splat/i.test(url) || /gaussian|splat/i.test(titleLower)) {
      const layer = new GaussianSplatLayer({ url: tilesetUrl });
      if (title) layer.title = title;
      return layer;
    }
    const layer = new IntegratedMesh3DTilesLayer({ url: tilesetUrl });
    if (title) layer.title = title;
    return layer;
  }

  // ── Everything else — let the SDK auto-detect ──────────────────────────
  const layer = await Layer.fromArcGISServerUrl({
    url,
    properties: title ? { title } : {},
  });
  return layer;
}

// ── Universal layer creation from portal item ID ─────────────────────────────

/**
 * Create a layer from a portal item ID.
 * Checks typeKeywords first to handle Scene Service sub-types and 3DTiles
 * that Layer.fromPortalItem mis-detects, then falls back to the SDK.
 */
export async function createLayerFromItemId(
  itemId: string,
  title?: string
): Promise<Layer> {
  // Fetch item metadata to check typeKeywords for sub-types the SDK mis-detects.
  try {
    const portalUrl = (await import("./arcgisAuth")).portalUrl;
    const resp = await fetch(`${portalUrl}/sharing/rest/content/items/${itemId}?f=json`);
    if (resp.ok) {
      const itemInfo = await resp.json();
      const keywords: string[] = itemInfo.typeKeywords ?? [];
      const keywordsLower = keywords.map((k: string) => k.toLowerCase());
      const itemType = (itemInfo.type ?? "").toLowerCase();

      // Gaussian Splat — "3DTiles Service" + typeKeyword "GaussianSplat"
      if (keywordsLower.includes("gaussiansplat")) {
        const layer = new GaussianSplatLayer({ portalItem: { id: itemId } as any });
        if (title) layer.title = title;
        return layer;
      }

      // Point Cloud — "Scene Service" + typeKeyword "PointCloud"
      if (keywordsLower.includes("pointcloud")) {
        const layer = new PointCloudLayer({ portalItem: { id: itemId } as any });
        if (title) layer.title = title;
        return layer;
      }

      // I3S Integrated Mesh — "Scene Service" + typeKeyword "IntegratedMesh"
      if (keywordsLower.includes("integratedmesh") && itemType.includes("scene service")) {
        const layer = new IntegratedMeshLayer({ portalItem: { id: itemId } as any });
        if (title) layer.title = title;
        return layer;
      }

      // 3D Tiles Integrated Mesh — "3DTiles Service" + typeKeyword "IntegratedMesh"
      if (keywordsLower.includes("integratedmesh") && itemType.includes("3dtiles")) {
        const layer = new IntegratedMesh3DTilesLayer({ portalItem: { id: itemId } as any });
        if (title) layer.title = title;
        return layer;
      }

      // Building Scene Layer — "Scene Service" + typeKeyword "Building"
      if (keywordsLower.includes("building")) {
        const layer = new BuildingSceneLayer({ portalItem: { id: itemId } as any });
        if (title) layer.title = title;
        return layer;
      }

      // Voxel Layer — "Scene Service" + typeKeyword "Voxel"
      if (keywordsLower.includes("voxel")) {
        const layer = new VoxelLayer({ portalItem: { id: itemId } as any });
        if (title) layer.title = title;
        return layer;
      }

      // Dimension Layer — "Scene Service" + typeKeyword "Dimension"
      // DimensionLayer doesn't support portalItem construction, load via URL
      if (keywordsLower.includes("dimension") && itemInfo.url) {
        const DimensionLayer = (await import("@arcgis/core/layers/DimensionLayer")).default;
        const layer = new DimensionLayer({ url: itemInfo.url } as any);
        if (title) layer.title = title;
        return layer;
      }

      // Oriented Imagery Layer — load as native OrientedImageryLayer for viewer support.
      if (keywordsLower.includes("orientedimagerylayer")) {
        const layer = new OrientedImageryLayer({ portalItem: { id: itemId } as any });
        if (title) layer.title = title;
        return layer;
      }

      // Catalog Layer — use CatalogLayer for proper "Layers in View" grouping and zoom-to support.
      if (keywordsLower.includes("cataloglayer")) {
        const layer = new CatalogLayer({ portalItem: { id: itemId } as any });
        if (title) layer.title = title;
        return layer;
      }

      // 3D Tiles fallback (3DObject, etc.)
      if (itemType.includes("3dtiles")) {
        if (itemInfo.url) {
          return createLayerFromUrl(itemInfo.url, title ?? itemInfo.title);
        }
        const layer = new IntegratedMesh3DTilesLayer({ portalItem: { id: itemId } as any });
        if (title) layer.title = title;
        return layer;
      }
    }
  } catch {
    // Fall through to SDK default
  }

  // Default: let the SDK handle it
  const layer = await Layer.fromPortalItem({
    portalItem: { id: itemId } as any,
  });
  if (title) layer.title = title;
  return layer;
}

// ── Elevation service support ────────────────────────────────────────────────

// ── COG (Cloud Optimized GeoTIFF) from direct URL ──────────────────────────

/**
 * Create an ImageryTileLayer from a Cloud Optimized GeoTIFF URL.
 * Used for STAC catalog assets — no ArcGIS server required, just a CORS-enabled HTTPS URL.
 */
export function createLayerFromCogUrl(url: string, title?: string): ImageryTileLayer {
  return new ImageryTileLayer({ url, title: title ?? "COG Layer" });
}

/**
 * Check if a portal item has elevation-related keywords in its metadata.
 * Used for display tagging only (e.g., showing an icon in search results).
 * Does NOT determine how the layer is added — Image Services with elevation data
 * (DSM, DEM, DTM) are loaded as normal operational ImageryLayers.
 * Only actual ElevationLayer items (runtime type "elevation") are automatically
 * routed to ground.layers.
 */
export function isElevationService(item: {
  title?: string;
  type?: string;
  url?: string | null;
  snippet?: string;
}): boolean {
  if (item.type && !/image\s*service|imagery/i.test(item.type)) return false;
  const text = `${item.title ?? ""} ${item.snippet ?? ""} ${item.url ?? ""}`;
  return /\b(elevation|terrain|dem\b|dtm\b|dsm\b|bathymetry|topograph)/i.test(text);
}

/**
 * Create an ElevationLayer from a URL or portal item ID.
 */
export function createElevationLayer(
  urlOrItemId: string,
  title?: string
): ElevationLayer {
  const isUrl = urlOrItemId.startsWith("http");
  const props: Record<string, any> = {};
  if (isUrl) {
    props.url = urlOrItemId;
  } else {
    props.portalItem = { id: urlOrItemId };
  }
  if (title) props.title = title;
  return new ElevationLayer(props);
}

/**
 * Add an elevation layer to the scene's ground AND a placeholder GroupLayer
 * to operational layers so it appears in the layer list widget.
 */
export function addElevationLayerToGround(
  view: any,
  urlOrItemId: string,
  title?: string
): ElevationLayer {
  const layer = createElevationLayer(urlOrItemId, title);
  if (view?.map?.ground?.layers) {
    view.map.ground.layers.add(layer);
  }
  if (view?.map?.layers) {
    const refLayer = new GroupLayer({
      title: title ? `${title} (Elevation)` : "Elevation Surface",
      listMode: "show",
    });
    view.map.layers.add(refLayer);
  }
  return layer;
}

// ── Shared elevation routing ─────────────────────────────────────────────────

import { getCurrentView, getCurrentViewType, requestViewSwitch } from "./viewManager";
import { withTimeout } from "./safeFetch";

/**
 * Handle elevation layer routing: switch to 3D, add to ground, zoom.
 * Used by both LoadLayerAgent and ContentSearchAgent to avoid duplication.
 * Returns a user-facing message string.
 */
export async function handleElevationRouting(
  urlOrItemId: string,
  displayName: string
): Promise<string> {
  // Elevation requires 3D SceneView
  if (getCurrentViewType() !== "3d") {
    try {
      await requestViewSwitch("3d");
      await new Promise((r) => setTimeout(r, 1000));
    } catch {
      return (
        `"${displayName}" is an elevation surface and requires 3D. ` +
        "Please switch to 3D using the toggle, then try again."
      );
    }
  }

  const activeView = getCurrentView() as any;
  if (!activeView?.map?.ground) {
    return "No active 3D scene view. Switch to 3D and try again.";
  }

  const elevLayer = addElevationLayerToGround(activeView, urlOrItemId, displayName);
  await withTimeout(elevLayer.load(), 30000, `Load elevation "${displayName}"`);

  if (elevLayer.fullExtent) {
    try {
      await activeView.goTo(
        { target: elevLayer.fullExtent, tilt: 65 } as any,
        { duration: 2000 }
      );
    } catch { /* non-critical */ }
  }

  return `Added "${displayName}" as terrain elevation surface.`;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Ensure a 3DTilesServer URL ends with /tileset.json.
 */
function ensure3DTilesTilesetUrl(url: string): string {
  if (/\/tileset\.json$/i.test(url)) return url;
  return url.replace(/\/?$/, "/tileset.json");
}
