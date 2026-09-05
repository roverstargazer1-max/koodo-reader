import BookModel from "../../../models/Book";
import BookUtil from "../../file/bookUtil";
import DatabaseService from "../../storage/databaseService";
import CoverUtil from "../../file/coverUtil";

jest.mock("../../../assets/lib/kookit-extra-browser.min", () => ({
  ConfigService: {
    getAllMapConfig: jest.fn(),
    setMapConfig: jest.fn(),
    getAllListConfig: jest.fn(),
    setListConfig: jest.fn(),
  },
}));

import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import { TranslationAutoImporter } from "../autoImport";

jest.mock("../../file/bookUtil", () => ({
  __esModule: true,
  default: {
    addBook: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock("../../storage/databaseService", () => ({
  __esModule: true,
  default: {
    saveRecord: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock("../../file/coverUtil", () => ({
  __esModule: true,
  default: {
    getCover: jest.fn().mockResolvedValue("data:image/jpeg;base64,mockCover"),
    addCover: jest.fn().mockResolvedValue(true),
  },
}));

describe("TranslationAutoImporter", () => {
  const mockSourceBook = new BookModel(
    "source_123",
    "Sample Novel",
    "Jane Doe",
    "An exciting tale",
    "md5_hash",
    "cover_path",
    "epub",
    "Publisher X",
    12345,
    100,
    "/path/to/book.epub",
    "utf-8"
  );

  const sampleBuffer = new ArrayBuffer(50);

  beforeEach(() => {
    jest.clearAllMocks();
    (CoverUtil.getCover as jest.Mock).mockResolvedValue(
      "data:image/jpeg;base64,mockCover"
    );
    (CoverUtil.addCover as jest.Mock).mockResolvedValue(true);
    (BookUtil.addBook as jest.Mock).mockResolvedValue(true);
    (DatabaseService.saveRecord as jest.Mock).mockResolvedValue(true);
  });

  it("registers translated book into library, inherits cover, shelf, and sets '译本' tag", async () => {
    const mockRefresh = jest.fn();
    const mockOpen = jest.fn();


    // Mock shelf list having source book
    jest.spyOn(ConfigService, "getAllMapConfig").mockImplementation((name) => {
      if (name === "shelfList") {
        return { "Sci-Fi": ["source_123", "other_book"] };
      }
      return {};
    });

    const setMapConfigSpy = jest
      .spyOn(ConfigService, "setMapConfig")
      .mockImplementation(() => {});

    const setListConfigSpy = jest
      .spyOn(ConfigService, "setListConfig")
      .mockImplementation(() => {});

    const newBook = await TranslationAutoImporter.importTranslatedBook({
      sourceBook: mockSourceBook,
      targetTitle: "Sample Novel (中文版)",
      format: "epub",
      translatedBuffer: sampleBuffer,
      onRefreshBooks: mockRefresh,
      onOpenBook: mockOpen,
    });

    expect(newBook).toBeDefined();
    expect(newBook.name).toBe("Sample Novel (中文版)");
    expect(newBook.author).toBe("Jane Doe");

    // 1. File added via BookUtil.addBook
    expect(BookUtil.addBook).toHaveBeenCalledWith(
      newBook.key,
      "epub",
      sampleBuffer
    );

    // 2. Cover inherited
    expect(CoverUtil.getCover).toHaveBeenCalledWith(mockSourceBook);
    expect(CoverUtil.addCover).toHaveBeenCalled();

    // 3. Saved to DatabaseService
    expect(DatabaseService.saveRecord).toHaveBeenCalledWith(newBook, "books");

    // 4. Shelf inherited
    expect(setMapConfigSpy).toHaveBeenCalledWith(
      "Sci-Fi",
      newBook.key,
      "shelfList"
    );

    // 5. '译本' tag set
    expect(setMapConfigSpy).toHaveBeenCalledWith(
      "译本",
      newBook.key,
      "tagList"
    );

    // 6. Refreshed library
    expect(mockRefresh).toHaveBeenCalled();
  });
});
