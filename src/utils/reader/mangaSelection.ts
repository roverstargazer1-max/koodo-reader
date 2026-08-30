import { MangaOcrSelection } from "../mangaAi";

type SelectionCallback = (selection: MangaOcrSelection) => void;

const LAYER_ID = "koodo-manga-selection-layer";
const cleanups = new WeakMap<Document, () => void>();

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const getImageForPoint = (doc: Document, x: number, y: number) => {
  const images = Array.from(doc.images).filter(
    (image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0
  );
  const hit = images.find((image) => {
    const rect = image.getBoundingClientRect();
    return (
      x >= rect.left &&
      x <= rect.right &&
      y >= rect.top &&
      y <= rect.bottom &&
      rect.width > 0 &&
      rect.height > 0
    );
  });
  if (hit) return hit;
  return images.sort(
    (a, b) =>
      b.getBoundingClientRect().width * b.getBoundingClientRect().height -
      a.getBoundingClientRect().width * a.getBoundingClientRect().height
  )[0];
};

const toHostRect = (doc: Document, rect: DOMRect) => {
  const frame = doc.defaultView?.frameElement as HTMLIFrameElement | null;
  const frameRect = frame?.getBoundingClientRect();
  if (!frameRect) {
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }
  return {
    left: frameRect.left + rect.left,
    top: frameRect.top + rect.top,
    width: rect.width,
    height: rect.height,
  };
};

const cropToDataUrl = (
  image: HTMLImageElement,
  crop: { x: number; y: number; width: number; height: number }
) => {
  const canvas = image.ownerDocument.createElement("canvas");
  canvas.width = crop.width;
  canvas.height = crop.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable for manga crop capture");
  context.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height
  );
  return canvas.toDataURL("image/jpeg", 0.92);
};

/** Bind a non-invasive Alt+drag layer inside one rendered reader iframe. */
export const bindMangaRegionSelection = (
  doc: Document,
  onSelect: SelectionCallback
) => {
  cleanups.get(doc)?.();
  const root = doc.body || doc.documentElement;
  if (!root) return () => undefined;

  const layer = doc.createElement("div");
  layer.id = LAYER_ID;
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;display:none;pointer-events:none;cursor:crosshair;user-select:none;";
  const selectionBox = doc.createElement("div");
  selectionBox.style.cssText =
    "position:absolute;border:2px solid #5c9ee6;background:rgba(92,158,230,.18);display:none;pointer-events:none;";
  layer.appendChild(selectionBox);
  root.appendChild(layer);

  let altDown = false;
  let dragging = false;
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let image: HTMLImageElement | undefined;

  const setLayerVisible = (visible: boolean) => {
    layer.style.display = visible ? "block" : "none";
    layer.style.pointerEvents = visible ? "auto" : "none";
  };
  const point = (event: PointerEvent) => {
    const rect = layer.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const updateBox = (event: PointerEvent) => {
    const current = point(event);
    const left = Math.min(startX, current.x);
    const top = Math.min(startY, current.y);
    selectionBox.style.left = `${left}px`;
    selectionBox.style.top = `${top}px`;
    selectionBox.style.width = `${Math.abs(current.x - startX)}px`;
    selectionBox.style.height = `${Math.abs(current.y - startY)}px`;
    selectionBox.style.display = "block";
  };
  const finish = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    if (pointerId !== null && layer.hasPointerCapture(pointerId)) {
      layer.releasePointerCapture(pointerId);
    }
    pointerId = null;
    const current = point(event);
    const selection = {
      left: Math.min(startX, current.x),
      top: Math.min(startY, current.y),
      right: Math.max(startX, current.x),
      bottom: Math.max(startY, current.y),
    };
    const layerRect = layer.getBoundingClientRect();
    const selectionViewport = {
      left: selection.left + layerRect.left,
      top: selection.top + layerRect.top,
      right: selection.right + layerRect.left,
      bottom: selection.bottom + layerRect.top,
    };
    selectionBox.style.display = "none";
    if (!image || selection.right - selection.left < 4 || selection.bottom - selection.top < 4) {
      return;
    }
    const imageRect = image.getBoundingClientRect();
    const left = clamp(selectionViewport.left, imageRect.left, imageRect.right);
    const top = clamp(selectionViewport.top, imageRect.top, imageRect.bottom);
    const right = clamp(selectionViewport.right, imageRect.left, imageRect.right);
    const bottom = clamp(selectionViewport.bottom, imageRect.top, imageRect.bottom);
    if (right - left < 2 || bottom - top < 2) return;
    const scaleX = image.naturalWidth / imageRect.width;
    const scaleY = image.naturalHeight / imageRect.height;
    const cropLeft = clamp(
      Math.floor((left - imageRect.left) * scaleX),
      0,
      image.naturalWidth - 1
    );
    const cropTop = clamp(
      Math.floor((top - imageRect.top) * scaleY),
      0,
      image.naturalHeight - 1
    );
    const cropRight = clamp(
      Math.ceil((right - imageRect.left) * scaleX),
      cropLeft + 1,
      image.naturalWidth
    );
    const cropBottom = clamp(
      Math.ceil((bottom - imageRect.top) * scaleY),
      cropTop + 1,
      image.naturalHeight
    );
    const crop = {
      x: cropLeft,
      y: cropTop,
      width: cropRight - cropLeft,
      height: cropBottom - cropTop,
      coordinateSpace: "image-pixel" as const,
    };
    try {
      onSelect({
        imageDataUrl: cropToDataUrl(image, crop),
        crop,
        transferCrop: {
          x: 0,
          y: 0,
          width: crop.width,
          height: crop.height,
          coordinateSpace: "image-pixel",
        },
        imageSize: { width: image.naturalWidth, height: image.naturalHeight },
        viewportRect: toHostRect(doc, new DOMRect(left, top, right - left, bottom - top)),
      });
    } catch (error) {
      console.error("Manga crop capture failed", error);
    }
    if (!altDown) setLayerVisible(false);
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== "Alt") return;
    altDown = true;
    setLayerVisible(true);
  };
  const keyup = (event: KeyboardEvent) => {
    if (event.key !== "Alt") return;
    altDown = false;
    if (!dragging) setLayerVisible(false);
  };
  const blur = () => {
    altDown = false;
    if (!dragging) setLayerVisible(false);
  };
  const pointerdown = (event: PointerEvent) => {
    if ((!altDown && !event.altKey) || event.button !== 0) return;
    altDown = true;
    setLayerVisible(true);
    event.preventDefault();
    event.stopPropagation();
    const current = point(event);
    image = getImageForPoint(doc, event.clientX, event.clientY);
    if (!image) return;
    const imageRect = image.getBoundingClientRect();
    if (
      event.clientX < imageRect.left ||
      event.clientX > imageRect.right ||
      event.clientY < imageRect.top ||
      event.clientY > imageRect.bottom
    ) {
      return;
    }
    dragging = true;
    pointerId = event.pointerId;
    startX = current.x;
    startY = current.y;
    layer.setPointerCapture(event.pointerId);
  };
  const pointermove = (event: PointerEvent) => {
    if (!dragging) return;
    event.preventDefault();
    updateBox(event);
  };
  const pointerup = (event: PointerEvent) => {
    if (!dragging) return;
    event.preventDefault();
    finish(event);
  };
  const pointercancel = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    pointerId = null;
    selectionBox.style.display = "none";
    if (!altDown) setLayerVisible(false);
  };

  doc.addEventListener("keydown", keydown);
  doc.addEventListener("keyup", keyup);
  doc.addEventListener("pointerdown", pointerdown);
  doc.addEventListener("pointermove", pointermove);
  doc.addEventListener("pointerup", pointerup);
  doc.addEventListener("pointercancel", pointercancel);
  doc.defaultView?.addEventListener("blur", blur);
  const cleanup = () => {
    doc.removeEventListener("keydown", keydown);
    doc.removeEventListener("keyup", keyup);
    doc.removeEventListener("pointerdown", pointerdown);
    doc.removeEventListener("pointermove", pointermove);
    doc.removeEventListener("pointerup", pointerup);
    doc.removeEventListener("pointercancel", pointercancel);
    doc.defaultView?.removeEventListener("blur", blur);
    layer.remove();
    cleanups.delete(doc);
  };
  cleanups.set(doc, cleanup);
  return cleanup;
};
