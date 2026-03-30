import PortalQueryParams from "@arcgis/core/portal/PortalQueryParams";
import type PortalItem from "@arcgis/core/portal/PortalItem";
import { getPortal } from "./arcgisAuth";
import { ALL_LAYER_TYPES } from "./typeFilterRegistry";

export interface PortalSearchResult {
  itemId: string;
  title: string;
  type: string;
  url: string | null;
  snippet: string;
  thumbnailUrl: string | null;
}

/**
 * Search ArcGIS Online for items matching a keyword, filtered by type.
 */
export async function searchPortalItems(
  keyword: string,
  itemTypes: string[] = ["Image Service"],
  maxResults = 10,
  sortField: string = "num-views",
  sortOrder: "asc" | "desc" = "desc"
): Promise<PortalSearchResult[]> {
  const portal = await getPortal();

  const typeFilter = itemTypes.map((t) => `type:"${t}"`).join(" OR ");
  const queryString = `(${keyword}) AND (${typeFilter})`;

  const query = new PortalQueryParams({
    query: queryString,
    num: maxResults,
    sortField,
    sortOrder,
  });

  const response = await portal.queryItems(query);

  return response.results.map((item: PortalItem) => ({
    itemId: item.id ?? "",
    title: item.title ?? "",
    type: item.type ?? "",
    url: (item as any).url ?? null,
    snippet: item.snippet ?? "",
    thumbnailUrl: item.thumbnailUrl ?? null,
  }));
}

/**
 * Search specifically for imagery-related items.
 */
export async function searchImageryItems(
  keyword: string,
  maxResults = 10
): Promise<PortalSearchResult[]> {
  return searchPortalItems(
    keyword,
    ["Image Service", "Imagery Layer"],
    maxResults
  );
}

/**
 * Search specifically for 3D scene-related items.
 */
export async function searchSceneItems(
  keyword: string,
  maxResults = 10
): Promise<PortalSearchResult[]> {
  return searchPortalItems(
    keyword,
    ["Scene Service", "Scene Layer", "3DTiles Service"],
    maxResults
  );
}

/**
 * Search for any layer type supported by ArcGIS Online.
 * Covers imagery, scene, feature, tile, map image, WMS, WFS, etc.
 */
export async function searchAllItems(
  keyword: string,
  maxResults = 10
): Promise<PortalSearchResult[]> {
  return searchPortalItems(keyword, ALL_LAYER_TYPES, maxResults);
}

/**
 * Search for Web Map items in the portal.
 */
export async function searchWebMaps(
  keyword: string,
  maxResults = 5
): Promise<PortalSearchResult[]> {
  return searchPortalItems(keyword, ["Web Map"], maxResults);
}

/**
 * Search for Web Scene items in the portal.
 */
export async function searchWebScenes(
  keyword: string,
  maxResults = 5
): Promise<PortalSearchResult[]> {
  return searchPortalItems(keyword, ["Web Scene"], maxResults);
}

// ── Scoped content search ────────────────────────────────────────────────────

export type SearchScope = "my-content" | "my-org" | "agol" | "living-atlas" | "all";

export interface ScopedSearchResults {
  scope: string;
  results: PortalSearchResult[];
}

// ALL_LAYER_TYPES imported from typeFilterRegistry.ts (single source of truth)

/**
 * Search for content across multiple scopes: My Content, My Org, AGOL, Living Atlas.
 * Returns results grouped by scope.
 *
 * @param typeKeywordsFilter — Optional typekeywords clause appended to the query
 *   (e.g., 'typekeywords:"Point Cloud"') to narrow Scene Service items by sub-type.
 * @param itemTypes — Optional override for portal item types to search. Defaults to ALL_LAYER_TYPES.
 */
export async function searchContentByScope(
  keyword: string,
  scope: SearchScope = "all",
  maxPerScope = 5,
  typeKeywordsFilter?: string,
  itemTypes?: string[],
  sortField: string = "num-views",
  sortOrder: "asc" | "desc" = "desc"
): Promise<ScopedSearchResults[]> {
  const portal = await getPortal();

  const username = portal.user?.username ?? "";
  const orgId = (portal as any).id ?? (portal.user as any)?.orgId ?? "";
  const types = itemTypes ?? ALL_LAYER_TYPES;
  const typeFilter = types.map((t) => `type:"${t}"`).join(" OR ");
  const tkClause = typeKeywordsFilter ? ` AND (${typeKeywordsFilter})` : "";

  const queries: { label: string; query: string }[] = [];

  // Portal search query syntax: the keyword must appear between scope filters
  // and type filters. Using "*" as a wildcard keyword is safe and prevents
  // the parser from misreading "owner:X AND" as a single token.
  const kw = keyword === "*" ? "" : `(${keyword}) `;

  if ((scope === "my-content" || scope === "all") && username) {
    queries.push({
      label: "My Content",
      query: `owner:${username} ${kw}(${typeFilter})${tkClause}`,
    });
  }

  if ((scope === "my-org" || scope === "all") && orgId) {
    queries.push({
      label: "My Organization",
      query: `orgid:${orgId} ${kw}(${typeFilter})${tkClause}`,
    });
  }

  if (scope === "agol" || scope === "all") {
    queries.push({
      label: "ArcGIS Online",
      query: `${kw}(${typeFilter})${tkClause}`,
    });
  }

  if (scope === "living-atlas" || scope === "all") {
    queries.push({
      label: "Living Atlas",
      query: `${kw}(${typeFilter})${tkClause} (owner:esri OR owner:esri_livingatlas OR typekeywords:"Living Atlas")`,
    });
  }

  const results = await Promise.all(
    queries.map(async ({ label, query }) => {
      try {
        console.log(`[portalSearch] ${label} query:`, query);
        const qp = new PortalQueryParams({
          query,
          num: maxPerScope,
          sortField,
          sortOrder,
        });
        let response = await portal.queryItems(qp);
        console.log(`[portalSearch] ${label}: ${response.results.length} results`);

        // If typekeywords filter returned 0 results, retry without it
        // (the typeKeyword value may differ across orgs/versions)
        if (response.results.length === 0 && tkClause) {
          const fallbackQuery = query.replace(tkClause, "");
          console.log(`[portalSearch] ${label} retrying without typekeywords:`, fallbackQuery);
          const fallbackQp = new PortalQueryParams({
            query: fallbackQuery,
            num: maxPerScope,
            sortField: "num-views",
            sortOrder: "desc",
          });
          response = await portal.queryItems(fallbackQp);
          console.log(`[portalSearch] ${label} fallback: ${response.results.length} results`);
        }

        // Debug: log typeKeywords of first result to verify portal metadata
        if (response.results.length > 0) {
          const first = response.results[0] as any;
          console.log(`[portalSearch] First result typeKeywords:`, first.typeKeywords);
        }
        return {
          scope: label,
          results: response.results.map((item: PortalItem) => ({
            itemId: item.id ?? "",
            title: item.title ?? "",
            type: item.type ?? "",
            url: (item as any).url ?? null,
            snippet: item.snippet ?? "",
            thumbnailUrl: item.thumbnailUrl ?? null,
          })),
        };
      } catch (err) {
        console.error(`[portalSearch] Error searching ${label}:`, err);
        return { scope: label, results: [] };
      }
    })
  );

  return results.filter((r) => r.results.length > 0);
}

/**
 * Look up a single portal item by ID and return its URL.
 */
export async function getPortalItemUrl(
  itemId: string
): Promise<{ url: string; title: string; type: string } | null> {
  const portal = await getPortal();

  const query = new PortalQueryParams({
    query: `id:${itemId}`,
    num: 1,
  });

  const response = await portal.queryItems(query);
  if (response.results.length === 0) return null;

  const item = response.results[0];
  return {
    url: (item as any).url ?? "",
    title: item.title ?? "",
    type: item.type ?? "",
  };
}
