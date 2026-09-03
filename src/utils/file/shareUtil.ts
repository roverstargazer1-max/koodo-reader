import { isElectron } from "react-device-detect";
import { getStorageLocation } from "../common";
import DatabaseService from "../storage/databaseService";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import BookModel from "../../models/Book";
import NoteModel from "../../models/Note";

declare var window: any;

const sanitizeFileName = (name: string): string =>
  name.replace(/[\\/:*?"<>|]/g, "_");

export interface SharePackageManifest {
  version: string;
  generator: string;
  createdAt: number;
  shelfName: string | null;
  includesNotes: boolean;
  books: {
    originalKey: string;
    name: string;
    author: string;
    description: string;
    format: string;
    size: number;
    publisher: string;
    fileName: string;
    coverName: string;
    charset?: string;
  }[];
}

export interface InspectSharePackageResult {
  ok: boolean;
  filePath?: string;
  totalSize?: number;
  manifest?: SharePackageManifest;
  error?: string;
}

export interface ImportSharePackageResult {
  ok: boolean;
  count?: number;
  shelfName?: string;
  renamedCount?: number;
  error?: string;
}

export class ShareUtil {
  /**
   * 导出分享包 (.kpack)
   */
  static async exportSharePackage(
    books: BookModel[],
    shelfName: string | null,
    includeNotes: boolean
  ): Promise<boolean> {
    if (!isElectron) {
      toast.error(
        i18n.t("Share package export is only available in desktop app")
      );
      return false;
    }
    if (!books || books.length === 0) {
      toast.error(i18n.t("Nothing to export"));
      return false;
    }

    const ipcRenderer = window.electronAPI;
    const defaultName =
      (shelfName ? sanitizeFileName(shelfName) : "books_share") + ".kpack";

    const targetFilePath = await ipcRenderer.invoke("select-save-path", {
      title: i18n.t("Save Share Package"),
      defaultPath: defaultName,
    });

    if (!targetFilePath) {
      return false;
    }

    const toastId = "export-share-package";
    toast.loading(i18n.t("Exporting share package...") + " (0%)", {
      id: toastId,
    });

    // 监听打包进度
    const progressListener = (_: any, data: { percent: number }) => {
      toast.loading(
        i18n.t("Exporting share package...") + ` (${data.percent}%)`,
        { id: toastId }
      );
    };
    ipcRenderer.on("share-export-progress", progressListener);

    try {
      // 收集相关的笔记
      let notes: NoteModel[] = [];
      if (includeNotes) {
        const allNotes: NoteModel[] =
          (await DatabaseService.getAllRecords("notes")) || [];
        const bookKeySet = new Set(books.map((b) => b.key));
        notes = allNotes.filter((n) => bookKeySet.has(n.bookKey));
      }

      const manifest: SharePackageManifest = {
        version: "1.0.0",
        generator: "Koodo Reader",
        createdAt: Date.now(),
        shelfName: shelfName || null,
        includesNotes: includeNotes && notes.length > 0,
        books: books.map((b) => {
          let coverExt = ".png";
          if (isElectron) {
            try {
              const fs = window.electronAPI.fs;
              const path = window.electronAPI.path;
              const coverFolder = path.join(
                getStorageLocation() || "",
                "cover"
              );
              if (fs.existsSync(coverFolder)) {
                const files = fs.readdirSync(coverFolder);
                const matched = files.find(
                  (f: string) => f.startsWith(b.key + ".") || f === b.key
                );
                if (matched) {
                  coverExt = path.extname(matched) || ".png";
                }
              }
            } catch (_) {}
          }
          return {
            originalKey: b.key,
            name: b.name,
            author: b.author || "",
            description: b.description || "",
            format: (b.format || "epub").toUpperCase(),
            size: b.size || 0,
            publisher: b.publisher || "",
            fileName: `${b.key}.${(b.format || "epub").toLowerCase()}`,
            coverName: `${b.key}${coverExt}`,
            charset: b.charset || "utf-8",
          };
        }),
      };

      const result = await ipcRenderer.invoke("export-share-package", {
        targetFilePath,
        manifest,
        books,
        includeNotes,
        notes,
        dataPath: getStorageLocation(),
      });

      ipcRenderer.removeListener("share-export-progress", progressListener);

      if (result.ok) {
        toast.success(i18n.t("Export successful"), { id: toastId });
        return true;
      } else {
        toast.error(result.error || i18n.t("Export failed"), { id: toastId });
        return false;
      }
    } catch (err: any) {
      ipcRenderer.removeListener("share-export-progress", progressListener);
      console.error("Export share package failed:", err);
      toast.error(err?.message || i18n.t("Export failed"), { id: toastId });
      return false;
    }
  }

  /**
   * 检查与预览分享包 (.kpack)
   */
  static async inspectSharePackage(
    filePath: string
  ): Promise<InspectSharePackageResult> {
    if (!isElectron) {
      return {
        ok: false,
        error: i18n.t("Share package import is only available in desktop app"),
      };
    }
    const ipcRenderer = window.electronAPI;
    return await ipcRenderer.invoke("inspect-share-package", { filePath });
  }

  /**
   * 导入分享包 (.kpack)
   */
  static async importSharePackage(
    filePath: string,
    onProgress?: (percent: number) => void
  ): Promise<ImportSharePackageResult> {
    if (!isElectron) {
      return {
        ok: false,
        error: i18n.t("Share package import is only available in desktop app"),
      };
    }

    const ipcRenderer = window.electronAPI;

    // 获取本地已有书名，以便遇到重名时自动追加（1）
    const existingBooks: BookModel[] =
      (await DatabaseService.getAllRecords("books")) || [];
    const existingBookNames = existingBooks.map((b) => b.name);

    let progressListener: any = null;
    if (onProgress) {
      progressListener = (_: any, data: { percent: number }) => {
        onProgress(data.percent);
      };
      ipcRenderer.on("share-import-progress", progressListener);
    }

    try {
      const result = await ipcRenderer.invoke("import-share-package", {
        filePath,
        dataPath: getStorageLocation(),
        existingBookNames,
      });

      if (progressListener) {
        ipcRenderer.removeListener("share-import-progress", progressListener);
      }

      if (!result.ok) {
        return { ok: false, error: result.error || i18n.t("Import failed") };
      }

      const { books, notes, shelfName, renamedCount } = result;

      // 1. 图书记录入库
      if (Array.isArray(books) && books.length > 0) {
        await DatabaseService.saveAllRecords(books, "books");
      }

      // 2. 笔记记录入库
      if (Array.isArray(notes) && notes.length > 0) {
        await DatabaseService.saveAllRecords(notes, "notes");
      }

      // 3. 书架整理
      let targetShelf = shelfName;
      if (!targetShelf || targetShelf.trim() === "") {
        const now = new Date();
        const year = now.getFullYear();
        const month = (now.getMonth() + 1).toString().padStart(2, "0");
        const day = now.getDate().toString().padStart(2, "0");
        targetShelf = `导入-${year}-${month}-${day}`;
      }

      const newBookKeys = books.map((b: any) => b.key);
      let shelfList = ConfigService.getAllMapConfig("shelfList") || {};
      let sortedShelfList =
        ConfigService.getAllListConfig("sortedShelfList") || [];

      if (!shelfList.hasOwnProperty(targetShelf)) {
        if (!sortedShelfList.includes(targetShelf)) {
          ConfigService.setListConfig(targetShelf, "sortedShelfList");
        }
      }

      newBookKeys.forEach((key: string) => {
        ConfigService.setMapConfig(targetShelf, key, "shelfList");
      });

      return {
        ok: true,
        count: books.length,
        shelfName: targetShelf,
        renamedCount: renamedCount || 0,
      };
    } catch (error: any) {
      if (progressListener) {
        ipcRenderer.removeListener("share-import-progress", progressListener);
      }
      console.error("Import share package failed:", error);
      toast.error(error?.message || i18n.t("Import failed"));
      return { ok: false, error: error?.message || i18n.t("Import failed") };
    }
  }
}

export default ShareUtil;
