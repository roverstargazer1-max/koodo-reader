const fs = require("fs");
const path = require("path");
const os = require("os");
const axios = require("axios");
const yazl = require("yazl");
const { getImageUrl } = require("./picaClient");

/**
 * Generate standard ComicInfo.xml metadata
 */
function generateComicInfoXml(meta = {}) {
  const escapeXml = (str) => {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  };

  const title = escapeXml(meta.title || "");
  const series = escapeXml(meta.series || meta.title || "");
  const number = meta.number !== undefined ? String(meta.number) : "1";
  const writer = escapeXml(meta.author || meta.writer || "");
  const translator = escapeXml(meta.chineseTeam || "");
  const summary = escapeXml(meta.description || meta.summary || "");
  const genre = escapeXml(
    Array.isArray(meta.categories)
      ? meta.categories.join(", ")
      : meta.genre || ""
  );
  const tags = escapeXml(
    Array.isArray(meta.tags) ? meta.tags.join(", ") : meta.tags || ""
  );
  const pageCount = meta.pageCount || meta.pagesCount || 0;

  return `<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Title>${title}</Title>
  <Series>${series}</Series>
  <Number>${number}</Number>
  <Summary>${summary}</Summary>
  <Writer>${writer}</Writer>
  <Translator>${translator}</Translator>
  <Genre>${genre}</Genre>
  <Tags>${tags}</Tags>
  <PageCount>${pageCount}</PageCount>
  <Manga>YesAndRightToLeft</Manga>
</ComicInfo>`;
}

/**
 * Package images and ComicInfo.xml into a .cbz archive using yazl
 */
function buildCbzArchive(outputPath, fileEntries, comicInfoXml) {
  return new Promise((resolve, reject) => {
    const zipfile = new yazl.ZipFile();
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const writeStream = fs.createWriteStream(outputPath);
    zipfile.outputStream.pipe(writeStream);

    // Add ComicInfo.xml
    if (comicInfoXml) {
      zipfile.addBuffer(
        Buffer.from(comicInfoXml, "utf-8"),
        "ComicInfo.xml"
      );
    }

    // Add image files / buffers
    fileEntries.forEach((entry) => {
      if (entry.filePath && fs.existsSync(entry.filePath)) {
        zipfile.addFile(entry.filePath, entry.archivePath);
      } else if (entry.buffer) {
        zipfile.addBuffer(entry.buffer, entry.archivePath);
      }
    });

    zipfile.end();

    writeStream.on("finish", () => {
      resolve(outputPath);
    });

    writeStream.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Download a single image buffer with retry and headers
 */
async function downloadImageBuffer(url, client = null, maxRetries = 3) {
  let attempt = 0;
  while (attempt < maxRetries) {
    attempt++;
    try {
      const agent = client ? client.getAgent() : null;
      const axiosConfig = {
        method: "GET",
        url,
        responseType: "arraybuffer",
        timeout: 20000,
        headers: {
          Referer: "https://picaapi.picacomic.com/",
          "User-Agent": "okhttp/3.8.1",
          accept: "image/webp,image/apng,image/*,*/*;q=0.8",
        },
      };
      if (agent) {
        axiosConfig.httpsAgent = agent;
        axiosConfig.httpAgent = agent;
        axiosConfig.proxy = false;
      }
      const response = await axios(axiosConfig);
      if (response.status === 200 && response.data) {
        return Buffer.from(response.data);
      }
    } catch (err) {
      if (attempt >= maxRetries) {
        throw new Error(`Failed to download image from ${url}: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 600 * attempt));
    }
  }
  throw new Error(`Failed to download image from ${url} after ${maxRetries} attempts`);
}

/**
 * Concurrently download an array of items with a worker pool and delay
 */
async function runConcurrentPool(items, workerFn, concurrency = 3, delayMs = 150) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const curIndex = index++;
      results[curIndex] = await workerFn(items[curIndex], curIndex);
      if (delayMs > 0) {
        const jitter = Math.floor(Math.random() * 80);
        await new Promise((r) => setTimeout(r, delayMs + jitter));
      }
    }
  }

  const workers = [];
  const count = Math.min(concurrency, items.length);
  for (let i = 0; i < count; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

/**
 * Download comic chapters, build CBZ and ComicInfo.xml
 */
async function downloadComicPackage({
  client,
  comicId,
  selectedEpOrders = [],
  combineCbz = true,
  outputDir,
  threads = 3,
  delayMs = 200,
  onProgress = () => {},
  isCancelled = () => false,
}) {
  const targetDir =
    outputDir ||
    path.join(
      os.homedir(),
      "Downloads",
      "KoodoReader_Comics"
    );

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // 1. Fetch comic detail
  const detailRes = await client.getComicDetail(comicId);
  if (detailRes.code !== 200 || !detailRes.data || !detailRes.data.comic) {
    throw new Error(detailRes.message || "Failed to fetch comic details");
  }
  const comic = detailRes.data.comic;

  // 2. Fetch all episodes
  let allEps = [];
  let epPage = 1;
  let totalEpPages = 1;
  do {
    const epsRes = await client.getEpisodes(comicId, epPage);
    if (epsRes.code === 200 && epsRes.data && epsRes.data.eps) {
      const epsData = epsRes.data.eps;
      allEps = allEps.concat(epsData.docs || []);
      totalEpPages = epsData.pages || 1;
      epPage++;
    } else {
      break;
    }
  } while (epPage <= totalEpPages);

  allEps.sort((a, b) => a.order - b.order);

  // Filter episodes if specific chapters selected
  let targetEps = allEps;
  if (selectedEpOrders && selectedEpOrders.length > 0) {
    const orderSet = new Set(selectedEpOrders);
    targetEps = allEps.filter((ep) => orderSet.has(ep.order));
  }

  if (targetEps.length === 0) {
    throw new Error("No episodes found to download");
  }

  const createdFiles = [];
  const sanitizeName = (str) =>
    (str || "").replace(/[<>:"/\\|?*]/g, "_").trim();

  // Create temporary directory for downloads
  const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "pica-pkg-"));

  try {
    if (combineCbz) {
      // --- Combine all episodes into one single CBZ ---
      const totalEpisodes = targetEps.length;
      const allPageEntries = [];
      let globalPageIndex = 1;

      for (let epIdx = 0; epIdx < totalEpisodes; epIdx++) {
        if (isCancelled()) throw new Error("Download cancelled by user");

        const ep = targetEps[epIdx];
        onProgress({
          percent: Math.floor((epIdx / totalEpisodes) * 85),
          currentEpTitle: ep.title,
          currentEpIndex: epIdx + 1,
          totalEps: totalEpisodes,
          status: "downloading",
        });

        // Fetch pages for this episode
        let epPages = [];
        let pPage = 1;
        let totalPPages = 1;
        do {
          const pagesRes = await client.getEpisodePages(comicId, ep.order, pPage);
          if (pagesRes.code === 200 && pagesRes.data && pagesRes.data.pages) {
            const pData = pagesRes.data.pages;
            epPages = epPages.concat(pData.docs || []);
            totalPPages = pData.pages || 1;
            pPage++;
          } else {
            break;
          }
        } while (pPage <= totalPPages);

        // Download images for this episode
        const pageBuffers = await runConcurrentPool(
          epPages,
          async (pageItem, pIdx) => {
            if (isCancelled()) throw new Error("Download cancelled by user");
            const imgUrl = pageItem.mediaUrl || getImageUrl(pageItem.media);
            const buf = await downloadImageBuffer(imgUrl, client);
            return { buf, pIdx };
          },
          threads,
          delayMs
        );

        pageBuffers.forEach(({ buf }) => {
          const ext = ".jpg";
          const archivePath = `page_${String(globalPageIndex++).padStart(5, "0")}${ext}`;
          allPageEntries.push({ buffer: buf, archivePath });
        });
      }

      onProgress({
        percent: 92,
        status: "packaging",
      });

      const comicInfoXml = generateComicInfoXml({
        title: comic.title,
        series: comic.title,
        author: comic.author,
        chineseTeam: comic.chineseTeam,
        description: comic.description,
        categories: comic.categories,
        tags: comic.tags,
        pageCount: allPageEntries.length,
      });

      const authorPrefix = comic.author ? `[${sanitizeName(comic.author)}] ` : "";
      const cbzFileName = `${authorPrefix}${sanitizeName(comic.title)}.cbz`;
      const cbzFilePath = path.join(targetDir, cbzFileName);

      await buildCbzArchive(cbzFilePath, allPageEntries, comicInfoXml);
      const stat = fs.statSync(cbzFilePath);
      createdFiles.push({ path: cbzFilePath, name: cbzFileName, size: stat.size });
    } else {
      // --- Separate CBZ per episode ---
      const totalEpisodes = targetEps.length;

      for (let epIdx = 0; epIdx < totalEpisodes; epIdx++) {
        if (isCancelled()) throw new Error("Download cancelled by user");

        const ep = targetEps[epIdx];
        onProgress({
          percent: Math.floor((epIdx / totalEpisodes) * 85),
          currentEpTitle: ep.title,
          currentEpIndex: epIdx + 1,
          totalEps: totalEpisodes,
          status: "downloading",
        });

        let epPages = [];
        let pPage = 1;
        let totalPPages = 1;
        do {
          const pagesRes = await client.getEpisodePages(comicId, ep.order, pPage);
          if (pagesRes.code === 200 && pagesRes.data && pagesRes.data.pages) {
            const pData = pagesRes.data.pages;
            epPages = epPages.concat(pData.docs || []);
            totalPPages = pData.pages || 1;
            pPage++;
          } else {
            break;
          }
        } while (pPage <= totalPPages);

        const pageBuffers = await runConcurrentPool(
          epPages,
          async (pageItem) => {
            if (isCancelled()) throw new Error("Download cancelled by user");
            const imgUrl = pageItem.mediaUrl || getImageUrl(pageItem.media);
            return downloadImageBuffer(imgUrl, client);
          },
          threads,
          delayMs
        );

        const fileEntries = pageBuffers.map((buf, pIdx) => ({
          buffer: buf,
          archivePath: `page_${String(pIdx + 1).padStart(4, "0")}.jpg`,
        }));

        const comicInfoXml = generateComicInfoXml({
          title: `${comic.title} - ${ep.title}`,
          series: comic.title,
          number: ep.order,
          author: comic.author,
          chineseTeam: comic.chineseTeam,
          description: comic.description,
          categories: comic.categories,
          tags: comic.tags,
          pageCount: fileEntries.length,
        });

        const authorPrefix = comic.author ? `[${sanitizeName(comic.author)}] ` : "";
        const cbzFileName = `${authorPrefix}${sanitizeName(comic.title)} - ${sanitizeName(ep.title)}.cbz`;
        const cbzFilePath = path.join(targetDir, cbzFileName);

        await buildCbzArchive(cbzFilePath, fileEntries, comicInfoXml);
        const stat = fs.statSync(cbzFilePath);
        createdFiles.push({ path: cbzFilePath, name: cbzFileName, size: stat.size });
      }
    }
  } finally {
    // Cleanup temporary directory
    try {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    } catch {}
  }

  return {
    code: 0,
    comicId,
    title: comic.title,
    author: comic.author,
    coverUrl: comic.thumbUrl || getImageUrl(comic.thumb),
    files: createdFiles,
  };
}

module.exports = {
  generateComicInfoXml,
  buildCbzArchive,
  downloadImageBuffer,
  runConcurrentPool,
  downloadComicPackage,
};
