import {
  searchContentByScope,
  type SearchScope,
  type ScopedSearchResults,
} from "../../../../../utils/portalSearch";
import { isElevationService } from "../../../../../utils/layerFactory";


// ── Cached search results for "add result N" follow-ups ──────────────────────
export let lastSearchResults: ScopedSearchResults[] = [];
let lastSearchTimestamp = 0;
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Check if cached search results are still valid (within TTL).
 */
export function hasValidSearchResults(): boolean {
  return lastSearchResults.length > 0 && (Date.now() - lastSearchTimestamp) < SEARCH_CACHE_TTL_MS;
}

/**
 * Explicitly clear cached search results.
 */
export function clearSearchResults(): void {
  lastSearchResults = [];
  lastSearchTimestamp = 0;
}

/**
 * Format search results as a readable numbered list.
 */
function formatResults(scopedResults: ScopedSearchResults[]): string {
  const lines: string[] = [];
  let globalIndex = 1;

  for (const { scope, results } of scopedResults) {
    lines.push(`**${scope}** (${results.length} result${results.length === 1 ? "" : "s"}):`);
    for (const r of results) {
      const snippet = r.snippet ? ` — ${r.snippet.slice(0, 80)}` : "";
      const elevTag = isElevationService(r) ? " 🏔️ Elevation" : "";
      lines.push(`  ${globalIndex}. ${r.title} (${r.type}${elevTag})${snippet}`);
      globalIndex++;
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Core search function. Calls searchContentByScope(), formats results,
 * and caches them for follow-up "add result N" requests.
 */
export async function searchContent(params: {
  scope: SearchScope;
  keyword: string;
  maxResults: number;
  itemType?: string;
  typeKeyword?: string;
  sortBy?: "popular" | "recent" | "title";
}): Promise<string> {
  const { scope, maxResults, itemType, typeKeyword, sortBy } = params;
  const sortMap: Record<string, string> = { popular: "num-views", recent: "modified", title: "title" };
  const sortField = sortMap[sortBy ?? "popular"];
  // Normalize empty/blank keyword to wildcard browse
  const keyword = params.keyword?.trim() || "*";

  // Build optional type arrays and keyword filter
  const itemTypes = itemType ? [itemType] : undefined;
  const typeKeywordsFilter = typeKeyword
    ? `typekeywords:"${typeKeyword}"`
    : undefined;

  console.log("[ContentSearch] Searching:", {
    keyword,
    scope,
    maxResults,
    itemTypes: itemTypes ?? "all",
    typeKeywords: typeKeywordsFilter ?? "none",
  });

  let scopedResults: ScopedSearchResults[];
  try {
    scopedResults = await searchContentByScope(
      keyword,
      scope,
      maxResults,
      typeKeywordsFilter,
      itemTypes,
      sortField,
      sortBy === "recent" ? "desc" : sortBy === "title" ? "asc" : "desc",
    );
  } catch (err: any) {
    console.error("[ContentSearch] Search failed:", err);
    return `Search failed: ${err?.message ?? String(err)}`;
  }

  // Cache results for follow-up "add result N" requests (valid for 5 min)
  lastSearchResults = scopedResults;
  lastSearchTimestamp = Date.now();

  const totalResults = scopedResults.reduce(
    (sum, s) => sum + s.results.length,
    0,
  );

  if (totalResults === 0) {
    const scopeLabel = scope === "all" ? "any source" : scope.replace("-", " ");
    const termLabel = keyword === "*" ? "browsing" : `"${keyword}"`;
    return (
      `No results found ${keyword === "*" ? "in" : "for " + termLabel + " in"} ${scopeLabel}. ` +
      "Try a different search term or broaden your scope."
    );
  }

  const heading =
    keyword === "*"
      ? `Top ${totalResults} result${totalResults === 1 ? "" : "s"}:\n`
      : `Found ${totalResults} result${totalResults === 1 ? "" : "s"} for "${keyword}":\n`;

  const output: string[] = [];
  output.push(heading);
  output.push(formatResults(scopedResults));
  output.push(
    'To add results, say "add result 1", "add results 1-5", or "add all results".',
  );

  // Notify the UI that search results are available
  window.dispatchEvent(new CustomEvent("imagery-assistant-search-results", { detail: { count: totalResults, scope } }));

  return output.join("\n");
}
