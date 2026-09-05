import { isElectron } from "react-device-detect";
import { L4RAGPair } from "./types";

declare var window: any;

function getSafeStoragePath(): string {
  if (
    typeof window !== "undefined" &&
    isElectron &&
    window?.electronAPI?.sendSync
  ) {
    try {
      return (
        window.localStorage?.getItem("storageLocation") ||
        window.electronAPI.sendSync("storage-location", "ping") ||
        ""
      );
    } catch {
      return "";
    }
  }
  return "";
}

export interface IFtsCorpus {
  recordPairs(
    bookKey: string,
    pairs: { source: string; target: string }[]
  ): Promise<void>;
  querySimilar(
    bookKey: string,
    queryText: string,
    topK?: number
  ): Promise<L4RAGPair[]>;
}

export class InMemoryFtsCorpus implements IFtsCorpus {
  private records: Array<{
    bookKey: string;
    source: string;
    target: string;
  }> = [];

  async recordPairs(
    bookKey: string,
    pairs: { source: string; target: string }[]
  ): Promise<void> {
    for (const pair of pairs) {
      if (pair.source?.trim() && pair.target?.trim()) {
        this.records.push({
          bookKey,
          source: pair.source.trim(),
          target: pair.target.trim(),
        });
      }
    }
  }

  async querySimilar(
    bookKey: string,
    queryText: string,
    topK: number = 3
  ): Promise<L4RAGPair[]> {
    if (!queryText?.trim()) return [];

    // Extract search keywords (words of >= 2 chars or CJK characters)
    const tokens = (
      queryText.toLowerCase().match(/[a-z0-9_-]{2,}|[\u4e00-\u9fa5]/gi) || []
    ).filter(Boolean);

    if (tokens.length === 0) return [];

    const tokenSet = new Set(tokens);
    const scored: Array<{ source: string; target: string; score: number }> = [];

    for (const record of this.records) {
      if (record.bookKey !== bookKey) continue;

      const sourceTokens =
        record.source.toLowerCase().match(/[a-z0-9_-]{2,}|[\u4e00-\u9fa5]/gi) ||
        [];
      let matches = 0;
      for (const t of sourceTokens) {
        if (tokenSet.has(t)) {
          matches++;
        }
      }

      if (matches > 0) {
        scored.push({
          source: record.source,
          target: record.target,
          score: matches,
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, topK).map((item) => ({
      sourceText: item.source,
      targetText: item.target,
      score: item.score,
    }));
  }
}

export class ElectronSqliteFtsCorpus implements IFtsCorpus {
  private inMemoryFallback = new InMemoryFtsCorpus();
  private initialized = false;

  private async ensureInitialized(): Promise<boolean> {
    if (this.initialized) return true;
    if (
      !isElectron ||
      typeof window === "undefined" ||
      !window?.electronAPI?.invoke
    ) {
      return false;
    }

    try {
      await window.electronAPI.invoke("custom-database-command", {
        query: `CREATE VIRTUAL TABLE IF NOT EXISTS translation_fts USING fts5(book_key, source_text, target_text);`,
        executeType: "run",
        data: [],
        dbName: "books",
        storagePath: getSafeStoragePath(),
      });
      this.initialized = true;
      return true;
    } catch (e) {
      console.warn("FTS5 table initialization failed, using fallback:", e);
      return false;
    }
  }

  async recordPairs(
    bookKey: string,
    pairs: { source: string; target: string }[]
  ): Promise<void> {
    const isReady = await this.ensureInitialized();
    if (!isReady) {
      return this.inMemoryFallback.recordPairs(bookKey, pairs);
    }

    for (const pair of pairs) {
      if (!pair.source?.trim() || !pair.target?.trim()) continue;
      try {
        await window.electronAPI.invoke("custom-database-command", {
          query: `INSERT INTO translation_fts(book_key, source_text, target_text) VALUES(?, ?, ?);`,
          executeType: "run",
          data: [bookKey, pair.source.trim(), pair.target.trim()],
          dbName: "books",
          storagePath: getSafeStoragePath(),
        });
      } catch (e) {
        console.warn("Failed to insert FTS record:", e);
      }
    }
  }

  async querySimilar(
    bookKey: string,
    queryText: string,
    topK: number = 3
  ): Promise<L4RAGPair[]> {
    const isReady = await this.ensureInitialized();
    if (!isReady) {
      return this.inMemoryFallback.querySimilar(bookKey, queryText, topK);
    }

    // Sanitize query tokens for FTS5 syntax
    const tokens = (
      queryText.toLowerCase().match(/[a-z0-9_-]{2,}|[\u4e00-\u9fa5]/gi) || []
    ).slice(0, 8); // Top keywords

    if (tokens.length === 0) return [];

    const ftsQuery = tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");

    try {
      const results = await window.electronAPI.invoke(
        "custom-database-command",
        {
          query: `SELECT source_text, target_text FROM translation_fts WHERE translation_fts MATCH ? AND book_key = ? LIMIT ?;`,
          executeType: "all",
          data: [ftsQuery, bookKey, topK],
          dbName: "books",
          storagePath: getSafeStoragePath(),
        }
      );

      if (Array.isArray(results) && results.length > 0) {
        return results.map((r: any) => ({
          sourceText: r.source_text,
          targetText: r.target_text,
        }));
      }
    } catch (e) {
      console.warn("FTS5 query failed, checking fallback:", e);
    }

    return this.inMemoryFallback.querySimilar(bookKey, queryText, topK);
  }
}
