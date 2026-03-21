/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ARCGIS_OAUTH_APP_ID: string;
  readonly VITE_ARCGIS_PORTAL_URL: string;
  readonly VITE_WEBMAP_ITEM_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
