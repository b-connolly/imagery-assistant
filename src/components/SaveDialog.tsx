import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { listUserFolders, type FolderInfo } from "../utils/saveMap";

const CREATE_NEW = "__create_new__";

interface SaveDialogProps {
  open: boolean;
  viewType: "2d" | "3d";
  username: string;
  onSave: (title: string, summary: string, folderId: string, newFolderName?: string) => void;
  onCancel: () => void;
  saving?: boolean;
}

export default function SaveDialog({
  open, viewType, username, onSave, onCancel, saving,
}: SaveDialogProps) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("Saved from Imagery Data Assistant");
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [selectedFolder, setSelectedFolder] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [loadingFolders, setLoadingFolders] = useState(false);

  const titleRef = useRef<HTMLElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const newFolderRef = useRef<HTMLElement>(null);

  const typeLabel = viewType === "2d" ? "map" : "scene";
  const showNewFolderInput = selectedFolder === CREATE_NEW;

  // Load folders when dialog opens
  useEffect(() => {
    if (!open) return;
    setTitle(viewType === "2d" ? "My Web Map" : "My Web Scene");
    setSummary("Saved from Imagery Data Assistant");
    setSelectedFolder("");
    setNewFolderName("");
    setLoadingFolders(true);
    listUserFolders()
      .then((f) => {
        console.log("[SaveDialog] Loaded", f.length, "folders");
        setFolders(f);
      })
      .catch((err) => {
        console.warn("[SaveDialog] Failed to load folders:", err);
        setFolders([]);
      })
      .finally(() => setLoadingFolders(false));
  }, [open, viewType]);

  // Imperatively attach calcite input events (React 18 compat)
  useEffect(() => {
    const el = titleRef.current as any;
    if (!el) return;
    const handler = (e: any) => setTitle(e.target.value ?? "");
    el.addEventListener("calciteInputInput", handler);
    return () => el.removeEventListener("calciteInputInput", handler);
  }, [open]);

  useEffect(() => {
    const el = summaryRef.current as any;
    if (!el) return;
    const handler = (e: any) => setSummary(e.target.value ?? "");
    el.addEventListener("calciteTextAreaInput", handler);
    return () => el.removeEventListener("calciteTextAreaInput", handler);
  }, [open]);

  useEffect(() => {
    const el = newFolderRef.current as any;
    if (!el) return;
    const handler = (e: any) => setNewFolderName(e.target.value ?? "");
    el.addEventListener("calciteInputInput", handler);
    return () => el.removeEventListener("calciteInputInput", handler);
  }, [open, showNewFolderInput]);

  const handleSave = useCallback(() => {
    if (!title.trim()) return;
    const folderId = selectedFolder === CREATE_NEW ? "" : selectedFolder;
    const folderName = selectedFolder === CREATE_NEW ? newFolderName.trim() : undefined;
    onSave(title.trim(), summary.trim(), folderId, folderName);
  }, [title, summary, selectedFolder, newFolderName, onSave]);

  if (!open) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.6)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        style={{
          background: "#1e1e1e",
          border: "1px solid #444",
          borderRadius: 8,
          width: 440,
          maxWidth: "90vw",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          color: "#e0e4e8",
          fontFamily: "var(--calcite-font-family, 'Avenir Next', sans-serif)",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "16px 20px",
          borderBottom: "1px solid #333",
          fontSize: 16,
          fontWeight: 500,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          Save {typeLabel}
          <button
            onClick={onCancel}
            style={{ background: "none", border: "none", color: "#aaa", cursor: "pointer", fontSize: 18 }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Title */}
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
            Title
            <calcite-input
              ref={(el: any) => { titleRef.current = el; }}
              value={title}
              placeholder={`Enter ${typeLabel} title`}
            />
          </label>

          {/* Folder */}
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
            Folder
            {loadingFolders ? (
              <div style={{ padding: 8, color: "#888" }}>Loading folders...</div>
            ) : (
              <>
                <div style={{
                  border: "1px solid #555",
                  borderRadius: 4,
                  maxHeight: 200,
                  overflow: "auto",
                  background: "#2b2b2b",
                }}>
                  {/* Create new folder */}
                  <div
                    onClick={() => setSelectedFolder(CREATE_NEW)}
                    style={{
                      padding: "8px 12px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      background: selectedFolder === CREATE_NEW ? "#0079c1" : "transparent",
                      borderBottom: "1px solid #444",
                    }}
                  >
                    <calcite-icon icon="folder-plus" scale="s" />
                    Create new folder
                  </div>
                  {/* Root folder */}
                  <div
                    onClick={() => setSelectedFolder("")}
                    style={{
                      padding: "8px 12px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      background: selectedFolder === "" ? "#0079c1" : "transparent",
                      fontWeight: selectedFolder === "" ? 600 : 400,
                    }}
                  >
                    <calcite-icon icon="home" scale="s" />
                    {username || "My Content"}
                  </div>
                  {/* User folders */}
                  {folders.map((f) => (
                    <div
                      key={f.id}
                      onClick={() => setSelectedFolder(f.id)}
                      style={{
                        padding: "8px 12px 8px 20px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        background: selectedFolder === f.id ? "#0079c1" : "transparent",
                      }}
                    >
                      <calcite-icon icon="folder" scale="s" />
                      {f.title}
                    </div>
                  ))}
                </div>
                {showNewFolderInput && (
                  <calcite-input
                    ref={(el: any) => { newFolderRef.current = el; }}
                    value={newFolderName}
                    placeholder="New folder name"
                    style={{ marginTop: 6 }}
                  />
                )}
              </>
            )}
          </label>

          {/* Summary */}
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
            Summary
            <calcite-text-area
              ref={(el: any) => { summaryRef.current = el; }}
              value={summary}
              placeholder="Description for this item"
              max-length={2048}
              rows={3}
            />
          </label>
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 20px",
          borderTop: "1px solid #333",
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
        }}>
          <calcite-button appearance="outline" onClick={onCancel} scale="s">
            Cancel
          </calcite-button>
          <calcite-button
            onClick={handleSave}
            scale="s"
            loading={saving ? true : undefined}
            disabled={!title.trim() || saving || (showNewFolderInput && !newFolderName.trim()) ? true : undefined}
          >
            Save
          </calcite-button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
