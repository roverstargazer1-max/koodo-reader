export interface MangaPixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
  coordinateSpace: "image-pixel";
}

export interface MangaOcrSelection {
  imageDataUrl: string;
  crop: MangaPixelCrop;
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
    crop: selection.crop,
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
