import localforage from "localforage";
import { PersistedTranslationState } from "./types";

export interface ITaskStorage {
  saveTask(state: PersistedTranslationState): Promise<void>;
  getTask(bookKey: string): Promise<PersistedTranslationState | null>;
  deleteTask(bookKey: string): Promise<void>;
  getAllTasks(): Promise<PersistedTranslationState[]>;
  getActiveOrPausedTask(
    bookKey?: string
  ): Promise<PersistedTranslationState | null>;
}

export class InMemoryTaskStorage implements ITaskStorage {
  private tasks = new Map<string, PersistedTranslationState>();

  async saveTask(state: PersistedTranslationState): Promise<void> {
    this.tasks.set(state.bookKey, { ...state, updatedAt: Date.now() });
  }

  async getTask(bookKey: string): Promise<PersistedTranslationState | null> {
    const task = this.tasks.get(bookKey);
    return task ? { ...task } : null;
  }

  async deleteTask(bookKey: string): Promise<void> {
    this.tasks.delete(bookKey);
  }

  async getAllTasks(): Promise<PersistedTranslationState[]> {
    return Array.from(this.tasks.values());
  }

  async getActiveOrPausedTask(
    bookKey?: string
  ): Promise<PersistedTranslationState | null> {
    if (bookKey) {
      const t = this.tasks.get(bookKey);
      if (t && (t.status === "running" || t.status === "paused" || t.status === "paused_error")) {
        return { ...t };
      }
      return null;
    }
    for (const t of this.tasks.values()) {
      if (t.status === "running" || t.status === "paused" || t.status === "paused_error") {
        return { ...t };
      }
    }
    return null;
  }
}

export class LocalForageTaskStorage implements ITaskStorage {
  private store: LocalForage;

  constructor() {
    this.store = localforage.createInstance({
      name: "koodo_reader_translation",
      storeName: "translation_tasks",
    });
  }

  async saveTask(state: PersistedTranslationState): Promise<void> {
    try {
      await this.store.setItem(state.bookKey, {
        ...state,
        updatedAt: Date.now(),
      });
    } catch (e) {
      console.error("Failed to save translation task to storage:", e);
    }
  }

  async getTask(bookKey: string): Promise<PersistedTranslationState | null> {
    try {
      return (await this.store.getItem<PersistedTranslationState>(bookKey)) || null;
    } catch (e) {
      console.error("Failed to get translation task from storage:", e);
      return null;
    }
  }

  async deleteTask(bookKey: string): Promise<void> {
    try {
      await this.store.removeItem(bookKey);
    } catch (e) {
      console.error("Failed to delete translation task from storage:", e);
    }
  }

  async getAllTasks(): Promise<PersistedTranslationState[]> {
    const tasks: PersistedTranslationState[] = [];
    try {
      await this.store.iterate<PersistedTranslationState, void>((value) => {
        if (value && value.bookKey) {
          tasks.push(value);
        }
      });
    } catch (e) {
      console.error("Failed to list translation tasks:", e);
    }
    return tasks;
  }

  async getActiveOrPausedTask(
    bookKey?: string
  ): Promise<PersistedTranslationState | null> {
    if (bookKey) {
      const task = await this.getTask(bookKey);
      if (
        task &&
        (task.status === "running" ||
          task.status === "paused" ||
          task.status === "paused_error")
      ) {
        return task;
      }
      return null;
    }
    const all = await this.getAllTasks();
    return (
      all.find(
        (t) =>
          t.status === "running" ||
          t.status === "paused" ||
          t.status === "paused_error"
      ) || null
    );
  }
}

export const TaskStorage = new LocalForageTaskStorage();
