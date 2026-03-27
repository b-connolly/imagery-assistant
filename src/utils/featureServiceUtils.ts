/**
 * Feature service utilities ported from ralouta/ArcGIS-JavaScript-AI-Component.
 * Uses imagery-assistant's arcgisAuth for credentials.
 */
import IdentityManager from "@arcgis/core/identity/IdentityManager";
import { portalUrl } from "./arcgisAuth";

// ── Types ────────────────────────────────────────────────────────────────────

export interface CredentialInfo {
  token: string;
  username: string;
  portalUrl: string;
}

export interface CreateHostedFeatureServiceParams {
  portalUrl: string;
  token: string;
  username: string;
  serviceName: string;
  layerName?: string;
  geometryType?: "esriGeometryPoint" | "esriGeometryPolyline" | "esriGeometryPolygon";
  fields?: Array<{ name: string; type: string; alias?: string; length?: number }>;
}

export interface CreateHostedFeatureServiceResult {
  success: boolean;
  message: string;
  serviceItemId?: string;
  serviceUrl?: string;
}

// ── Credential helper ────────────────────────────────────────────────────────

/**
 * Get the current credential as a simple object (token, username, portalUrl).
 * Compatible with ralouta's getCredential() interface.
 */
export async function getCredential(): Promise<CredentialInfo> {
  const sharingRestUrl = `${portalUrl}/sharing/rest`;
  const existing = IdentityManager.findCredential(sharingRestUrl);
  if (existing) {
    return {
      token: existing.token!,
      username: existing.userId!,
      portalUrl,
    };
  }
  const credential = await IdentityManager.getCredential(sharingRestUrl);
  return {
    token: credential.token!,
    username: credential.userId!,
    portalUrl,
  };
}

// ── Search portal for a feature layer by name ────────────────────────────────

export async function searchPortalLayerByName(name: string): Promise<string | null> {
  let credential: CredentialInfo;
  try { credential = await getCredential(); } catch { return null; }

  const { token } = credential;
  const query = `title:"${name}" type:"Feature Service" owner:${credential.username}`;
  const params = new URLSearchParams({
    f: "json",
    q: query,
    num: "10",
    sortField: "modified",
    sortOrder: "desc",
    token,
  });

  try {
    const resp = await fetch(`${credential.portalUrl}/sharing/rest/search?${params}`);
    if (!resp.ok) return null;
    const json: any = await resp.json();
    const items: any[] = Array.isArray(json?.results) ? json.results : [];
    const search = name.trim().toLowerCase();
    const exact = items.find((item) => item?.title?.toLowerCase() === search);
    const item = exact ?? items.find((item) => item?.title?.toLowerCase().includes(search));
    if (!item) return null;
    if (item.url) {
      const base = item.url.replace(/\/+$/, "");
      return /\/\d+$/.test(base) ? base : `${base}/0`;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Create a hosted feature service ──────────────────────────────────────────

export async function createHostedFeatureService(
  params: CreateHostedFeatureServiceParams
): Promise<CreateHostedFeatureServiceResult> {
  const {
    portalUrl: pUrl,
    token,
    username,
    serviceName,
    layerName = "Layer0",
    geometryType = "esriGeometryPoint",
    fields,
  } = params;

  const defaultFields = [
    { name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" },
    { name: "Name", type: "esriFieldTypeString", alias: "Name", length: 255 },
    { name: "Description", type: "esriFieldTypeString", alias: "Description", length: 1024 },
  ];
  let layerFields;
  if (fields && fields.length) {
    layerFields = [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" }, ...fields];
  } else {
    layerFields = defaultFields;
  }

  const extent = {
    xmin: -180, ymin: -90, xmax: 180, ymax: 90,
    spatialReference: { wkid: 4326 },
  };

  const serviceDefinition = {
    name: serviceName,
    serviceDescription: "Hosted feature service created by custom agent",
    hasStaticData: false,
    maxRecordCount: 2000,
    supportedQueryFormats: "JSON",
    capabilities: "Create,Delete,Query,Update,Editing",
    allowGeometryUpdates: true,
    units: "esriDecimalDegrees",
    xssPreventionInfo: {
      xssPreventionEnabled: true,
      xssPreventionRule: "InputOnly",
      xssInputRule: "rejectInvalid",
    },
  } as any;

  const url = `${pUrl}/sharing/rest/content/users/${encodeURIComponent(username)}/createService`;
  const body = new URLSearchParams({
    f: "json",
    token,
    outputType: "featureService",
    createParameters: JSON.stringify(serviceDefinition),
  });

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await resp.json();

  if (json && json.success) {
    const serviceUrl: string = json.serviceurl || json.serviceUrl;
    const baseServiceUrl = serviceUrl.replace(/\/\d+$/, "");

    const layerDef = {
      name: layerName,
      type: "Feature Layer",
      geometryType,
      fields: layerFields,
      extent,
      objectIdField: "OBJECTID",
      spatialReference: { wkid: 4326 },
      displayField: "Name",
      capabilities: "Create,Delete,Query,Update,Editing",
    } as any;

    const addBody = new URLSearchParams({
      f: "json",
      token,
      addToDefinition: JSON.stringify({ layers: [layerDef] }),
    });

    const adminBaseUrl = baseServiceUrl.includes("/rest/services/")
      ? baseServiceUrl.replace("/rest/services/", "/rest/admin/services/")
      : baseServiceUrl.replace("/rest/", "/rest/admin/");

    const addRespAdmin = await fetch(`${adminBaseUrl}/addToDefinition`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: addBody,
    });
    const addJsonAdmin = await addRespAdmin.json();

    if (addJsonAdmin?.success !== false && !addJsonAdmin?.error) {
      return {
        success: true,
        message: `Created hosted feature layer/service: ${serviceName}`,
        serviceItemId: json.serviceItemId,
        serviceUrl: baseServiceUrl,
      };
    }

    const addResp = await fetch(`${baseServiceUrl}/addToDefinition`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: addBody,
    });
    const addJson = await addResp.json();

    if (addJson?.success !== false && !addJson?.error) {
      return {
        success: true,
        message: `Created hosted feature layer/service: ${serviceName}`,
        serviceItemId: json.serviceItemId,
        serviceUrl: baseServiceUrl,
      };
    }
    const adminErr = addJsonAdmin?.error?.message || JSON.stringify(addJsonAdmin);
    const publicErr = addJson?.error?.message || JSON.stringify(addJson);
    return {
      success: false,
      message: `Service created, but failed to add layer definition. Admin: ${adminErr}. Public: ${publicErr}`,
      serviceItemId: json.serviceItemId,
      serviceUrl: baseServiceUrl,
    };
  }

  const message = json?.error?.message || "Failed to create hosted feature layer/service";
  return { success: false, message };
}
