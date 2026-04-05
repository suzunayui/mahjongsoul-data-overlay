const totalEl = document.querySelector("#han-total");
let lastGoodValue = "0飜";

function formatTotal(counts) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"];
  let total = 0;
  for (const key of keys) {
    const occurrences = Number(counts?.[key] ?? 0);
    if (Number.isFinite(occurrences) && occurrences > 0) {
      total += Number(key) * occurrences;
    }
  }

  const yakumanLike = Number(counts?.["13+"] ?? 0);
  if (Number.isFinite(yakumanLike) && yakumanLike > 0) {
    total += 13 * yakumanLike;
  }

  return `${total}飜`;
}

async function refreshOverlay() {
  try {
    const response = await fetch(`/han-data?t=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();
    const value =
      Number.isFinite(Number(data?.totalHan)) ? `${Number(data.totalHan)}飜` : formatTotal(data?.counts);
    totalEl.textContent = value;
    lastGoodValue = value;
  } catch {
    totalEl.textContent = lastGoodValue;
  }
}

refreshOverlay();
setInterval(refreshOverlay, 1500);
