const DEBUG_PORT = Number(process.env.CHROME_DEBUG_PORT || 9222);
const TARGET_HINT = process.env.MJS_TARGET_HINT || "mahjongsoul";

async function getJson(url) {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(
      `Chrome DevTools endpoint (${url}) に接続できませんでした。\n` +
      `Chromeを --remote-debugging-port=${DEBUG_PORT} 付きで起動しているか確認してください。\n` +
      `例: chrome.exe --remote-debugging-port=${DEBUG_PORT}`
    );
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

async function connectWebSocket(url) {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", (event) => {
      reject(new Error(`WebSocket connection failed: ${event.message || "unknown error"}`));
    }, { once: true });
  });
}

function makeRpcClient(ws) {
  let nextId = 1;
  const pending = new Map();

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!Object.hasOwn(message, "id")) {
      return;
    }
    const callback = pending.get(message.id);
    if (!callback) {
      return;
    }
    pending.delete(message.id);
    if (message.error) {
      callback.reject(new Error(JSON.stringify(message.error)));
      return;
    }
    callback.resolve(message.result);
  });

  return {
    async send(method, params = {}) {
      const id = nextId++;
      const payload = JSON.stringify({ id, method, params });
      ws.send(payload);
      return await new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
    }
  };
}

function stringifyPreview(value) {
  if (value == null) {
    return String(value);
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

async function findMahjongSoulTarget() {
  const targets = await getJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const candidates = targets.filter((target) => {
    const url = String(target.url || "").toLowerCase();
    const title = String(target.title || "").toLowerCase();
    return (
      target.type === "page" &&
      (url.includes(TARGET_HINT.toLowerCase()) || title.includes(TARGET_HINT.toLowerCase()))
    );
  });

  if (candidates.length === 0) {
    const available = targets
      .filter((target) => target.type === "page")
      .map((target) => `- ${target.title || "(no title)"} | ${target.url}`)
      .join("\n");
    throw new Error(
      `雀魂タブが見つかりませんでした。\n` +
      `Chromeを --remote-debugging-port=${DEBUG_PORT} 付きで起動してから、雀魂のタブを開いてください。\n` +
      `見えている page タブ:\n${available || "(none)"}`
    );
  }

  return candidates[0];
}

async function evaluate(client, expression) {
  return await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
}

const pageProbeExpression = `
(() => {
  const textNodes = [...document.querySelectorAll("body *")]
    .map((el) => (el.innerText || "").trim())
    .filter(Boolean)
    .filter((text, index, array) => array.indexOf(text) === index);

  const rankLikeTexts = textNodes.filter((text) =>
    /初心|雀士|雀傑|雀豪|雀聖|魂天|rank|level|段位|pt|point/i.test(text)
  );

  const storageMatches = [];
  for (const [storeName, store] of [["localStorage", localStorage], ["sessionStorage", sessionStorage]]) {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      const value = store.getItem(key);
      if (/rank|level|dan|grade|point|score|pt/i.test(key || "") ||
          /rank|level|dan|grade|point|score|pt|雀士|雀傑|雀豪|雀聖|魂天/i.test(value || "")) {
        storageMatches.push({
          store: storeName,
          key,
          value: value && value.length > 400 ? value.slice(0, 400) + "...(truncated)" : value
        });
      }
    }
  }

  return {
    title: document.title,
    url: location.href,
    rankLikeTexts: rankLikeTexts.slice(0, 50),
    storageMatches: storageMatches.slice(0, 50)
  };
})()
`;

const xhrHookExpression = `
(() => {
  if (window.__mjsHookInstalled) {
    return "already-installed";
  }
  window.__mjsHookInstalled = true;
  window.__mjsCaptured = [];

  const pushEntry = (entry) => {
    window.__mjsCaptured.push({
      time: new Date().toISOString(),
      ...entry
    });
    if (window.__mjsCaptured.length > 100) {
      window.__mjsCaptured.shift();
    }
  };

  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const url = String(args[0]?.url || args[0]);
      if (/rank|level|dan|point|score|account|profile|login/i.test(url)) {
        const clone = response.clone();
        const text = await clone.text();
        pushEntry({
          kind: "fetch",
          url,
          body: text.slice(0, 1000)
        });
      }
    } catch (error) {
      pushEntry({
        kind: "fetch-error",
        error: String(error)
      });
    }
    return response;
  };

  const OriginalWebSocket = window.WebSocket;
  window.WebSocket = function WrappedWebSocket(...args) {
    const socket = new OriginalWebSocket(...args);
    socket.addEventListener("message", (event) => {
      try {
        const text = typeof event.data === "string" ? event.data : "";
        if (/rank|level|dan|point|score|雀士|雀傑|雀豪|雀聖|魂天/i.test(text)) {
          pushEntry({
            kind: "ws-message",
            url: String(args[0]),
            body: text.slice(0, 1000)
          });
        }
      } catch (error) {
        pushEntry({
          kind: "ws-error",
          error: String(error)
        });
      }
    });
    return socket;
  };
  window.WebSocket.prototype = OriginalWebSocket.prototype;

  return "installed";
})()
`;

const readCapturedExpression = `
(() => window.__mjsCaptured || [])()
`;

async function main() {
  const target = await findMahjongSoulTarget();
  console.log(`Connected target: ${target.title}`);
  console.log(`URL: ${target.url}`);

  const ws = await connectWebSocket(target.webSocketDebuggerUrl);
  const client = makeRpcClient(ws);

  await client.send("Page.enable");
  await client.send("Runtime.enable");

  const probe = await evaluate(client, pageProbeExpression);
  console.log("\n=== Visible rank-like texts / storage hints ===");
  console.log(stringifyPreview(probe.result.value));

  const hook = await evaluate(client, xhrHookExpression);
  console.log("\n=== Hook status ===");
  console.log(stringifyPreview(hook.result.value));

  console.log("\nChrome側でプロフィール表示やロビー遷移をしたあと Enter を押してください。");
  await new Promise((resolve) => process.stdin.once("data", resolve));

  const captured = await evaluate(client, readCapturedExpression);
  console.log("\n=== Captured network hints ===");
  console.log(stringifyPreview(captured.result.value));

  ws.close();
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
