import JSZip from "jszip";
import toast from "react-hot-toast";
import { supportedFormats } from "../common";
import { isElectron } from "react-device-detect";

declare var window: any;

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".avif",
]);

/**
 * 判断文件名是否为受支持的图片格式
 */
export const isImageFile = (filename: string): boolean => {
  const ext = "." + (filename.split(".").pop() || "").toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
};

/**
 * 自然数字排序对比函数 (例如 1.jpg, 2.jpg, 10.jpg)
 */
export const naturalCompare = (a: string, b: string): number => {
  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: "base",
  });
};

export interface ImageItem {
  name: string; // 文件名 (不含父目录路径)
  path?: string; // 本地绝对路径 (Electron 环境)
  file?: File; // Web 环境 File 对象
  getData?: () => Promise<ArrayBuffer>; // 获取 ArrayBuffer 的延迟函数
}

export interface FolderComicTask {
  title: string;
  images: ImageItem[];
}

/**
 * 将一组排好序的图片打包为标准的 .cbz (ZIP) 文件对象
 */
export const createCBZFromImages = async (
  title: string,
  images: ImageItem[]
): Promise<File | null> => {
  if (!images || images.length === 0) return null;

  // 按照文件名自然排序
  const sortedImages = [...images].sort((a, b) =>
    naturalCompare(a.name, b.name)
  );

  const zip = new JSZip();

  // 依次读取各图片数据并添加到 zip 根目录（避免多层无用子目录）
  for (let i = 0; i < sortedImages.length; i++) {
    const item = sortedImages[i];
    let buffer: ArrayBuffer | null = null;

    if (item.getData) {
      buffer = await item.getData();
    } else if (item.file) {
      buffer = await item.file.arrayBuffer();
    } else if (isElectron && item.path) {
      const fs = window.electronAPI.fs;
      const nodeBuf = fs.readFileSync(item.path);
      buffer = nodeBuf.buffer.slice(
        nodeBuf.byteOffset,
        nodeBuf.byteOffset + nodeBuf.byteLength
      );
    }

    if (buffer) {
      // 规范化扩展名（将 .jpeg 统一为 .jpg，避免旧版引擎正则仅匹配 .jpg）
      let rawExt = (item.name.split(".").pop() || "jpg").toLowerCase();
      if (rawExt === "jpeg") {
        rawExt = "jpg";
      }
      // 使用格式化的序号文件名（如 0001.jpg, 0002.png），确保在任何解包引擎中都严格保序且兼容
      const padIndex = String(i + 1).padStart(4, "0");
      const normalizedFileName = `${padIndex}.${rawExt}`;
      zip.file(normalizedFileName, buffer);
    }
  }

  const zipBlob = await zip.generateAsync({
    type: "blob",
    compression: "STORE", // 漫画图片通常已经过压缩，使用 STORE 速度更快且兼容性最高
  });

  const cbzFileName = `${title.replace(/[/\\?%*:|"<>]/g, "_")}.cbz`;
  const cbzFile: any = new File([zipBlob], cbzFileName, {
    type: "application/vnd.comicbook+zip",
  });

  return cbzFile;
};

/**
 * 递归收集 Electron 环境下的目录结构：
 * 如果子目录包含图片，拆分成独立的单话 Task
 */
export const scanElectronImageFolder = (
  folderPath: string,
  fs: any,
  path: any
): { comicTasks: FolderComicTask[]; regularBookPaths: string[] } => {
  const comicTasks: FolderComicTask[] = [];
  const regularBookPaths: string[] = [];

  const traverse = (currentDir: string) => {
    let items: string[] = [];
    try {
      items = fs.readdirSync(currentDir);
    } catch (e) {
      console.error("Error reading dir:", currentDir, e);
      return;
    }

    const currentImages: ImageItem[] = [];
    const subDirs: string[] = [];

    for (const item of items) {
      // 过滤系统隐藏文件
      if (item.startsWith(".") || item === "Thumbs.db" || item === "desktop.ini") {
        continue;
      }
      const fullPath = path.join(currentDir, item);
      let stat: any;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        subDirs.push(fullPath);
      } else if (stat.isFile()) {
        const ext = path.extname(item).toLowerCase();
        if (isImageFile(item)) {
          currentImages.push({
            name: item,
            path: fullPath,
          });
        } else if (supportedFormats.includes(ext)) {
          regularBookPaths.push(fullPath);
        }
      }
    }

    // 如果当前目录直接包含图片，打包为一个漫画任务
    if (currentImages.length > 0) {
      const folderName = path.basename(currentDir) || "Comic";
      comicTasks.push({
        title: folderName,
        images: currentImages,
      });
    }

    // 递归处理子目录
    for (const subDir of subDirs) {
      traverse(subDir);
    }
  };

  traverse(folderPath);
  return { comicTasks, regularBookPaths };
};

/**
 * 扫描浏览器 FileSystemEntry 树
 */
export const scanBrowserEntries = async (
  entries: FileSystemEntry[]
): Promise<{ comicTasks: FolderComicTask[]; regularBooks: File[] }> => {
  const comicTasks: FolderComicTask[] = [];
  const regularBooks: File[] = [];

  const readDirEntries = (
    dirEntry: FileSystemDirectoryEntry
  ): Promise<FileSystemEntry[]> => {
    const reader = dirEntry.createReader();
    const all: FileSystemEntry[] = [];
    return new Promise((resolve) => {
      const readNext = () => {
        reader.readEntries(
          (results) => {
            if (results.length === 0) {
              resolve(all);
            } else {
              all.push(...Array.from(results));
              readNext();
            }
          },
          () => resolve(all)
        );
      };
      readNext();
    });
  };

  const traverseEntry = async (entry: FileSystemEntry) => {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      const file: File = await new Promise((resolve, reject) => {
        fileEntry.file(resolve, reject);
      });
      const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
      if (supportedFormats.includes(ext)) {
        regularBooks.push(file);
      }
    } else if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry;
      const subEntries = await readDirEntries(dirEntry);
      const currentImages: ImageItem[] = [];

      for (const sub of subEntries) {
        if (sub.isFile) {
          if (sub.name.startsWith(".") || sub.name === "Thumbs.db") continue;
          if (isImageFile(sub.name)) {
            const fileEntry = sub as FileSystemFileEntry;
            currentImages.push({
              name: sub.name,
              getData: () =>
                new Promise((resolve, reject) => {
                  fileEntry.file(
                    (f) => resolve(f.arrayBuffer()),
                    (err) => reject(err)
                  );
                }),
            });
          } else {
            // 普通支持的书籍
            const fileEntry = sub as FileSystemFileEntry;
            try {
              const f: File = await new Promise((res, rej) =>
                fileEntry.file(res, rej)
              );
              const ext = "." + (f.name.split(".").pop() || "").toLowerCase();
              if (supportedFormats.includes(ext)) {
                regularBooks.push(f);
              }
            } catch (e) {}
          }
        } else if (sub.isDirectory) {
          await traverseEntry(sub);
        }
      }

      if (currentImages.length > 0) {
        comicTasks.push({
          title: dirEntry.name || "Comic",
          images: currentImages,
        });
      }
    }
  };

  for (const entry of entries) {
    await traverseEntry(entry);
  }

  return { comicTasks, regularBooks };
};

/**
 * 统一处理拖拽项目（包含普通文件、包含多话图片的文件夹、嵌套目录等）
 */
export const processDroppedItems = async (
  dataTransfer: DataTransfer,
  importBookFunc: (file: any) => Promise<void>,
  t: (key: string) => string
): Promise<void> => {
  const items = dataTransfer.items;
  const toastId = "import-folder-comic";

  // 1. Electron 环境优先通过 files[i].path 深度扫描
  if (isElectron && dataTransfer.files && dataTransfer.files.length > 0) {
    const fs = window.electronAPI.fs;
    const path = window.electronAPI.path;

    const allComicTasks: FolderComicTask[] = [];
    const allRegularFiles: string[] = [];

    for (let i = 0; i < dataTransfer.files.length; i++) {
      const domFile: any = dataTransfer.files[i];
      const filePath = domFile.path;
      if (!filePath) continue;

      try {
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          const { comicTasks, regularBookPaths } = scanElectronImageFolder(
            filePath,
            fs,
            path
          );
          allComicTasks.push(...comicTasks);
          allRegularFiles.push(...regularBookPaths);
        } else if (stat.isFile()) {
          const ext = path.extname(filePath).toLowerCase();
          if (supportedFormats.includes(ext)) {
            allRegularFiles.push(filePath);
          }
        }
      } catch (err) {
        console.error("Error inspecting dropped item:", filePath, err);
      }
    }

    // 先导入普通图书
    for (const regPath of allRegularFiles) {
      try {
        const fileName = path.basename(regPath);
        let file: any = new File([], fileName);
        file.path = regPath;
        await importBookFunc(file);
      } catch (e) {
        console.error("Import file failed:", regPath, e);
      }
    }

    // 打包并导入漫画任务
    if (allComicTasks.length > 0) {
      for (let i = 0; i < allComicTasks.length; i++) {
        const task = allComicTasks[i];
        toast.loading(
          `${t("Packaging comic")} (${i + 1}/${allComicTasks.length}): ${task.title}`,
          { id: toastId }
        );

        try {
          const cbzFile = await createCBZFromImages(task.title, task.images);
          if (cbzFile) {
            await importBookFunc(cbzFile);
          }
        } catch (error) {
          console.error("Failed to package comic:", task.title, error);
          toast.error(`${t("Import failed")}: ${task.title}`);
        }
      }
      toast.dismiss(toastId);
    }

    return;
  }

  // 2. Web 浏览器端环境
  if (items && items.length > 0) {
    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const entry = item.webkitGetAsEntry();
      if (entry) entries.push(entry);
    }

    const { comicTasks, regularBooks } = await scanBrowserEntries(entries);

    // 导入常规图书
    for (const book of regularBooks) {
      await importBookFunc(book);
    }

    // 打包并导入漫画
    if (comicTasks.length > 0) {
      for (let i = 0; i < comicTasks.length; i++) {
        const task = comicTasks[i];
        toast.loading(
          `${t("Packaging comic")} (${i + 1}/${comicTasks.length}): ${task.title}`,
          { id: toastId }
        );

        try {
          const cbzFile = await createCBZFromImages(task.title, task.images);
          if (cbzFile) {
            await importBookFunc(cbzFile);
          }
        } catch (error) {
          console.error("Failed to package comic in browser:", task.title, error);
          toast.error(`${t("Import failed")}: ${task.title}`);
        }
      }
      toast.dismiss(toastId);
    }
  }
};
