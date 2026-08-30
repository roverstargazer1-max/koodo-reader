const { bindMangaTextOverlay } = require("./mangaOverlay");

const setImageGeometry = (image, { left, top, width, height, naturalWidth, naturalHeight }) => {
  Object.defineProperty(image, "naturalWidth", { configurable: true, value: naturalWidth });
  Object.defineProperty(image, "naturalHeight", { configurable: true, value: naturalHeight });
  image.getBoundingClientRect = () => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  });
};

describe("bindMangaTextOverlay", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("pins page regions to the image that produced them", () => {
    const capturedImage = document.createElement("img");
    const otherVisibleImage = document.createElement("img");
    setImageGeometry(capturedImage, {
      left: 10,
      top: 20,
      width: 200,
      height: 300,
      naturalWidth: 100,
      naturalHeight: 150,
    });
    setImageGeometry(otherVisibleImage, {
      left: 600,
      top: 20,
      width: 400,
      height: 600,
      naturalWidth: 200,
      naturalHeight: 300,
    });
    document.body.append(capturedImage, otherVisibleImage);

    const cleanup = bindMangaTextOverlay(
      document,
      [
        {
          id: "region-1",
          bbox: { x: 10, y: 15, width: 20, height: 30, space: "image-pixel" },
          sourceText: "source",
          translatedText: "translated",
        },
      ],
      { image: capturedImage }
    );

    const label = document.querySelector("#koodo-manga-text-overlay button");
    expect(label).not.toBeNull();
    expect(label.style.left).toBe("30px");
    expect(label.style.top).toBe("50px");
    expect(label.style.width).toBe("40px");
    expect(label.style.height).toBe("60px");

    cleanup();
    expect(document.querySelector("#koodo-manga-text-overlay")).toBeNull();
  });
});
