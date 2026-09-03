const crypto = require("crypto");
const axios = require("axios");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { SocksProxyAgent } = require("socks-proxy-agent");

const API_KEY = "C69BAF41DA5ABD1FFEDC6D2FEA56B";
const SECRET_KEY = "~d}$Q7$eIni=V)9\\RK/P.RM4;9[7|@/CA}b~OW!3?EV`:<>M7pddUBL5n|0/*Cn";
const APP_VERSION = "2.2.1.2.3.3";
const APP_BUILD_VERSION = "44";
const APP_PLATFORM = "android";
const APP_CHANNEL = "2";
const DEFAULT_USER_AGENT = "okhttp/3.8.1";

const ROUTE_HOSTS = {
  route1: "https://picaapi.picacomic.com",
  route2: "https://picaapi.picacomic.com",
  route3: "https://picaapi.picacomic.com",
};

const ROUTE_CHANNELS = {
  route1: "1",
  route2: "2",
  route3: "3",
};

/**
 * Generate HMAC-SHA256 signature for PicACG API request
 */
function generateSignature(path, timestamp, nonce, method, apiKey = API_KEY, secretKey = SECRET_KEY) {
  const cleanPath = String(path)
    .replace(/^https?:\/\/[^\/]+\/?/, "")
    .replace(/^\//, "");
  const raw = (cleanPath + timestamp + nonce + method + apiKey).toLowerCase();
  return crypto.createHmac("sha256", secretKey).update(raw).digest("hex");
}

/**
 * Build PicACG HTTP headers with HMAC signature
 */
function createHeaders(path, method = "GET", token = null, options = {}) {
  const timestamp = String(options.timestamp || Math.floor(Date.now() / 1000));
  const nonce = String(options.nonce || crypto.randomUUID()).replace(/-/g, "");
  const quality = options.quality || "original";
  const channel = options.channel || APP_CHANNEL;
  const signature = generateSignature(
    path,
    timestamp,
    nonce,
    method,
    options.apiKey || API_KEY,
    options.secretKey || SECRET_KEY
  );

  const headers = {
    "api-key": options.apiKey || API_KEY,
    "accept": "application/vnd.picacomic.com.v1+json",
    "app-channel": String(channel),
    "time": timestamp,
    "nonce": nonce,
    "signature": signature,
    "app-version": APP_VERSION,
    "app-platform": APP_PLATFORM,
    "app-build-version": APP_BUILD_VERSION,
    "app-uuid": options.uuid || "defaultUuid",
    "image-quality": quality,
    "User-Agent": DEFAULT_USER_AGENT,
    "Content-Type": "application/json; charset=UTF-8",
  };

  if (token) {
    headers["authorization"] = token;
  }

  return headers;
}

/**
 * Convert thumbnail / image ref object to absolute URL
 */
function getImageUrl(thumb) {
  if (!thumb) return "";
  if (typeof thumb === "string") return thumb;
  const fileServer = thumb.fileServer || "";
  const path = thumb.path || "";
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const cleanServer = fileServer.replace(/\/+$/, "");
  const cleanPath = path.replace(/^\/+/, "");
  return `${cleanServer}/static/${cleanPath}`;
}

class PicaClient {
  constructor(config = {}) {
    this.route = config.route || "route1";
    this.proxy = config.proxy || "";
    this.quality = config.quality || "original";
    this.token = config.token || null;
    this.credentials = config.credentials || null; // { email, password }
    this.timeout = config.timeout || 25000;
    this.customAxiosInstance = null;
  }

  getBaseUrl() {
    return ROUTE_HOSTS[this.route] || ROUTE_HOSTS.route1;
  }

  getChannel() {
    return ROUTE_CHANNELS[this.route] || APP_CHANNEL;
  }

  setToken(token) {
    this.token = token;
  }

  setCredentials(email, password) {
    this.credentials = { email, password };
  }

  updateConfig(config = {}) {
    if (config.route) this.route = config.route;
    if (config.proxy !== undefined) this.proxy = config.proxy;
    if (config.quality) this.quality = config.quality;
    if (config.token !== undefined) this.token = config.token;
  }

  getAgent() {
    if (!this.proxy || !this.proxy.trim()) return null;
    const proxyStr = this.proxy.trim();
    if (proxyStr.startsWith("socks://") || proxyStr.startsWith("socks5://") || proxyStr.startsWith("socks5h://")) {
      return new SocksProxyAgent(proxyStr);
    }
    if (proxyStr.startsWith("http://") || proxyStr.startsWith("https://")) {
      return new HttpsProxyAgent(proxyStr);
    }
    return null;
  }

  /**
   * Execute raw HTTP request with automatic HMAC header calculation and 401 retry
   */
  async request(path, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    const cleanPath = path.replace(/^\//, "");
    const url = options.fullUrl || `${this.getBaseUrl()}/${cleanPath}`;

    const headers = createHeaders(cleanPath, method, this.token, {
      quality: this.quality,
      channel: options.channel || this.getChannel(),
      ...options.headerOptions,
    });

    const agent = this.getAgent();
    const axiosConfig = {
      method,
      url,
      headers: {
        ...headers,
        ...options.headers,
      },
      data: options.data,
      params: options.params,
      timeout: this.timeout,
      validateStatus: () => true, // Don't throw for non-2xx so we can intercept 401
    };

    if (agent) {
      axiosConfig.httpsAgent = agent;
      axiosConfig.httpAgent = agent;
      axiosConfig.proxy = false;
    }

    try {
      const response = await axios(axiosConfig);

      // Handle 401 Token Expiration with silent re-auth
      if (response.status === 401 && !options._isRetry && this.credentials && this.credentials.email) {
        const loginSuccess = await this.silentReAuth();
        if (loginSuccess) {
          return this.request(path, { ...options, _isRetry: true });
        }
      }

      const body = response.data;
      if (response.status >= 200 && response.status < 300) {
        return {
          code: 200,
          status: response.status,
          message: body?.message || "success",
          data: body?.data || body,
        };
      }

      return {
        code: response.status,
        status: response.status,
        message: body?.message || `HTTP ${response.status}`,
        error: body?.error || body?.message || "Request failed",
        data: body?.data,
      };
    } catch (err) {
      return {
        code: 500,
        status: 500,
        message: err.message || "Network request error",
        error: err.code || err.message,
      };
    }
  }

  async silentReAuth() {
    if (!this.credentials || !this.credentials.email || !this.credentials.password) {
      return false;
    }
    try {
      const res = await this.signIn(this.credentials.email, this.credentials.password, false);
      return res.code === 200 && Boolean(this.token);
    } catch {
      return false;
    }
  }

  // --- API Methods ---

  /**
   * User Sign In (/auth/sign-in)
   */
  async signIn(email, password, remember = true) {
    const res = await this.request("auth/sign-in", {
      method: "POST",
      data: { email, password },
    });

    if (res.code === 200 && res.data && res.data.token) {
      this.token = res.data.token;
      if (remember) {
        this.setCredentials(email, password);
      }
    }
    return res;
  }

  /**
   * Get User Profile (/users/profile)
   */
  async getProfile() {
    const res = await this.request("users/profile", { method: "GET" });
    if (res.code === 200 && res.data && res.data.user) {
      const user = res.data.user;
      if (user.avatar) {
        user.avatarUrl = getImageUrl(user.avatar);
      }
    }
    return res;
  }

  /**
   * Get Categories (/categories)
   */
  async getCategories() {
    const res = await this.request("categories", { method: "GET" });
    if (res.code === 200 && res.data && res.data.categories) {
      res.data.categories.forEach((cat) => {
        if (cat.thumb) {
          cat.thumbUrl = getImageUrl(cat.thumb);
        }
      });
    }
    return res;
  }

  /**
   * Get Comics list with filters (/comics)
   */
  async getComics({ page = 1, category = "", tag = "", author = "", sort = "dd" } = {}) {
    const params = { page: String(page), s: sort };
    if (category) params.c = category;
    if (tag) params.t = tag;
    if (author) params.a = author;

    const res = await this.request("comics", { method: "GET", params });
    if (res.code === 200 && res.data && res.data.comics && res.data.comics.docs) {
      res.data.comics.docs.forEach((item) => {
        if (item.thumb) {
          item.thumbUrl = getImageUrl(item.thumb);
        }
      });
    }
    return res;
  }

  /**
   * Advanced search comics (/comics/advanced-search)
   */
  async search({ keyword = "", sort = "dd", categories = [], page = 1 } = {}) {
    const res = await this.request(`comics/advanced-search?page=${page}`, {
      method: "POST",
      data: {
        keyword,
        sort,
        categories: Array.isArray(categories) ? categories : [],
      },
    });

    if (res.code === 200 && res.data && res.data.comics && res.data.comics.docs) {
      res.data.comics.docs.forEach((item) => {
        if (item.thumb) {
          item.thumbUrl = getImageUrl(item.thumb);
        }
      });
    }
    return res;
  }

  /**
   * Leaderboard (/comics/leaderboard)
   */
  async getLeaderboard({ timeType = "H24", categoryType = "VC" } = {}) {
    const params = { tt: timeType, ct: categoryType };
    const res = await this.request("comics/leaderboard", { method: "GET", params });
    if (res.code === 200 && res.data && res.data.comics) {
      const docs = Array.isArray(res.data.comics) ? res.data.comics : res.data.comics.docs || [];
      docs.forEach((item) => {
        if (item.thumb) {
          item.thumbUrl = getImageUrl(item.thumb);
        }
      });
    }
    return res;
  }

  /**
   * Random recommendation comics (/comics/random)
   */
  async getRandom() {
    const res = await this.request("comics/random", { method: "GET" });
    if (res.code === 200 && res.data && res.data.comics) {
      const docs = Array.isArray(res.data.comics) ? res.data.comics : res.data.comics.docs || [];
      docs.forEach((item) => {
        if (item.thumb) {
          item.thumbUrl = getImageUrl(item.thumb);
        }
      });
    }
    return res;
  }

  /**
   * Comic Detail (/comics/{comicId})
   */
  async getComicDetail(comicId) {
    const res = await this.request(`comics/${comicId}`, { method: "GET" });
    if (res.code === 200 && res.data && res.data.comic) {
      const comic = res.data.comic;
      if (comic.thumb) {
        comic.thumbUrl = getImageUrl(comic.thumb);
      }
    }
    return res;
  }

  /**
   * Comic Episodes list (/comics/{comicId}/eps)
   */
  async getEpisodes(comicId, page = 1) {
    return this.request(`comics/${comicId}/eps`, {
      method: "GET",
      params: { page: String(page) },
    });
  }

  /**
   * Episode Pages list (/comics/{comicId}/order/{order}/pages)
   */
  async getEpisodePages(comicId, order, page = 1) {
    const res = await this.request(`comics/${comicId}/order/${order}/pages`, {
      method: "GET",
      params: { page: String(page) },
    });

    if (res.code === 200 && res.data && res.data.pages && res.data.pages.docs) {
      res.data.pages.docs.forEach((pageItem) => {
        if (pageItem.media) {
          pageItem.mediaUrl = getImageUrl(pageItem.media);
        }
      });
    }
    return res;
  }

  /**
   * User Favorites (/users/favourite)
   */
  async getFavorites(page = 1, sort = "dd") {
    const res = await this.request("users/favourite", {
      method: "GET",
      params: { page: String(page), s: sort },
    });

    if (res.code === 200 && res.data && res.data.comics && res.data.comics.docs) {
      res.data.comics.docs.forEach((item) => {
        if (item.thumb) {
          item.thumbUrl = getImageUrl(item.thumb);
        }
      });
    }
    return res;
  }

  /**
   * Toggle Comic Favorite status (/comics/{comicId}/favourite)
   */
  async toggleFavorite(comicId) {
    return this.request(`comics/${comicId}/favourite`, {
      method: "POST",
    });
  }
}

module.exports = {
  PicaClient,
  generateSignature,
  createHeaders,
  getImageUrl,
  API_KEY,
  SECRET_KEY,
  ROUTE_HOSTS,
  ROUTE_CHANNELS,
};
