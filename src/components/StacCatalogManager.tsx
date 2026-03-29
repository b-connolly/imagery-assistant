import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  getStacEndpoints,
  addStacEndpoint,
  removeStacEndpoint,
  updateStacEndpoint,
  resetStacEndpoints,
  getStacCollections,
  type StacEndpoint,
} from "../utils/stacClient";

// ── Types ────────────────────────────────────────────────────────────────────

interface DraftCatalog {
  id: string;
  name: string;
  url: string;
}

interface CatalogStatus {
  collectionCount: number | null;
  error: string | null;
  checking: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function StacCatalogManager({ open, onClose }: Props) {
  const [catalogs, setCatalogs] = useState<StacEndpoint[]>([]);
  const [statuses, setStatuses] = useState<Map<string, CatalogStatus>>(new Map());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [draft, setDraft] = useState<DraftCatalog>({ id: "", name: "", url: "" });
  const panelRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const reload = useCallback(() => setCatalogs(getStacEndpoints()), []);

  useEffect(() => {
    if (open) {
      reload();
      setEditingId(null);
      setAddingNew(false);
    }
  }, [open, reload]);

  // ── Drag handling ─────────────────────────────────────────────────────────

  const onDragStart = useCallback((e: React.MouseEvent) => {
    if (!panelRef.current) return;
    dragging.current = true;
    const rect = panelRef.current.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !panelRef.current) return;
      panelRef.current.style.left = `${ev.clientX - dragOffset.current.x}px`;
      panelRef.current.style.top = `${ev.clientY - dragOffset.current.y}px`;
    };
    const onUp = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  // ── Status check ──────────────────────────────────────────────────────────

  const checkCatalog = useCallback(async (ep: StacEndpoint) => {
    setStatuses((prev) => new Map(prev).set(ep.id, { collectionCount: null, error: null, checking: true }));
    try {
      const collections = await getStacCollections(ep);
      setStatuses((prev) => new Map(prev).set(ep.id, { collectionCount: collections.length, error: null, checking: false }));
    } catch (err: any) {
      setStatuses((prev) => new Map(prev).set(ep.id, { collectionCount: null, error: err?.message ?? "Connection failed", checking: false }));
    }
  }, []);

  // ── CRUD ──────────────────────────────────────────────────────────────────

  const startAdd = () => {
    setEditingId(null);
    setAddingNew(true);
    setDraft({ id: "", name: "", url: "" });
  };

  const startEdit = (ep: StacEndpoint) => {
    setEditingId(ep.id);
    setAddingNew(false);
    setDraft({ id: ep.id, name: ep.name, url: ep.url });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setAddingNew(false);
  };

  const generateId = (name: string): string =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `stac-${Date.now()}`;

  const saveEdit = () => {
    const url = draft.url.trim();
    const name = draft.name.trim();
    if (!url || !name) return;
    if (addingNew) {
      addStacEndpoint({ id: generateId(name), name, url: url.replace(/\/$/, "") });
    } else if (editingId) {
      updateStacEndpoint(editingId, { name, url: url.replace(/\/$/, "") });
    }
    reload();
    cancelEdit();
  };

  const handleDelete = (id: string) => {
    removeStacEndpoint(id);
    reload();
  };

  const handleReset = () => {
    resetStacEndpoints();
    setStatuses(new Map());
    reload();
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (!open) return null;

  const isEditing = addingNew || editingId !== null;

  return (
    <div ref={panelRef} className="stac-catalog-panel" onMouseDown={() => {
      document.querySelectorAll(".panel-focused").forEach((el) => el.classList.remove("panel-focused"));
      panelRef.current?.classList.add("panel-focused");
    }}>
      {/* Titlebar */}
      <div className="stac-catalog-titlebar" onMouseDown={onDragStart}>
        <span>
          <calcite-icon icon="globe" scale="s" />
          {" "}STAC Catalogs
        </span>
        <calcite-button
          appearance="transparent"
          icon-start="x"
          scale="s"
          onClick={onClose}
          title="Close"
        />
      </div>

      {/* Content */}
      <div className="stac-catalog-content">
        {!isEditing ? (
          <>
            {catalogs.length === 0 && (
              <div className="stac-catalog-empty">No catalogs configured.</div>
            )}
            {catalogs.map((ep) => {
              const status = statuses.get(ep.id);
              return (
                <div key={ep.id} className="stac-catalog-card">
                  <div className="stac-catalog-card-header">
                    <div className="stac-catalog-card-info">
                      <div className="stac-catalog-card-name">{ep.name}</div>
                      <div className="stac-catalog-card-url">{ep.url}</div>
                    </div>
                    <div className="stac-catalog-card-actions">
                      <calcite-button
                        appearance="transparent"
                        icon-start="check-circle"
                        scale="s"
                        kind={status?.error ? "danger" : status?.collectionCount != null ? "success" : "neutral"}
                        loading={status?.checking ? true : undefined}
                        onClick={() => checkCatalog(ep)}
                        title="Test connection"
                      />
                      <calcite-button
                        appearance="transparent"
                        icon-start="pencil"
                        scale="s"
                        onClick={() => startEdit(ep)}
                        title="Edit"
                      />
                      <calcite-button
                        appearance="transparent"
                        icon-start="trash"
                        scale="s"
                        kind="danger"
                        onClick={() => handleDelete(ep.id)}
                        title="Remove"
                      />
                    </div>
                  </div>
                  {status && !status.checking && (
                    <div className={`stac-catalog-status ${status.error ? "error" : "success"}`}>
                      {status.error
                        ? `Error: ${status.error}`
                        : `Connected — ${status.collectionCount} collection${status.collectionCount === 1 ? "" : "s"}`}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        ) : (
          <div className="stac-catalog-form">
            <calcite-label scale="s">
              Name
              <calcite-input
                scale="s"
                placeholder="e.g. Microsoft Planetary Computer"
                value={draft.name}
                onCalciteInputInput={(e: any) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </calcite-label>
            <calcite-label scale="s">
              STAC API URL
              <calcite-input
                scale="s"
                placeholder="e.g. https://earth-search.aws.element84.com/v1"
                value={draft.url}
                onCalciteInputInput={(e: any) => setDraft((d) => ({ ...d, url: e.target.value }))}
              />
            </calcite-label>
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="stac-catalog-actions">
        {!isEditing ? (
          <>
            <calcite-button appearance="outline" icon-start="plus" scale="s" onClick={startAdd} width="auto">
              Add
            </calcite-button>
            <calcite-button appearance="transparent" icon-start="reset" scale="s" onClick={handleReset} width="auto" title="Reset to defaults">
              Reset
            </calcite-button>
          </>
        ) : (
          <>
            <calcite-button appearance="outline" scale="s" onClick={cancelEdit}>
              Cancel
            </calcite-button>
            <calcite-button
              scale="s"
              onClick={saveEdit}
              disabled={!draft.name.trim() || !draft.url.trim()}
            >
              {addingNew ? "Add" : "Save"}
            </calcite-button>
          </>
        )}
      </div>
    </div>
  );
}
