import WebMap from "@arcgis/core/WebMap.js";
import WebScene from "@arcgis/core/WebScene.js";
import Portal from "@arcgis/core/portal/Portal.js";
import PortalFolder from "@arcgis/core/portal/PortalFolder.js";
import type MapView from "@arcgis/core/views/MapView";
import type SceneView from "@arcgis/core/views/SceneView";
import { safeFetchJson } from "./safeFetch";

export interface FolderInfo {
  id: string;
  title: string;
}

/**
 * List the authenticated user's portal folders.
 */
export async function listUserFolders(): Promise<FolderInfo[]> {
  const portal = Portal.getDefault();
  await portal.load();
  const user = portal.user;
  if (!user) return [];
  try {
    const folders = await user.fetchFolders();
    return folders.map((f: any) => ({ id: f.id, title: f.title }));
  } catch (err) {
    // Fallback: REST API
    console.warn("[saveMap] fetchFolders failed, trying REST:", err);
    try {
      const token = (await import("@arcgis/core/identity/IdentityManager")).default
        .findCredential(`${portal.url}/sharing`)?.token ?? "";
      const url = `${portal.url}/sharing/rest/content/users/${encodeURIComponent(user.username)}`;
      const form = new FormData();
      form.append("f", "json");
      form.append("token", token);
      const data = await safeFetchJson<{ folders?: { id: string; title: string }[] }>(
        url, { method: "POST", body: form }
      );
      return (data.folders ?? []).map((f: any) => ({ id: f.id, title: f.title }));
    } catch {
      return [];
    }
  }
}

/**
 * Create a new folder in the user's portal content via REST API.
 */
export async function createFolder(folderName: string): Promise<string> {
  const portal = Portal.getDefault();
  await portal.load();
  const user = portal.user;
  if (!user) throw new Error("Not signed in");

  const IdentityManager = (await import("@arcgis/core/identity/IdentityManager")).default;
  const token = IdentityManager.findCredential(`${portal.url}/sharing`)?.token ?? "";

  const url = `${portal.url}/sharing/rest/content/users/${encodeURIComponent(user.username)}/createFolder`;
  const form = new FormData();
  form.append("f", "json");
  form.append("token", token);
  form.append("title", folderName);

  const data = await safeFetchJson<{ success?: boolean; folder?: { id: string }; error?: { message: string } }>(
    url, { method: "POST", body: form }
  );
  if (!data?.success || !data?.folder?.id) {
    throw new Error(data?.error?.message ?? "Failed to create folder");
  }
  return data.folder.id;
}

/**
 * Check if the current view's map has a saved portal item (i.e., was loaded from a saved web map).
 */
export function hasSavedPortalItem(view: MapView | SceneView): boolean {
  const item = (view.map as any)?.portalItem;
  return !!(item?.id);
}

/**
 * Get the title of the current map's portal item, if any.
 */
export function getSavedTitle(view: MapView | SceneView): string | null {
  return (view.map as any)?.portalItem?.title ?? null;
}

/**
 * Save (update in place) the current Web Map. Requires the map to have been loaded from a portal item.
 */
export async function updateWebMap(
  view: MapView,
): Promise<{ id: string; title: string }> {
  const webMap = view.map as WebMap;
  await webMap.updateFrom(view);
  const item = await webMap.save();
  return { id: item.id, title: item.title ?? "Untitled" };
}

/**
 * Save (update in place) the current Web Scene. Requires the scene to have been loaded from a portal item.
 */
export async function updateWebScene(
  view: SceneView,
): Promise<{ id: string; title: string }> {
  const webScene = view.map as unknown as WebScene;
  await webScene.updateFrom(view);
  const item = await webScene.save();
  return { id: item.id, title: item.title ?? "Untitled" };
}

/**
 * Save As — create a new Web Map portal item from the current 2D view.
 * Uses the view's existing map directly so layers stay on the map after save.
 */
export async function saveAsWebMap(
  view: MapView,
  title: string,
  options?: { summary?: string; folderId?: string; tags?: string[] },
): Promise<{ id: string; title: string }> {
  const portal = Portal.getDefault();
  await portal.load();

  const webMap = view.map as WebMap;
  await webMap.updateFrom(view);

  const folder = options?.folderId
    ? new PortalFolder({ id: options.folderId, portal })
    : undefined;

  const item = await webMap.saveAs(
    {
      title,
      snippet: options?.summary || "Saved from Imagery Data Assistant",
      tags: options?.tags ?? ["imagery-assistant"],
      portal,
    },
    folder ? { folder } : undefined,
  );

  return { id: item.id, title: item.title ?? title };
}

/**
 * Save As — create a new Web Scene portal item from the current 3D view.
 * Uses the view's existing scene directly so layers stay on the map after save.
 */
export async function saveAsWebScene(
  view: SceneView,
  title: string,
  options?: { summary?: string; folderId?: string; tags?: string[] },
): Promise<{ id: string; title: string }> {
  const portal = Portal.getDefault();
  await portal.load();

  const webScene = view.map as unknown as WebScene;
  await webScene.updateFrom(view);

  const folder = options?.folderId
    ? new PortalFolder({ id: options.folderId, portal })
    : undefined;

  const item = await webScene.saveAs(
    {
      title,
      snippet: options?.summary || "Saved from Imagery Data Assistant",
      tags: options?.tags ?? ["imagery-assistant"],
      portal,
    },
    folder ? { folder } : undefined,
  );

  return { id: item.id, title: item.title ?? title };
}
