import { MangaTextRegion } from "../mangaAi";
import {
  getPrimaryRenderedMangaImage,
  toHostMangaRect,
} from "./mangaSelection";

const OVERLAY_ID = "koodo-manga-text-overlay";
const cleanups = new WeakMap<Document, () => void>();

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export interface MangaOverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Render page-local regions in the iframe viewport. The source contract stays
 * in image pixels; only this layer converts it to the current CSS rectangle.
 */
export const bindMangaTextOverlay = (
  doc: Document,
  regions: MangaTextRegion[],
  options: {
    showSourceWhenUntranslated?: boolean;
    onRegionClick?: (region: MangaTextRegion, rect: MangaOverlayRect) => void;
  } = {}
) => {
  cleanups.get(doc)?.();
  if (!regions.length) return () => undefined;
  const image = getPrimaryRenderedMangaImage(doc);
  const root = doc.body || doc.documentElement;
  if (!image || !root) return () => undefined;

  const layer = doc.createElement("div");
  layer.id = OVERLAY_ID;
  layer.setAttribute("aria-label", "Manga text regions");
  layer.style.cssText =
    "position:fixed;inset:0;z-index:2147483646;pointer-events:none;overflow:hidden;";
  const labels = regions.map((region) => {
    const label = doc.createElement("button");
    label.type = "button";
    label.dataset.regionId = region.id;
    label.textContent =
      region.translatedText ||
      (options.showSourceWhenUntranslated === false ? "" : region.sourceText);
    label.title = region.translatedText
      ? region.sourceText
      : "Translation is not available";
    label.style.cssText =
      "position:absolute;box-sizing:border-box;margin:0;padding:3px 5px;border:1px solid rgba(28,96,160,.7);border-radius:3px;background:rgba(255,255,236,.92);color:#1d2733;box-shadow:0 1px 4px rgba(0,0,0,.25);font:600 14px/1.2 sans-serif;white-space:pre-wrap;overflow:hidden;overflow-wrap:anywhere;text-align:center;pointer-events:none;";
    if (options.onRegionClick) {
      label.style.pointerEvents = "auto";
      label.style.cursor = "pointer";
      label.addEventListener("click", () =>
        options.onRegionClick?.(
          region,
          toHostMangaRect(doc, label.getBoundingClientRect())
        )
      );
    }
    layer.appendChild(label);
    return { region, label };
  });
  root.appendChild(layer);

  const update = () => {
    const imageRect = image.getBoundingClientRect();
    if (!imageRect.width || !imageRect.height) return;
    labels.forEach(({ region, label }) => {
      const left = clamp(
        imageRect.left + (region.bbox.x / image.naturalWidth) * imageRect.width,
        imageRect.left,
        imageRect.right
      );
      const top = clamp(
        imageRect.top + (region.bbox.y / image.naturalHeight) * imageRect.height,
        imageRect.top,
        imageRect.bottom
      );
      const right = clamp(
        imageRect.left +
          ((region.bbox.x + region.bbox.width) / image.naturalWidth) *
            imageRect.width,
        left + 2,
        imageRect.right
      );
      const bottom = clamp(
        imageRect.top +
          ((region.bbox.y + region.bbox.height) / image.naturalHeight) *
            imageRect.height,
        top + 2,
        imageRect.bottom
      );
      label.style.left = `${left}px`;
      label.style.top = `${top}px`;
      label.style.width = `${Math.max(2, right - left)}px`;
      label.style.height = `${Math.max(2, bottom - top)}px`;
      const fontSize = Math.max(10, Math.min(18, (bottom - top) / 4));
      label.style.fontSize = `${fontSize}px`;
      label.style.display = label.textContent ? "block" : "none";
    });
  };

  const onScroll = () => update();
  doc.defaultView?.addEventListener("resize", update);
  doc.defaultView?.addEventListener("scroll", onScroll, true);
  update();
  const cleanup = () => {
    doc.defaultView?.removeEventListener("resize", update);
    doc.defaultView?.removeEventListener("scroll", onScroll, true);
    layer.remove();
    cleanups.delete(doc);
  };
  cleanups.set(doc, cleanup);
  return cleanup;
};
