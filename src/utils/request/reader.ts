import toast from "react-hot-toast";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import i18n from "../../i18n";
import { parseWithSystemOCR } from "./common";

// Mock readerRequest for backward compatibility
let readerRequest: any = undefined;

export const getReaderRequest = async () => {
  if (!readerRequest) {
    readerRequest = {
      getTransFetch: async () => ({ done: true, data: "" }),
      getAnswerFetch: async () => ({ done: true, data: "" }),
      getDictionaryFetch: async () => ({ done: true, data: [] }),
      getDictionary: async () => ({ code: 200, data: [] }),
      getOcrResult: async () => ({ code: 200, data: "" }),
      getOcrResultV2: async () => ({ code: 200, data: "" }),
      getTTSAudio: async () => null,
      getBatchTrans: async () => ({ code: 200, data: { texts: [] } }),
      analyzeText: async () => ({ code: 200, data: { results: [] } }),
      getBookMetadata: async () => ({ code: 200, data: [] }),
      getSplitSentence: async () => ({ code: 200, data: { sentences: [] } }),
      detectLanguage: async () => ({ code: 200, data: "zh" }),
    };
  }
  return readerRequest;
};

export const resetReaderRequest = () => {
  readerRequest = undefined;
};

/**
 * 划词 / 流式翻译
 * TODO(personal-local): 划词与流式翻译 - 待接入自定义 AI Provider (OpenAI/DeepSeek) 或独立翻译 API
 * 参考文档: docs/plan/LOCAL_REFACTOR_ROADMAP.md #3.1
 */
export const getTransStream = async (
  text: string,
  from: string,
  to: string,
  onMessage: (result: { text?: string; done?: boolean }) => void
): Promise<{ done: boolean; data?: any }> => {
  const customModel = ConfigService.getReaderConfig("aiTranslateModel");
  if (!customModel) {
    toast(
      i18n.t(
        "Please configure personal AI API in Setting -> AI service first"
      ),
      { id: "ai-trans-not-configured" }
    );
  }
  onMessage({ text: "", done: true });
  return { done: true, data: "" };
};

/**
 * AI 助读与划词问答
 * TODO(personal-local): AI 助读问答 - 待接入自定义 AI Provider (OpenAI/DeepSeek)
 * 参考文档: docs/plan/LOCAL_REFACTOR_ROADMAP.md #3.3
 */
export const getAnswerStream = async (
  text: string,
  question: string,
  history: any[],
  mode: string,
  onMessage: (result: { text?: string; done?: boolean }) => void
): Promise<{ done: boolean; data?: any }> => {
  const customModel = ConfigService.getReaderConfig("aiAssistanceModel");
  if (!customModel) {
    toast(
      i18n.t(
        "Please configure personal AI API in Setting -> AI service first"
      ),
      { id: "ai-assist-not-configured" }
    );
  }
  onMessage({ text: "", done: true });
  return { done: true, data: "" };
};

/**
 * 词典释义流
 * TODO(personal-local): 词典查询 - 待接入本地离线词典或自定义词典 API
 * 参考文档: docs/plan/LOCAL_REFACTOR_ROADMAP.md #3.2
 */
export const getDictionaryStream = async (
  word: string,
  from: string,
  to: string,
  sentence: string,
  isFullAnalysis: boolean,
  onMessage: (result: { text?: string; done?: boolean }) => void
): Promise<{ done: boolean; data?: any }> => {
  onMessage({ text: "", done: true });
  return { done: true, data: [] };
};

export const getDictionary = async (
  word: string,
  from: string,
  to: string
): Promise<{ code: number; data: any[] }> => {
  return { code: 200, data: [] };
};

export const getDictText = async (word: string, from: string, to: string) => {
  return "";
};

/**
 * OCR 识别
 * TODO(personal-local): OCR 文字识别 - 优先使用本地系统 OCR 引擎或 Tesseract.js
 * 参考文档: docs/plan/LOCAL_REFACTOR_ROADMAP.md #3.6
 */
export const getOcrResult = async (
  imageBase64: string
): Promise<{ code: number; data: string }> => {
  const text = await parseWithSystemOCR(imageBase64);
  return { code: 200, data: text || "" };
};

export const getOcrResultV2 = async (
  file: any
): Promise<{ code: number; data: string }> => {
  return { code: 200, data: "" };
};

/**
 * 神经语音 TTS
 * TODO(personal-local): 语音朗读 TTS - 待接入 Edge-TTS 或自定义语音合成 API
 * 参考文档: docs/plan/LOCAL_REFACTOR_ROADMAP.md #3.4
 */
export const getTTSAudio = async (
  text: string,
  language: string,
  voice: string,
  speed: number,
  pitch: number,
  isFirst: boolean
): Promise<{ code: number; data: { audio_base64?: string } } | null> => {
  // 返回 null，让调用方优雅降级到本地 Web Speech API (window.speechSynthesis)
  return null;
};

/**
 * 全文章节批量翻译
 * TODO(personal-local): 全文批量翻译 - 待接入自定义 AI Provider (OpenAI/DeepSeek) 章节批量翻译
 * 参考文档: docs/plan/LOCAL_REFACTOR_ROADMAP.md #3.1
 */
export const getBatchTrans = async (
  texts: string[],
  from: string,
  to: string
): Promise<{ code: number; data: { texts: string[] } }> => {
  const customModel = ConfigService.getReaderConfig("aiTranslateModel");
  if (!customModel) {
    toast(
      i18n.t(
        "Full-text translation requires configuring an AI API in Setting -> AI service"
      ),
      { id: "batch-trans-offline-tip" }
    );
  }
  return { code: 200, data: { texts: [] } };
};

/**
 * 页面生词释义分析
 * TODO(personal-local): 生词释义 - 待接入离线词频分词库与本地/AI释义引擎
 * 参考文档: docs/plan/LOCAL_REFACTOR_ROADMAP.md #3.2
 */
export const getWordDefinitions = async (
  texts: string[],
  level: string,
  lang: string
): Promise<{ code: number; data: { results: any[] } }> => {
  return { code: 200, data: { results: [] } };
};

/**
 * 图书元数据刮削
 * TODO(personal-local): 图书元数据刮削 - 待接入客户端直连豆瓣/Google Books API
 * 参考文档: docs/plan/LOCAL_REFACTOR_ROADMAP.md #3.5
 */
export const getBookMetadata = async (
  name: string,
  author: string
): Promise<{ code: number; data: any[] }> => {
  return { code: 200, data: [] };
};

/**
 * 语句切分
 */
export const getSplitSentence = async (
  texts: { text: string; index: number }[]
): Promise<{ code: number; data: { sentences: any[] } }> => {
  const sentences: any[] = [];
  texts.forEach((item) => {
    const parts = item.text
      .split(/([.!?。！？\n]+)/)
      .filter((s) => s.trim().length > 0);
    parts.forEach((p) => {
      sentences.push({
        text: p,
        role: "narrator",
      });
    });
  });
  return { code: 200, data: { sentences } };
};

/**
 * 语言检测
 */
export const detectLanguage = async (
  text: string
): Promise<{ code: number; data: string }> => {
  const isChinese = /[\u4e00-\u9fa5]/.test(text.slice(0, 100));
  return { code: 200, data: isChinese ? "zh" : "en" };
};
