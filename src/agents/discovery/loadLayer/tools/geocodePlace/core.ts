import { getCurrentView } from "../../../../../utils/viewManager";
import { withTimeout } from "../../../../../utils/safeFetch";

/**
 * Geocode a place name using ArcGIS World Geocoding Service and zoom to it.
 */
export async function geocodePlace(params: {
  placeName: string;
}): Promise<string> {
  const activeView = getCurrentView();
  if (!activeView) {
    return "No active map view.";
  }

  const placeName = (params.placeName ?? "").trim();
  if (!placeName) {
    return "Please provide a place name to navigate to.";
  }

  try {
    const locator = await import("@arcgis/core/rest/locator");
    const result = await withTimeout(
      locator.addressToLocations(
        "https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer",
        {
          address: { SingleLine: placeName },
          maxLocations: 1,
        }
      ),
      10000,
      "Geocode place name"
    );

    const candidate = (result as any)?.[0];
    if (candidate?.location) {
      await activeView.goTo(
        {
          target: candidate.location,
          zoom:
            candidate.attributes?.Addr_type === "Locality" ? 12 : 15,
        },
        { duration: 2000 }
      );
      return `Zoomed to **${candidate.address || placeName}**.`;
    }
  } catch (err: any) {
    console.warn("[LoadLayer] Geocode failed:", err?.message);
  }

  return `Could not find a location named "${placeName}".`;
}
