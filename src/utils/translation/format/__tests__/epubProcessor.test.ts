import JSZip from "jszip";
import { EpubProcessor } from "../epubProcessor";
import { TxtProcessor } from "../txtProcessor";
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from "util";

const SafeTextDecoder = typeof TextDecoder !== "undefined" ? TextDecoder : NodeTextDecoder;
const SafeTextEncoder = typeof TextEncoder !== "undefined" ? TextEncoder : NodeTextEncoder;

// Helper to create a minimal valid EPUB archive in memory
async function createSampleEpubZip(options?: {
  title?: string;
  lang?: string;
  bodyHtml?: string;
}): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const title = options?.title || "Test Book";
  const lang = options?.lang || "en";
  const bodyHtml =
    options?.bodyHtml ||
    `<h1>Chapter 1: The Beginning</h1>
<p class="intro">This is the <em>first</em> paragraph with an <img src="images/cover.jpg" alt="cover" /> image.</p>
<figure><img src="images/fig1.png" /><figcaption>Figure 1</figcaption></figure>
<p style="color: red;">Second paragraph here.</p>
<pre><code>console.log("untouched code");</code></pre>
<svg><text>untouched svg text</text></svg>`;

  zip.file("mimetype", "application/epub+zip");
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookID" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${title}</dc:title>
    <dc:language>${lang}</dc:language>
  </metadata>
  <manifest>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover-image" href="images/cover.jpg" media-type="image/jpeg"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
  </spine>
</package>`
  );

  zip.file(
    "OEBPS/chapter1.xhtml",
    `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${title}</title>
</head>
<body>
${bodyHtml}
</body>
</html>`
  );

  zip.file("OEBPS/images/cover.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
  zip.file("OEBPS/images/fig1.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

  return await zip.generateAsync({ type: "arraybuffer" });
}

describe("EpubProcessor", () => {
  it("parses EPUB spine and extracts translatable leaf text nodes while filtering code and svg", async () => {
    const epubBuffer = await createSampleEpubZip();
    const parsed = await EpubProcessor.parse(epubBuffer);

    expect(parsed.title).toBe("Test Book");
    expect(parsed.language).toBe("en");
    expect(parsed.chapters.length).toBe(1);

    const chapter = parsed.chapters[0];
    const extractedTexts = chapter.nodes.map((n) => n.originalText);

    // Translatable items should include headings and paragraphs
    expect(extractedTexts).toContain("Chapter 1: The Beginning");
    expect(extractedTexts.some((t) => t.includes("Second paragraph here"))).toBe(true);

    // Non-content / excluded tags must NOT be extracted
    expect(extractedTexts.some((t) => t.includes("console.log"))).toBe(false);
    expect(extractedTexts.some((t) => t.includes("untouched svg text"))).toBe(false);
  });

  it("reconstructs EPUB in pure translation mode preserving images, classes, and styles", async () => {
    const epubBuffer = await createSampleEpubZip();
    const parsed = await EpubProcessor.parse(epubBuffer);

    const translations = new Map<string, string>();
    for (const node of parsed.chapters[0].nodes) {
      translations.set(node.id, `[译: ${node.originalText}]`);
    }

    const newBuffer = await EpubProcessor.reconstruct(
      parsed,
      translations,
      "pure",
      "测试图书（中文版）",
      "zh"
    );

    expect(newBuffer).toBeInstanceOf(ArrayBuffer);
    expect(newBuffer.byteLength).toBeGreaterThan(0);

    // Read back reconstructed EPUB and inspect XHTML
    const newZip = await JSZip.loadAsync(newBuffer);
    const opfXml = await newZip.file("OEBPS/content.opf")!.async("string");
    expect(opfXml).toContain("<dc:title>测试图书（中文版）</dc:title>");
    expect(opfXml).toContain("<dc:language>zh</dc:language>");

    const chapterXhtml = await newZip.file("OEBPS/chapter1.xhtml")!.async("string");
    // Translations injected
    expect(chapterXhtml).toContain("[译: Chapter 1: The Beginning]");
    expect(chapterXhtml).toContain("[译: Second paragraph here.]");

    // Images, classes, and styles preserved byte-for-byte / structurally
    expect(chapterXhtml).toContain('<img src="images/cover.jpg" alt="cover"');
    expect(chapterXhtml).toContain('class="intro"');
    expect(chapterXhtml).toContain('style="color: red;"');
    expect(chapterXhtml).toContain('<pre><code>console.log("untouched code");</code></pre>');

    // Binary image files still intact in zip
    expect(newZip.file("OEBPS/images/cover.jpg")).not.toBeNull();
    expect(newZip.file("OEBPS/images/fig1.png")).not.toBeNull();
  });

  it("reconstructs EPUB in bilingual mode appending subtext styling", async () => {
    const epubBuffer = await createSampleEpubZip();
    const parsed = await EpubProcessor.parse(epubBuffer);

    const translations = new Map<string, string>();
    for (const node of parsed.chapters[0].nodes) {
      translations.set(node.id, `[双语译文: ${node.originalText}]`);
    }

    const newBuffer = await EpubProcessor.reconstruct(
      parsed,
      translations,
      "bilingual",
      "Bilingual Edition",
      "zh"
    );

    const newZip = await JSZip.loadAsync(newBuffer);
    const chapterXhtml = await newZip.file("OEBPS/chapter1.xhtml")!.async("string");

    // Both original and translated text should be present
    expect(chapterXhtml).toContain("Chapter 1: The Beginning");
    expect(chapterXhtml).toContain("[双语译文: Chapter 1: The Beginning]");
    expect(chapterXhtml).toContain("koodo-translated-subtext");
  });
});

describe("TxtProcessor", () => {
  const sampleTxt = `Title: My Novel
Author: Alice

第1章 冒险的开端
This is paragraph one of chapter one.
This is paragraph two of chapter one.

第2章 迷雾重重
This is paragraph one of chapter two.
This is paragraph two of chapter two.`;

  it("parses TXT chapters via regex and segments paragraphs", () => {
    const parsed = TxtProcessor.parse(sampleTxt);
    expect(parsed.chapters.length).toBe(2);
    expect(parsed.chapters[0].title).toContain("第1章");
    expect(parsed.chapters[1].title).toContain("第2章");
    expect(parsed.chapters[0].nodes.length).toBeGreaterThanOrEqual(2);
  });

  it("reconstructs TXT in pure and bilingual modes", () => {
    const parsed = TxtProcessor.parse(sampleTxt);
    const translations = new Map<string, string>();
    let counter = 1;
    for (const chapter of parsed.chapters) {
      for (const node of chapter.nodes) {
        translations.set(node.id, `中文译文段落_${counter++}`);
      }
    }

    // Pure mode
    const pureBuffer = TxtProcessor.reconstruct(parsed, translations, "pure");
    const pureText = new SafeTextDecoder().decode(pureBuffer);
    expect(pureText).toContain("中文译文段落_");
    expect(pureText).not.toContain("This is paragraph one of chapter one.");

    // Bilingual mode
    const bilingualBuffer = TxtProcessor.reconstruct(parsed, translations, "bilingual");
    const bilingualText = new SafeTextDecoder().decode(bilingualBuffer);
    expect(bilingualText).toContain("This is paragraph one of chapter one.");
    expect(bilingualText).toContain("中文译文段落_");
  });
});
