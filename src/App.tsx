import { useCallback, useEffect, useRef, useState } from "react";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import {
  initializeOAuth,
  checkSignInStatus,
  getCredential,
  getPortalUser,
  ensureWebMapItem,
  signOut,
} from "./utils/arcgisAuth";
import ElevationLayer from "@arcgis/core/layers/ElevationLayer";
import {
  setCurrentView,
  captureViewpoint,
  getOperationalLayers,
  registerViewSwitchHandler,
  registerWebMapSwitchHandler,
  registerWebSceneSwitchHandler,
  type ViewType,
} from "./utils/viewManager";
import ViewToggle from "./components/ViewToggle";
import { registerLoadLayerAgent } from "./agents/LoadLayerAgent";
import { registerImageryAnalysisAgent } from "./agents/ImageryAnalysisAgent";
import { registerElevationOffsetAgent } from "./agents/ElevationOffsetAgent";
import { registerContentSearchAgent } from "./agents/ContentSearchAgent";
import { registerMeasurementAgent } from "./agents/MeasurementAgent";
import { registerSwipeAgent } from "./agents/SwipeAgent";
import { registerLayerInfoAgent } from "./agents/LayerInfoAgent";
import { registerPointCloudAgent } from "./agents/PointCloudAgent";
import { registerOrientedImageryAgent } from "./agents/OrientedImageryAgent";
import { registerCatalogLayerAgent } from "./agents/CatalogLayerAgent";

// Global default — zoomed out to show the full world
const DEFAULT_CENTER = [0, 20];
const DEFAULT_ZOOM = 1;

/**
 * Pre-register custom agent elements into an arcgis-assistant element.
 * Must happen synchronously when the assistant element mounts,
 * BEFORE the orchestrator initializes and snapshots child agents.
 */
function registerCustomAgents(assistant: HTMLElement) {
  registerLoadLayerAgent(assistant);
  registerImageryAnalysisAgent(assistant);
  registerElevationOffsetAgent(assistant);
  registerContentSearchAgent(assistant);
  registerMeasurementAgent(assistant);
  registerSwipeAgent(assistant);
  registerLayerInfoAgent(assistant);
  registerPointCloudAgent(assistant);
  registerOrientedImageryAgent(assistant);
  registerCatalogLayerAgent(assistant);
}

export default function App() {
  const [oauthReady, setOauthReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [userName, setUserName] = useState("");
  const [userInfo, setUserInfo] = useState<{ username: string; thumbnailUrl: string | null; orgUrl: string }>({ username: "", thumbnailUrl: null, orgUrl: "" });
  const [loading, setLoading] = useState(true);
  const [viewType, setViewType] = useState<ViewType>("2d");
  const [webMapId, setWebMapId] = useState<string | null>(null);
  const [webSceneId, setWebSceneId] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // The web map item ID used by the assistant for embeddings storage (not for the map view)
  const assistantItemId = useRef<string | null>(null);

  // Track the assistant element to register agents exactly once per mount
  const assistantRegistered = useRef(false);

  // Shared post-auth setup: load user profile and ensure assistant web map item
  const completeSignIn = useCallback(async () => {
    setSignedIn(true);
    const user = await getPortalUser();
    setUserName(user.fullName);
    setUserInfo({
      username: user.username,
      thumbnailUrl: user.thumbnailUrl,
      orgUrl: user.orgUrl,
    });
    const itemId = await ensureWebMapItem();
    assistantItemId.current = itemId;
    setWebMapId(itemId);
  }, []);

  // Initialize OAuth on mount
  useEffect(() => {
    const info = initializeOAuth();
    if (!info) {
      setLoading(false);
      return;
    }
    setOauthReady(true);

    checkSignInStatus().then(async (credential) => {
      if (credential) {
        try {
          await completeSignIn();
        } catch {
          // Portal load failed but credential exists
        }
      }
      setLoading(false);
    });
  }, [completeSignIn]);

  // Handle sign-in button click
  const handleSignIn = useCallback(async () => {
    try {
      await getCredential();
      await completeSignIn();
    } catch {
      // User cancelled or auth failed
    }
  }, [completeSignIn]);

  // Track current viewType in a ref so the event handler always sees the latest
  const viewTypeRef = useRef(viewType);
  viewTypeRef.current = viewType;

  // Pending viewpoint + layers to transfer when toggling between 2D/3D
  const pendingTransfer = useRef<{
    viewpoint: any;
    layers: import("@arcgis/core/layers/Layer").default[];
  } | null>(null);

  // Ref callback for arcgis-map / arcgis-scene — attaches native event listener
  const mapSceneRefCallback = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const handler = async (e: Event) => {
      const target = e.target as any;
      const view = target.view ?? (e as CustomEvent)?.detail?.view;
      if (view) {
        console.log("[App] View ready:", viewTypeRef.current, view);
        setCurrentView(view, viewTypeRef.current);

        // Inset widgets from the edges
        view.ui.padding = { top: 20, left: 20, right: 20, bottom: 20 };

        // ── Add layer list + basemap gallery via view.ui.add() → top-right ──
        const layerExpand = document.createElement("arcgis-expand");
        layerExpand.setAttribute("expand-icon", "layers");
        layerExpand.setAttribute("scale", "l");
        const layerList = document.createElement("arcgis-layer-list") as any;
        layerList.view = view;
        layerList.listItemCreatedFunction = (event: any) => {
          const item = event.item;
          item.actionsSections = [
            [{ title: "Zoom to", icon: "zoom-to-object", id: "zoom-to" }],
          ];
        };
        layerList.addEventListener("arcgisTriggerAction", async (evt: Event) => {
          const detail = (evt as CustomEvent).detail;
          console.log("[App] Layer list action fired:", detail?.action?.id, detail?.item?.layer?.title);
          if (detail?.action?.id === "zoom-to") {
            const layer = detail.item?.layer;
            if (!layer) return;
            try {
              // Ensure layer is loaded so fullExtent is available
              if (typeof layer.load === "function" && layer.loadStatus !== "loaded") {
                await layer.load();
              }

              let extent = layer.fullExtent;

              // CatalogLayer dynamic sublayers don't have fullExtent.
              // Walk up parent chain to find the CatalogLayer and query its footprint.
              if (!extent) {
                let catalog: any = null;
                let p = layer.parent;
                while (p) {
                  if (p.type === "catalog") { catalog = p; break; }
                  p = p.parent;
                }
                console.log("[App] Zoom-to: no fullExtent, parent chain →", catalog?.type ?? "no catalog found", "layer:", layer.title, "type:", layer.type);
                if (catalog) {
                  try {
                    await catalog.load();
                    const footprintLayer = catalog.footprintLayer;
                    if (footprintLayer) {
                      await footprintLayer.load();
                      // Log field names so we know what to query
                      const fieldNames = footprintLayer.fields?.map((f: any) => f.name) ?? [];
                      console.log("[App] Footprint fields:", fieldNames);
                      console.log("[App] Layer portalItem:", (layer as any).portalItem?.id, "title:", layer.title);

                      // Try multiple field name patterns used by different catalog services
                      const itemId = (layer as any).portalItem?.id;
                      const layerTitle = (layer.title ?? "").replace(/'/g, "''");
                      let result: any = null;

                      // Try by item ID field (various naming conventions)
                      if (itemId) {
                        for (const field of ["itemid", "ItemId", "ITEMID", "item_id", "portalitemid", "PortalItemId"]) {
                          if (fieldNames.some((f: string) => f.toLowerCase() === field.toLowerCase())) {
                            result = await footprintLayer.queryFeatures({
                              where: `${field} = '${itemId}'`,
                              returnGeometry: true,
                              num: 1,
                            });
                            if (result.features?.length > 0) break;
                          }
                        }
                      }

                      // Try by title/name field
                      if (!result?.features?.length) {
                        for (const field of ["title", "Title", "name", "Name", "TITLE", "NAME", "layername", "LayerName"]) {
                          if (fieldNames.some((f: string) => f.toLowerCase() === field.toLowerCase())) {
                            result = await footprintLayer.queryFeatures({
                              where: `${field} = '${layerTitle}'`,
                              returnGeometry: true,
                              num: 1,
                            });
                            if (result.features?.length > 0) break;
                          }
                        }
                      }

                      // Last resort: query all features and match by title in attributes
                      if (!result?.features?.length) {
                        result = await footprintLayer.queryFeatures({
                          where: "1=1",
                          returnGeometry: true,
                          outFields: ["*"],
                          num: 100,
                        });
                        const match = result.features?.find((f: any) => {
                          const attrs = f.attributes ?? {};
                          return Object.values(attrs).some((v: any) =>
                            typeof v === "string" && v.toLowerCase() === layerTitle.toLowerCase()
                          );
                        });
                        if (match) {
                          extent = match.geometry?.extent;
                        }
                      }

                      if (!extent && result?.features?.length > 0) {
                        extent = result.features[0].geometry?.extent;
                      }
                      console.log("[App] Footprint query result:", result?.features?.length ?? 0, "extent:", !!extent);
                    }
                  } catch (err) {
                    console.warn("[App] Footprint query failed:", err);
                  }
                }
              }

              if (extent) {
                await view.goTo(extent, { duration: 2000 });
              } else {
                // Last fallback: try via layer view
                try {
                  const lv = await view.whenLayerView(layer);
                  if (lv?.fullExtent) {
                    await view.goTo(lv.fullExtent, { duration: 2000 });
                  }
                } catch { /* non-critical */ }
              }
            } catch {
              // Non-critical — layer may not support zoom
            }
          }
        });
        layerExpand.appendChild(layerList);

        const basemapExpand = document.createElement("arcgis-expand");
        basemapExpand.setAttribute("expand-icon", "basemap");
        basemapExpand.setAttribute("scale", "l");
        const basemapGallery = document.createElement("arcgis-basemap-gallery") as any;
        basemapGallery.view = view;
        basemapExpand.appendChild(basemapGallery);

        view.ui.add([layerExpand, basemapExpand], "top-right");

        // ── Bookmarks / Slides — only if web map/scene has bookmarks or slides ──
        const addBookmarksIfPresent = async () => {
          try {
            await view.map.load?.();
            const bookmarks = (view.map as any).bookmarks;
            const slides = (view.map as any).presentation?.slides;
            const bookmarkCount = bookmarks?.length ?? 0;
            const slideCount = slides?.length ?? 0;
            const mapSceneEl = el;

            // Clean up any previous bookmarks/slides widget
            mapSceneEl.querySelectorAll("arcgis-expand[expand-icon='bookmark']").forEach((e) => e.remove());
            mapSceneEl.querySelectorAll(".slides-expand-container").forEach((e) => e.remove());

            // WebMap bookmarks → use <arcgis-bookmarks> component
            if (bookmarkCount > 0) {
              const bookmarksExpand = document.createElement("arcgis-expand");
              bookmarksExpand.setAttribute("expand-icon", "bookmark");
              bookmarksExpand.setAttribute("scale", "l");
              bookmarksExpand.setAttribute("position", "top-right");
              const bookmarksEl = document.createElement("arcgis-bookmarks") as any;
              bookmarksExpand.appendChild(bookmarksEl);
              mapSceneEl.appendChild(bookmarksExpand);
              console.log("[App] Added Bookmarks —", bookmarkCount, "bookmarks");
            }

            // WebScene slides → custom slides panel (no SDK component for slides)
            if (slideCount > 0) {
              const slidesPanel = document.createElement("div");
              slidesPanel.className = "slides-panel";
              slidesPanel.style.cssText = "max-height:400px;overflow-y:auto;padding:8px;width:200px;background:var(--calcite-color-background, #1e1e1e);border-radius:4px;";

              slides.forEach((slide: any) => {
                const item = document.createElement("div");
                item.style.cssText = "cursor:pointer;margin-bottom:8px;border:2px solid transparent;border-radius:4px;overflow:hidden;transition:border-color 0.2s;";
                item.addEventListener("mouseenter", () => { item.style.borderColor = "var(--calcite-color-brand, #00a0ff)"; });
                item.addEventListener("mouseleave", () => { item.style.borderColor = "transparent"; });

                if (slide.thumbnail?.url) {
                  const img = document.createElement("img");
                  img.src = slide.thumbnail.url;
                  img.alt = slide.title?.text ?? "Slide";
                  img.style.cssText = "width:100%;display:block;";
                  item.appendChild(img);
                }

                const label = document.createElement("div");
                label.textContent = slide.title?.text ?? "Untitled Slide";
                label.style.cssText = "padding:4px 6px;font-size:12px;color:var(--calcite-color-text-1, #fff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
                item.appendChild(label);

                item.addEventListener("click", () => {
                  slide.applyTo(view);
                });

                slidesPanel.appendChild(item);
              });

              // Wrap in expand using arcgis-expand
              const expandEl = document.createElement("arcgis-expand");
              expandEl.setAttribute("expand-icon", "bookmark");
              expandEl.setAttribute("scale", "l");
              expandEl.setAttribute("position", "top-right");
              expandEl.className = "slides-expand-container";
              expandEl.appendChild(slidesPanel);
              mapSceneEl.appendChild(expandEl);
              console.log("[App] Added Slides panel —", slideCount, "slides");
            }
          } catch (err) {
            console.warn("[App] Bookmarks/slides setup failed:", err);
          }
        };
        addBookmarksIfPresent();

        // ── Transfer layers + viewpoint from the previous view ──
        const transfer = pendingTransfer.current;
        if (transfer) {
          pendingTransfer.current = null;

          // Re-add operational layers to the new view's map
          if (transfer.layers.length > 0) {
            console.log("[App] Transferring", transfer.layers.length, "layers to new view");
            view.map.layers.addMany(transfer.layers);
          }

          // Restore viewpoint — set directly on the view to avoid async races
          // This is the SDK's intended mechanism for syncing 2D ↔ 3D views
          view.viewpoint = transfer.viewpoint;
        }

        // ── Ensure ground has world elevation ──
        // Web scenes loaded by item ID may lack a ground elevation surface.
        // Wait briefly for the ground attribute to be processed before checking.
        if (view.map?.ground) {
          const ensureGround = () => {
            const ground = view.map.ground;
            const hasElevation = ground.layers?.length > 0;
            if (!hasElevation) {
              console.log("[App] Ground has no elevation layers — adding world elevation service");
              ground.layers.add(
                new ElevationLayer({
                  url: "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer",
                })
              );
            }
          };
          // Defer to let the web component process ground="world-elevation" first
          setTimeout(ensureGround, 500);
        }

        // Strip grid/graticule reference layers from basemap to prevent
        // unwanted horizontal/vertical lines on the map
        const stripGridLayers = (basemap: any) => {
          if (!basemap) return;
          for (const collection of [basemap.referenceLayers, basemap.baseLayers]) {
            if (!collection) continue;
            const toRemove = collection.filter((l: any) =>
              /grid|graticule|lat.*lon|coordinate/i.test(l.title || l.id || "")
            );
            toRemove.forEach((l: any) => collection.remove(l));
            if (toRemove.length) console.log("[App] Removed grid layers:", toRemove.map((l: any) => l.title || l.id));
          }
        };
        stripGridLayers(view.map?.basemap);
        // Also strip when user changes basemap via gallery
        if (view.map) {
          reactiveUtils.watch(
            () => view.map?.basemap,
            (bm: any) => stripGridLayers(bm)
          );
        }
      } else {
        console.warn("[App] arcgisViewReadyChange fired but no view found");
      }
    };
    el.addEventListener("arcgisViewReadyChange", handler);
  }, []);

  // Handle view type toggle — capture state, switch, transfer on ready
  const handleViewToggle = useCallback(
    (newType: ViewType) => {
      if (newType === viewType) return;

      // Capture current viewpoint and operational layers before unmounting
      const vp = captureViewpoint();
      const layers = getOperationalLayers();

      pendingTransfer.current = vp
        ? { viewpoint: vp, layers }
        : null;

      setViewType(newType);
    },
    [viewType]
  );

  // Register the view switch handler so agents can programmatically switch views
  useEffect(() => {
    registerViewSwitchHandler(handleViewToggle);
  }, [handleViewToggle]);

  // Register the web map / web scene switch handlers so agents can load them by item ID
  // Use viewTypeRef to avoid re-registering on every viewType change
  useEffect(() => {
    registerWebMapSwitchHandler((itemId: string) => {
      setWebMapId(itemId);
      if (viewTypeRef.current !== "2d") setViewType("2d");
    });
    registerWebSceneSwitchHandler((itemId: string) => {
      setWebSceneId(itemId);
      if (viewTypeRef.current !== "3d") setViewType("3d");
    });
  }, []);

  // Ref callback: fires synchronously when the arcgis-assistant element mounts.
  // This registers agents BEFORE the orchestrator reads child elements.
  const assistantRefCallback = useCallback(
    (el: HTMLElement | null) => {
      if (!el) {
        assistantRegistered.current = false;
        return;
      }
      if (assistantRegistered.current) return;
      assistantRegistered.current = true;
      registerCustomAgents(el);

      // Listen for AI model errors (403 = org doesn't have AI Models license)
      el.addEventListener("arcgisError", ((evt: CustomEvent) => {
        const msg = evt.detail?.message ?? evt.detail?.error?.message ?? String(evt.detail);
        console.error("[App] Assistant error:", msg);
        if (/403|forbidden/i.test(msg)) {
          setAiError(
            "Your ArcGIS Online organization does not have access to ArcGIS AI Models. " +
            "Ask your org admin to enable AI Models under Organization Settings > Security."
          );
        }
      }) as EventListener);
    },
    []
  );

  // No OAuth configured
  if (!loading && !oauthReady) {
    return (
      <div className="no-oauth-warning">
        <h2>Imagery Data Assistant</h2>
        <p>
          OAuth is not configured. Copy <code>.env.example</code> to{" "}
          <code>.env.local</code> and add your ArcGIS Online App ID.
        </p>
        <p>
          Then restart the dev server with <code>npm run dev</code>.
        </p>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="loading-overlay">
        <calcite-loader scale="l" type="indeterminate" />
        <span className="loading-text">Initializing...</span>
      </div>
    );
  }

  const mapElementId = viewType === "2d" ? "main-map" : "main-scene";

  return (
    <calcite-shell>
      {/* Header */}
      <div slot="header" className="app-header">
        <div className="app-header-left">
          <span className="app-title">Imagery Data Assistant</span>
        </div>
        <div className="app-header-right">
          <ViewToggle currentView={viewType} onToggle={handleViewToggle} />
          {signedIn ? (
            <>
              <calcite-button
                id="user-menu-trigger"
                appearance="transparent"
                scale="s"
                icon-end="chevron-down"
                style={{ color: "#e0e4e8" }}
              >
                {userInfo.thumbnailUrl ? (
                  <img
                    src={userInfo.thumbnailUrl}
                    alt=""
                    style={{ width: 24, height: 24, borderRadius: "50%", marginRight: 6, verticalAlign: "middle" }}
                  />
                ) : (
                  <calcite-icon icon="user" scale="s" style={{ marginRight: 4 }} />
                )}
                {userName}
              </calcite-button>
              <calcite-popover
                reference-element="user-menu-trigger"
                placement="bottom-end"
                auto-close={true}
                style={{ "--calcite-popover-border-color": "#404040" } as any}
              >
                <div style={{ padding: "8px 0", minWidth: 200, background: "#1e1e1e" }}>
                  <a href={`${userInfo.orgUrl}/home/user.html`} target="_blank" rel="noreferrer" className="user-menu-item">
                    <calcite-icon icon="user" scale="s" /> My Profile
                  </a>
                  <a href={`${userInfo.orgUrl}/home/`} target="_blank" rel="noreferrer" className="user-menu-item">
                    <calcite-icon icon="organization" scale="s" /> My Organization
                  </a>
                  <a href={`${userInfo.orgUrl}/home/content.html`} target="_blank" rel="noreferrer" className="user-menu-item">
                    <calcite-icon icon="content-full" scale="s" /> My Content
                  </a>
                  <div style={{ borderTop: "1px solid #404040", margin: "6px 0" }} />
                  <button className="user-menu-item" onClick={signOut}>
                    <calcite-icon icon="sign-out" scale="s" /> Sign Out
                  </button>
                </div>
              </calcite-popover>
            </>
          ) : (
            <calcite-button
              appearance="outline-fill"
              scale="s"
              onClick={handleSignIn}
            >
              Sign In
            </calcite-button>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="main-content">
        <div className="map-container">
          {viewType === "2d" ? (
            <arcgis-map
              key={webMapId || "default-map"}
              ref={mapSceneRefCallback}
              id="main-map"
              item-id={webMapId ?? undefined}
              basemap={webMapId ? undefined : "dark-gray-vector"}
              center={webMapId && webMapId !== assistantItemId.current ? undefined : `${DEFAULT_CENTER[0]},${DEFAULT_CENTER[1]}`}
              zoom={webMapId && webMapId !== assistantItemId.current ? undefined : DEFAULT_ZOOM}
            >
              <arcgis-home position="top-left" scale="l" />
              <arcgis-zoom position="top-left" scale="l" />
              <arcgis-compass position="top-left" />
            </arcgis-map>
          ) : (
            <arcgis-scene
              key={webSceneId || "default-scene"}
              ref={mapSceneRefCallback}
              id="main-scene"
              item-id={webSceneId ?? undefined}
              basemap={webSceneId ? undefined : "dark-gray-vector"}
              ground={webSceneId ? undefined : "world-elevation"}
            >
              <arcgis-home position="top-left" scale="l" />
              <arcgis-zoom position="top-left" scale="l" />
              <arcgis-compass position="top-left" />
            </arcgis-scene>
          )}
        </div>

        <div id="assistant-panel">
          {aiError && (
            <div style={{
              padding: "12px 16px",
              background: "rgba(255, 80, 60, 0.12)",
              border: "1px solid rgba(255, 80, 60, 0.3)",
              borderRadius: "8px",
              margin: "12px",
              color: "#ff9080",
              fontSize: "0.82rem",
              lineHeight: 1.5,
            }}>
              <strong>AI Models Unavailable</strong>
              <p style={{ margin: "6px 0 0" }}>{aiError}</p>
            </div>
          )}
          {signedIn ? (
            <arcgis-assistant
              ref={assistantRefCallback}
              reference-element={`#${mapElementId}`}
              heading="Imagery Data Assistant"
            >
              <arcgis-assistant-help-agent />
              <arcgis-assistant-navigation-agent />
              <arcgis-assistant-data-exploration-agent />
            </arcgis-assistant>
          ) : (
            <div className="sign-in-panel">
              <div className="sign-in-card">
                <div className="sign-in-icon">
                  <calcite-icon icon="sign-in" scale="l" />
                </div>
                <p className="sign-in-text">
                  Sign in with your ArcGIS Online account to access the assistant.
                </p>
                <calcite-button scale="l" width="full" onClick={handleSignIn}>
                  Sign In
                </calcite-button>
              </div>
            </div>
          )}
        </div>
      </div>
    </calcite-shell>
  );
}
