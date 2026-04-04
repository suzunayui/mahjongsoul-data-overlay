import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { debugPort, installHooks } from "./mjs-common.js";

const recordsDir = path.resolve("records");
const latestMatchStatePath = path.join(recordsDir, "match-latest.json");
const recordSeenKeysPath = path.join(recordsDir, "seen-record-keys.json");
const pollMs = Number(process.env.MJS_MATCH_POLL_MS || 1000);

async function extractMatchState(page) {
  return await page.evaluate("window.__mjsExtractMatchState()");
}

async function writeLatestMatchState(snapshot) {
  await fs.mkdir(recordsDir, { recursive: true });
  await fs.writeFile(latestMatchStatePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

function formatTimestampParts(isoString) {
  const date = new Date(isoString);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return {
    dateKey: `${yyyy}-${mm}-${dd}`,
    timeLabel: `${hh}:${mi}`
  };
}

function buildRecordKey(snapshot) {
  const players = Array.isArray(snapshot.gameEndSummary) ? snapshot.gameEndSummary : [];
  return JSON.stringify(
    players.map((player) => ({
      accountId: player.accountId ?? null,
      nickname: player.nickname ?? null,
      score: player.score ?? null,
      totalPoint: player.totalPoint ?? null
    }))
  );
}

async function appendMatchRecord(snapshot) {
  const sourcePlayers = Array.isArray(snapshot.extractedPlayers) ? snapshot.extractedPlayers : [];
  if (sourcePlayers.length === 0) {
    return { written: false, reason: "no-extracted-players" };
  }

  const ranked = sourcePlayers
    .filter(
      (player) =>
        typeof player.score === "number" &&
        player.name &&
        !(player.score === 0 && player.accountId === snapshot.selfAccountId)
    )
    .sort((a, b) => b.score - a.score)
    .map((player, index) => ({
      place: index + 1,
      accountId: player.accountId ?? null,
      nickname: player.name || `player-${player.index}`,
      score: player.score,
      totalPoint:
        snapshot.gameEndSummary?.find((item) => typeof item.score === "number" && item.score === player.score)
          ?.totalPoint ?? null
    }));

  if (ranked.length === 0) {
    return { written: false, reason: "no-ranked-players" };
  }

  const { dateKey, timeLabel } = formatTimestampParts(snapshot.createdAt);
  const filePath = path.join(recordsDir, `${dateKey}.txt`);
  const summaryPath = path.join(recordsDir, "summary.json");
  await fs.mkdir(recordsDir, { recursive: true });

  const lines = ranked.map((player) => {
    const totalPointSuffix =
      typeof player.totalPoint === "number" ? ` (${player.totalPoint >= 0 ? "+" : ""}${player.totalPoint})` : "";
    return `${player.place}位 ${player.nickname} ${player.score}${totalPointSuffix}`;
  });
  const recordText = `[${timeLabel}] ${lines.join(" / ")}`;
  const dedupeKey = JSON.stringify({
    dateKey,
    timeLabel,
    ranked: ranked.map((player) => ({
      place: player.place,
      accountId: player.accountId ?? null,
      nickname: player.nickname,
      score: player.score,
      totalPoint: player.totalPoint ?? null
    }))
  });

  let seenKeys = [];
  try {
    seenKeys = JSON.parse(await fs.readFile(recordSeenKeysPath, "utf8"));
    if (!Array.isArray(seenKeys)) {
      seenKeys = [];
    }
  } catch {
    seenKeys = [];
  }

  if (seenKeys.includes(dedupeKey)) {
    return { written: false, reason: "duplicate-record", filePath, summaryPath };
  }

  await fs.appendFile(filePath, `${recordText}\n`, "utf8");

  const selfPlace =
    ranked.find((player) => player.accountId != null && player.accountId === snapshot.selfAccountId)?.place ?? null;

  let summary = {
    updatedAt: snapshot.createdAt,
    selfAccountId: snapshot.selfAccountId ?? null,
    selfNickname: snapshot.selfNickname ?? null,
    counts: {
      1: 0,
      2: 0,
      3: 0,
      4: 0
    }
  };

  try {
    summary = JSON.parse(await fs.readFile(summaryPath, "utf8"));
  } catch {
    // keep default
  }

  summary.updatedAt = snapshot.createdAt;
  summary.selfAccountId = snapshot.selfAccountId ?? summary.selfAccountId ?? null;
  summary.selfNickname = snapshot.selfNickname ?? summary.selfNickname ?? null;
  if (!summary.counts) {
    summary.counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  }
  if (selfPlace && summary.counts[selfPlace] != null) {
    summary.counts[selfPlace] += 1;
  }

  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  seenKeys.push(dedupeKey);
  if (seenKeys.length > 500) {
    seenKeys = seenKeys.slice(-500);
  }
  await fs.writeFile(recordSeenKeysPath, `${JSON.stringify(seenKeys, null, 2)}\n`, "utf8");

  return { written: true, filePath, summaryPath, selfPlace };
}

async function dedupeDailyRecordFiles() {
  await fs.mkdir(recordsDir, { recursive: true });
  const entries = await fs.readdir(recordsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !/^\d{4}-\d{2}-\d{2}\.txt$/.test(entry.name)) {
      continue;
    }

    const filePath = path.join(recordsDir, entry.name);
    const raw = await fs.readFile(filePath, "utf8");
    const lines = raw
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);
    const uniqueLines = [...new Set(lines)];
    if (uniqueLines.length !== lines.length) {
      await fs.writeFile(filePath, `${uniqueLines.join("\n")}\n`, "utf8");
    }
  }
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
  await dedupeDailyRecordFiles();

  console.log(`Connected page: ${page.url()}`);
  console.log(`Watching match state every ${pollMs}ms`);
  console.log(`Latest match state: ${latestMatchStatePath}`);
  console.log(`Match records: ${recordsDir}`);

  let lastFingerprint = "";
  let lastRecordKey = "";
  let initializedRecordBaseline = false;

  const saveSnapshot = async (reason) => {
    const snapshot = await extractMatchState(page);
    const fingerprint = JSON.stringify({
      inGame: snapshot.inGame,
      extractedPlayers: snapshot.extractedPlayers,
      scoreCandidates: snapshot.scoreCandidates,
      playerSummaries: snapshot.playerSummaries.map((player) => player.snapshot)
    });

    if (fingerprint === lastFingerprint) {
      return;
    }

    lastFingerprint = fingerprint;
    await writeLatestMatchState(snapshot);
    console.log(`[${snapshot.createdAt}] Updated latest match state (${reason}): ${latestMatchStatePath}`);

    if (!snapshot.inGame) {
      const recordKey = buildRecordKey(snapshot);

      if (!initializedRecordBaseline) {
        lastRecordKey = recordKey !== "[]" ? recordKey : "";
        initializedRecordBaseline = true;
        return;
      }

      if (recordKey !== "[]" && recordKey !== lastRecordKey) {
        const recordResult = await appendMatchRecord(snapshot);
        if (recordResult.written) {
          console.log(`[${snapshot.createdAt}] Appended match record: ${recordResult.filePath}`);
          if (recordResult.summaryPath) {
            console.log(`[${snapshot.createdAt}] Updated record summary: ${recordResult.summaryPath}`);
          }
          lastRecordKey = recordKey;
        }
      }
    } else if (!initializedRecordBaseline) {
      initializedRecordBaseline = true;
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

const isDirectRun = process.argv[1] != null && /mjs-match-watch\.js$/i.test(process.argv[1]);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
