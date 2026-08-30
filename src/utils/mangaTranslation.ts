import {
  CommonTool,
  ConfigService,
  KookitConfig,
} from "../assets/lib/kookit-extra-browser.min";
import { MangaTextRegion } from "./mangaAi";
import { aiRequest } from "./request/common";

const MAX_CACHE_ENTRIES = 512;
const PAGE_TRANSLATION_BATCH_SIZE = 8;
const translationCache = new Map<string, string>();

export interface MangaTranslationOptions {
  sourceLanguage?: string;
  targetLanguage?: string;
}

interface MangaAiModelConfig {
  endpoint: string;
  modelId: string;
  apiKey?: string;
  providerId?: string;
}

export class MangaTranslationError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MangaTranslationError";
    this.code = code;
  }
}

const normalizeLanguage = (value: string | undefined, fallback: string) => {
  const trimmed = (value || "").trim();
  if (!trimmed || trimmed.toLowerCase() === "auto") return fallback;
  return trimmed;
};

const replacePromptToken = (prompt: string, token: string, value: string) =>
  prompt.split(token).join(value);

const getTranslationLanguages = (options: MangaTranslationOptions) => ({
  sourceLanguage: normalizeLanguage(
    options.sourceLanguage || ConfigService.getReaderConfig("transSource"),
    "Automatic"
  ),
  targetLanguage: normalizeLanguage(
    options.targetLanguage || ConfigService.getReaderConfig("transTarget"),
    "English"
  ),
});

const parseModelConfig = (value: unknown): MangaAiModelConfig | null => {
  if (typeof value === "string") {
    try {
      return parseModelConfig(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const config = value as Record<string, unknown>;
  if (
    typeof config.endpoint !== "string" ||
    typeof config.modelId !== "string" ||
    !config.endpoint.trim() ||
    !config.modelId.trim()
  ) {
    return null;
  }
  return {
    endpoint: config.endpoint.trim(),
    modelId: config.modelId.trim(),
    apiKey: typeof config.apiKey === "string" ? config.apiKey : "",
    providerId: typeof config.providerId === "string" ? config.providerId : "",
  };
};

const getConfiguredModel = (): { key: string; config: MangaAiModelConfig } => {
  // Manga can opt into a different configured model without duplicating the
  // provider, endpoint, or credential store. An empty override inherits the
  // existing text-translation model for backward compatibility.
  const key =
    ConfigService.getReaderConfig("mangaTranslateModel") ||
    ConfigService.getReaderConfig("aiTranslateModel") ||
    "";
  if (!key) {
    throw new MangaTranslationError(
      "manga_translation_model_missing",
      "Choose an AI or Manga translation model in Settings > AI before translating manga."
    );
  }
  const entry = ConfigService.getObjectConfig(key, "aiModelConfig", null);
  const config = parseModelConfig((entry as any)?.config);
  if (!config) {
    throw new MangaTranslationError(
      "manga_translation_model_invalid",
      "The selected AI translation model is incomplete. Update it in Settings > AI."
    );
  }
  return { key, config };
};

/**
 * Region OCR stays useful without a remote model. Check configuration before
 * starting the optional automatic translation step so an OCR-only reader is
 * not shown a transient provider error.
 */
export const shouldAutoTranslateMangaRegion = (): boolean => {
  if (ConfigService.getReaderConfig("isAutoMangaTranslate") === "no") {
    return false;
  }
  try {
    getConfiguredModel();
    return true;
  } catch {
    return false;
  }
};

const chatCompletionsUrl = (endpoint: string) => {
  const normalized = endpoint.replace(/\/+$/, "");
  return /\/chat\/completions$/i.test(normalized)
    ? normalized
    : `${normalized}/chat/completions`;
};

const contentToString = (content: unknown): string => {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const item = part as Record<string, unknown>;
      return typeof item.text === "string"
        ? item.text
        : typeof item.content === "string"
          ? item.content
          : "";
    })
    .join("")
    .trim();
};

const responseText = (payload: unknown): string => {
  if (!payload || typeof payload !== "object") return "";
  const data = payload as Record<string, any>;
  const choice = Array.isArray(data.choices) ? data.choices[0] : null;
  const value =
    choice?.message?.content ??
    choice?.text ??
    data.output_text ??
    data.output?.[0]?.content;
  return contentToString(value);
};

const renderConfiguredPrompt = (
  text: string,
  sourceLanguage: string,
  targetLanguage: string
) => {
  let prompt =
    ConfigService.getReaderConfig("aiTranslatePrompt") ||
    KookitConfig.DefaultPrompts.aiTranslate;
  prompt = replacePromptToken(prompt, "{from}", sourceLanguage);
  prompt = replacePromptToken(prompt, "{to}", targetLanguage);
  return replacePromptToken(prompt, "{text}", text);
};

const requestCompletion = async (prompt: string): Promise<string> => {
  const { config } = getConfiguredModel();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  const response = await aiRequest(
    chatCompletionsUrl(config.endpoint),
    "POST",
    headers,
    JSON.stringify({
      model: config.modelId,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      ...CommonTool.getDisableThinkingParams(config.providerId || ""),
    })
  );
  if (!response.ok) {
    throw new MangaTranslationError(
      "manga_translation_request_failed",
      `AI translation request failed (HTTP ${response.status}).`
    );
  }
  let data: unknown;
  try {
    data = JSON.parse(response.body);
  } catch {
    throw new MangaTranslationError(
      "manga_translation_response_invalid",
      "The AI translation provider returned invalid JSON."
    );
  }
  const text = responseText(data);
  if (!text) {
    throw new MangaTranslationError(
      "manga_translation_response_invalid",
      "The AI translation provider returned no translated text."
    );
  }
  return text;
};

const cacheKeyFor = (
  modelKey: string,
  sourceLanguage: string,
  targetLanguage: string,
  sourceText: string
) => `${modelKey}\u0000${sourceLanguage}\u0000${targetLanguage}\u0000${sourceText}`;

const readCachedTranslation = (key: string) => translationCache.get(key);

const cacheTranslation = (key: string, translatedText: string) => {
  if (translationCache.size >= MAX_CACHE_ENTRIES) translationCache.clear();
  translationCache.set(key, translatedText);
};

const stripJsonFence = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
};

const parseBatchTranslations = (
  value: string,
  expectedIds: Set<string>
): Map<string, string> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(value));
  } catch {
    throw new MangaTranslationError(
      "manga_translation_response_invalid",
      "The AI translation provider did not return the required JSON mapping."
    );
  }
  const translations = new Map<string, string>();
  const add = (id: unknown, text: unknown) => {
    if (
      typeof id === "string" &&
      expectedIds.has(id) &&
      typeof text === "string" &&
      text.trim()
    ) {
      translations.set(id, text.trim());
    }
  };
  if (Array.isArray(parsed)) {
    parsed.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const record = item as Record<string, unknown>;
      add(record.id, record.translatedText ?? record.translation ?? record.text);
    });
  } else if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    const list = Array.isArray(record.translations) ? record.translations : null;
    if (list) {
      list.forEach((item) => {
        if (!item || typeof item !== "object") return;
        const entry = item as Record<string, unknown>;
        add(entry.id, entry.translatedText ?? entry.translation ?? entry.text);
      });
    } else {
      Object.entries(record).forEach(([id, item]) => {
        add(
          id,
          item && typeof item === "object"
            ? (item as Record<string, unknown>).translatedText ??
                (item as Record<string, unknown>).translation ??
                (item as Record<string, unknown>).text
            : item
        );
      });
    }
  }
  if (translations.size !== expectedIds.size) {
    throw new MangaTranslationError(
      "manga_translation_response_invalid",
      "The AI translation provider omitted one or more manga regions."
    );
  }
  return translations;
};

export const getMangaTranslationErrorMessage = (error: unknown): string => {
  const code = (error as { code?: string } | undefined)?.code;
  switch (code) {
    case "manga_translation_model_missing":
    case "manga_translation_model_invalid":
      return error instanceof Error ? error.message : "Configure an AI translation model first.";
    case "manga_translation_request_failed":
      return "The AI translation provider rejected the request. Check its endpoint, key, and model.";
    case "manga_translation_response_invalid":
      return "The AI translation provider returned an unusable response. Try another model or retry.";
    default:
      return error instanceof Error ? error.message : "Manga translation failed.";
  }
};

export const translateMangaText = async (
  sourceText: string,
  options: MangaTranslationOptions = {}
): Promise<string> => {
  const text = sourceText.trim();
  if (!text) return "";
  const { key } = getConfiguredModel();
  const { sourceLanguage, targetLanguage } = getTranslationLanguages(options);
  const cacheKey = cacheKeyFor(key, sourceLanguage, targetLanguage, text);
  const cached = readCachedTranslation(cacheKey);
  if (cached) return cached;
  const prompt = [
    renderConfiguredPrompt(text, sourceLanguage, targetLanguage),
    "\nManga context: preserve dialogue tone, names, punctuation, and line breaks when possible.",
  ].join("\n");
  const translatedText = await requestCompletion(prompt);
  cacheTranslation(cacheKey, translatedText);
  return translatedText;
};

export const translateMangaRegions = async (
  regions: MangaTextRegion[],
  options: MangaTranslationOptions = {}
): Promise<MangaTextRegion[]> => {
  if (!regions.length) return [];
  const { key } = getConfiguredModel();
  const { sourceLanguage, targetLanguage } = getTranslationLanguages(options);
  const translated = new Map<string, string>();
  const pending: MangaTextRegion[] = [];

  regions.forEach((region) => {
    const sourceText = region.sourceText.trim();
    if (!sourceText) return;
    const cacheKey = cacheKeyFor(key, sourceLanguage, targetLanguage, sourceText);
    const cached = readCachedTranslation(cacheKey);
    if (cached) translated.set(region.id, cached);
    else pending.push(region);
  });

  for (let index = 0; index < pending.length; index += PAGE_TRANSLATION_BATCH_SIZE) {
    const batch = pending.slice(index, index + PAGE_TRANSLATION_BATCH_SIZE);
    const payload = batch.map((region) => ({
      id: region.id,
      text: region.sourceText,
      readingOrder: region.readingOrder ?? null,
      type: region.type ?? "other",
      orientation: region.orientation ?? "unknown",
    }));
    const prompt = [
      renderConfiguredPrompt(JSON.stringify(payload), sourceLanguage, targetLanguage),
      "\nThis is a manga page. Return ONLY a JSON object mapping every input id to its translated text.",
      "Do not include markdown, explanations, source text, or IDs that were not supplied.",
      "Preserve each dialogue region independently while using readingOrder as context.",
    ].join("\n");
    let batchTranslations: Map<string, string>;
    try {
      batchTranslations = parseBatchTranslations(
        await requestCompletion(prompt),
        new Set(batch.map((region) => region.id))
      );
    } catch (error) {
      if (
        !(error instanceof MangaTranslationError) ||
        error.code !== "manga_translation_response_invalid"
      ) {
        throw error;
      }
      // Some OpenAI-compatible models ignore the JSON contract. Preserve a
      // usable page by retrying those regions through the proven single-text path.
      batchTranslations = new Map();
      for (const region of batch) {
        batchTranslations.set(
          region.id,
          await translateMangaText(region.sourceText, {
            sourceLanguage,
            targetLanguage,
          })
        );
      }
    }
    batch.forEach((region) => {
      const translatedText = batchTranslations.get(region.id) || "";
      if (!translatedText) return;
      translated.set(region.id, translatedText);
      cacheTranslation(
        cacheKeyFor(key, sourceLanguage, targetLanguage, region.sourceText.trim()),
        translatedText
      );
    });
  }

  return regions.map((region) => ({
    ...region,
    translatedText: translated.get(region.id) || region.translatedText || null,
  }));
};

export const clearMangaTranslationCache = () => translationCache.clear();
