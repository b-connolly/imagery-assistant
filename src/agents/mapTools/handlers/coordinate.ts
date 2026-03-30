import { getCurrentView, onViewChange } from "../../../utils/viewManager";
import { setLastAssistantGeoSnapshot } from "../../../utils/assistantState";
import { clearClickHandler as clearImageryClickHandler } from "./imagery";
import * as webMercatorUtils from "@arcgis/core/geometry/support/webMercatorUtils";
import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol";

// ── Click handler cleanup ───────────────────────────────────────────────────

let coordClickRemove: (() => void) | null = null;

onViewChange(() => {
  if (coordClickRemove) {
    coordClickRemove();
    coordClickRemove = null;
  }
});

// ── Format helpers ──────────────────────────────────────────────────────────

function formatDegrees(value: number, isLat: boolean): string {
  const abs = Math.abs(value);
  const dir = isLat ? (value >= 0 ? "N" : "S") : (value >= 0 ? "E" : "W");
  return `${abs.toFixed(6)}° ${dir}`;
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function coordinateHandler(text: string): Promise<{ outputMessage: string }> {
  const view = getCurrentView();
  if (!view) return { outputMessage: "No active map view." };

  // Clean up any existing click handlers (ours + imagery identify)
  if (coordClickRemove) {
    coordClickRemove();
    coordClickRemove = null;
  }
  clearImageryClickHandler();

  console.log("[Coordinates] Registering click handler on view:", view.type);

  // Wait for the user to click the map — returns coordinates as the agent response
  const result = await new Promise<string>((resolve) => {
    const timeout = setTimeout(() => {
      handle.remove();
      coordClickRemove = null;
      resolve("Coordinate capture timed out — no click detected within 30 seconds.");
    }, 30000);

    const handle = view.on("click", async (event: any) => {
      clearTimeout(timeout);

      try {
        let mapPoint = event.mapPoint;
        if (!mapPoint) {
          resolve("Could not read map coordinates from click.");
          handle.remove();
          coordClickRemove = null;
          return;
        }

        // Project to WGS84 if needed
        if (mapPoint.spatialReference?.isWebMercator) {
          mapPoint = webMercatorUtils.webMercatorToGeographic(mapPoint) as any;
        }

        const lat = mapPoint.latitude ?? mapPoint.y;
        const lon = mapPoint.longitude ?? mapPoint.x;

        if (lat == null || lon == null) {
          resolve("Could not extract coordinates from click location.");
          handle.remove();
          coordClickRemove = null;
          return;
        }

        const latStr = formatDegrees(lat, true);
        const lonStr = formatDegrees(lon, false);
        const decimal = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;

        // Query elevation from World Terrain 3D service
        let elevation: number | null = null;
        try {
          const ElevationLayer = (await import("@arcgis/core/layers/ElevationLayer")).default;
          const terrainLayer = new ElevationLayer({
            url: "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer",
          });
          const queryPoint = new Point({ latitude: lat, longitude: lon });
          const result = await terrainLayer.queryElevation(queryPoint);
          elevation = (result as any).geometry?.z ?? null;
          console.log(`[Coordinates] Elevation: ${elevation?.toFixed(1)}m`);
        } catch (err) {
          console.warn("[Coordinates] Elevation query failed:", err);
        }

        const elevStr = elevation != null ? `${elevation.toFixed(1)} m` : "unavailable";

        console.log(`[Coordinates] ${latStr}, ${lonStr}, elev ${elevStr} (${decimal})`);

        // Add a temporary marker graphic at the clicked location
        try {
          const graphic = new Graphic({
            geometry: new Point({
              latitude: lat,
              longitude: lon,
            }),
            symbol: new SimpleMarkerSymbol({
              color: [56, 130, 246, 0.8],
              size: 12,
              outline: { color: [255, 255, 255], width: 2 },
            }),
          });
          view.graphics.add(graphic);
          // Remove marker after 30 seconds
          setTimeout(() => {
            try { view.graphics.remove(graphic); } catch { /* view may have changed */ }
          }, 30000);
        } catch { /* non-critical */ }

        // Store in assistant state for MCP follow-up queries
        setLastAssistantGeoSnapshot({
          title: "Clicked Location",
          responseText: `User clicked at ${latStr}, ${lonStr}, elevation ${elevStr}`,
          entities: [
            {
              kind: "point",
              origin: "source",
              label: `${latStr}, ${lonStr}`,
              lat,
              lon,
              description: `Clicked coordinate: ${decimal}, elevation: ${elevStr}`,
            },
          ],
          updatedAt: new Date().toISOString(),
        });

        resolve(
          `**Coordinates captured:**\n\n` +
          `**Latitude:** ${latStr}\n\n` +
          `**Longitude:** ${lonStr}\n\n` +
          `**Elevation:** ${elevStr}\n\n` +
          `Location stored — you can now ask "weather at this location" or other queries using these coordinates.`
        );
      } catch (err: any) {
        console.error("[Coordinates] Click handler error:", err);
        resolve(`Error capturing coordinates: ${err?.message ?? String(err)}`);
      }

      handle.remove();
      coordClickRemove = null;
    });

    coordClickRemove = () => {
      clearTimeout(timeout);
      handle.remove();
    };
  });

  return { outputMessage: result };
}
