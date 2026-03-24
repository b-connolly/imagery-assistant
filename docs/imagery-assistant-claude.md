# Imagery Data Assistant — Architecture Reference

A React + ArcGIS web app providing a natural-language chat interface for geospatial imagery and layers. Built on the `arcgis-assistant` AI component with custom agents for imagery-specific operations.

**Stack:** React 18, TypeScript, Vite, ArcGIS Maps SDK 5.x, ArcGIS AI Components, LangChain StateGraph, Zod
**Location:** `Apps/imagery-assistant/`

---

## Architecture Foundations

### 1. Authentication & Portal (`arcgisAuth.ts`)

**OAuth flow:** `initializeOAuth()` registers OAuth info with `IdentityManager`, then `getCredential()` triggers the redirect. Non-popup flow (`popup: false`) for web component compatibility.

**Centralized Portal:** `getPortal()` returns a single cached `Portal` instance with 30s load timeout. All modules must use this — never create `new Portal()` directly.

**User validation:** After `portal.load()`, always check `portal.user` is non-null before proceeding. A null user means authentication failed silently.

**Token for raw REST calls:** Use `appendToken(url)` from `safeFetch.ts` to add the ArcGIS token to any direct `fetch()` call to secured services. The SDK's `IdentityManager` handles tokens automatically for SDK operations, but raw `fetch()` calls need manual token attachment.

**Configuration (env vars):**
| Variable | Default | Purpose |
|----------|---------|---------|
| `VITE_ARCGIS_OAUTH_APP_ID` | (required) | OAuth 2.0 App ID |
| `VITE_ARCGIS_PORTAL_URL` | `https://www.arcgis.com` | Portal URL |
| `VITE_WEBMAP_ITEM_ID` | (auto-created) | Override the backing WebMap item |
| `VITE_BASEMAP_ITEM_ID` | `c11ce4f7801740b2905eb03ddc963ac8` | Default basemap style |

### 2. Backing Store — WebMap Item & Embeddings

`ensureWebMapItem()` finds or creates a WebMap item tagged `"reality-data-assistant"`. This is NOT the displayed map — it's a backing store for the AI orchestrator's embeddings data.

`ensureEmbeddingsResource()` creates a JSON resource (`embeddings-v01.json`) on that item with schema:
```json
{ "schemaVersion": "0.1", "embeddings": { "modelProvider": "openai", "model": "text-embedding-ada-002", "dimensions": 1536, "templates": {...} }, "layers": [] }
```

All Portal REST calls use `safeFetchJson()` which detects ArcGIS error objects (`{error: {code, message}}`) that arrive as HTTP 200.

### 3. Error Handling (`safeFetch.ts`)

All network operations must use the centralized error handling utilities:

| Function | Purpose |
|----------|---------|
| `safeFetch(url, options?, timeoutMs?)` | `fetch()` with AbortController timeout (15s default) + `response.ok` check |
| `safeFetchJson<T>(url, options?, timeoutMs?)` | Above + JSON parse + ArcGIS REST `{error}` detection |
| `withTimeout(promise, ms, label)` | Wrap any Promise (layer.load, portal.load, queryElevation, view.goTo) |
| `appendToken(url)` | Append ArcGIS token to URL query params for secured services |

**Error types:** `NetworkError`, `TimeoutError`, `PortalError` — all extend `Error` with descriptive messages.

**Rules:**
- Never use raw `fetch()` — always `safeFetch` or `safeFetchJson`
- Never `await layer.load()` without `withTimeout(layer.load(), 30000, "description")`
- Never swallow errors silently — at minimum `console.warn()` with context

### 4. View Management (`viewManager.ts`)

**Global state:** `currentView` (MapView or SceneView) and `currentViewType` ("2d" or "3d") tracked at module level. Updated via `setCurrentView()`, read via `getCurrentView()`.

**View switching:** `requestViewSwitch(targetType)` returns a Promise that resolves when the new view is ready, with a 30-second timeout. Same for `requestWebMapSwitch(itemId)` and `requestWebSceneSwitch(itemId)`.

**Listener pattern:** `onViewChange(callback)` returns an unlisten function. Agent-scoped listeners (registered once at module load) intentionally omit cleanup since they live for the app lifetime.

### 5. Layer Factory (`layerFactory.ts`)

**SDK-first principle:** Always prefer `Layer.fromPortalItem()` and `Layer.fromArcGISServerUrl()`. Only intercept for known SDK gaps.

**Known SDK gaps (5.0.x):**

| Portal Item Type | typeKeyword | Correct SDK Class | SDK Creates Instead |
|---|---|---|---|
| 3DTiles Service | GaussianSplat | GaussianSplatLayer | IntegratedMesh3DTilesLayer |
| Scene Service | PointCloud | PointCloudLayer | SceneLayer |
| Scene Service | IntegratedMesh | IntegratedMeshLayer | SceneLayer |
| Scene Service | Building | BuildingSceneLayer | SceneLayer |
| Scene Service | Voxel | VoxelLayer | SceneLayer |
| Feature Service | OrientedImageryLayer | FeatureLayer (sublayer /0) | — |
| Feature Service | CatalogLayer | CatalogLayer | — |

**Elevation routing:** `handleElevationRouting(urlOrItemId, displayName)` is the shared function for routing elevation layers to the ground surface. Handles 3D switch, ground validation, load with timeout, and zoom. Used by both LoadLayerAgent and ContentSearchAgent.

### 6. Portal Search (`portalSearch.ts`)

Uses the centralized `getPortal()` from `arcgisAuth.ts`.

**Scoped search:** `searchContentByScope(keyword, scope, maxPerScope, typeKeywordsFilter?, itemTypes?)` searches across My Content, My Org, AGOL, and Living Atlas in parallel.

**Type filtering:** Sub-types within Scene Service and 3DTiles Service are distinguished by `typeKeywords`, not separate item types. When `typeKeywordsFilter` returns 0 results, automatically retries without it.

**Ignored types:** `Oriented Imagery Catalog` (OIC) is legacy — never search for or load OIC items.

---

## Agent Framework

### Registration Contract

Every custom agent must:
1. Export `registerXxxAgent(assistant: HTMLElement)`
2. Create a LangChain `StateGraph` with `createAgentState()` from `agentHelpers.ts`
3. Register via `registerAgentElement(assistant, { id, name, description, createGraph })`

Agents are registered synchronously in `App.tsx` → `registerCustomAgents()` BEFORE the orchestrator initializes.

### Intent Extraction Pattern

```
1. Try fast regex first (no LLM call)
2. Fall back to invokeToolPrompt() with Zod schema + 15s timeout
3. Fall back to raw text as keyword
```

### Bailout Pattern (AGENT_KEYWORDS)

All agent keyword patterns are centralized in `AGENT_KEYWORDS` in `agentHelpers.ts`. When adding or changing keywords, update the map — all agents import from it.

```typescript
import { AGENT_KEYWORDS } from "../utils/agentHelpers";
// Bail out if another agent owns this request
for (const { pattern, label } of bailoutChecks) {
  if (pattern.test(text)) return { outputMessage: "" };
}
```

Empty `outputMessage` = "I have nothing to say" — the orchestrator tries the next agent.

### 3D Type Detection

`REQUIRES_3D` (Set of runtime type strings) and `is3DItemType(portalItemType)` are both in `agentHelpers.ts`. Use `REQUIRES_3D` for runtime layer types, `is3DItemType` for portal item type strings.

---

## Custom Agents (8)

| Agent | File | Triggers | Purpose |
|-------|------|----------|---------|
| **LoadLayerAgent** | `LoadLayerAgent.ts` | load, add, open, remove, zoom to | Load/remove/zoom layers, web maps/scenes |
| **ContentSearchAgent** | `ContentSearchAgent.ts` | search, find, browse, my content | Multi-scope portal search with result caching |
| **ImageryAnalysisAgent** | `ImageryAnalysisAgent.ts` | stretch, NDVI, hillshade, screenshot | Imagery rendering and analysis |
| **LayerInfoAgent** | `LayerInfoAgent.ts` | describe, fields, metadata, info | Layer metadata and properties |
| **MeasurementAgent** | `MeasurementAgent.ts` | measure, distance, area, elevation profile | Measurement web components |
| **SwipeAgent** | `SwipeAgent.ts` | compare, swipe, split | Layer comparison tool |
| **ElevationOffsetAgent** | `ElevationOffsetAgent.ts` | fix floating, elevation offset, raise | 3D vertical alignment |
| **PointCloudAgent** | `PointCloudAgent.ts` | class code, classification, lidar | Point cloud visualization |

### Built-in Agents (from @arcgis/ai-components)

| Agent | Purpose |
|-------|---------|
| `arcgis-assistant-help-agent` | General help and capabilities |
| `arcgis-assistant-navigation-agent` | Map navigation, zooming, basemap switching |
| `arcgis-assistant-data-exploration-agent` | Query layers, inspect features, summarize map |

---

## SDK Gotchas & Lessons Learned

### ArcGIS SDK
- **`Layer.fromPortalItem()`** doesn't handle: GaussianSplat, PointCloud, IntegratedMesh, Building, Voxel, Dimension, OrientedImagery, CatalogLayer. Check `typeKeywords` first.
- **`Layer.fromArcGISServerUrl()`** doesn't handle: 3DTilesServer URLs, external tileset.json. Intercept before calling SDK.
- **Web Scenes/Maps are NOT layers** — use `requestWebSceneSwitch(itemId)` / `requestWebMapSwitch(itemId)`, never `Layer.fromPortalItem()`.
- **`PointCloudValueFilter`** only supports `mode: "include"` — for exclude, invert by including all codes EXCEPT excluded ones.
- **Oriented Imagery Catalog** is legacy — ignore. Only use Oriented Imagery Layer (Feature Service + typeKeyword `"OrientedImageryLayer"`).
- **`<arcgis-bookmarks>`** only works for WebMap bookmarks, NOT WebScene slides.
- **Deprecated widgets** — use web components (`<arcgis-bookmarks>`, `<arcgis-expand>`) instead of `new Bookmarks()`, `new Expand()`.
- **`reference-element=""`** on measurement components causes `querySelector('#')` crash — set `view` directly.

### Portal Search
- Sub-types use **typeKeywords**, not separate types. Example: PointCloud = `type:"Scene Service"` + `typekeywords:"PointCloud"`.
- When `stripKeyword: true`, search uses `*` as keyword — don't combine with text keyword.
- Portal query syntax: `owner:X (keyword) (type:Y)` — omitting keyword between scope and type can break parser.

### Elevation
- Runtime `layer.type === "elevation"` → always route to `map.ground.layers`
- Image Services with elevation data (DSM, DEM, DTM) → normal operational layers unless user explicitly asks "add as terrain"

### CSS / UI
- Measurement components render in Shadow DOM — style via host element and CSS custom properties.
- Add `padding: 12px 16px` to measurement containers so results text doesn't clip.
- Use Calcite icon names that exist (`"bookmark"` works, `"presentations"` and `"slide"` don't).

---

## Code Quality Standards

### Error Handling Requirements
- **Never raw `fetch()`** — use `safeFetch` / `safeFetchJson` from `safeFetch.ts`
- **Never bare `await promise`** for network/SDK ops — wrap with `withTimeout()`
- **Never bare `catch {}`** — at minimum `console.warn()` with context
- **Always check `portal.user`** after `portal.load()` — null means auth failed
- **Always check ArcGIS REST errors** — `safeFetchJson` handles `{error: {code, message}}` automatically

### Shared Utilities — Use What Exists
- `elapsed(startMs)` — performance timing
- `findLayerByTitle(layers, query)` — exact then substring match
- `REQUIRES_3D` / `is3DItemType()` — 3D type detection (single source of truth)
- `getPortal()` — centralized cached Portal instance
- `AGENT_KEYWORDS` — centralized bailout regex patterns
- `handleElevationRouting()` — shared elevation-to-ground flow
- `log()` — debug logging (only in dev mode)

---

## Deployment

### Prerequisites
- Node.js 18+, ArcGIS Online org, OAuth 2.0 App ID

### Setup
```bash
cd Apps/imagery-assistant
npm install
# Create .env.local with VITE_ARCGIS_OAUTH_APP_ID=your_app_id
npm run dev    # http://localhost:5173
npm run build  # dist/ → deploy as static files
```

### First-Run Behavior
On first sign-in, the app automatically:
1. Creates a WebMap item tagged `"reality-data-assistant"` in user's content
2. Creates embeddings resource on that item (required by AI orchestrator)
3. Shares the item with the org

### Project Structure
```
Apps/imagery-assistant/src/
├── main.tsx                  # Web component registration + React mount
├── App.tsx                   # Auth, views, agent registration
├── agents/                   # 8 custom agents
├── utils/
│   ├── safeFetch.ts          # Error handling: safeFetch, withTimeout, error types
│   ├── arcgisAuth.ts         # OAuth, portal, WebMap item, embeddings
│   ├── viewManager.ts        # View state, 2D/3D switching, timeout protection
│   ├── layerFactory.ts       # Layer creation, SDK gap overrides, elevation routing
│   ├── portalSearch.ts       # Portal search with scoping
│   ├── rasterFunctions.ts    # Imagery rendering utilities
│   └── agentHelpers.ts       # Agent state, registration, AGENT_KEYWORDS, shared helpers
├── components/               # ViewToggle, ErrorBoundary
└── types/                    # Layer types, custom element declarations
```
