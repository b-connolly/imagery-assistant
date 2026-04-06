# Imagery Data Assistant

An AI-powered geospatial assistant built with ArcGIS Maps SDK for JavaScript v5, ArcGIS AI Assistant components, and custom LangGraph agents. Search, load, visualize, analyze, and save geospatial content through natural language.

## Demo

A live demo is hosted on AWS S3: **[Imagery Data Assistant Demo](https://esri-imagery-apps.s3.dualstack.us-west-1.amazonaws.com/apps/imagery-assistant/index.html)**

Sign in with your ArcGIS Online account to explore the full capabilities.

## Acknowledgments

This project was inspired by and built upon the foundational work of [ralouta/ArcGIS-JavaScript-AI-Component](https://github.com/ralouta/ArcGIS-JavaScript-AI-Component). That project demonstrated how to integrate ArcGIS AI Assistant components with custom agents in a React application and served as the starting point for this imagery-focused extension.

## Disclaimer

This app has been developed with the assistance of AI coding agents. Review the code, configuration, and deployment choices before using it beyond demos or internal experimentation. This application is for testing new AI Agent capabilities and custom agent development using ArcGIS Maps SDK for JS. Some features are not fully complete and there are limitations to phrasing at this time.

## What It Does

- **Search and discover** geospatial content across ArcGIS Online, your organization, and the Living Atlas.
- **Load** any ArcGIS layer type by URL, item ID, or natural-language search.
- **Navigate** to places by name in 2D and 3D via geocoding.
- **Visualize** imagery with stretches, color ramps, and server-side processing templates.
- **Analyze** with distance, area, volume, and elevation profile measurements.
- **Compare** layers side-by-side with a swipe tool.
- **Inspect** layer metadata, fields, statistics, and service capabilities.
- **Manage 3D content** — fix elevation offsets, visualize point clouds, view oriented imagery.
- **Save and manage maps** — save your work as a Web Map or Web Scene to ArcGIS Online.
- **Toggle between 2D and 3D** views with automatic layer and viewpoint transfer.

## Architecture

The app uses 3 consolidated custom agents, each following ArcGIS SDK best practices for agent development:

### Custom Agents

| Agent | Pattern | Description |
|---|---|---|
| **ContentSearchAgent** | Multi-node (Router + LLM + ToolNode) | Searches ArcGIS Online across scopes (My Content, My Org, AGOL, Living Atlas). Returns results with contextual "Add Result" buttons. Handles type filtering for imagery, point clouds, web maps, etc. |
| **LoadLayerAgent** | Multi-node (Router + LLM + ToolNode) | Loads/removes layers from URLs or item IDs. Geocodes place names for navigation. Loads saved Web Maps and Web Scenes. Auto-switches to 3D for 3D-only layer types. |
| **StacSearchAgent** | Multi-node (Router + LLM + ToolNode) | Searches external STAC catalogs (Element84 Earth Search, Microsoft Planetary Computer). Filters by extent, date, cloud cover, and collection. Loads COG assets as ImageryTileLayer. Supports pagination and thumbnail previews. |
| **MapToolsAgent** | Single-node dispatcher | Routes to 9 handler functions for visualization and analysis tools. Handles save/clear map commands. |

### MapToolsAgent Handlers

| Handler | Capabilities |
|---|---|
| **imagery** | Stretches, color ramps, processing templates, pixel identification |
| **pointCloud** | Classification filtering, symbology (elevation, intensity, RGB, class code), point size/density |
| **elevationOffset** | Auto-fix, click-to-fix, manual offset, elevation diagnostics |
| **measurement** | Distance, area, volume (cut & fill), elevation profile |
| **swipe** | Layer comparison with horizontal/vertical swipe tool |
| **layerInfo** | Metadata, fields, statistics, popup configuration, layer listing |
| **orientedImagery** | Oriented Imagery viewer panel with navigation and image gallery |
| **catalog** | Catalog layer filter panel by item type |
| **save** | Save/Save As web maps and web scenes, clear map |

### STAC Integration

The **StacSearchAgent** enables searching external [STAC (SpatioTemporal Asset Catalog)](https://stacspec.org/en) APIs for satellite imagery and remote sensing data outside of ArcGIS. This capability is limited to public only STAC collections.

**Default catalogs:**
- [Element84 Earth Search](https://earth-search.aws.element84.com/v1) — Sentinel-2, Landsat, NAIP, COP-DEM
- [Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/api/stac/v1) — Sentinel-2, Landsat, ASTER, MODIS, NAIP

**Features:**
- Search by map extent, date range, cloud cover percentage, and collection
- Browse available collections from any catalog
- Load COG (Cloud Optimized GeoTIFF) assets directly as `ImageryTileLayer` — no ArcGIS server required
- Planetary Computer SAS token signing (free, anonymous, auto-cached)
- Result pagination with thumbnail previews
- STAC Catalog Manager UI for adding/removing custom STAC endpoints (persisted to localStorage)

**Known limitations:**
- No STAC items can be accessed if requester-pays, open data only. 
- COPC point clouds cannot be loaded

### Built-in Agents

| Agent | Notes |
|---|---|
| **Data Exploration** | Queries features, statistics, and spatial proximity in 2D web maps (built-in, 2D only) |

### Agent Routing

Agents use a keyword-based bailout system to avoid conflicts. Each agent checks `AGENT_KEYWORDS` patterns and returns empty if the request belongs to another agent. The orchestrator tries agents in registration order; empty responses signal "not my job."

```
User prompt → Orchestrator → tries each agent:
  ContentSearchAgent: "search my content" → handles it
  LoadLayerAgent: "search my content" → bails (search keyword → ContentSearch territory)
  MapToolsAgent: "search my content" → bails (search keyword → ContentSearch territory)
```

### Project Structure

```
src/
├── agents/
│   ├── discovery/
│   │   ├── contentSearch/          # Multi-node: router → LLM → ToolNode
│   │   │   ├── nodes/             # Router, LLM prompt, tool execution
│   │   │   └── tools/             # searchContent, addResults (adapter + core)
│   │   ├── loadLayer/              # Multi-node: router → LLM → ToolNode
│   │   │   ├── nodes/             # Router, LLM prompt, tool execution
│   │   │   └── tools/             # loadLayer, removeLayer, zoomToLayer, geocodePlace
│   │   ├── mcp/                   # MCP passthrough agent
│   │   └── stac/                  # STAC search agent
│   │       ├── nodes/             # Router, LLM prompt, tool execution
│   │       └── tools/             # searchStac, browseCollections, addStacResults
│   └── mapTools/                   # Single-node dispatcher
│       ├── mapToolsNode.ts        # Routes to handlers via keyword matching
│       └── handlers/              # imagery, pointCloud, elevationOffset, measurement,
│                                  # swipe, layerInfo, orientedImagery, catalog, save
├── components/
│   ├── AgentElement.tsx           # React 18 wrapper for arcgis-assistant-agent
│   ├── SaveDialog.tsx             # Save map dialog with folder selection
│   ├── StacCatalogManager.tsx     # STAC catalog add/edit/remove panel
│   ├── ViewToggle.tsx             # 2D/3D toggle control
│   └── ErrorBoundary.tsx
├── utils/
│   ├── arcgisAuth.ts              # OAuth, portal, default web map config
│   ├── viewManager.ts             # View state, switching, layer transfer
│   ├── saveMap.ts                 # Save/update Web Maps and Web Scenes
│   ├── portalSearch.ts            # Portal search across scopes
│   ├── layerFactory.ts            # Layer creation from URLs and item IDs
│   ├── rasterFunctions.ts         # Stretch, template, and identify utilities
│   ├── agentHelpers.ts            # AGENT_KEYWORDS, shared utilities
│   ├── stacClient.ts              # STAC API client, endpoint management, SAS signing
│   ├── typeFilterRegistry.ts      # Portal type → keyword mapping
│   └── safeFetch.ts               # Fetch with timeout and error handling
└── App.tsx                        # Main app, view management, contextual prompts
```

## Save Workflow

The app starts with a read-only default web map (for AI orchestrator embeddings). Users work with an empty basemap and add content as needed.

| Command | Behavior |
|---|---|
| `save web map My Project` | Creates a new Web Map portal item titled "My Project" |
| `save web map` (after first save) | Updates the existing saved map in place |
| `save web scene My 3D Project` | Creates a new Web Scene portal item |
| `clear map` | Removes all layers, resets to empty default map |

The Save As dialog (accessible from the user menu) supports folder selection and creating new folders.

## Contextual Prompt Buttons

The assistant shows context-aware suggested prompts based on the current state:

| State | Buttons shown |
|---|---|
| **No layers** | Search My Content, Search My Organization, Search ArcGIS Online, Search ArcGIS Living Atlas |
| **After search results** | Add Result 1, Add All Results, [scope] |
| **After listing templates** | Apply 1, Apply 2, Apply 3, Change Stretch |
| **After adding a layer** | Layer-type-specific tools (e.g., Change Stretch, Fix Elevation, Describe Layer, Remove All Layers) |

## Example Prompts

**Search & load**
- `search my content for gaussian splat layers`
- `search Living Atlas for elevation data`
- `add result 1`
- `add all results`
- `load this layer: https://services.arcgis.com/.../FeatureServer`

**STAC search**
- `search earth search for sentinel-2 imagery with less than 20% cloud cover`
- `search planetary computer for landsat imagery from last month`
- `browse collections on earth search`
- `add STAC result 1`
- `add all STAC results`
- `show more STAC results`

**Navigation**
- `zoom to Denver CO`
- `go to Tokyo`
- `fly to the Grand Canyon`

**Imagery analysis**
- `list processing templates`
- `apply processing template Name`
- `change stretch to min-max with DRA`
- `compare layer 1 and layer 2`

**Measurement**
- `measure distance in kilometers`
- `measure area in acres`
- `show an elevation profile`
- `measure volume using cut and fill`

**3D & point cloud**
- `fix elevation`
- `filter point cloud class code 2`
- `color by elevation`
- `change point cloud density to 100`

**Layer query**
- `describe layer`
- `what fields does this layer have?`
- `add pop up info`

**Maps & Scenes**
- `save web map Title`
- `search my content for web scenes`
- `clear map`
- `remove all layers`

## Local Development

### Requirements

- Node.js 18+
- An ArcGIS Online account with OAuth credentials

### Setup

```bash
git clone https://github.com/b-connolly/imagery-assistant.git
cd imagery-assistant
npm install
```

Create `.env.local`:
```
VITE_ARCGIS_OAUTH_APP_ID=your_oauth_app_id
VITE_ARCGIS_PORTAL_URL=https://www.arcgis.com
```

```bash
npm run dev       # Start development server (http://localhost:5173)
npm run build     # Production build
npm run preview   # Preview production build
```

### OAuth Setup

1. Create an OAuth app at [developers.arcgis.com](https://developers.arcgis.com).
2. Add redirect URLs: `http://localhost:5173` and `http://localhost:4173`.
3. Set the client ID in `.env.local`.

## Tech Stack

- [ArcGIS Maps SDK for JavaScript v5](https://developers.arcgis.com/javascript/latest/)
- [ArcGIS AI Assistant Components](https://www.npmjs.com/package/@arcgis/ai-components)
- [Calcite Design System](https://developers.arcgis.com/calcite-design-system/)
- [LangGraph (Web)](https://www.npmjs.com/package/@langchain/langgraph)
- [React 18](https://react.dev/) + [Vite 7](https://vite.dev/)
- [TypeScript](https://www.typescriptlang.org/)

## Known Limitations

- **Built-in navigation agent removed** — only supports 2D and crashes in 3D SceneView. Geocoding is handled by LoadLayerAgent instead, which works in both 2D and 3D.
- **Built-in data exploration agent** — only supports 2D for querying feature layers. Does not work in 3D SceneView.
- **React 18 custom element props** — React 18 does not pass object props to web components as properties (fixed in React 19). The `AgentElement` wrapper handles this by setting the `agent` property imperatively.
- **Save requires ArcGIS Online access** — saving web maps/scenes requires write permissions to your ArcGIS Online content.
- **STAC items cannot be saved to maps or scenes** — saving web maps/scenes is limited to only those supported currently in ArcGIS Online.
- **STAC COPC point clouds** — cannot be loaded directly. ArcGIS JS SDK `PointCloudLayer` requires a Scene Service endpoint, and `@deck.gl/arcgis` does not yet support `@arcgis/core` v5.
- **Stop button** — the `arcgis-assistant` stop button does not cancel running agent operations. No abort signal is wired through LangGraph invoke.
