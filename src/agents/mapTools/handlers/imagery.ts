import ImageryLayer from "@arcgis/core/layers/ImageryLayer";
import { getCurrentView, onViewChange } from "../../../utils/viewManager";
import {
  findLayerByTitle,
} from "../../../utils/agentHelpers";
import {
  applyStretch,
  applyServerTemplate,
  clearRasterFunction,
  getServerTemplates,
  identifyPixel,
  getBandInfos,
  SDK_COLOR_RAMPS,
  type StretchType,
} from "../../../utils/rasterFunctions";

// ── Active click handler tracking ────────────────────────────────────────────

let clickHandlerRemove: (() => void) | null = null;
let identifyLayerTitle: string | null = null;

function clearClickHandler(): void {
  if (clickHandlerRemove) {
    clickHandlerRemove();
    clickHandlerRemove = null;
    identifyLayerTitle = null;
  }
}

onViewChange(() => clearClickHandler());

// ── Find imagery layer ───────────────────────────────────────────────────────

const IMAGERY_TYPES = new Set(["imagery", "imagery-tile"]);

/** Match a color ramp name from user text against SDK_COLOR_RAMPS. */
function findColorRamp(text: string): string | null {
  const lower = text.toLowerCase().replace(/[-_]/g, " ");
  // Exact match first
  const exact = SDK_COLOR_RAMPS.find((r) => lower.includes(r.replace(/-/g, " ")));
  if (exact) return exact;
  // Fuzzy: check if any ramp name words appear
  const words = lower.split(/\s+/).filter((w) => w.length > 3);
  for (const ramp of SDK_COLOR_RAMPS) {
    const rampWords = ramp.split("-");
    if (rampWords.some((rw) => words.includes(rw))) return ramp;
  }
  return null;
}

// ── Template listing cache (survives view switches for 5 min) ────────────────
let lastTemplateLayerTitle = "";
let lastTemplateList: { name: string }[] = [];
let lastTemplateTimestamp = 0;
const TEMPLATE_CACHE_TTL_MS = 5 * 60 * 1000;

function getCachedTemplates(): { name: string }[] | null {
  if (lastTemplateList.length > 0 && (Date.now() - lastTemplateTimestamp) < TEMPLATE_CACHE_TTL_MS) {
    return lastTemplateList;
  }
  return null;
}

function findImageryLayer(view: any, hint: string | null): ImageryLayer | null {
  const layers = view.map?.layers?.toArray() ?? [];
  if (hint) {
    const match = findLayerByTitle(layers, hint);
    if (match && IMAGERY_TYPES.has(match.type)) return match;
    // Also try matching by type keyword in the hint
    const byType = layers.find((l: any) =>
      IMAGERY_TYPES.has(l.type) && (l.type === hint || hint?.toLowerCase().includes("imagery"))
    );
    if (byType) return byType;
  }
  // Auto-select: prefer most recently added imagery layer
  const imgLayers = layers.filter((l: any) => IMAGERY_TYPES.has(l.type));
  return imgLayers.length > 0 ? imgLayers[imgLayers.length - 1] : null;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function imageryHandler(text: string): Promise<{ outputMessage: string }> {
      console.log("[ImageryTools] Starting. User text:", text);

      const view = getCurrentView();
      if (!view?.map) return { outputMessage: "No active map view." };

      // Extract layer name hint from text
      const layerHint = text
        .replace(/\b(apply|use|set|change|switch|enable|disable|turn|on|off|to|the|layer|template|processing|raster|function|identify|popup|describe|info|list|show|available|templates|reset|clear|none|default)\b/gi, "")
        .trim() || null;

      const layer = findImageryLayer(view, layerHint);

      // ── Close/disable identify ───────────────────────────────────────
      if (/\b(disable|turn\s*off|stop|remove|clear)\s*(identify|popup|click)/i.test(text)) {
        if (clickHandlerRemove) {
          clearClickHandler();
          return { outputMessage: "Click-to-identify disabled." };
        }
        return { outputMessage: "Click-to-identify is not currently active." };
      }

      // ── Enable identify / popup ──────────────────────────────────────
      if (/\b(identify|pixel\s*value|popup|click.?to.?identify|enable\s*popup|add\s*popup)\b/i.test(text)) {
        if (!layer) return { outputMessage: "No imagery layer found on the map." };

        // Clear any existing handler
        clearClickHandler();

        const handler = (view as any).on("click", async (event: any) => {
          event.stopPropagation();
          // Close any existing popup before identifying
          (view as any).closePopup?.();

          try {
            const result = await identifyPixel(layer, event.mapPoint, view);
            if (!result) {
              (view as any).openPopup({
                title: `${layer.title}`,
                content: "No data at this location.",
                location: event.mapPoint,
              });
              return;
            }

            const bands = getBandInfos(layer);
            const content = result.values
              .map((v: any, i: number) => {
                const bandName = bands[i]?.name ?? `Band ${i + 1}`;
                return `<b>${bandName}:</b> ${v}`;
              })
              .join("<br>");

            (view as any).openPopup({
              title: `${layer.title} — Pixel Values`,
              content,
              location: event.mapPoint,
            });
          } catch (err) {
            console.error("[ImageryTools] Identify click failed:", err);
          }
        });

        clickHandlerRemove = () => handler.remove();
        identifyLayerTitle = layer.title ?? null;
        return { outputMessage: `Click-to-identify enabled on "${layer.title}". Click any location to see pixel values.` };
      }

      // ── List available processing templates ──────────────────────────
      if (/\b(list|show|available|what)\b.*\b(template|function|processing)\b/i.test(text) ||
          /\b(template|function|processing)\b.*\b(list|show|available|what)\b/i.test(text)) {
        if (!layer) return { outputMessage: "No imagery layer found on the map." };

        const templates = getServerTemplates(layer);
        if (templates.length === 0) {
          return { outputMessage: `"${layer.title}" has no server processing templates.` };
        }

        // Cache for follow-up "apply N" requests
        lastTemplateList = templates;
        lastTemplateLayerTitle = layer.title;
        lastTemplateTimestamp = Date.now();

        const list = templates.map((t, i) => `${i + 1}. ${t.name}`).join("\n");
        // Notify UI to show template-specific prompt buttons
        window.dispatchEvent(new CustomEvent("imagery-assistant-templates-listed", {
          detail: { count: templates.length },
        }));
        return {
          outputMessage: `**Processing templates for "${layer.title}"** (${templates.length}):\n\n${list}\n\nSay "apply [number]" or "apply [template name]" to use one.`,
        };
      }

      // ── Stretch type change ──────────────────────────────────────────
      const stretchMatch = text.match(/\b(stretch|std\s*dev|standard\s*deviation|min[\s-]*max|percent[\s-]*clip|histogram\s*equal|sigmoid)\b/i);
      if (stretchMatch && /\b(change|set|apply|use|switch)\b/i.test(text)) {
        if (!layer) return { outputMessage: "No imagery layer found on the map." };

        // Detect stretch type
        const stretchMap: Record<string, StretchType> = {
          "none": "none",
          "standard deviation": "standard-deviation",
          "std dev": "standard-deviation",
          "min max": "min-max",
          "minmax": "min-max",
          "percent clip": "percent-clip",
          "histogram equalization": "histogram-equalization",
          "histogram equal": "histogram-equalization",
          "sigmoid": "sigmoid",
        };

        let stretchType: StretchType = "standard-deviation";
        const lower = text.toLowerCase().replace(/[-_]/g, " ");
        for (const [key, val] of Object.entries(stretchMap)) {
          if (lower.includes(key)) { stretchType = val; break; }
        }

        // Detect DRA
        const dra = /\b(dra|dynamic\s*range\s*adjust)/i.test(text);

        // Detect color ramp in same command
        const rampName = findColorRamp(text);

        applyStretch(layer, stretchType, { dynamicRangeAdjustment: dra, colorRampName: rampName ?? undefined });
        const draLabel = dra ? " with DRA" : "";
        const rampLabel = rampName ? ` and **${rampName}** color ramp` : "";
        return { outputMessage: `Applied **${stretchType}** stretch${draLabel}${rampLabel} to "${layer.title}".` };
      }

      // ── Color ramp (standalone) ──────────────────────────────────────
      if (/\bcolor\s*ramp\b/i.test(text)) {
        if (!layer) return { outputMessage: "No imagery layer found on the map." };

        const rampName = findColorRamp(text);
        if (!rampName) {
          const rampList = SDK_COLOR_RAMPS.join(", ");
          return { outputMessage: `Couldn't match a color ramp. Available ramps:\n\n${rampList}\n\nSay "change color ramp to [name]".` };
        }

        // Apply stretch with color ramp (keep current stretch type or default to std dev)
        const currentStretch = ((layer.renderer as any)?.stretchType as StretchType) ?? "standard-deviation";
        const currentDRA = (layer.renderer as any)?.dynamicRangeAdjustment ?? false;
        applyStretch(layer, currentStretch, { dynamicRangeAdjustment: currentDRA, colorRampName: rampName });
        return { outputMessage: `Applied **${rampName}** color ramp to "${layer.title}".` };
      }

      // ── Reset / clear processing ─────────────────────────────────────
      if (/\b(reset|clear|remove|default|none)\b.*\b(raster|function|template|processing|render)\b/i.test(text) ||
          /\b(raster|function|template|processing|render)\b.*\b(reset|clear|remove|default|none)\b/i.test(text)) {
        if (!layer) return { outputMessage: "No imagery layer found on the map." };
        clearRasterFunction(layer);
        return { outputMessage: `Reset "${layer.title}" to default rendering.` };
      }

      // ── Apply processing template ────────────────────────────────────
      if (/\b(apply|use|set|change|switch)\b/i.test(text)) {
        if (!layer) return { outputMessage: "No imagery layer found on the map." };

        // Use live templates, fall back to cached list if layer changed
        let templates = getServerTemplates(layer);
        if (templates.length === 0) {
          const cached = getCachedTemplates();
          if (cached) templates = cached;
        }
        if (templates.length === 0) {
          return { outputMessage: `"${layer.title}" has no server processing templates to apply.` };
        }

        // Extract template name from text
        const cleaned = text
          .replace(/\b(apply|use|set|change|switch|to|the|template|processing|raster|function|layer)\b/gi, "")
          .trim();

        // Match by number ("apply template 3")
        const numMatch = cleaned.match(/^\s*(\d+)\s*$/);
        if (numMatch) {
          const idx = parseInt(numMatch[1], 10) - 1;
          if (idx >= 0 && idx < templates.length) {
            applyServerTemplate(layer, templates[idx].name);
            return { outputMessage: `Applied **${templates[idx].name}** to "${layer.title}".` };
          }
          return { outputMessage: `Template number ${numMatch[1]} is out of range. Available: 1–${templates.length}.` };
        }

        // Match by name (fuzzy)
        const lower = cleaned.toLowerCase();
        const match = templates.find((t) => t.name.toLowerCase() === lower) ??
          templates.find((t) => t.name.toLowerCase().includes(lower)) ??
          templates.find((t) => lower.includes(t.name.toLowerCase()));

        if (match) {
          applyServerTemplate(layer, match.name);
          return { outputMessage: `Applied **${match.name}** to "${layer.title}".` };
        }

        // No match — list available
        const list = templates.map((t, i) => `${i + 1}. ${t.name}`).join("\n");
        return {
          outputMessage: `Couldn't match "${cleaned}" to a template. Available for "${layer.title}":\n\n${list}\n\nSay "apply [name]" or "apply [number]".`,
        };
      }

      // ── Describe imagery layer ───────────────────────────────────────
      if (/\b(describe|info|detail|about|properties|metadata)\b/i.test(text)) {
        if (!layer) return { outputMessage: "No imagery layer found on the map." };

        const bands = getBandInfos(layer);
        const templates = getServerTemplates(layer);
        const rasterInfo = (layer as any).serviceRasterInfo;
        const pixelType = rasterInfo?.pixelType ?? (layer as any).pixelType ?? "unknown";
        const extent = layer.fullExtent;

        const lines: string[] = [];
        lines.push(`### ${layer.title}`);
        lines.push(`- **Type:** ${layer.type}`);
        lines.push(`- **Pixel type:** ${pixelType}`);
        lines.push(`- **Bands:** ${bands.length} (${bands.map((b) => b.name).join(", ")})`);
        if (extent) {
          lines.push(`- **Extent:** [${extent.xmin.toFixed(4)}, ${extent.ymin.toFixed(4)}] → [${extent.xmax.toFixed(4)}, ${extent.ymax.toFixed(4)}]`);
        }
        if (templates.length > 0) {
          lines.push(`- **Processing templates (${templates.length}):** ${templates.join(", ")}`);
        }
        if (identifyLayerTitle === layer.title) {
          lines.push(`- **Click-to-identify:** active`);
        }

        return { outputMessage: lines.join("\n") };
      }

      // ── Fallback: no recognized command ──────────────────────────────
      if (!layer) return { outputMessage: "No imagery layer found on the map. Load an imagery layer first." };

      // If text matches a template name directly, apply it
      const templates = getServerTemplates(layer);
      const directMatch = templates.find((t) => t.name.toLowerCase() === text.toLowerCase().trim()) ??
        templates.find((t) => text.toLowerCase().includes(t.name.toLowerCase()));
      if (directMatch) {
        applyServerTemplate(layer, directMatch.name);
        return { outputMessage: `Applied **${directMatch.name}** to "${layer.title}".` };
      }

      return {
        outputMessage: `Imagery commands for "${layer.title}":\n` +
          `- **"list templates"** — show available processing templates\n` +
          `- **"apply [template]"** — apply a processing template\n` +
          `- **"enable identify"** — click to see pixel values\n` +
          `- **"reset rendering"** — clear processing back to default`,
      };
}
