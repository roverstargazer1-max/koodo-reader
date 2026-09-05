import { ParsedChapter, TranslationLayoutMode } from "../types";
import JSZip from "jszip";

export interface ParsedEpubChapter extends ParsedChapter {
  href: string;
  doc: Document;
  rawText: string;
  nodeMap: Map<string, Node>;
}

export interface ParsedEpubBook {
  title: string;
  language: string;
  chapters: ParsedEpubChapter[];
  zip: JSZip;
  opfPath: string;
  opfDoc: Document;
}

export interface ParsedTxtChapter extends ParsedChapter {
  rawParagraphs: string[];
}

export interface ParsedTxtBook {
  title: string;
  headerText: string;
  chapters: ParsedTxtChapter[];
}
