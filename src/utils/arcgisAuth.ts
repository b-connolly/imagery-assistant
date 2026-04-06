import OAuthInfo from "@arcgis/core/identity/OAuthInfo";
import IdentityManager from "@arcgis/core/identity/IdentityManager";
import Portal from "@arcgis/core/portal/Portal";
import type Credential from "@arcgis/core/identity/Credential";
import { withTimeout } from "./safeFetch";

const portalUrl =
  import.meta.env.VITE_ARCGIS_PORTAL_URL || "https://www.arcgis.com";

// Default web map — provides embeddings for the orchestrator.
// Must have an embeddings-v01.json resource already configured.
// Set via VITE_WEBMAP_ITEM_ID in .env.local.
export const DEFAULT_WEBMAP_ID = import.meta.env.VITE_WEBMAP_ITEM_ID || "";

// ── Centralized Portal instance ──────────────────────────────────────────────

let _cachedPortal: Portal | null = null;

/**
 * Get the shared, cached Portal instance. Loads on first call.
 */
export async function getPortal(): Promise<Portal> {
  if (!_cachedPortal || _cachedPortal.url !== portalUrl) {
    _cachedPortal = new Portal({ url: portalUrl });
  }
  if (_cachedPortal.loadStatus !== "loaded") {
    await withTimeout(_cachedPortal.load(), 30000, "Portal load");
  }
  return _cachedPortal;
}

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
 * Load the portal and return the signed-in user's profile.
 */
export async function getPortalUser(): Promise<{
  fullName: string;
  username: string;
  thumbnailUrl: string | null;
  orgUrl: string;
}> {
  const portal = await getPortal();
  if (!portal.user) {
    throw new Error("Authentication failed: no portal user after login");
  }
  const user = portal.user;
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

export { portalUrl };
