import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";

export const BOOK_DRAG_TYPE = "application/x-koodo-book";

export function setBookDragData(e: React.DragEvent, bookKeys: string[]): void {
  if (!e.dataTransfer) return;
  e.dataTransfer.setData(BOOK_DRAG_TYPE, JSON.stringify(bookKeys));
  e.dataTransfer.effectAllowed = "copy";

  if (bookKeys.length > 1) {
    try {
      const badge = document.createElement("div");
      badge.className = "book-drag-multi-badge";
      badge.style.position = "absolute";
      badge.style.top = "-9999px";
      badge.style.left = "-9999px";
      badge.style.padding = "6px 14px";
      badge.style.background = "var(--theme-color, #007aff)";
      badge.style.color = "#ffffff";
      badge.style.borderRadius = "20px";
      badge.style.fontSize = "13px";
      badge.style.fontWeight = "bold";
      badge.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.35)";
      badge.style.zIndex = "99999";
      badge.style.pointerEvents = "none";
      badge.innerText = `📚 ${bookKeys.length}`;
      document.body.appendChild(badge);
      e.dataTransfer.setDragImage(badge, 20, 20);
      setTimeout(() => {
        if (badge.parentNode) {
          badge.parentNode.removeChild(badge);
        }
      }, 0);
    } catch (_) {}
  }
}

export function parseBookDragData(e: React.DragEvent | DragEvent): string[] {
  if (!e.dataTransfer) return [];
  const raw = e.dataTransfer.getData(BOOK_DRAG_TYPE);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [raw];
  } catch {
    return [raw];
  }
}

export function isBookDragEvent(e: React.DragEvent | DragEvent): boolean {
  if (!e.dataTransfer) return false;
  return Array.from(e.dataTransfer.types).includes(BOOK_DRAG_TYPE);
}

export function isExternalFileDragEvent(
  e: React.DragEvent | DragEvent
): boolean {
  if (!e.dataTransfer) return false;
  if (isBookDragEvent(e)) return false;
  const types = Array.from(e.dataTransfer.types);
  const isElectronRuntime =
    typeof window !== "undefined" && Boolean(window.electronAPI);
  return (
    types.includes("Files") ||
    Array.from(e.dataTransfer.items || []).some((item) => item.kind === "file") ||
    (isElectronRuntime &&
      (types.includes("text/uri-list") || types.includes("public.file-url")))
  );
}

export function addBooksToShelf(
  bookKeys: string[],
  shelfTitle: string
): number {
  const shelfList = ConfigService.getAllMapConfig("shelfList") || {};
  const currentList = Array.isArray(shelfList[shelfTitle])
    ? [...shelfList[shelfTitle]]
    : [];
  const existing = new Set<string>(currentList);
  let added = 0;
  for (const key of bookKeys) {
    if (existing.has(key)) continue;
    currentList.unshift(key);
    existing.add(key);
    added++;
  }
  if (added > 0) {
    shelfList[shelfTitle] = currentList;
    ConfigService.setAllMapConfig(shelfList, "shelfList");
  }
  return added;
}

export function addBooksToFavorite(bookKeys: string[]): number {
  const favoriteList = ConfigService.getAllListConfig("favoriteBooks") || [];
  const existing = new Set<string>(favoriteList);
  const deleted = new Set<string>(
    ConfigService.getAllListConfig("deletedBooks") || []
  );
  let added = 0;
  for (const key of bookKeys) {
    if (existing.has(key)) continue;
    favoriteList.unshift(key);
    existing.add(key);
    if (deleted.has(key)) {
      ConfigService.deleteListConfig(key, "deletedBooks");
    }
    added++;
  }
  if (added > 0) {
    ConfigService.setAllListConfig(favoriteList, "favoriteBooks");
  }
  return added;
}

export function moveBooksToTrash(bookKeys: string[]): number {
  const deletedList = ConfigService.getAllListConfig("deletedBooks") || [];
  const existing = new Set<string>(deletedList);
  let moved = 0;
  for (const key of bookKeys) {
    if (existing.has(key)) continue;
    deletedList.unshift(key);
    existing.add(key);
    ConfigService.deleteListConfig(key, "favoriteBooks");
    moved++;
  }
  if (moved > 0) {
    ConfigService.setAllListConfig(deletedList, "deletedBooks");
  }
  return moved;
}
