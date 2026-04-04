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

async function extractProfileDataForPkg(page) {
  return await page.evaluate(`
    (() => {
      const accountData = window.GameMgr?.Inst?.account_data ?? null;
      const cfgRoot = window.cfg ?? null;

      const parseRankLevel = (value) => {
        if (!value || typeof value !== "object") {
          return null;
        }
        const id = typeof value.id === "number" ? value.id : null;
        const score = typeof value.score === "number" ? value.score : null;
        if (id == null) {
          return null;
        }
        const idString = String(id).padStart(5, "0");
        const modeCode = Number(idString.slice(0, 1));
        const rankCode = Number(idString.slice(1, 3));
        const star = Number(idString.slice(3, 5));
        const modeNameMap = { 1: "yonma", 2: "sanma" };
        const rankNameMap = {
          1: "\\u521d\\u5fc3",
          2: "\\u96c0\\u58eb",
          3: "\\u96c0\\u5091",
          4: "\\u96c0\\u8c6a",
          5: "\\u96c0\\u8056",
          6: "\\u9b42\\u5929"
        };
        return {
          id,
          score,
          modeCode,
          modeName: modeNameMap[modeCode] || null,
          rankCode,
          rankName: rankNameMap[rankCode] || null,
          star
        };
      };

      const findConfigEntry = (root, targetId) => {
        if (!root || targetId == null) {
          return null;
        }
        const direct = root[targetId] ?? root[String(targetId)] ?? null;
        if (direct) {
          return direct;
        }
        const queue = [root];
        const seen = new WeakSet();
        while (queue.length > 0) {
          const current = queue.shift();
          if (!current || typeof current !== "object") {
            continue;
          }
          if (seen.has(current)) {
            continue;
          }
          seen.add(current);
          if (Array.isArray(current)) {
            const found = current.find((item) => item && typeof item === "object" && item.id === targetId);
            if (found) {
              return found;
            }
            for (const item of current.slice(0, 50)) {
              if (item && typeof item === "object") {
                queue.push(item);
              }
            }
            continue;
          }
          for (const key of Reflect.ownKeys(current).filter((key) => typeof key === "string").slice(0, 80)) {
            let item;
            try {
              item = current[key];
            } catch {
              continue;
            }
            if (item && typeof item === "object" && item.id === targetId) {
              return item;
            }
            if (item && typeof item === "object") {
              queue.push(item);
            }
          }
        }
        return null;
      };

      const summarizeValue = (value) => {
        if (!value || typeof value !== "object") {
          return value;
        }
        const out = {};
        for (const key of Reflect.ownKeys(value).filter((key) => typeof key === "string").slice(0, 30)) {
          let item;
          try {
            item = value[key];
          } catch {
            continue;
          }
          if (
            item == null ||
            typeof item === "string" ||
            typeof item === "number" ||
            typeof item === "boolean"
          ) {
            out[key] = item;
          }
        }
        return out;
      };

      const level = parseRankLevel(accountData?.level);
      const level3 = parseRankLevel(accountData?.level3);
      const levelDefinitionRoot = cfgRoot?.level_definition ?? null;

      return {
        accountData: {
          account_id: accountData?.account_id ?? null,
          nickname: accountData?.nickname ?? null,
          title: accountData?.title ?? null
        },
        extracted: {
          accountId: accountData?.account_id ?? null,
          nickname: accountData?.nickname ?? null,
          title: accountData?.title ?? null,
          level,
          level3,
          levelDefinition: {
            yonma: summarizeValue(findConfigEntry(levelDefinitionRoot, level?.id)),
            sanma: summarizeValue(findConfigEntry(levelDefinitionRoot, level3?.id))
          },
          rankIntroduce: {
            yonma: null,
            sanma: null
          },
          scoreCandidates: {}
        }
      };
    })()
  `);
}

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
  let visibleHints = null;
  let runtimeHints = null;
  let extractedProfile;

  if (!process.pkg) {
    try {
      visibleHints = await collectVisibleHints(page);
    } catch (error) {
      console.error("collectVisibleHints failed:", error);
      throw error;
    }

    try {
      runtimeHints = await collectRuntimeHints(page);
    } catch (error) {
      console.error("collectRuntimeHints failed:", error);
      throw error;
    }
  }

  try {
    extractedProfile = process.pkg ? await extractProfileDataForPkg(page) : await extractProfileData(page);
  } catch (error) {
    console.error("extractProfileData failed:", error);
    throw error;
  }

  const capturedInPage = await page.evaluate("window.__mjsCaptured || []");

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

export async function main() {
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

const isDirectRun = process.argv[1] != null && /mjs-collect\.js$/i.test(process.argv[1]);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
