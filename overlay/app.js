const yonmaEl = document.querySelector("#yonma");
const sanmaEl = document.querySelector("#sanma");
let lastGoodLines = null;

const rankNameMap = {
  1: "\u521d\u5fc3",
  2: "\u96c0\u58eb",
  3: "\u96c0\u5091",
  4: "\u96c0\u8c6a",
  5: "\u96c0\u8056",
  6: "\u9b42\u5929"
};

function formatDelta(currentScore, startScore) {
  if (typeof currentScore !== "number" || typeof startScore !== "number") {
    return { text: "", className: "delta-neutral" };
  }

  const diff = currentScore - startScore;
  if (diff > 0) {
    return { text: `+${diff}`, className: "delta-positive" };
  }
  if (diff < 0) {
    return { text: `${diff}`, className: "delta-negative" };
  }
  return { text: "+0", className: "delta-neutral" };
}

function renderLine(element, label, level, levelDefinition, startLevel) {
  if (!level) {
    element.textContent = "";
    return;
  }

  const rankName = rankNameMap[level.rankCode] || "?";
  const star = level.star ?? "?";
  const score = level.score ?? "?";
  const endPoint = levelDefinition?.end_point ?? "?";
  const delta = formatDelta(level.score, startLevel?.score);
  element.innerHTML = `
    <span class="main-text">${label}${rankName}${star}\uff1a${score}/${endPoint}</span>
    <span class="delta ${delta.className}">${delta.text}</span>
  `;
}

async function refreshOverlay() {
  try {
    const response = await fetch(`/data?t=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();
    const extracted = data?.extractedProfile?.extracted
      ? data.extractedProfile.extracted
      : data?.yonma || data?.sanma
        ? {
            level: data.yonma,
            level3: data.sanma,
            levelDefinition: {
              yonma: data.yonma ? { end_point: data.yonma.endPoint } : null,
              sanma: data.sanma ? { end_point: data.sanma.endPoint } : null
            }
          }
        : null;
    const startData = data?.__pointsStart || null;

    if (!extracted) {
      if (!lastGoodLines) {
        yonmaEl.textContent = "";
        sanmaEl.textContent = "";
      }
      return;
    }

    renderLine(
      yonmaEl,
      "\u56db\u9ebb",
      extracted.level,
      extracted.levelDefinition?.yonma,
      startData?.yonma
    );
    renderLine(
      sanmaEl,
      "\u4e09\u9ebb",
      extracted.level3,
      extracted.levelDefinition?.sanma,
      startData?.sanma
    );
    lastGoodLines = {
      yonma: yonmaEl.innerHTML,
      sanma: sanmaEl.innerHTML
    };
  } catch (error) {
    if (lastGoodLines) {
      yonmaEl.innerHTML = lastGoodLines.yonma;
      sanmaEl.innerHTML = lastGoodLines.sanma;
      return;
    }

    yonmaEl.textContent = "";
    sanmaEl.textContent = "";
  }
}

refreshOverlay();
setInterval(refreshOverlay, 1500);
