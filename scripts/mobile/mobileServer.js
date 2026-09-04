const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const crypto = require("crypto");
const { getAvailableInterfaces, getPrimaryAddress } = require("./networkUtil");

const DEFAULT_PORT = 28283;
const MAX_PORT = 28299;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".epub": "application/epub+zip",
  ".txt": "text/plain; charset=utf-8",
};

class MobileServer {
  constructor() {
    this.server = null;
    this.port = DEFAULT_PORT;
    this.host = "0.0.0.0";
    this.selectedAddress = null;
    this.token = null;
    this.running = false;
    this.staticDir = null;
    this.routes = {
      GET: new Map(),
      POST: new Map(),
    };
    this.routeRegex = {
      GET: [],
      POST: [],
    };
  }

  /**
   * Register a route handler.
   * Path can be a literal string or a regex.
   */
  registerRoute(method, routePath, handler) {
    const upperMethod = method.toUpperCase();
    if (typeof routePath === "string" && !routePath.includes(":")) {
      this.routes[upperMethod].set(routePath, handler);
    } else {
      // Pattern with params e.g. /api/cover/:key or regex
      let regex;
      let paramNames = [];
      if (routePath instanceof RegExp) {
        regex = routePath;
      } else {
        const pattern = routePath.replace(/:([a-zA-Z0-9_]+)/g, (_, name) => {
          paramNames.push(name);
          return "([^/]+)";
        });
        regex = new RegExp(`^${pattern}$`);
      }
      this.routeRegex[upperMethod].push({ regex, paramNames, handler });
    }
  }

  /**
   * Resolve static directory path for mobile web client.
   */
  resolveStaticDir() {
    if (this.staticDir && fs.existsSync(this.staticDir)) {
      return this.staticDir;
    }
    const candidates = [
      path.join(__dirname, "..", "..", "public", "mobile"),
      path.join(__dirname, "..", "..", "build", "mobile"),
      path.join(process.cwd(), "public", "mobile"),
      path.join(process.cwd(), "build", "mobile"),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        this.staticDir = c;
        return c;
      }
    }
    const defaultDir = path.join(__dirname, "..", "..", "public", "mobile");
    fs.mkdirSync(defaultDir, { recursive: true });
    this.staticDir = defaultDir;
    return defaultDir;
  }

  /**
   * Extract authentication token from request.
   */
  extractToken(req, parsedUrl) {
    // 1. Check query parameter ?token=
    const queryToken = parsedUrl.searchParams.get("token");
    if (queryToken) return queryToken;

    // 2. Check Authorization header: Bearer <token>
    const authHeader = req.headers["authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.slice(7).trim();
    }

    // 3. Check x-token header
    const xToken = req.headers["x-token"];
    if (xToken) return xToken;

    // 4. Check Cookie header: token=<token>
    const cookieHeader = req.headers["cookie"];
    if (cookieHeader) {
      const match = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/);
      if (match) return decodeURIComponent(match[1]);
    }

    return null;
  }

  /**
   * Validate token against server's active token.
   */
  isTokenValid(token) {
    if (!this.token) return false;
    if (!token || typeof token !== "string") return false;
    // Constant-time comparison to prevent timing attacks
    if (token.length !== this.token.length) return false;
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(this.token));
  }

  /**
   * Core request listener handling authentication, CORS, routing, and static files.
   */
  handleRequest(req, res) {
    // Add CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, x-token, Range"
    );
    res.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length");

    // Handle preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname;

    const isApiRequest = pathname.startsWith("/api/");
    const isStaticAsset = /\.(css|js|png|jpg|jpeg|svg|ico|webp|woff2?|ttf)$/i.test(pathname);

    // Token validation
    const token = this.extractToken(req, parsedUrl);
    const hasValidToken = this.isTokenValid(token);

    if (isApiRequest && !hasValidToken) {
      res.writeHead(401, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(
        JSON.stringify({
          error: "Unauthorized",
          message: "Valid mobile pairing token required",
        })
      );
      return;
    }

    if (!isApiRequest && !isStaticAsset && !hasValidToken) {
      const isHtmlNav = req.headers.accept && req.headers.accept.includes("text/html");
      if (!isHtmlNav) {
        res.writeHead(401, {
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(
          JSON.stringify({
            error: "Unauthorized",
            message: "Valid mobile pairing token required",
          })
        );
        return;
      }
    }

    // If query token is provided on initial page load, set HTTP cookie for seamless subsequent requests
    if (hasValidToken && parsedUrl.searchParams.has("token")) {
      res.setHeader(
        "Set-Cookie",
        `token=${encodeURIComponent(this.token)}; Path=/; SameSite=Lax`
      );
    }

    const method = req.method.toUpperCase();

    // 1. Check exact API routes
    const exactHandler = this.routes[method]?.get(pathname);
    if (exactHandler) {
      return exactHandler(req, res, { query: parsedUrl.searchParams, params: {} });
    }

    // 2. Check pattern API routes
    const patterns = this.routeRegex[method] || [];
    for (const item of patterns) {
      const match = pathname.match(item.regex);
      if (match) {
        const params = {};
        for (let i = 0; i < item.paramNames.length; i++) {
          params[item.paramNames[i]] = decodeURIComponent(match[i + 1]);
        }
        return item.handler(req, res, { query: parsedUrl.searchParams, params });
      }
    }

    // 3. Prevent unhandled API routes from falling back to SPA index.html
    if (pathname.startsWith("/api/")) {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Endpoint not found", path: pathname }));
      return;
    }

    // 4. Fallback to static file serving
    this.serveStaticFile(pathname, res);
  }

  /**
   * Serve static files from mobile client directory.
   */
  serveStaticFile(reqPath, res) {
    const staticBase = this.resolveStaticDir();
    let relativePath = reqPath === "/" ? "index.html" : reqPath.replace(/^\//, "");
    // Remove query params if any
    relativePath = relativePath.split("?")[0];

    const safePath = path.normalize(path.join(staticBase, relativePath));
    if (!safePath.startsWith(staticBase)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    fs.stat(safePath, (err, stats) => {
      if (err || !stats.isFile()) {
        // Fallback to index.html for SPA client-side routing
        const indexPath = path.join(staticBase, "index.html");
        fs.readFile(indexPath, (indexErr, content) => {
          if (indexErr) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Not Found");
            return;
          }
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(content);
        });
        return;
      }

      const ext = path.extname(safePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      const isDynamic = ext === ".html" || ext === ".js" || ext === ".css";
      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": stats.size,
        "Cache-Control": isDynamic ? "no-cache, must-revalidate" : "public, max-age=86400",
      });

      fs.createReadStream(safePath).pipe(res);
    });
  }

  /**
   * Start HTTP server, sequentially scanning ports from startPort to maxPort.
   */
  async start(options = {}) {
    if (this.running && this.server) {
      return this.getStatus();
    }

    const startPort = options.port || this.port || DEFAULT_PORT;
    const maxPort = options.maxPort || Math.max(startPort + 16, MAX_PORT);
    const host = options.host || "0.0.0.0";
    this.token = options.token || this.token || crypto.randomBytes(16).toString("hex");

    if (options.staticDir) {
      this.staticDir = options.staticDir;
    }

    return new Promise((resolve, reject) => {
      let currentPort = startPort;

      const tryBind = (p) => {
        if (p > maxPort) {
          return reject(
            new Error(`Unable to bind server: all ports in range ${startPort}-${maxPort} are in use.`)
          );
        }

        const server = http.createServer((req, res) => this.handleRequest(req, res));

        server.once("error", (err) => {
          server.close();
          if (err.code === "EADDRINUSE") {
            tryBind(p + 1);
          } else {
            reject(err);
          }
        });

        server.once("listening", () => {
          this.server = server;
          this.port = p;
          this.host = host;
          this.running = true;
          const interfaces = getAvailableInterfaces();
          const primary = getPrimaryAddress();
          const requestedAddress = options.selectedAddress;
          const isRequestedValid =
            requestedAddress && interfaces.some((i) => i.address === requestedAddress);
          this.selectedAddress = isRequestedValid ? requestedAddress : primary;
          resolve(this.getStatus());
        });

        server.listen(p, host);
      };

      tryBind(currentPort);
    });
  }

  /**
   * Stop HTTP server.
   */
  async stop() {
    if (!this.server || !this.running) {
      this.running = false;
      return this.getStatus();
    }

    return new Promise((resolve) => {
      this.server.close(() => {
        this.server = null;
        this.running = false;
        resolve(this.getStatus());
      });
    });
  }

  /**
   * Generate a new cryptographically secure token.
   */
  resetToken() {
    this.token = crypto.randomBytes(16).toString("hex");
    return this.token;
  }

  /**
   * Set active token.
   */
  setToken(token) {
    this.token = token;
  }

  /**
   * Set selected IP address for display.
   */
  setSelectedAddress(addr) {
    this.selectedAddress = addr;
  }

  /**
   * Get server status and pairing info.
   */
  getStatus() {
    const interfaces = getAvailableInterfaces();
    const primary = getPrimaryAddress();
    const isValidSelected =
      this.selectedAddress && interfaces.some((i) => i.address === this.selectedAddress);
    if (!isValidSelected) {
      this.selectedAddress = primary;
    }
    const activeAddress = this.selectedAddress || primary;
    const connectionUrl = this.running && this.token
      ? `http://${activeAddress}:${this.port}/?token=${this.token}`
      : "";

    return {
      running: this.running,
      port: this.port,
      host: this.host,
      token: this.token,
      selectedAddress: activeAddress,
      primaryAddress: primary,
      interfaces,
      connectionUrl,
    };
  }
}

// Create singleton instance
const mobileServer = new MobileServer();

module.exports = {
  MobileServer,
  mobileServer,
};
