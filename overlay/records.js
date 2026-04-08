const recordsEl = document.querySelector("#records");
let lastGoodValue = "戦績: 0-0-0-0";

function formatCounts(counts) {
  const first = counts?.["1"] ?? counts?.[1] ?? 0;
  const second = counts?.["2"] ?? counts?.[2] ?? 0;
  const third = counts?.["3"] ?? counts?.[3] ?? 0;
  const fourth = counts?.["4"] ?? counts?.[4] ?? 0;
  return `戦績: ${first}-${second}-${third}-${fourth}`;
}

async function refreshOverlay() {
  try {
    const response = await fetch(`/records-data?t=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();
    const value = formatCounts(data?.counts);
    recordsEl.textContent = value;
    lastGoodValue = value;
  } catch {
    recordsEl.textContent = lastGoodValue;
  }
}

refreshOverlay();
setInterval(refreshOverlay, 1500);
