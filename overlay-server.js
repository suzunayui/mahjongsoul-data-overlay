import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const port = Number(process.env.OVERLAY_PORT || 4173);
const pointsDir = path.resolve("points");
const latestMatchJsonPath = path.resolve("records", "match-latest.json");
const recordsSummaryPath = path.resolve("records", "summary.json");
const overlayHtmlPath = path.resolve("overlay", "index.html");
const pointsHtmlPath = path.resolve("overlay", "points.html");
const recordsHtmlPath = path.resolve("overlay", "records.html");
const overlayCssPath = path.resolve("overlay", "styles.css");
const overlayJsPath = path.resolve("overlay", "app.js");
const pointsJsPath = path.resolve("overlay", "points.js");
const recordsJsPath = path.resolve("overlay", "records.js");

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body));
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

    if (url.pathname === "/styles.css") {
      const css = await readTextFile(overlayCssPath);
      res.writeHead(200, {
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(css);
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

    sendJson(res, 404, { ok: false, message: "Not found" });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      message: "Server error",
      detail: String(error.message || error)
    });
  }
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    sendJson(res, 500, {
      ok: false,
      message: "Unhandled server error",
      detail: String(error.message || error)
    });
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Overlay server listening on http://127.0.0.1:${port}/rank`);
});
