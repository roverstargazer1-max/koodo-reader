import { TranslationLayoutMode, TranslatableTextNode } from "../types";
import { ParsedTxtBook, ParsedTxtChapter } from "./types";

const CHAPTER_SPLIT_REGEX =
  /(?:^|\r?\n)(?=(?:第[0-9一二三四五六七八九十百千万]+[章回节卷]|Chapter\s+\d+|SECTION\s+\d+|[Cc]hapter\s+[IVXLCDM]+)[^\r\n]*)/i;

const CHAPTER_TITLE_REGEX =
  /^(?:第[0-9一二三四五六七八九十百千万]+[章回节卷]|Chapter\s+\d+|SECTION\s+\d+|[Cc]hapter\s+[IVXLCDM]+)[^\r\n]*/i;

function getTextEncoder(): TextEncoder {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder();
  }
  return new (globalThis as any).TextEncoder();
}

function getTextDecoder(): TextDecoder {
  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder("utf-8");
  }
  return new (globalThis as any).TextDecoder("utf-8");
}

export class TxtProcessor {
  /**
   * Ingest text content or ArrayBuffer and parse into structured chapters & paragraphs.
   */
  static parse(content: string | ArrayBuffer): ParsedTxtBook {
    let rawText = "";
    if (typeof content === "string") {
      rawText = content;
    } else {
      rawText = getTextDecoder().decode(content);
    }

    // Normalize newlines
    const normalized = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    // Split text by chapter regex
    const chapterSplits = normalized.split(CHAPTER_SPLIT_REGEX).filter(Boolean);

    let headerText = "";
    let chaptersRaw: string[] = [];

    if (chapterSplits.length > 1) {
      // If the first section before the first chapter header doesn't match a chapter header, treat as book header/metadata
      if (!CHAPTER_TITLE_REGEX.test(chapterSplits[0].trim())) {
        headerText = chapterSplits[0].trim();
        chaptersRaw = chapterSplits.slice(1);
      } else {
        chaptersRaw = chapterSplits;
      }
    } else {
      // No chapter pattern found: fallback to virtual chapter chunking
      const allParagraphs = normalized
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      const PARAS_PER_CHAPTER = 50;
      chaptersRaw = [];
      for (let i = 0; i < allParagraphs.length; i += PARAS_PER_CHAPTER) {
        const slice = allParagraphs.slice(i, i + PARAS_PER_CHAPTER);
        chaptersRaw.push(
          `Chapter ${Math.floor(i / PARAS_PER_CHAPTER) + 1}\n\n` +
            slice.join("\n\n")
        );
      }
    }

    const chapters: ParsedTxtChapter[] = [];

    for (let cIdx = 0; cIdx < chaptersRaw.length; cIdx++) {
      const rawSection = chaptersRaw[cIdx].trim();
      const rawLines = rawSection
        .split(/\n+/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      let chapterTitle = `Chapter ${cIdx + 1}`;
      let bodyLines = rawLines;

      if (rawLines.length > 0 && CHAPTER_TITLE_REGEX.test(rawLines[0])) {
        chapterTitle = rawLines[0];
        bodyLines = rawLines.slice(1);
      }

      const nodes: TranslatableTextNode[] = [];
      let pIdx = 0;

      // Add chapter title as translatable node
      const titleNodeId = `c${cIdx}_title`;
      nodes.push({
        id: titleNodeId,
        originalText: chapterTitle,
        isHeading: true,
      });

      // Add paragraphs
      for (const line of bodyLines) {
        nodes.push({
          id: `c${cIdx}_p${pIdx++}`,
          originalText: line,
          isHeading: false,
        });
      }

      chapters.push({
        index: cIdx,
        id: `txt_chap_${cIdx}`,
        title: chapterTitle,
        nodes,
        rawParagraphs: bodyLines,
      });
    }

    const title = chapters[0]?.title || "Untitled Text Book";

    return {
      title,
      headerText,
      chapters,
    };
  }

  /**
   * Reconstruct TXT into pure or bilingual UTF-8 ArrayBuffer.
   */
  static reconstruct(
    parsedTxt: ParsedTxtBook,
    translations: Map<string, string>,
    mode: TranslationLayoutMode
  ): ArrayBuffer {
    const lines: string[] = [];

    if (parsedTxt.headerText) {
      lines.push(parsedTxt.headerText);
      lines.push("");
    }

    for (const chapter of parsedTxt.chapters) {
      // Chapter title
      const titleNode = chapter.nodes.find((n) => n.isHeading);
      const translatedTitle = titleNode
        ? translations.get(titleNode.id)
        : undefined;

      if (mode === "pure") {
        lines.push(translatedTitle || chapter.title);
      } else {
        if (translatedTitle && translatedTitle !== chapter.title) {
          lines.push(`${chapter.title} (${translatedTitle})`);
        } else {
          lines.push(chapter.title);
        }
      }
      lines.push("");

      // Paragraphs
      const contentNodes = chapter.nodes.filter((n) => !n.isHeading);
      for (const node of contentNodes) {
        const translated = translations.get(node.id);

        if (mode === "pure") {
          lines.push(translated || node.originalText);
          lines.push("");
        } else {
          lines.push(node.originalText);
          if (translated) {
            lines.push(`【译】${translated}`);
          }
          lines.push("");
        }
      }
      lines.push("----------------------------------------");
      lines.push("");
    }

    const outputText = lines.join("\n");
    return getTextEncoder().encode(outputText).buffer;
  }
}
