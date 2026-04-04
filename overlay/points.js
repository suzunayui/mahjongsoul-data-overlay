const elements = {
  self: document.querySelector("#self"),
  shimocha: document.querySelector("#shimocha"),
  toimen: document.querySelector("#toimen"),
  kamicha: document.querySelector("#kamicha")
};

let lastGoodLines = null;

const emptyLines = {
  self: "\u81ea\u5206\uff1a00000",
  shimocha: "\u4e0b\u5bb6\uff1a00000",
  toimen: "\u5bfe\u9762\uff1a00000",
  kamicha: "\u4e0a\u5bb6\uff1a00000"
};

const seatLabels = {
  self: "\u81ea\u5206",
  shimocha: "\u4e0b\u5bb6",
  toimen: "\u5bfe\u9762",
  kamicha: "\u4e0a\u5bb6"
};

function makePlaceholderLine(seat) {
  return {
    label: seatLabels[seat] || "",
    score: "00000",
    isDealer: false,
    rankClass: "",
    hidden: true
  };
}

function renderLines(lines) {
  for (const [seat, element] of Object.entries(elements)) {
    const line = lines[seat];
    if (!line) {
      element.innerHTML = "";
      continue;
    }

    if (typeof line === "string") {
      element.textContent = line;
      continue;
    }

    const dealerClass = line.isDealer ? " points-label-dealer" : "";
    const rankClass = line.rankClass ? ` ${line.rankClass}` : "";
    const hiddenClass = line.hidden ? " points-line-hidden" : "";
    element.innerHTML = `<span class="points-label${dealerClass}${hiddenClass}">${line.label}\uff1a</span><span class="points-score${rankClass}${hiddenClass}">${line.score}</span>`;
  }
}

function formatSeatLine(label, player) {
  return {
    label,
    score: typeof player?.score === "number" ? String(player.score) : "00000",
    isDealer: label === "\u89aa"
  };
}

function shouldHideSeat(player) {
  if (!player) {
    return true;
  }

  if (typeof player.score === "number" && player.score !== 0) {
    return false;
  }

  if (!player.name && (player.absoluteSeat == null || player.absoluteSeat < 0)) {
    return true;
  }

  if (!player.name && player.score === 0) {
    return true;
  }

  return false;
}

function comparePlayersForRank(a, b) {
  const aScore = typeof a?.score === "number" ? a.score : Number.NEGATIVE_INFINITY;
  const bScore = typeof b?.score === "number" ? b.score : Number.NEGATIVE_INFINITY;
  if (bScore !== aScore) {
    return bScore - aScore;
  }

  const aSeat = typeof a?.absoluteSeat === "number" ? a.absoluteSeat : Number.MAX_SAFE_INTEGER;
  const bSeat = typeof b?.absoluteSeat === "number" ? b.absoluteSeat : Number.MAX_SAFE_INTEGER;
  if (aSeat !== bSeat) {
    return aSeat - bSeat;
  }

  return String(a?.seat || "").localeCompare(String(b?.seat || ""));
}

async function refreshOverlay() {
  try {
    const response = await fetch(`/match-data?t=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();
    const players = Array.isArray(data?.extractedPlayers) ? data.extractedPlayers : null;

    if (!players || players.length === 0) {
      if (!lastGoodLines) {
        renderLines(emptyLines);
      }
      return;
    }

    const seatMap = {
      self: players.find((player) => player?.seat === "self") || null,
      shimocha: players.find((player) => player?.seat === "shimocha") || null,
      toimen: players.find((player) => player?.seat === "toimen") || null,
      kamicha: players.find((player) => player?.seat === "kamicha") || null
    };
    const dealerAbsoluteSeat =
      typeof data?.dealerAbsoluteSeat === "number" ? data.dealerAbsoluteSeat : null;
    const rankedPlayers = Object.values(seatMap)
      .filter((player) => player && typeof player.score === "number" && !shouldHideSeat(player))
      .sort(comparePlayersForRank);
    const topSeat = rankedPlayers[0]?.seat ?? null;
    const bottomSeat = rankedPlayers.length > 1 ? rankedPlayers[rankedPlayers.length - 1]?.seat ?? null : null;

    const lines = {};
    for (const seat of Object.keys(elements)) {
      const player = seatMap[seat];
      if (shouldHideSeat(player)) {
        lines[seat] = makePlaceholderLine(seat);
        continue;
      }

      const label =
        dealerAbsoluteSeat != null &&
        typeof player?.absoluteSeat === "number" &&
        player.absoluteSeat === dealerAbsoluteSeat
          ? "\u89aa"
          : seatLabels[seat] || seat;

      lines[seat] = {
        ...formatSeatLine(label, player),
        rankClass:
          seat === topSeat
            ? "points-score-top"
            : seat === bottomSeat
              ? "points-score-bottom"
              : ""
      };
    }

    renderLines(lines);
    lastGoodLines = lines;
  } catch {
    if (!lastGoodLines) {
      renderLines(emptyLines);
      return;
    }

    renderLines(lastGoodLines);
  }
}

refreshOverlay();
setInterval(refreshOverlay, 1000);
