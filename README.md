# Imagery Data Assistant

React + Vite app built with ArcGIS Maps SDK, ArcGIS AI Assistant components, and custom LangGraph agents for imagery and geospatial data workflows.

## Acknowledgments

This project was inspired by and built upon the foundational work of [ralouta/ArcGIS-JavaScript-AI-Component](https://github.com/ralouta/ArcGIS-JavaScript-AI-Component). That project demonstrated how to integrate ArcGIS AI Assistant components with custom agents in a React application and served as the starting point for this imagery-focused extension.

## Disclaimer

This app has been vibe-coded with the assistance of Claude. Review the code, configuration, and deployment choices before using it beyond demos or internal experimentation. This application is just for testing new AI Agent capabilities in ArcGIS Maps SDK for JS and for testing new agent development and deployment for Imagery & 3D content.

## What It Does

- Sign in with ArcGIS and work with 2D maps or 3D scenes.
- Search your ArcGIS Online organization for imagery, elevation, and other content.
- Load layers by URL, item ID, or natural-language search.
- Perform measurements: distance, area, volume, and elevation profiles.
- Run raster analysis with server-side raster functions.
- Compare layers side-by-side with a swipe tool.
- Query layer metadata, fields, and service capabilities.
- Adjust elevation offsets for 3D layers.

## Custom Agents

This app relies heavily on custom agent development following this [resource](https://developers.arcgis.com/javascript/latest/agentic-apps/ai-custom-agents/).

| Agent | Description |
|---|---|
| **ContentSearchAgent** | Searches ArcGIS Online for imagery, elevation, and geospatial content with smart filtering |
| **LoadLayerAgent** | Loads layers by URL or item ID — supports Feature, Imagery, Scene, Tile, WMS, and elevation services |
| **MeasurementAgent** | Activates distance, area, volume, and elevation profile tools in 2D and 3D |
| **ImageryAnalysisAgent** | Applies raster functions (NDVI, hillshade, slope, etc.) to Image Service layers |
| **SwipeAgent** | Enables layer comparison with a leading/trailing swipe tool |
| **LayerInfoAgent** | Queries layer metadata, fields, statistics, and service capabilities |
| **ElevationOffsetAgent** | Adjusts Z-offset for 3D layers to correct elevation positioning |
| **AllCapabilitiesAgent** | Lists all available agent capabilities for the user |

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
- `show hillshade`
- `apply slope analysis`

**Layer info & comparison**
- `what fields does the oriented imagery layer have?`
- `swipe between the two imagery layers`
- `what can this app do?`

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
