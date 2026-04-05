import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { appDataBaseDir, debugPort, installHooks } from "./mjs-common.js";

const recordsDir = path.join(appDataBaseDir, "records");
const debugOutputDir = path.join(appDataBaseDir, "output");
const latestMatchStatePath = path.join(recordsDir, "match-latest.json");
const recordSeenKeysPath = path.join(recordsDir, "seen-record-keys.json");
const hanEventsPath = path.join(recordsDir, "han-events.json");
const hanSeenKeysPath = path.join(recordsDir, "seen-han-keys.json");
const hanSummaryPath = path.join(recordsDir, "han-summary.json");
const riichiEventsPath = path.join(recordsDir, "riichi-events.json");
const settingsPath = path.join(appDataBaseDir, "config", "settings.json");
const pollMs = Number(process.env.MJS_MATCH_POLL_MS || 1000);
const shouldWriteDebugOutput = !process.pkg || process.env.MJS_WRITE_DEBUG_OUTPUT === "1";

async function extractMatchState(page) {
  return await page.evaluate("window.__mjsExtractMatchState()");
}

async function writeLatestMatchState(snapshot) {
  await fs.mkdir(recordsDir, { recursive: true });
  await fs.writeFile(latestMatchStatePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

async function outputDirExists() {
  if (shouldWriteDebugOutput) {
    await fs.mkdir(debugOutputDir, { recursive: true });
    return true;
  }
  try {
    const stat = await fs.stat(debugOutputDir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function createSafeTimestamp(isoString) {
  return isoString.replaceAll(":", "-").replaceAll(".", "-");
}

function hasHuleLikeData(snapshot) {
  return (
    (Array.isArray(snapshot.huleCandidates) && snapshot.huleCandidates.length > 0) ||
    (Array.isArray(snapshot.actionMapSummaries) && snapshot.actionMapSummaries.length > 0)
  );
}

function hasRiichiLikeData(snapshot) {
  return (
    snapshot?.latestRiichiSummary != null ||
    snapshot?.latestRiichiSnapshot != null ||
    snapshot?.latestSelfRiichiEvent != null ||
    (Array.isArray(snapshot?.recentRiichiSnapshots) && snapshot.recentRiichiSnapshots.length > 0) ||
    (Array.isArray(snapshot?.riichiCaptureMeta?.actionNames) && snapshot.riichiCaptureMeta.actionNames.length > 0)
  );
}

async function writeDebugOutput(snapshot, reason) {
  if (!(await outputDirExists())) {
    return;
  }

  const latestDebugPath = path.join(debugOutputDir, "match-debug-latest.json");
  await fs.writeFile(latestDebugPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  if (reason === "initial") {
    return;
  }

  if (!hasHuleLikeData(snapshot) && !hasRiichiLikeData(snapshot) && snapshot.inGame) {
    return;
  }

  const timestamp = createSafeTimestamp(snapshot.createdAt);
  const filePath = path.join(debugOutputDir, `match-debug-${timestamp}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
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

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildSelfRiichiEvent(snapshot) {
  const selfRiichiState = snapshot?.selfRiichiState;
  const hasVisibleRiichiCue =
    selfRiichiState?.transLiqiState?.activeInHierarchy === true ||
    selfRiichiState?.liqibangState?.activeInHierarchy === true ||
    selfRiichiState?.selfRiichiHint === true;
  if (!selfRiichiState || hasVisibleRiichiCue !== true) {
    return null;
  }

  return {
    capturedAt: snapshot.createdAt,
    selfAccountId: snapshot.selfAccountId ?? null,
    selfNickname: snapshot.selfNickname ?? null,
    selfAbsoluteSeat: snapshot.selfAbsoluteSeat ?? null,
    seat: selfRiichiState.relativeSeat ?? null,
    seatJp: selfRiichiState.relativeSeatJp ?? null,
    score: typeof selfRiichiState.score === "number" ? selfRiichiState.score : null,
    liqiOperation: typeof selfRiichiState.liqiOperation === "number" ? selfRiichiState.liqiOperation : null,
    handTileCount: typeof selfRiichiState.handTileCount === "number" ? selfRiichiState.handTileCount : null,
    canDiscard: typeof selfRiichiState.canDiscard === "boolean" ? selfRiichiState.canDiscard : null,
    transLiqiState: selfRiichiState.transLiqiState ?? null,
    liqibangState: selfRiichiState.liqibangState ?? null,
    selfRiichiHint: selfRiichiState.selfRiichiHint === true
  };
}

function detectSelfRiichiTransition(previousState, currentState) {
  if (!currentState) {
    return false;
  }
  if (!previousState) {
    return false;
  }

  const prevTransVisible = previousState?.transLiqiState?.activeInHierarchy === true;
  const currTransVisible = currentState?.transLiqiState?.activeInHierarchy === true;
  const prevStickVisible = previousState?.liqibangState?.activeInHierarchy === true;
  const currStickVisible = currentState?.liqibangState?.activeInHierarchy === true;
  const tileCountDropToRiichi =
    previousState?.handTileCount === 14 &&
    currentState?.handTileCount === 13 &&
    previousState?.canDiscard === true &&
    currentState?.canDiscard === false &&
    currentState?.liqiOperation === 7;

  return (
    (prevTransVisible === false && currTransVisible === true) ||
    (prevStickVisible === false && currStickVisible === true) ||
    tileCountDropToRiichi
  );
}

async function appendRiichiEvent(event) {
  if (!event) {
    return { written: false, reason: "no-riichi-event" };
  }

  let events = await readJsonFile(riichiEventsPath, []);
  if (!Array.isArray(events)) {
    events = [];
  }

  const previous = events.at(-1) ?? null;
  const isDuplicate =
    previous?.capturedAt === event.capturedAt &&
    previous?.selfAccountId === event.selfAccountId &&
    previous?.selfAbsoluteSeat === event.selfAbsoluteSeat;
  if (isDuplicate) {
    return { written: false, reason: "duplicate-riichi-event" };
  }

  events.push(event);
  if (events.length > 1000) {
    events = events.slice(-1000);
  }

  await writeJsonFile(riichiEventsPath, events);
  return { written: true, event };
}

function normalizeHuleEvent(snapshot) {
  const summary = snapshot?.latestHuleSummary;
  if (summary && Array.isArray(summary.hules) && summary.hules.length > 0) {
    return {
      capturedAt: summary.capturedAt ?? snapshot.createdAt,
      actionName: summary.actionName ?? null,
      selfAbsoluteSeat: snapshot.selfAbsoluteSeat ?? null,
      hules: summary.hules.map((hule) => ({
        seat: typeof hule?.seat === "number" ? hule.seat : null,
        count: typeof hule?.count === "number" ? hule.count : null,
        fu: typeof hule?.fu === "number" ? hule.fu : null,
        zimo: Boolean(hule?.zimo),
        yiman: Boolean(hule?.yiman),
        titleId: typeof hule?.titleId === "number" ? hule.titleId : null,
        pointRong: typeof hule?.pointRong === "number" ? hule.pointRong : null,
        pointSum: typeof hule?.pointSum === "number" ? hule.pointSum : null,
        dadian: typeof hule?.dadian === "number" ? hule.dadian : null,
        fans: []
      })),
      oldScores: Array.isArray(summary.oldScores) ? summary.oldScores : [],
      deltaScores: Array.isArray(summary.deltaScores) ? summary.deltaScores : [],
      scores: Array.isArray(summary.scores) ? summary.scores : []
    };
  }

  const source = snapshot?.latestHuleSnapshot;
  const payload = source?.args?.[0]?.msg;
  const hules = Array.isArray(payload?.hules) ? payload.hules : [];
  if (!source || hules.length === 0) {
    return null;
  }

  return {
    capturedAt: source.capturedAt ?? snapshot.createdAt,
    actionName: source.actionName ?? null,
    selfAbsoluteSeat: snapshot.selfAbsoluteSeat ?? null,
    hules: hules.map((hule) => ({
      seat: typeof hule?.seat === "number" ? hule.seat : null,
      count: typeof hule?.count === "number" ? hule.count : null,
      fu: typeof hule?.fu === "number" ? hule.fu : null,
      zimo: Boolean(hule?.zimo),
      yiman: Boolean(hule?.yiman),
      titleId: typeof hule?.title_id === "number" ? hule.title_id : null,
      pointRong: typeof hule?.point_rong === "number" ? hule.point_rong : null,
      pointSum: typeof hule?.point_sum === "number" ? hule.point_sum : null,
      dadian: typeof hule?.dadian === "number" ? hule.dadian : null,
      fans: Array.isArray(hule?.fans)
        ? hule.fans.map((fan) => ({
            id: typeof fan?.id === "number" ? fan.id : null,
            val: typeof fan?.val === "number" ? fan.val : null
          }))
        : []
    })),
    oldScores: Array.isArray(payload?.old_scores) ? payload.old_scores : [],
    deltaScores: Array.isArray(payload?.delta_scores) ? payload.delta_scores : [],
    scores: Array.isArray(payload?.scores) ? payload.scores : []
  };
}

function buildHanEventKey(event) {
  return JSON.stringify({
    capturedAt: event.capturedAt,
    actionName: event.actionName,
    hules: event.hules.map((hule) => ({
      seat: hule.seat,
      count: hule.count,
      fu: hule.fu,
      zimo: hule.zimo,
      yiman: hule.yiman,
      titleId: hule.titleId,
      pointRong: hule.pointRong,
      pointSum: hule.pointSum
    }))
  });
}

function inferEffectiveHan(hule) {
  const count = Number(hule?.count);
  if (!Number.isFinite(count) || count <= 0) {
    return 0;
  }

  if (hule?.yiman) {
    return count * 13;
  }

  const pointRong = Number(hule?.pointRong);
  const pointSum = Number(hule?.pointSum);
  const dadian = Number(hule?.dadian);

  // Fallback for older snapshots where yiman was not persisted.
  // Yakuman-class hands have final values far above normal han-based hands.
  if (
    count <= 4 &&
    (
      (Number.isFinite(pointRong) && pointRong >= 48000) ||
      (Number.isFinite(pointSum) && pointSum >= 32000) ||
      (Number.isFinite(dadian) && dadian >= 32000)
    )
  ) {
    return count * 13;
  }

  return count;
}

async function appendHanEvent(snapshot) {
  const event = normalizeHuleEvent(snapshot);
  if (!event) {
    return { written: false, reason: "no-hule-event" };
  }

  await fs.mkdir(recordsDir, { recursive: true });

  let seenKeys = await readJsonFile(hanSeenKeysPath, []);
  if (!Array.isArray(seenKeys)) {
    seenKeys = [];
  }

  const key = buildHanEventKey(event);
  if (seenKeys.includes(key)) {
    return { written: false, reason: "duplicate-hule-event" };
  }

  let events = await readJsonFile(hanEventsPath, []);
  if (!Array.isArray(events)) {
    events = [];
  }

  events.push(event);
  if (events.length > 1000) {
    events = events.slice(-1000);
  }

  seenKeys.push(key);
  if (seenKeys.length > 1000) {
    seenKeys = seenKeys.slice(-1000);
  }

  await writeJsonFile(hanEventsPath, events);
  await writeJsonFile(hanSeenKeysPath, seenKeys);
  return { written: true, event };
}

async function rebuildHanSummary() {
  const settings = await readJsonFile(settingsPath, { hanCountScope: "all_players" });
  const events = await readJsonFile(hanEventsPath, []);
  const scope =
    settings?.hanCountScope === "all_players" || settings?.hanCountScope === "self_with_ron_loss"
      ? settings.hanCountScope
      : "self_only";
  const counts = {};
  let totalHan = 0;

  for (let han = 1; han <= 13; han += 1) {
    counts[String(han)] = 0;
  }
  counts["13+"] = 0;

  for (const event of Array.isArray(events) ? events : []) {
    const selfSeat = typeof event?.selfAbsoluteSeat === "number" ? event.selfAbsoluteSeat : null;
    const hules = Array.isArray(event?.hules) ? event.hules : [];
    const deltaScores = Array.isArray(event?.deltaScores) ? event.deltaScores : [];
    const selfDelta =
      selfSeat != null && Number.isFinite(Number(deltaScores[selfSeat])) ? Number(deltaScores[selfSeat]) : null;

    for (const hule of hules) {
      const effectiveHan = inferEffectiveHan(hule);
      if (effectiveHan <= 0) {
        continue;
      }

      if (scope === "all_players") {
        totalHan += effectiveHan;
      } else if (scope === "self_only") {
        if (selfSeat == null || hule?.seat !== selfSeat) {
          continue;
        }
        totalHan += effectiveHan;
      } else if (scope === "self_with_ron_loss") {
        if (selfSeat == null) {
          continue;
        }
        if (hule?.seat === selfSeat) {
          totalHan += effectiveHan;
        } else if (hule?.zimo === false && selfDelta != null && selfDelta < 0) {
          totalHan -= effectiveHan;
        } else {
          continue;
        }
      } else {
        continue;
      }

      if (effectiveHan >= 13) {
        counts["13+"] += 1;
      } else {
        counts[String(effectiveHan)] += 1;
      }
    }
  }

  const summary = {
    updatedAt: new Date().toISOString(),
    scope,
    totalHan,
    counts
  };

  await writeJsonFile(hanSummaryPath, summary);
  return summary;
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
  if (await outputDirExists()) {
    console.log(`Debug output: ${debugOutputDir}`);
  }

  let lastFingerprint = "";
  let lastRecordKey = "";
  let initializedRecordBaseline = false;
  let lastHanKey = "";
  let initializedHanBaseline = false;
  let lastSelfRiichiLike = false;
  let initializedSelfRiichiBaseline = false;
  let lastSelfRiichiState = null;

  const saveSnapshot = async (reason) => {
    const snapshot = await extractMatchState(page);
    const currentSelfRiichiLike = snapshot?.selfRiichiState?.isRiichiLike === true;
    const justSelfRiichi =
      initializedSelfRiichiBaseline &&
      (
        (lastSelfRiichiLike === false && currentSelfRiichiLike === true) ||
        detectSelfRiichiTransition(lastSelfRiichiState, snapshot?.selfRiichiState)
      );
    const latestSelfRiichiEvent = justSelfRiichi ? buildSelfRiichiEvent(snapshot) : null;
    const enrichedSnapshot = {
      ...snapshot,
      selfJustRiichi: justSelfRiichi,
      latestSelfRiichiEvent
    };
    const fingerprint = JSON.stringify({
      inGame: enrichedSnapshot.inGame,
      extractedPlayers: enrichedSnapshot.extractedPlayers,
      latestHuleSnapshot: enrichedSnapshot.latestHuleSnapshot,
      recentHuleSnapshots: enrichedSnapshot.recentHuleSnapshots,
      latestRiichiSnapshot: enrichedSnapshot.latestRiichiSnapshot,
      latestRiichiSummary: enrichedSnapshot.latestRiichiSummary,
      recentRiichiSnapshots: enrichedSnapshot.recentRiichiSnapshots,
      riichiCaptureMeta: enrichedSnapshot.riichiCaptureMeta,
      selfRiichiState: enrichedSnapshot.selfRiichiState,
      activeRiichiPlayers: enrichedSnapshot.activeRiichiPlayers,
      playerRiichiStates: enrichedSnapshot.playerRiichiStates,
      selfJustRiichi: enrichedSnapshot.selfJustRiichi,
      latestSelfRiichiEvent: enrichedSnapshot.latestSelfRiichiEvent,
      scoreCandidates: enrichedSnapshot.scoreCandidates,
      playerSummaries: enrichedSnapshot.playerSummaries.map((player) => player.snapshot)
    });

    if (fingerprint === lastFingerprint) {
      return;
    }

    lastFingerprint = fingerprint;
    await writeLatestMatchState(enrichedSnapshot);
    await writeDebugOutput(enrichedSnapshot, reason);
    console.log(`[${enrichedSnapshot.createdAt}] Updated latest match state (${reason}): ${latestMatchStatePath}`);

    if (!initializedSelfRiichiBaseline) {
      initializedSelfRiichiBaseline = true;
    } else if (latestSelfRiichiEvent) {
      const riichiResult = await appendRiichiEvent(latestSelfRiichiEvent);
      if (riichiResult.written) {
        console.log(`[${enrichedSnapshot.createdAt}] Captured self riichi event: ${riichiEventsPath}`);
      }
    }
    lastSelfRiichiLike = currentSelfRiichiLike;
    lastSelfRiichiState = snapshot?.selfRiichiState ?? null;

    if (!enrichedSnapshot.inGame) {
      const recordKey = buildRecordKey(enrichedSnapshot);

      if (!initializedRecordBaseline) {
        lastRecordKey = recordKey !== "[]" ? recordKey : "";
        initializedRecordBaseline = true;
        return;
      }

      if (recordKey !== "[]" && recordKey !== lastRecordKey) {
        const recordResult = await appendMatchRecord(enrichedSnapshot);
        if (recordResult.written) {
          console.log(`[${enrichedSnapshot.createdAt}] Appended match record: ${recordResult.filePath}`);
          if (recordResult.summaryPath) {
            console.log(`[${enrichedSnapshot.createdAt}] Updated record summary: ${recordResult.summaryPath}`);
          }
          lastRecordKey = recordKey;
        }
      }
    } else if (!initializedRecordBaseline) {
      initializedRecordBaseline = true;
    }
  };

  await saveSnapshot("initial");
  await rebuildHanSummary();

  const interval = setInterval(() => {
    saveSnapshot("poll")
      .then(async () => {
        const snapshot = await readJsonFile(latestMatchStatePath, null);
        if (snapshot?.latestHuleSummary || snapshot?.latestHuleSnapshot) {
          const currentHanEvent = normalizeHuleEvent(snapshot);
          const currentHanKey = currentHanEvent ? buildHanEventKey(currentHanEvent) : "";

          if (!initializedHanBaseline) {
            lastHanKey = currentHanKey;
            initializedHanBaseline = true;
          } else if (currentHanKey && currentHanKey !== lastHanKey) {
            const hanResult = await appendHanEvent(snapshot);
            if (hanResult.written) {
              lastHanKey = currentHanKey;
            }
          }
        } else if (!initializedHanBaseline) {
          initializedHanBaseline = true;
        }
        await rebuildHanSummary();
      })
      .catch((error) => {
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
