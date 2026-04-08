import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const port = Number(process.env.OVERLAY_PORT || 4173);
const moduleDir =
  typeof __dirname === "string"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));
const dataBaseDir = path.resolve(process.env.MJS_APPDATA_DIR || ".");
const pointsDir = path.join(dataBaseDir, "points");
const settingsPath = path.join(dataBaseDir, "config", "settings.json");
const latestMatchJsonPath = path.join(dataBaseDir, "records", "match-latest.json");
const recordsSummaryPath = path.join(dataBaseDir, "records", "summary.json");
const hanSummaryPath = path.join(dataBaseDir, "records", "han-summary.json");
const overlayDir = process.pkg
  ? path.join(path.dirname(process.execPath), "overlay")
  : path.join(moduleDir, "overlay");
const overlayHtmlPath = path.join(overlayDir, "index.html");
const pointsHtmlPath = path.join(overlayDir, "points.html");
const recordsHtmlPath = path.join(overlayDir, "records.html");
const hanHtmlPath = path.join(overlayDir, "han.html");
const overlayCssPath = path.join(overlayDir, "styles.css");
const overlayThemeJsPath = path.join(overlayDir, "theme.js");
const overlayJsPath = path.join(overlayDir, "app.js");
const pointsJsPath = path.join(overlayDir, "points.js");
const recordsJsPath = path.join(overlayDir, "records.js");
const hanJsPath = path.join(overlayDir, "han.js");

const defaultOverlayDesign = {
  rank: "normal",
  points: "normal",
  records: "normal",
  han: "normal"
};
const defaultOverlayStyle = {
  textColor: "#f7f4eb",
  backgroundColor: "#ffffff",
  backgroundOpacity: 20,
  borderColor: "#ffffff",
  borderWidth: 1,
  borderRadius: 14,
  fontFamily: "Segoe UI, Meiryo UI, sans-serif"
};

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function normalizeThemeName(value) {
  return value === "frameless_white" ||
    value === "frameless_black" ||
    value === "custom"
    ? value
    : "normal";
}

function normalizeOverlayDesign(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    rank: normalizeThemeName(source.rank),
    points: normalizeThemeName(source.points),
    records: normalizeThemeName(source.records),
    han: normalizeThemeName(source.han)
  };
}

async function readOverlayDesignSettings() {
  try {
    const raw = await fs.readFile(settingsPath, "utf8");
    const parsed = JSON.parse(raw);
    const overlayDesign = normalizeOverlayDesign(parsed?.overlayDesign);
    const overlayStyle = normalizeOverlayStyle(parsed?.overlayStyle);
    return { overlayDesign, overlayStyle };
  } catch {
    return {
      overlayDesign: { ...defaultOverlayDesign },
      overlayStyle: { ...defaultOverlayStyle }
    };
  }
}

function normalizeOverlayStyle(value) {
  const source = value && typeof value === "object" ? value : {};
  const textColor =
    typeof source.textColor === "string" && /^#[0-9a-fA-F]{6}$/.test(source.textColor)
      ? source.textColor
      : defaultOverlayStyle.textColor;
  const backgroundColor =
    typeof source.backgroundColor === "string" && /^#[0-9a-fA-F]{6}$/.test(source.backgroundColor)
      ? source.backgroundColor
      : typeof source.borderColor === "string" && /^#[0-9a-fA-F]{6}$/.test(source.borderColor)
        ? source.borderColor
        : defaultOverlayStyle.backgroundColor;
  const backgroundOpacityRaw = Number(
    source.backgroundOpacity != null ? source.backgroundOpacity : source.borderOpacity
  );
  const backgroundOpacity = Number.isFinite(backgroundOpacityRaw)
    ? Math.max(0, Math.min(100, Math.round(backgroundOpacityRaw)))
    : defaultOverlayStyle.backgroundOpacity;
  const borderColor =
    typeof source.borderColor === "string" && /^#[0-9a-fA-F]{6}$/.test(source.borderColor)
      ? source.borderColor
      : defaultOverlayStyle.borderColor;
  const borderWidthRaw = Number(source.borderWidth);
  const borderWidth = Number.isFinite(borderWidthRaw)
    ? Math.max(0, Math.min(12, Math.round(borderWidthRaw)))
    : defaultOverlayStyle.borderWidth;
  const borderRadiusRaw = Number(source.borderRadius);
  const borderRadius = Number.isFinite(borderRadiusRaw)
    ? Math.max(0, Math.min(36, Math.round(borderRadiusRaw)))
    : defaultOverlayStyle.borderRadius;
  const fontFamily =
    typeof source.fontFamily === "string" && source.fontFamily.trim().length > 0
      ? source.fontFamily.trim().slice(0, 120)
      : defaultOverlayStyle.fontFamily;

  return {
    textColor,
    backgroundColor,
    backgroundOpacity,
    borderColor,
    borderWidth,
    borderRadius,
    fontFamily
  };
}

async function readTextFile(filePath) {
  return await fs.readFile(filePath, "utf8");
}

async function findLatestPointsFile() {
  try {
    const entries = await fs.readdir(pointsDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith("-latest-change.json"))
      .map((entry) => path.join(pointsDir, entry.name));

    if (files.length === 0) {
      return null;
    }

    const stats = await Promise.all(
      files.map(async (filePath) => ({
        filePath,
        stat: await fs.stat(filePath)
      }))
    );

    stats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    return stats[0].filePath;
  } catch {
    return null;
  }
}

async function findLatestMatchingFile(dirPath, suffix) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
      .map((entry) => path.join(dirPath, entry.name));

    if (files.length === 0) {
      return null;
    }

    const stats = await Promise.all(
      files.map(async (filePath) => ({
        filePath,
        stat: await fs.stat(filePath)
      }))
    );

    stats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    return stats[0].filePath;
  } catch {
    return null;
  }
}

function buildObsEmbedHtml(route) {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OBS ${route} embed</title>
    <style>
      html, body, iframe {
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: transparent;
        border: 0;
      }
    </style>
  </head>
  <body>
    <iframe id="frame" title="${route} overlay"></iframe>
    <script>
      (() => {
        const route = ${JSON.stringify(route)};
        const frame = document.getElementById("frame");
        let lastKey = "";

        const buildSrc = (theme, style) => {
          const params = new URLSearchParams();
          params.set("theme", theme);
          params.set("textColor", style?.textColor || "#f7f4eb");
          params.set("backgroundColor", style?.backgroundColor || style?.borderColor || "#ffffff");
          params.set(
            "backgroundOpacity",
            String(style?.backgroundOpacity ?? style?.borderOpacity ?? 20)
          );
          params.set("borderColor", style?.borderColor || "#ffffff");
          params.set("borderWidth", String(style?.borderWidth ?? 1));
          params.set("borderRadius", String(style?.borderRadius ?? 14));
          params.set("borderOpacity", String(style?.backgroundOpacity ?? style?.borderOpacity ?? 20));
          params.set("fontFamily", style?.fontFamily || "Segoe UI, Meiryo UI, sans-serif");
          return \`/\${route}?\${params.toString()}\`;
        };

        async function refreshTheme() {
          try {
            const response = await fetch(\`/design-config?overlay=\${route}&t=\${Date.now()}\`, { cache: "no-store" });
            const data = await response.json();
            const validThemes = new Set(["normal", "frameless_white", "frameless_black", "custom"]);
            const theme = validThemes.has(data?.theme) ? data.theme : "normal";
            const style = data?.style || {};
            const key = JSON.stringify({ theme, style });
            if (key === lastKey) {
              return;
            }

            lastKey = key;
            frame.src = buildSrc(theme, style);
          } catch {
            if (!frame.src) {
              frame.src = buildSrc("normal", {});
            }
          }
        }

        refreshTheme();
        setInterval(refreshTheme, 2000);
      })();
    </script>
  </body>
</html>`;
}

async function handleRequest(req, res) {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);

  try {
    if (url.pathname === "/" || url.pathname === "/rank") {
      const html = await readTextFile(overlayHtmlPath);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(html);
      return;
    }

    if (url.pathname === "/points") {
      const html = await readTextFile(pointsHtmlPath);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(html);
      return;
    }

    if (url.pathname === "/records") {
      const html = await readTextFile(recordsHtmlPath);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(html);
      return;
    }

    if (url.pathname === "/han") {
      const html = await readTextFile(hanHtmlPath);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(html);
      return;
    }

    if (url.pathname === "/obs/rank" || url.pathname === "/obs/points" || url.pathname === "/obs/records" || url.pathname === "/obs/han") {
      const route = url.pathname.replace("/obs/", "");
      const html = buildObsEmbedHtml(route);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(html);
      return;
    }

    if (url.pathname === "/styles.css") {
      const css = await readTextFile(overlayCssPath);
      res.writeHead(200, {
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(css);
      return;
    }

    if (url.pathname === "/theme.js") {
      const js = await readTextFile(overlayThemeJsPath);
      res.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(js);
      return;
    }

    if (url.pathname === "/app.js") {
      const js = await readTextFile(overlayJsPath);
      res.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(js);
      return;
    }

    if (url.pathname === "/points.js") {
      const js = await readTextFile(pointsJsPath);
      res.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(js);
      return;
    }

    if (url.pathname === "/records.js") {
      const js = await readTextFile(recordsJsPath);
      res.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(js);
      return;
    }

    if (url.pathname === "/han.js") {
      const js = await readTextFile(hanJsPath);
      res.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(js);
      return;
    }

    if (url.pathname === "/design-config") {
      const { overlayDesign, overlayStyle } = await readOverlayDesignSettings();
      const overlay = url.searchParams.get("overlay");
      if (overlay === "rank" || overlay === "points" || overlay === "records" || overlay === "han") {
        sendJson(res, 200, {
          overlay,
          theme: overlayDesign[overlay],
          style: overlayStyle,
          all: overlayDesign
        });
        return;
      }

      sendJson(res, 200, { all: overlayDesign, style: overlayStyle });
      return;
    }

    if (url.pathname === "/data") {
      try {
        const latestPointsPath = await findLatestPointsFile();
        if (!latestPointsPath) {
          throw new Error("latest points snapshot not found");
        }
        const raw = await fs.readFile(latestPointsPath, "utf8");
        const payload = JSON.parse(raw);
        const startFile = await findLatestMatchingFile(pointsDir, "-start.json");
        if (startFile) {
          try {
            payload.__pointsStart = JSON.parse(await fs.readFile(startFile, "utf8"));
          } catch {
            // ignore parse/read failure
          }
        }
        sendJson(res, 200, payload);
      } catch (error) {
        sendJson(res, 200, {
          ok: false,
          message: "latest points snapshot not found yet",
          detail: String(error.message || error)
        });
      }
      return;
    }

    if (url.pathname === "/match-data") {
      try {
        const raw = await fs.readFile(latestMatchJsonPath, "utf8");
        sendJson(res, 200, JSON.parse(raw));
      } catch (error) {
        sendJson(res, 200, {
          ok: false,
          message: "mjs-match-latest.json not found yet",
          detail: String(error.message || error)
        });
      }
      return;
    }

    if (url.pathname === "/records-data") {
      try {
        const raw = await fs.readFile(recordsSummaryPath, "utf8");
        sendJson(res, 200, JSON.parse(raw));
      } catch {
        sendJson(res, 200, {
          counts: {
            1: 0,
            2: 0,
            3: 0,
            4: 0
          }
        });
      }
      return;
    }

    if (url.pathname === "/han-data") {
      try {
        const raw = await fs.readFile(hanSummaryPath, "utf8");
        sendJson(res, 200, JSON.parse(raw));
      } catch {
        sendJson(res, 200, {
          updatedAt: null,
          scope: "self_only",
          counts: Object.fromEntries([
            ["1", 0],
            ["2", 0],
            ["3", 0],
            ["4", 0],
            ["5", 0],
            ["6", 0],
            ["7", 0],
            ["8", 0],
            ["9", 0],
            ["10", 0],
            ["11", 0],
            ["12", 0],
            ["13", 0],
            ["13+", 0]
          ])
        });
      }
      return;
    }

    sendJson(res, 404, { ok: false, message: "Not found" });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      message: "Server error",
      detail: String(error.message || error)
    });
  }
}

export async function main() {
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      sendJson(res, 500, {
        ok: false,
        message: "Unhandled server error",
        detail: String(error.message || error)
      });
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", (error) => {
      if (error && error.code === "EADDRINUSE") {
        console.log(`Overlay server already running on http://127.0.0.1:${port}/rank`);
        resolve();
        return;
      }
      reject(error);
    });

    server.listen(port, "127.0.0.1", () => {
      console.log(`Overlay server listening on http://127.0.0.1:${port}/rank`);
      resolve();
    });
  });
}

const isDirectRun = process.argv[1] != null && /overlay-server\.js$/i.test(process.argv[1]);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
