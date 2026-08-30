const {
  captureMangaPage,
  getPrimaryRenderedMangaImage,
} = require("./mangaSelection");

const setImageGeometry = (image, { left, top, width, height, naturalWidth, naturalHeight }) => {
  Object.defineProperties(image, {
    complete: { configurable: true, value: true },
    naturalWidth: { configurable: true, value: naturalWidth },
    naturalHeight: { configurable: true, value: naturalHeight },
  });
  image.getBoundingClientRect = () => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  });
};

describe("manga page capture", () => {
  let getContext;
  let toDataURL;

  beforeEach(() => {
    document.body.innerHTML = "";
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    getContext = jest
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({ drawImage: jest.fn() });
    toDataURL = jest
      .spyOn(HTMLCanvasElement.prototype, "toDataURL")
      .mockReturnValue("data:image/jpeg;base64,captured");
  });

  afterEach(() => {
    getContext.mockRestore();
    toDataURL.mockRestore();
    document.body.innerHTML = "";
  });

  it("chooses the image with the most visible viewport area", () => {
    const mostlyHidden = document.createElement("img");
    const visible = document.createElement("img");
    setImageGeometry(mostlyHidden, {
      left: -700,
      top: 0,
      width: 800,
      height: 1000,
      naturalWidth: 1600,
      naturalHeight: 2000,
    });
    setImageGeometry(visible, {
      left: 120,
      top: 10,
      width: 360,
      height: 540,
      naturalWidth: 800,
      naturalHeight: 1200,
    });
    document.body.append(mostlyHidden, visible);

    expect(getPrimaryRenderedMangaImage(document)).toBe(visible);
  });

  it("captures the selected page at natural pixels rather than CSS scale", () => {
    const image = document.createElement("img");
    setImageGeometry(image, {
      left: 100,
      top: 50,
      width: 400,
      height: 600,
      naturalWidth: 1600,
      naturalHeight: 2400,
    });
    document.body.append(image);

    const capture = captureMangaPage(document);

    expect(capture).toEqual(
      expect.objectContaining({
        imageDataUrl: "data:image/jpeg;base64,captured",
        imageSize: { width: 1600, height: 2400 },
        renderedImage: image,
        viewportRect: { left: 100, top: 50, width: 400, height: 600 },
      })
    );
    const canvas = getContext.mock.instances[0];
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(2400);
    expect(toDataURL).toHaveBeenCalledWith("image/jpeg", 0.88);
  });
});
