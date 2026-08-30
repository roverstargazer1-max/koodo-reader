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

export interface MangaPageCapture {
  imageDataUrl: string;
  imageSize: { width: number; height: number };
  viewportRect: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

export interface MangaTextRegion {
  id: string;
  pageId?: string | null;
  imageSha256?: string | null;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
    space: "image-pixel";
  };
  bboxNorm?: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  polygon?: Array<{ x: number; y: number }> | null;
  sourceText: string;
  translatedText?: string | null;
  confidence?: number | null;
  type?: "dialogue" | "narration" | "sfx" | "other" | null;
  orientation?: "vertical" | "horizontal" | "unknown" | null;
  readingOrder?: number | null;
  engines?: Record<string, string> | null;
  cacheIdentity?: string | null;
}

export interface MangaPageAnalyzeResult {
  contractVersion: "1";
  requestId: string;
  pageId?: string | null;
  imageSize: { width: number; height: number };
  regions: MangaTextRegion[];
  detector: string;
  ocrEngine: string;
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
    case "detector_unavailable":
      return "Page detection runtime is not installed. Run setup-page-analysis.ps1 first.";
    case "detector_model_missing":
    case "detector_model_path_required":
      return "Page detector model is not installed. Run setup-page-analysis.ps1 -Warmup and retry.";
    case "detector_model_download_unavailable":
    case "detector_model_download_failed":
      return "Page detector model could not be downloaded. Configure a model endpoint or install the model manually.";
    case "detector_backend_unsupported":
      return "The configured page detection backend is not supported.";
    case "detector_import_failed":
    case "detector_failed":
      return "Page detection failed. Check the Manga AI sidecar logs and retry.";
    case "mask_unsupported":
      return "Page masks are not available in this build yet.";
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

export const analyzeMangaPage = async (
  page: MangaPageCapture,
  options: {
    pageId?: string;
    sourceLanguage?: string;
    readingDirection?: "rtl" | "ltr" | "auto";
    detector?: "manga-translator" | "none";
  } = {}
): Promise<MangaPageAnalyzeResult> => {
  const result = await getElectronApi().invoke("manga-ai-analyze-page", {
    contractVersion: "1",
    requestId: createRequestId(),
    image: { dataUrl: page.imageDataUrl },
    pageId: options.pageId,
    sourceLanguage: options.sourceLanguage,
    readingDirection: options.readingDirection || "auto",
    detector: options.detector || "manga-translator",
    ocrEngine: "manga-ocr",
    includeMask: false,
  });
  if (!result || result.error) {
    const error = new Error(
      result?.error?.message || "Manga AI page analysis failed"
    ) as Error & { code?: string };
    error.code = result?.error?.code;
    throw error;
  }
  return result as MangaPageAnalyzeResult;
};
