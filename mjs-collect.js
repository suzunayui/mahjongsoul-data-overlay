import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  collectRuntimeHints,
  collectVisibleHints,
  debugPort,
  extractProfileData,
  installHooks,
  isInterestingTextPayload,
  isInterestingUrl,
  matchesRankHint,
  rankAssetPattern,
  summarizeEntry
} from "./mjs-common.js";

const pointsDir = path.resolve("points");
const pollMs = Number(process.env.MJS_POLL_MS || 2000);

function toDailyPointsSnapshot(report) {
  const extracted = report?.extractedProfile?.extracted || {};
  return {
    createdAt: report.createdAt,
    pageUrl: report.pageUrl,
    accountId: extracted.accountId ?? null,
    nickname: extracted.nickname ?? null,
    yonma: extracted.level
      ? {
          id: extracted.level.id ?? null,
          rankName: extracted.level.rankName ?? null,
          rankCode: extracted.level.rankCode ?? null,
          star: extracted.level.star ?? null,
          score: extracted.level.score ?? null,
          endPoint: extracted.levelDefinition?.yonma?.end_point ?? null
        }
      : null,
    sanma: extracted.level3
      ? {
          id: extracted.level3.id ?? null,
          rankName: extracted.level3.rankName ?? null,
          rankCode: extracted.level3.rankCode ?? null,
          star: extracted.level3.star ?? null,
          score: extracted.level3.score ?? null,
          endPoint: extracted.levelDefinition?.sanma?.end_point ?? null
        }
      : null
  };
}

function getPointsFingerprint(snapshot) {
  return JSON.stringify({
    yonma: snapshot.yonma,
    sanma: snapshot.sanma
  });
}

async function buildReport(page, networkHits) {
  const visibleHints = await collectVisibleHints(page);
  const runtimeHints = await collectRuntimeHints(page);
  const extractedProfile = await extractProfileData(page);
  const capturedInPage = await page.evaluate(() => window.__mjsCaptured || []);

  return {
    createdAt: new Date().toISOString(),
    pageUrl: page.url(),
    visibleHints,
    runtimeHints,
    extractedProfile,
    networkHints: [...networkHits, ...capturedInPage]
      .slice(-80)
      .map((entry) => summarizeEntry(entry))
  };
}

function pickWatchedState(report) {
  return {
    pageUrl: report.pageUrl,
    extractedProfile: report.extractedProfile
  };
}

async function updatePointsFiles(report) {
  const snapshot = toDailyPointsSnapshot(report);
  const dateKey = report.createdAt.slice(0, 10);
  const startPath = path.join(pointsDir, `${dateKey}-start.json`);
  const latestPath = path.join(pointsDir, `${dateKey}-latest-change.json`);

  await fs.mkdir(pointsDir, { recursive: true });

  try {
    await fs.access(startPath);
  } catch {
    await fs.writeFile(startPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  }

  let previous = null;
  try {
    previous = JSON.parse(await fs.readFile(latestPath, "utf8"));
  } catch {
    previous = null;
  }

  if (!previous || getPointsFingerprint(previous) !== getPointsFingerprint(snapshot)) {
    await fs.writeFile(latestPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    return { changed: true, latestPath, startPath };
  }

  return { changed: false, latestPath, startPath };
}

async function main() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const context = browser.contexts()[0];

  if (!context) {
    throw new Error(`No browser context found on port ${debugPort}. Start npm.cmd run mjs:launch first.`);
  }

  const page =
    context.pages().find((candidate) => candidate.url().includes("mahjongsoul")) ||
    context.pages()[0];

  if (!page) {
    throw new Error("No page found in the connected browser.");
  }

  await installHooks(page);

  const networkHits = [];

  page.on("response", async (response) => {
    const url = response.url();
    if (!isInterestingUrl(url)) {
      return;
    }
    try {
      const headers = await response.allHeaders();
      const contentType = headers["content-type"] || "";
      if (!/json|text|javascript/.test(contentType) && !rankAssetPattern.test(url)) {
        return;
      }

      const text = await response.text();
      if (!isInterestingTextPayload(text) && !rankAssetPattern.test(url)) {
        return;
      }

      networkHits.push({
        kind: "response",
        url,
        status: response.status(),
        contentType,
        body: rankAssetPattern.test(url) ? undefined : text.slice(0, 1200)
      });
    } catch (error) {
      networkHits.push({
        kind: "response-error",
        url,
        error: String(error)
      });
    }
  });

  page.on("websocket", (ws) => {
    ws.on("framereceived", ({ payload }) => {
      const text = typeof payload === "string" ? payload : "";
      if (matchesRankHint(text)) {
        networkHits.push({
          kind: "websocket",
          url: ws.url(),
          body: text.slice(0, 1200)
        });
      }
    });
  });

  console.log(`Connected page: ${page.url()}`);
  console.log(`Watching for changes every ${pollMs}ms.`);
  console.log(`Points snapshots: ${pointsDir}`);
  console.log("Keep this process running while you use Mahjongsoul.");

  let lastFingerprint = "";

  const saveSnapshot = async (reason) => {
    const report = await buildReport(page, networkHits);
    const watchedState = pickWatchedState(report);
    const fingerprint = JSON.stringify(watchedState);
    if (fingerprint === lastFingerprint) {
      return;
    }

    lastFingerprint = fingerprint;
    const pointsResult = await updatePointsFiles(report);
    if (pointsResult.changed) {
      console.log(
        `[${report.createdAt}] Updated points snapshots: ${pointsResult.startPath} / ${pointsResult.latestPath}`
      );
    }
  };

  await saveSnapshot("initial");

  const interval = setInterval(() => {
    saveSnapshot("poll").catch((error) => {
      console.error(error);
    });
  }, pollMs);

  const shutdown = async () => {
    clearInterval(interval);
    await browser.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    shutdown().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  });

  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
