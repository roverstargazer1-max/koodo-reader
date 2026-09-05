import BookModel from "../../models/Book";
import BookUtil from "../file/bookUtil";
import CoverUtil from "../file/coverUtil";
import DatabaseService from "../storage/databaseService";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import React from "react";

export interface AutoImportParams {
  sourceBook: BookModel;
  targetTitle: string;
  format: "epub" | "txt";
  translatedBuffer: ArrayBuffer;
  onOpenBook?: (book: BookModel) => void;
  onRefreshBooks?: () => void;
}

export class TranslationAutoImporter {
  static async importTranslatedBook(
    params: AutoImportParams
  ): Promise<BookModel> {
    const {
      sourceBook,
      targetTitle,
      format,
      translatedBuffer,
      onOpenBook,
      onRefreshBooks,
    } = params;

    const newKey = Date.now().toString();

    // 1. Add file to storage
    await BookUtil.addBook(newKey, format, translatedBuffer);

    // 2. Create new BookModel inheriting metadata
    const newBook = new BookModel(
      newKey,
      targetTitle || `${sourceBook.name} (Translated)`,
      sourceBook.author || "",
      sourceBook.description || "",
      newKey, // md5 / identifier
      "", // cover will be copied below
      format,
      sourceBook.publisher || "",
      translatedBuffer.byteLength,
      sourceBook.page || 0,
      "",
      "utf-8"
    );

    // 3. Inherit cover from source book
    try {
      const sourceCover = await CoverUtil.getCover(sourceBook);
      if (sourceCover) {
        newBook.cover = sourceCover;
        await CoverUtil.addCover(newBook);
      }
    } catch (e) {
      console.warn("Failed to inherit cover for translated book:", e);
    }

    // 4. Save book record to database (SQLite / IndexedDB)
    await DatabaseService.saveRecord(newBook, "books");

    // 5. Inherit shelf placements
    try {
      const shelfList = ConfigService.getAllMapConfig("shelfList") || {};
      for (const shelfName in shelfList) {
        const bookKeys = shelfList[shelfName];
        if (Array.isArray(bookKeys) && bookKeys.includes(sourceBook.key)) {
          ConfigService.setMapConfig(shelfName, newKey, "shelfList");
        }
      }
    } catch (e) {
      console.warn("Failed to inherit shelf placements:", e);
    }

    // 6. Add "译本" tag
    try {
      const tagTitle = "译本";
      const sortedTagList = ConfigService.getAllListConfig("sortedTagList") || [];
      if (!sortedTagList.includes(tagTitle)) {
        ConfigService.setListConfig(tagTitle, "sortedTagList");
      }
      ConfigService.setMapConfig(tagTitle, newKey, "tagList");
    } catch (e) {
      console.warn("Failed to set translated tag:", e);
    }

    // 7. Refresh library view
    if (typeof onRefreshBooks === "function") {
      onRefreshBooks();
    }

    // 8. Success toast with action
    toast.success(
      (t) =>
        React.createElement(
          "span",
          {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              gap: "8px",
            },
          },
          React.createElement(
            "span",
            null,
            `全书翻译完成并已自动入库: ${newBook.name}`
          ),
          onOpenBook
            ? React.createElement(
                "button",
                {
                  style: {
                    padding: "4px 10px",
                    backgroundColor: "var(--primary-color, #1890ff)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "12px",
                  },
                  onClick: () => {
                    toast.dismiss(t.id);
                    onOpenBook(newBook);
                  },
                },
                "立即阅读"
              )
            : null
        ),
      { duration: 8000 }
    );

    return newBook;
  }
}
