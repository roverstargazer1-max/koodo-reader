import JSZip from "jszip";
import { TranslationLayoutMode, TranslatableTextNode } from "../types";
import {
  ParsedEpubBook,
  ParsedEpubChapter,
} from "./types";

const EXCLUDED_TAGS = new Set([
  "style",
  "script",
  "pre",
  "code",
  "svg",
  "noscript",
]);

export class EpubProcessor {
  /**
   * Parse an EPUB file buffer, inspect its OPF spine, and extract translatable leaf text nodes.
   */
  static async parse(buffer: ArrayBuffer): Promise<ParsedEpubBook> {
    const zip = await JSZip.loadAsync(buffer);

    // 1. Locate rootfile from META-INF/container.xml
    const containerEntry = zip.file("META-INF/container.xml");
    if (!containerEntry) {
      throw new Error("Invalid EPUB: Missing META-INF/container.xml");
    }

    const containerXml = await containerEntry.async("string");
    const containerDoc = new DOMParser().parseFromString(
      containerXml,
      "application/xml"
    );
    const rootfileEl =
      containerDoc.querySelector("rootfile") ||
      containerDoc.getElementsByTagName("rootfile")[0];
    if (!rootfileEl) {
      throw new Error("Invalid EPUB: Missing rootfile in container.xml");
    }

    const opfPath = rootfileEl.getAttribute("full-path");
    if (!opfPath) {
      throw new Error("Invalid EPUB: Missing full-path in container.xml");
    }

    const opfEntry = zip.file(opfPath);
    if (!opfEntry) {
      throw new Error(`Invalid EPUB: Missing OPF file at ${opfPath}`);
    }

    // 2. Parse OPF document
    const opfDir = opfPath.includes("/")
      ? opfPath.substring(0, opfPath.lastIndexOf("/") + 1)
      : "";
    const opfXml = await opfEntry.async("string");
    const opfDoc = new DOMParser().parseFromString(opfXml, "application/xml");

    // Extract title & language
    const titleEl =
      opfDoc.querySelector("dc\\:title") ||
      opfDoc.getElementsByTagName("dc:title")[0] ||
      opfDoc.getElementsByTagName("title")[0];
    const langEl =
      opfDoc.querySelector("dc\\:language") ||
      opfDoc.getElementsByTagName("dc:language")[0] ||
      opfDoc.getElementsByTagName("language")[0];

    const title = titleEl?.textContent?.trim() || "Untitled Book";
    const language = langEl?.textContent?.trim() || "auto";

    // Build manifest map
    const manifestItems = new Map<string, { href: string; mediaType: string }>();
    const itemEls = Array.from(opfDoc.querySelectorAll("manifest > item, item"));
    for (const item of itemEls) {
      const id = item.getAttribute("id");
      const href = item.getAttribute("href");
      const mediaType = item.getAttribute("media-type") || "";
      if (id && href) {
        manifestItems.set(id, { href, mediaType });
      }
    }

    // Extract spine order
    const spineItems: string[] = [];
    const itemrefEls = Array.from(
      opfDoc.querySelectorAll("spine > itemref, itemref")
    );
    for (const ref of itemrefEls) {
      const idref = ref.getAttribute("idref");
      if (idref) {
        spineItems.push(idref);
      }
    }

    // 3. Process each spine item (XHTML chapter)
    const chapters: ParsedEpubChapter[] = [];
    let chapterIndex = 0;

    for (const idref of spineItems) {
      const manifestEntry = manifestItems.get(idref);
      if (!manifestEntry) continue;

      const relativeHref = manifestEntry.href;
      const fullPath = opfDir + relativeHref;
      const fileEntry = zip.file(fullPath);
      if (!fileEntry) continue;

      const rawText = await fileEntry.async("string");
      let doc = new DOMParser().parseFromString(rawText, "application/xhtml+xml");
      if (doc.querySelector("parsererror")) {
        doc = new DOMParser().parseFromString(rawText, "text/html");
      }

      // Extract translatable nodes
      const nodeMap = new Map<string, Node>();
      const nodes: TranslatableTextNode[] = [];
      let nodeCounter = 0;

      const walk = (currentNode: Node) => {
        if (currentNode.nodeType === Node.ELEMENT_NODE) {
          const tagName = (currentNode as Element).tagName.toLowerCase();
          if (EXCLUDED_TAGS.has(tagName)) {
            return; // Skip script, style, pre, code, svg, noscript
          }
        }

        if (currentNode.nodeType === Node.TEXT_NODE) {
          const raw = currentNode.nodeValue || "";
          const trimmed = raw.trim();
          if (trimmed.length > 0) {
            const nodeId = `c${chapterIndex}_n${nodeCounter++}`;
            nodeMap.set(nodeId, currentNode);

            const parent = currentNode.parentElement;
            const parentTag = parent?.tagName.toLowerCase() || "";
            const isHeading = /^h[1-6]$/.test(parentTag);

            nodes.push({
              id: nodeId,
              originalText: trimmed,
              isHeading,
            });
          }
          return;
        }

        // Recursively traverse child nodes
        for (let i = 0; i < currentNode.childNodes.length; i++) {
          walk(currentNode.childNodes[i]);
        }
      };

      walk(doc.body || doc.documentElement);

      // Derive chapter title
      const headingNode = nodes.find((n) => n.isHeading);
      const chapterTitle =
        headingNode?.originalText ||
        doc.title?.trim() ||
        `Chapter ${chapterIndex + 1}`;

      chapters.push({
        index: chapterIndex,
        id: idref,
        title: chapterTitle,
        href: fullPath,
        nodes,
        doc,
        rawText,
        nodeMap,
      });

      chapterIndex++;
    }

    return {
      title,
      language,
      chapters,
      zip,
      opfPath,
      opfDoc,
    };
  }

  /**
   * Safe reconstitution of EPUB with translations.
   */
  static async reconstruct(
    parsedEpub: ParsedEpubBook,
    translations: Map<string, string>,
    mode: TranslationLayoutMode,
    newTitle?: string,
    targetLang?: string
  ): Promise<ArrayBuffer> {
    const { zip, chapters, opfPath, opfDoc } = parsedEpub;
    const serializer = new XMLSerializer();

    // 1. Update OPF metadata
    if (newTitle) {
      let titleEl =
        opfDoc.querySelector("dc\\:title") ||
        opfDoc.getElementsByTagName("dc:title")[0] ||
        opfDoc.getElementsByTagName("title")[0];
      if (titleEl) {
        titleEl.textContent = newTitle;
      }
    }

    if (targetLang) {
      let langEl =
        opfDoc.querySelector("dc\\:language") ||
        opfDoc.getElementsByTagName("dc:language")[0] ||
        opfDoc.getElementsByTagName("language")[0];
      if (langEl) {
        langEl.textContent = targetLang;
      }
    }

    zip.file(opfPath, serializer.serializeToString(opfDoc));

    // 2. Inject translations into each chapter's DOM
    for (const chapter of chapters) {
      const { doc, nodeMap, nodes, href } = chapter;

      // Ensure bilingual stylesheet is injected if in bilingual mode
      if (mode === "bilingual") {
        let styleTag = doc.getElementById("koodo-translation-styles");
        if (!styleTag) {
          styleTag = doc.createElement("style");
          styleTag.id = "koodo-translation-styles";
          styleTag.textContent = `
            .koodo-translated-subtext {
              display: block;
              margin-top: 0.35em;
              margin-bottom: 0.35em;
              color: #555555;
              font-size: 0.95em;
              line-height: 1.5;
              font-weight: normal;
            }
          `;
          if (doc.head) {
            doc.head.appendChild(styleTag);
          } else if (doc.body) {
            doc.body.insertBefore(styleTag, doc.body.firstChild);
          }
        }
      }

      for (const item of nodes) {
        const translated = translations.get(item.id);
        if (!translated) continue;

        const textNode = nodeMap.get(item.id);
        if (!textNode || !textNode.parentNode) continue;

        if (mode === "pure") {
          // Replace nodeValue directly, preserving parent elements, styles, images untouched
          textNode.nodeValue = translated;
        } else {
          // Bilingual mode: append translated element adjacent to original text node
          const subtextSpan = doc.createElement("span");
          subtextSpan.className = "koodo-translated-subtext";
          subtextSpan.setAttribute(
            "style",
            "display: block; margin-top: 0.35em; margin-bottom: 0.35em; color: #555; font-size: 0.95em; line-height: 1.5; font-weight: normal;"
          );
          subtextSpan.textContent = translated;

          // Insert right after original text node
          textNode.parentNode.insertBefore(subtextSpan, textNode.nextSibling);
        }
      }

      // Serialize back to XHTML and update ZIP
      const serializedChapter = serializer.serializeToString(doc);
      zip.file(href, serializedChapter);
    }

    return await zip.generateAsync({
      type: "arraybuffer",
      mimeType: "application/epub+zip",
    });
  }
}
