import BookModel from "../../models/Book";
import BookUtil from "../file/bookUtil";
import { TranslationTaskConfig } from "./types";
import { BookTranslator } from "./scheduler/bookTranslator";
import {
  PersistedTranslationState,
  TranslationProgress,
  TranslationStatus,
} from "./scheduler/types";
import { TaskStorage } from "./scheduler/taskStorage";
import { TranslationAutoImporter } from "./autoImport";
import toast from "react-hot-toast";
import i18n from "../../i18n";

export type TranslationListener = (progress: TranslationProgress) => void;

class TranslationManager {
  private activeTranslator: BookTranslator | null = null;
  private activeBook: BookModel | null = null;
  private activeConfig: TranslationTaskConfig | null = null;
  private currentProgress: TranslationProgress | null = null;
  private isMinimized = false;
  private isDialogOpen = false;
  private listeners: Set<TranslationListener> = new Set();
  private onRefreshLibrary?: () => void;
  private onOpenBookCallback?: (book: BookModel) => void;

  setRefreshLibraryCallback(cb: () => void) {
    this.onRefreshLibrary = cb;
  }

  setOpenBookCallback(cb: (book: BookModel) => void) {
    this.onOpenBookCallback = cb;
  }

  subscribe(listener: TranslationListener): () => void {
    this.listeners.add(listener);
    if (this.currentProgress) {
      listener(this.currentProgress);
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(progress: TranslationProgress) {
    this.currentProgress = progress;
    for (const listener of this.listeners) {
      try {
        listener(progress);
      } catch (e) {
        console.error("Translation listener error:", e);
      }
    }
  }

  getProgress(): TranslationProgress | null {
    return this.currentProgress;
  }

  getActiveBook(): BookModel | null {
    return this.activeBook;
  }

  getActiveConfig(): TranslationTaskConfig | null {
    return this.activeConfig;
  }

  isTaskActive(): boolean {
    return (
      this.currentProgress !== null &&
      (this.currentProgress.status === "running" ||
        this.currentProgress.status === "paused" ||
        this.currentProgress.status === "paused_error")
    );
  }

  isWidgetVisible(): boolean {
    return this.isTaskActive() && this.isMinimized;
  }

  setMinimized(minimized: boolean) {
    this.isMinimized = minimized;
    if (this.currentProgress) {
      this.notify(this.currentProgress);
    }
  }

  getIsMinimized(): boolean {
    return this.isMinimized;
  }

  setDialogOpen(open: boolean) {
    this.isDialogOpen = open;
    if (open) {
      this.isMinimized = false;
    }
  }

  getIsDialogOpen(): boolean {
    return this.isDialogOpen;
  }

  async checkForIncompleteTask(
    bookKey?: string
  ): Promise<PersistedTranslationState | null> {
    return await TaskStorage.getActiveOrPausedTask(bookKey);
  }

  async startTask(
    book: BookModel,
    config: TranslationTaskConfig
  ): Promise<void> {
    this.activeBook = book;
    this.activeConfig = config;
    this.isMinimized = false;
    this.isDialogOpen = true;

    const buffer = (await BookUtil.fetchBook(
      book.key,
      book.format.toLowerCase(),
      true,
      book.path
    )) as ArrayBuffer;

    if (!buffer || !(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
      toast.error("读取书籍文件失败，无法进行翻译");
      return;
    }

    this.activeTranslator = new BookTranslator({
      config,
      sourceBuffer: buffer,
      storage: TaskStorage,
    });

    this.activeTranslator.onProgress((p) => {
      this.notify(p);
    });

    try {
      const translatedBuffer = await this.activeTranslator.start();
      await this.handleTaskCompletion(translatedBuffer);
    } catch (err: any) {
      console.warn("Translation run interrupted:", err);
      if (this.activeTranslator?.getStatus() === "paused_error") {
        toast.error(`翻译已暂停 (发生错误): ${err.message}`);
      }
    }
  }

  async resumeTask(
    book: BookModel,
    config: TranslationTaskConfig
  ): Promise<void> {
    this.activeBook = book;
    this.activeConfig = config;
    this.isMinimized = false;
    this.isDialogOpen = true;

    const buffer = (await BookUtil.fetchBook(
      book.key,
      book.format.toLowerCase(),
      true,
      book.path
    )) as ArrayBuffer;

    if (!buffer || !(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
      toast.error("读取书籍文件失败，无法进行翻译");
      return;
    }

    this.activeTranslator = new BookTranslator({
      config,
      sourceBuffer: buffer,
      storage: TaskStorage,
    });

    this.activeTranslator.onProgress((p) => {
      this.notify(p);
    });

    try {
      const translatedBuffer = await this.activeTranslator.resume();
      await this.handleTaskCompletion(translatedBuffer);
    } catch (err: any) {
      console.warn("Translation resume interrupted:", err);
      if (this.activeTranslator?.getStatus() === "paused_error") {
        toast.error(`翻译已暂停 (发生错误): ${err.message}`);
      }
    }
  }

  pauseTask() {
    if (this.activeTranslator) {
      this.activeTranslator.pause();
    }
  }

  async cancelTask(): Promise<void> {
    if (this.activeTranslator) {
      await this.activeTranslator.cancel();
    }
    this.activeTranslator = null;
    this.currentProgress = null;
    this.isMinimized = false;
    this.isDialogOpen = false;
  }

  private async handleTaskCompletion(translatedBuffer: ArrayBuffer) {
    if (!this.activeBook || !this.activeConfig) return;

    try {
      await TranslationAutoImporter.importTranslatedBook({
        sourceBook: this.activeBook,
        targetTitle: this.activeConfig.targetTitle,
        format: this.activeConfig.format,
        translatedBuffer,
        onRefreshBooks: this.onRefreshLibrary,
        onOpenBook: this.onOpenBookCallback,
      });
    } catch (e: any) {
      console.error("Auto import failed:", e);
      toast.error(`译本自动入库失败: ${e.message}`);
    } finally {
      this.activeTranslator = null;
      this.currentProgress = null;
      this.isMinimized = false;
      this.isDialogOpen = false;
    }
  }
}

export const GlobalTranslationManager = new TranslationManager();
