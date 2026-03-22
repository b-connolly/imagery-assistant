import OAuthInfo from "@arcgis/core/identity/OAuthInfo";
import IdentityManager from "@arcgis/core/identity/IdentityManager";
import Portal from "@arcgis/core/portal/Portal";
import type Credential from "@arcgis/core/identity/Credential";

const portalUrl =
  import.meta.env.VITE_ARCGIS_PORTAL_URL || "https://www.arcgis.com";

/**
 * Register OAuth info with the IdentityManager.
 * Call once at app startup before any ArcGIS requests.
 */
export function initializeOAuth(): OAuthInfo | null {
  const appId = import.meta.env.VITE_ARCGIS_OAUTH_APP_ID;
  if (!appId) {
    console.warn(
      "VITE_ARCGIS_OAUTH_APP_ID not set. Copy .env.example to .env.local and add your App ID."
    );
    return null;
  }

  const oAuthInfo = new OAuthInfo({
    appId,
    portalUrl,
    popup: false,
  });

  IdentityManager.registerOAuthInfos([oAuthInfo]);
  return oAuthInfo;
}

/**
 * Attempt to get existing credential or trigger OAuth redirect.
 */
export async function getCredential(): Promise<Credential> {
  return IdentityManager.getCredential(`${portalUrl}/sharing`);
}

/**
 * Check if there is an existing credential without triggering sign-in.
 */
export async function checkSignInStatus(): Promise<Credential | null> {
  try {
    return await IdentityManager.checkSignInStatus(`${portalUrl}/sharing`);
  } catch {
    return null;
  }
}

/**
 * Load the portal and return the signed-in user's full name.
 */
export async function getPortalUser(): Promise<{
  fullName: string;
  username: string;
  thumbnailUrl: string | null;
  orgUrl: string;
}> {
  const portal = new Portal({ url: portalUrl });
  await portal.load();
  const user = portal.user!;
  // Build org-specific URL: https://{urlKey}.{customBaseUrl}
  // e.g., urlKey="ivt" + customBaseUrl="maps.arcgis.com" → https://ivt.maps.arcgis.com
  const urlKey = (portal as any).urlKey;
  const customBase = (portal as any).customBaseUrl;
  const orgUrl = urlKey && customBase
    ? `https://${urlKey}.${customBase}`
    : portal.url ?? portalUrl;
  console.log("[Auth] Org URL:", orgUrl, "urlKey:", urlKey, "customBase:", customBase);
  return {
    fullName: user.fullName ?? "",
    username: user.username ?? "",
    thumbnailUrl: user.thumbnailUrl ?? null,
    orgUrl,
  };
}

/**
 * Sign out: destroy all credentials and reload the page.
 */
export function signOut(): void {
  IdentityManager.destroyCredentials();
  window.location.reload();
}

const EMBEDDINGS_RESOURCE = "embeddings-v01.json";

/**
 * Ensure the embeddings resource exists on a WebMap portal item.
 * The arcgis-assistant orchestrator requires this resource to initialize.
 */
async function ensureEmbeddingsResource(
  itemId: string,
  username: string,
  token: string
): Promise<void> {
  const userItemBase =
    `${portalUrl}/sharing/rest/content/users/${encodeURIComponent(username)}/items/${itemId}`;

  // Check if resource already exists and is valid
  const resourceUrl =
    `${portalUrl}/sharing/rest/content/items/${itemId}/resources/${EMBEDDINGS_RESOURCE}` +
    `?token=${encodeURIComponent(token)}`;
  try {
    const resp = await fetch(resourceUrl);
    if (resp.ok) {
      const data = await resp.json();
      // If it's a valid object with correct schema, we're good
      if (data && data.schemaVersion === "0.1" && Array.isArray(data.layers)) {
        return;
      }
      // Invalid format — delete and recreate
      const removeForm = new FormData();
      removeForm.append("f", "json");
      removeForm.append("token", token);
      removeForm.append("resource", EMBEDDINGS_RESOURCE);
      await fetch(`${userItemBase}/removeResources`, {
        method: "POST",
        body: removeForm,
      });
    }
  } catch {
    // Resource doesn't exist or can't be read — create it
  }

  // The arcgis-assistant orchestrator validates against this exact Zod schema
  const emptyEmbeddings = {
    schemaVersion: "0.1",
    modified: Date.now(),
    embeddings: {
      modelProvider: "openai",
      model: "text-embedding-ada-002",
      dimensions: 1536,
      templates: {
        layer: "Name: {name}\nTitle: {title}\nDescription: {description}",
        field: "Name: {name}\nAlias: {alias}\nDescription: {description}",
      },
    },
    layers: [],
  };

  const addForm = new FormData();
  addForm.append("f", "json");
  addForm.append("token", token);
  addForm.append("resourcesPrefix", "");
  addForm.append("fileName", EMBEDDINGS_RESOURCE);
  addForm.append("text", JSON.stringify(emptyEmbeddings));

  await fetch(`${userItemBase}/addResources`, {
    method: "POST",
    body: addForm,
  });
}

/**
 * Find or create a WebMap item for the assistant.
 * Searches for an existing "Imagery Data Assistant" WebMap first,
 * creates one if not found.
 */
export async function ensureWebMapItem(): Promise<string> {
  // If user provided one via env, use it directly
  const envItemId = import.meta.env.VITE_WEBMAP_ITEM_ID;
  if (envItemId) return envItemId;

  const portal = new Portal({ url: portalUrl });
  await portal.load();
  const user = portal.user!;
  const username = user.username ?? "";

  const credential = IdentityManager.findCredential(`${portalUrl}/sharing`);
  const token = credential?.token ?? "";

  // Search for existing WebMap created by this app
  const searchUrl =
    `${portalUrl}/sharing/rest/search?f=json&token=${encodeURIComponent(token)}` +
    `&q=owner:${encodeURIComponent(username)} type:"Web Map" tags:"reality-data-assistant"` +
    `&num=1&sortField=modified&sortOrder=desc`;

  const searchResp = await fetch(searchUrl);
  const searchJson = await searchResp.json();
  if (searchJson?.results?.length > 0) {
    const existingId = searchJson.results[0].id;
    // Ensure embeddings resource exists on the existing item
    await ensureEmbeddingsResource(existingId, username, token);
    return existingId;
  }

  // Create a new WebMap
  const webMapJson = {
    operationalLayers: [],
    baseMap: {
      baseMapLayers: [
        {
          id: "dark-gray-vector",
          layerType: "VectorTileLayer",
          title: "Dark Gray Canvas",
          styleUrl:
            "https://www.arcgis.com/sharing/rest/content/items/c11ce4f7801740b2905eb03ddc963ac8/resources/styles/root.json",
        },
      ],
      title: "Dark Gray Canvas",
    },
    initialState: {
      viewpoint: {
        targetGeometry: {
          spatialReference: { latestWkid: 4326, wkid: 4326 },
          xmin: -112.2,
          ymin: 33.3,
          xmax: -111.9,
          ymax: 33.6,
        },
      },
    },
    version: "2.30",
  };

  const addItemUrl = `${portalUrl}/sharing/rest/content/users/${encodeURIComponent(username)}/addItem`;
  const formData = new FormData();
  formData.append("f", "json");
  formData.append("token", token);
  formData.append("type", "Web Map");
  formData.append("title", "Imagery Data Assistant Map");
  formData.append("tags", "reality-data-assistant");
  formData.append("snippet", "Auto-created WebMap for Imagery Data Assistant");
  formData.append("text", JSON.stringify(webMapJson));

  const resp = await fetch(addItemUrl, { method: "POST", body: formData });
  const json = await resp.json();

  if (!json?.success || !json?.id) {
    throw new Error(`Failed to create WebMap: ${JSON.stringify(json?.error ?? json)}`);
  }

  // Share with org so the map loads without issues
  const shareUrl = `${portalUrl}/sharing/rest/content/users/${encodeURIComponent(username)}/items/${json.id}/share`;
  const shareForm = new FormData();
  shareForm.append("f", "json");
  shareForm.append("token", token);
  shareForm.append("everyone", "false");
  shareForm.append("org", "true");
  await fetch(shareUrl, { method: "POST", body: shareForm });

  // Add empty embeddings resource (required by arcgis-assistant orchestrator)
  await ensureEmbeddingsResource(json.id, username, token);

  return json.id;
}

export { portalUrl };
