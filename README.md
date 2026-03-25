# Imagery Data Assistant

React + Vite app built with ArcGIS Maps SDK, ArcGIS AI Assistant components, and custom LangGraph agents for imagery and geospatial data workflows.

## Acknowledgments

This project was inspired by and built upon the foundational work of [ralouta/ArcGIS-JavaScript-AI-Component](https://github.com/ralouta/ArcGIS-JavaScript-AI-Component). That project demonstrated how to integrate ArcGIS AI Assistant components with custom agents in a React application and served as the starting point for this imagery-focused extension.

## Demo

A live demo is hosted on AWS S3: **[Imagery Data Assistant Demo](https://esri-imagery-apps.s3.dualstack.us-west-1.amazonaws.com/apps/imagery-assistant/index.html)**

Sign in with your ArcGIS Online account to explore the full capabilities — search for imagery and geospatial content, load layers from URLs or portal items, run raster analysis, perform 2D/3D measurements, and interact with your data through natural language. The demo reflects the latest build from this repository.

## Disclaimer

This app has been developed with the assistance of AI coding agents. Review the code, configuration, and deployment choices before using it beyond demos or internal experimentation. This application is just for testing new AI Agent capabilities in ArcGIS Maps SDK for JS. Some features are not fully complete and there are limitations to phrasing at this time.

## What It Does

- Sign in with ArcGIS and work with 2D maps or 3D scenes.
- Search your ArcGIS Online organization for imagery, elevation, and other content.
- Load layers by URL, item ID, or natural-language search.
- Perform measurements: distance, area, volume, and elevation profiles.
- Run raster analysis with server-side processing templates and stretches.
- Compare layers side-by-side with a swipe tool.
- Query layer metadata, fields, statistics, and service capabilities.
- Adjust elevation offsets for 3D layers (auto-fix, click-to-fix, or manual).
- Visualize and filter point clouds by classification, color, and density.
- View oriented imagery with coverage footprints and image galleries.

## Custom Agents

This app relies heavily on custom agent development following this [resource](https://developers.arcgis.com/javascript/latest/agentic-apps/ai-custom-agents/).

| Agent | Group | Description |
|---|---|---|
| **ContentSearchAgent** | Discovery | Searches ArcGIS Online for imagery, elevation, and geospatial content with smart filtering |
| **LoadLayerAgent** | Discovery | Loads layers by URL or item ID — supports Feature, Imagery, Scene, Tile, WMS, and elevation services |
| **ImageryToolsAgent** | Visualization | Applies stretches, color ramps, server-side processing templates, and pixel identification |
| **PointCloudAgent** | Visualization | Controls point cloud layer styling — classification filtering, color by elevation/intensity/RGB |
| **OrientedImageryAgent** | Visualization | Opens the Oriented Imagery viewer for street-level and oblique imagery |
| **CatalogLayerAgent** | Visualization | Interactive filtering for items in Catalog Layers by layer type |
| **SwipeAgent** | Analysis | Enables layer comparison with a leading/trailing swipe tool |
| **LayerInfoAgent** | Analysis | Queries layer metadata, fields, statistics, layer order, and service capabilities |
| **MeasurementAgent** | Analysis | Activates distance, area, volume, and elevation profile tools in 2D and 3D |
| **ElevationOffsetAgent** | Analysis | Fixes 3D layer vertical alignment with auto-fix, click-to-fix, and manual offset |

## Local Development Requirements

- Node.js 18+
- An ArcGIS Online account with OAuth credentials

## Local Setup

### 1. Clone The Repository

```bash
git clone https://github.com/b-connolly/imagery-assistant.git
cd imagery-assistant
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure ArcGIS OAuth

1. Create an ArcGIS OAuth app at [developers.arcgis.com](https://developers.arcgis.com).
2. Add redirect URLs: `http://localhost:5173` and `http://localhost:4173`.
3. Update the client ID in `src/utils/arcgisAuth.ts`.

### 4. Run The App

```bash
npm run dev
```

## Build Commands

```bash
npm run dev       # Start development server
npm run build     # Production build
npm run preview   # Preview production build
```

## Using The App

1. Sign in with your ArcGIS Online account.
2. Toggle between 2D Map and 3D Scene views.
3. Ask the assistant to find, load, analyze, or measure geospatial data.

Example prompts:

**Search & load**
- `search my content for oriented imagery layers`
- `find elevation services`
- `load this layer: https://services.arcgis.com/.../FeatureServer`
- `add the layer with item id abc123`

**Elevation & terrain**
- `load this as a terrain surface: https://tiles.arcgis.com/.../ImageServer`
- `adjust the elevation offset for the drone imagery layer`

**Measurement**
- `measure distance in kilometers`
- `measure area in acres`
- `show an elevation profile`
- `measure volume using cut and fill`

**Imagery analysis**
- `apply NDVI to the satellite imagery layer`
- `apply the hillshade template`
- `identify pixels on click`

**Layer info & comparison**
- `what fields does the oriented imagery layer have?`
- `describe layer 4`
- `swipe between the two imagery layers`

**3D & point cloud**
- `fix the floating mesh`
- `show only ground and buildings`
- `color by elevation`

## Tech Stack

- [ArcGIS Maps SDK for JavaScript v5](https://developers.arcgis.com/javascript/latest/)
- [ArcGIS AI Assistant Components](https://www.npmjs.com/package/@arcgis/ai-components)
- [Calcite Design System](https://developers.arcgis.com/calcite-design-system/)
- [LangGraph (Web)](https://www.npmjs.com/package/@langchain/langgraph)
- [React 18](https://react.dev/) + [Vite 7](https://vite.dev/)
- [TypeScript](https://www.typescriptlang.org/)

## Troubleshooting

| Symptom | Fix |
|---|---|
| Sign-in fails | Check OAuth client ID and redirect URLs in `arcgisAuth.ts` |
| Layers won't load | Verify the service URL is accessible and the item is shared with your account |
| Measurement tool doesn't appear | Ensure the map/scene view is fully loaded before requesting a measurement |
| Volume measurement requires 3D | The agent auto-switches to 3D — if it fails, toggle to Scene view manually |
| Layer list is empty | Ensure layers have been added to the map; ground-only layers appear as placeholders |
