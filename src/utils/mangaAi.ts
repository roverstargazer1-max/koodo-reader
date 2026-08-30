export interface MangaPixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
  coordinateSpace: "image-pixel";
}

export interface MangaOcrSelection {
  imageDataUrl: string;
  /** Geometry of the selected text on the original manga page. */
  crop: MangaPixelCrop;
  /** Geometry inside imageDataUrl, which may be a compact image crop. */
  transferCrop: MangaPixelCrop;
  imageSize: { width: number; height: number };
  viewportRect: { left: number; top: number; width: number; height: number };
}

export interface MangaOcrResult {
  contractVersion: "1";
  requestId: string;
  sourceText: string;
  engine: string;
  imageSize: [number, number];
  crop: MangaPixelCrop;
}

export interface MangaAiStatus {
  running: boolean;
  port: number | null;
  error: string | null;
}

export const getMangaOcrErrorMessage = (error: any): string => {
  switch (error?.code) {
    case "ocr_engine_unavailable":
      return "Manga OCR runtime is not installed. Run setup-region-ocr.ps1 first.";
    case "ocr_model_load_failed":
      return "Manga OCR model is not ready. Run setup-region-ocr.ps1 -Warmup and retry.";
    case "sidecar_timeout":
      return "Manga OCR timed out. Warm the model and try again.";
    default:
      return error?.message || String(error);
  }
};

const createRequestId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
};

const getElectronApi = () => {
  const api = (window as any).electronAPI;
  if (!api || typeof api.invoke !== "function") {
    throw new Error("Manga AI requires the Electron desktop runtime");
  }
  return api;
};

export const getMangaAiStatus = async (): Promise<MangaAiStatus> => {
  return getElectronApi().invoke("manga-ai-status");
};

export const ocrMangaRegion = async (
  selection: MangaOcrSelection,
  sourceLanguage?: string
): Promise<MangaOcrResult> => {
  const result = await getElectronApi().invoke("manga-ai-ocr-region", {
    contractVersion: "1",
    requestId: createRequestId(),
    image: { dataUrl: selection.imageDataUrl },
    crop: selection.transferCrop,
    sourceRegion: {
      imageSize: selection.imageSize,
      crop: selection.crop,
    },
    sourceLanguage: sourceLanguage || undefined,
    ocrEngine: "manga-ocr",
  });
  if (!result || result.error) {
    const error = new Error(
      result?.error?.message || "Manga AI OCR request failed"
    ) as Error & { code?: string };
    error.code = result?.error?.code;
    throw error;
  }
  return result as MangaOcrResult;
};
