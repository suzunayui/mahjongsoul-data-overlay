import path from "node:path";
import process from "node:process";

export const userDataDir = path.resolve(".playwright-profile");
export const targetUrl = process.env.MJS_URL || "https://game.mahjongsoul.com/";
export const headless = process.env.HEADLESS === "1";
export const debugPort = Number(process.env.CHROME_DEBUG_PORT || 9222);
export const launchWidth = Number(process.env.MJS_WINDOW_WIDTH || 960);
export const launchHeight = Number(process.env.MJS_WINDOW_HEIGHT || 540);
export const rankHintPattern =
  /rank|level|pt|point|score|dan|\u521d\u5fc3|\u96c0\u58eb|\u96c0\u5091|\u96c0\u8c6a|\u96c0\u8056|\u9b42\u5929|\u6bb5\u4f4d/i;
export const rankAssetPattern =
  /\/(?:sanma|sima)_(?:fish|queshi|quejie|quehao|quesheng|huntian)\.png/i;

export function isInterestingTextPayload(text) {
  return /rank|level|pt|point|score|dan|account|profile/i.test(text);
}

export function isInterestingUrl(url) {
  return (
    /account|profile|user|role|rank|level|dan|point|score/i.test(url) ||
    rankAssetPattern.test(url)
  );
}

export function matchesRankHint(text) {
  return rankHintPattern.test(text);
}

export function summarizeEntry(entry) {
  if (rankAssetPattern.test(entry.url || "")) {
    return {
      kind: entry.kind,
      url: entry.url,
      status: entry.status,
      contentType: entry.contentType
    };
  }

  return entry;
}

export async function collectVisibleHints(page) {
  return await page.evaluate(`
    (() => {
      const rankHintPattern =
        /rank|level|pt|point|score|dan|\\u521d\\u5fc3|\\u96c0\\u58eb|\\u96c0\\u5091|\\u96c0\\u8c6a|\\u96c0\\u8056|\\u9b42\\u5929|\\u6bb5\\u4f4d/i;
      const rankAssetPattern =
        /\\/(?:sanma|sima)_(?:fish|queshi|quejie|quehao|quesheng|huntian)\\.png/i;
      const texts = [...document.querySelectorAll("body *")]
        .map((el) => (el.innerText || "").trim())
        .filter(Boolean)
        .filter((text) => text.length < 120)
        .filter((text, index, array) => array.indexOf(text) === index);
      const rankLikeTexts = texts
        .filter((text) => rankHintPattern.test(text))
        .slice(0, 60);
      const storageMatches = [];
      for (const [storeName, store] of [["localStorage", localStorage], ["sessionStorage", sessionStorage]]) {
        for (let i = 0; i < store.length; i += 1) {
          const key = store.key(i);
          const value = store.getItem(key);
          if (
            /rank|level|dan|grade|point|score|pt/i.test(key || "") ||
            rankHintPattern.test(value || "")
          ) {
            storageMatches.push({
              store: storeName,
              key,
              value: value && value.length > 300 ? value.slice(0, 300) + "...(truncated)" : value
            });
          }
        }
      }
      return {
        title: document.title,
        url: location.href,
        rankLikeTexts,
        storageMatches: storageMatches.slice(0, 30),
        loadedRankAssets: performance.getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((name) => rankAssetPattern.test(name))
          .slice(-20)
      };
    })()
  `);
}

export async function collectRuntimeHints(page) {
  const evaluator = function () {
    const seen = new WeakSet();
    const queue = [];
    const hits = [];

    const pushNode = (value, path) => {
      if (!value || typeof value !== "object") {
        return;
      }
      if (seen.has(value)) {
        return;
      }
      seen.add(value);
      queue.push({ value, path, depth: path.split(".").length - 1 });
    };

    const summarize = (value) => {
      if (value == null) {
        return value;
      }
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
      }
      if (Array.isArray(value)) {
        return value.slice(0, 8).map((item) => summarize(item));
      }

      const out = {};
      for (const [key, item] of Object.entries(value).slice(0, 20)) {
        if (item == null || typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
          out[key] = item;
        }
      }
      return out;
    };

    const interestingKey = (key) =>
      /uid|account|profile|rank|level|grade|score|point|pt|nickname|name|role|user/i.test(key);

    const interestingValue = (value) =>
      typeof value === "string" &&
      /uid|rank|level|grade|score|point|雀士|雀傑|雀豪|雀聖|魂天|段位/i.test(value);

    pushNode(window, "window");

    while (queue.length > 0 && hits.length < 80) {
      const current = queue.shift();
      if (current.depth > 4) {
        continue;
      }

      let entries = [];
      try {
        entries = Reflect.ownKeys(current.value)
          .filter((key) => typeof key === "string")
          .slice(0, 120)
          .map((key) => {
            let value;
            try {
              value = current.value[key];
            } catch {
              value = "[unreadable]";
            }
            return [key, value];
          });
      } catch {
        continue;
      }

      const matched = entries
        .filter(([key, value]) => interestingKey(key) || interestingValue(value))
        .slice(0, 20);

      if (matched.length > 0) {
        hits.push({
          path: current.path,
          matches: matched.map(([key, value]) => ({
            key,
            value: summarize(value)
          }))
        });
      }

      for (const [key, value] of entries.slice(0, 120)) {
        if (!value || typeof value !== "object") {
          continue;
        }
        pushNode(value, `${current.path}.${key}`);
      }
    }

    const getKeys = (value) => {
      try {
        return Reflect.ownKeys(value)
          .filter((key) => typeof key === "string")
          .slice(0, 80);
      } catch {
        return [];
      }
    };

    const getByPath = (root, path) => {
      let current = root;
      for (const part of path.split(".")) {
        if (!current) {
          return undefined;
        }
        current = current[part];
      }
      return current;
    };

    const targetedRoots = [
      "uiscript",
      "ui",
      "app",
      "cfg",
      "Laya",
      "GameMgr",
      "game",
      "view",
      "mjcore",
      "net",
      "protobuf",
      "DesktopMgr"
    ]
      .filter((key) => key in window)
      .map((key) => {
        let value;
        try {
          value = window[key];
        } catch {
          value = "[unreadable]";
        }
        return {
          key,
          type: typeof value,
          preview: summarize(value),
          keys: getKeys(value)
        };
      });

    const candidatePaths = [
      "GameMgr.Inst",
      "GameMgr.Inst.account_data",
      "GameMgr.Inst.login_loading_end",
      "GameMgr.Inst.EnterLobby",
      "app.NetAgent",
      "app.NetAgent.Inst",
      "app.NetAgent.Inst._rpc_map",
      "app.UserMgr",
      "app.UserMgr.Inst",
      "app.AccountMgr",
      "app.AccountMgr.Inst",
      "app.GameMgr",
      "uiscript.UI_Lobby",
      "uiscript.UI_Lobby.Inst",
      "uiscript.UI_PaiPu",
      "uiscript.UI_Sushe",
      "ui.UiMgr",
      "ui.UiMgr.Inst",
      "net.NetAgent",
      "net.MessageWrapper",
      "Laya.stage",
      "view.DesktopMgr",
      "DesktopMgr"
    ];

    const candidateResults = candidatePaths
      .map((path) => {
        try {
          const value = getByPath(window, path);
          if (value == null) {
            return null;
          }
          return {
            path,
            type: typeof value,
            preview: summarize(value),
            keys: typeof value === "object" || typeof value === "function" ? getKeys(value) : []
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    return {
      targetedRoots,
      candidateResults,
      hits
    };
  };

  return await page.evaluate("(" + evaluator.toString() + ")()");
}

export async function extractProfileData(page) {
  const evaluator = function () {
    const getByPath = (root, path) => {
      let current = root;
      for (const part of path.split(".")) {
        if (current == null) {
          return undefined;
        }
        current = current[part];
      }
      return current;
    };

    const summarizePrimitiveObject = (value) => {
      if (!value || typeof value !== "object") {
        return value;
      }
      const out = {};
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== "string") {
          continue;
        }
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

    const accountData = getByPath(window, "GameMgr.Inst.account_data");
    const gameMgr = getByPath(window, "GameMgr.Inst");
    const cfgRoot = window.cfg;

    const accountPrimitive = summarizePrimitiveObject(accountData) || {};
    const gameMgrPrimitive = summarizePrimitiveObject(gameMgr) || {};

    const scoreCandidates = {};
    const sources = [
      ["GameMgr.Inst.account_data", accountPrimitive],
      ["GameMgr.Inst", gameMgrPrimitive]
    ];

    for (const [sourceName, source] of sources) {
      for (const [key, value] of Object.entries(source)) {
        if (/level|score|rank|grade|point|pt/.test(key)) {
          scoreCandidates[`${sourceName}.${key}`] = value;
        }
      }
    }

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

      const modeNameMap = {
        1: "yonma",
        2: "sanma"
      };

      const rankNameMap = {
        1: "\u521d\u5fc3",
        2: "\u96c0\u58eb",
        3: "\u96c0\u5091",
        4: "\u96c0\u8c6a",
        5: "\u96c0\u8056",
        6: "\u9b42\u5929"
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

    const summarizeValue = (value, depth = 0) => {
      if (value == null) {
        return value;
      }
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
      }
      if (depth >= 2) {
        return {
          __type: Array.isArray(value) ? "array" : typeof value,
          keys: Reflect.ownKeys(value)
            .filter((key) => typeof key === "string")
            .slice(0, 20)
        };
      }
      if (Array.isArray(value)) {
        return value.slice(0, 10).map((item) => summarizeValue(item, depth + 1));
      }
      const out = {};
      for (const key of Reflect.ownKeys(value).filter((key) => typeof key === "string").slice(0, 30)) {
        let item;
        try {
          item = value[key];
        } catch {
          continue;
        }
        out[key] = summarizeValue(item, depth + 1);
      }
      return out;
    };

    const findConfigEntry = (root, targetId) => {
      if (!root || targetId == null) {
        return null;
      }

      const tryDirect = (container) => {
        if (!container) {
          return null;
        }
        const directCandidates = [
          container[targetId],
          container[String(targetId)],
          typeof container.get === "function" ? container.get(targetId) : null,
          typeof container.get === "function" ? container.get(String(targetId)) : null
        ];
        for (const candidate of directCandidates) {
          if (candidate) {
            return candidate;
          }
        }
        return null;
      };

      const direct = tryDirect(root);
      if (direct) {
        return direct;
      }

      const queue = [{ value: root, depth: 0 }];
      const seen = new WeakSet();

      while (queue.length > 0) {
        const current = queue.shift();
        if (!current.value || typeof current.value !== "object") {
          continue;
        }
        if (seen.has(current.value)) {
          continue;
        }
        seen.add(current.value);
        if (current.depth > 3) {
          continue;
        }

        if (Array.isArray(current.value)) {
          const found = current.value.find((item) => item && typeof item === "object" && item.id === targetId);
          if (found) {
            return found;
          }
          for (const item of current.value.slice(0, 50)) {
            if (item && typeof item === "object") {
              queue.push({ value: item, depth: current.depth + 1 });
            }
          }
          continue;
        }

        const nestedDirect = tryDirect(current.value);
        if (nestedDirect) {
          return nestedDirect;
        }

        const entries = Reflect.ownKeys(current.value)
          .filter((key) => typeof key === "string")
          .slice(0, 80);

        for (const key of entries) {
          let item;
          try {
            item = current.value[key];
          } catch {
            continue;
          }
          if (item && typeof item === "object" && item.id === targetId) {
            return item;
          }
          if (item && typeof item === "object") {
            queue.push({ value: item, depth: current.depth + 1 });
          }
        }
      }

      return null;
    };

    const readConfigSource = (name) => {
      if (!cfgRoot) {
        return null;
      }
      try {
        return cfgRoot[name];
      } catch {
        return null;
      }
    };

    const level = parseRankLevel(accountData?.level);
    const level3 = parseRankLevel(accountData?.level3);
    const levelDefinitionRoot = readConfigSource("level_definition");
    const rankIntroduceRoot = readConfigSource("rank_introduce");
    const levelDefinition = {
      yonma: summarizeValue(findConfigEntry(levelDefinitionRoot, level?.id)),
      sanma: summarizeValue(findConfigEntry(levelDefinitionRoot, level3?.id))
    };
    const rankIntroduce = {
      yonma: summarizeValue(findConfigEntry(rankIntroduceRoot, level?.id)),
      sanma: summarizeValue(findConfigEntry(rankIntroduceRoot, level3?.id))
    };

    return {
      accountData: accountPrimitive,
      gameMgr: gameMgrPrimitive,
      extracted: {
        accountId: accountPrimitive.account_id ?? gameMgrPrimitive.account_id ?? null,
        nickname: accountPrimitive.nickname ?? gameMgrPrimitive.player_name ?? null,
        title: accountPrimitive.title ?? null,
        level,
        level3,
        levelDefinition,
        rankIntroduce,
        scoreCandidates
      }
    };
  };

  return await page.evaluate("(" + evaluator.toString() + ")()");
}

export async function installHooks(page) {
  await page.addInitScript(() => {
    const rankAssetPattern =
      /\/(?:sanma|sima)_(?:fish|queshi|quejie|quehao|quesheng|huntian)\.png/i;

    if (window.__mjsHooksInstalled) {
      return;
    }

    window.__mjsHooksInstalled = true;
    window.__mjsCaptured = [];

    const pushEntry = (entry) => {
      window.__mjsCaptured.push({
        time: new Date().toISOString(),
        ...entry
      });
      if (window.__mjsCaptured.length > 200) {
        window.__mjsCaptured.shift();
      }
    };

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      try {
        const url = String(args[0]?.url || args[0] || "");
        if (isInterestingUrlForPage(url)) {
          const text = await response.clone().text();
          if (isInterestingTextPayloadForPage(text) || rankAssetPattern.test(url)) {
            pushEntry({
              kind: "fetch",
              url,
              body: rankAssetPattern.test(url) ? undefined : text.slice(0, 1200)
            });
          }
        }
      } catch (error) {
        pushEntry({
          kind: "fetch-error",
          error: String(error)
        });
      }
      return response;
    };

    const NativeWebSocket = window.WebSocket;
    function WrappedWebSocket(...args) {
      const socket = new NativeWebSocket(...args);
      socket.addEventListener("message", (event) => {
        try {
          const text = typeof event.data === "string" ? event.data : "";
          if (matchesRankHintForPage(text)) {
            pushEntry({
              kind: "ws-message",
              url: String(args[0] || ""),
              body: text.slice(0, 1200)
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
    }

    function matchesRankHintForPage(text) {
      return /rank|level|pt|point|score|dan|\u521d\u5fc3|\u96c0\u58eb|\u96c0\u5091|\u96c0\u8c6a|\u96c0\u8056|\u9b42\u5929|\u6bb5\u4f4d/i.test(text);
    }

    function isInterestingTextPayloadForPage(text) {
      return /rank|level|pt|point|score|dan|account|profile/i.test(text);
    }

    function isInterestingUrlForPage(url) {
      return (
        /account|profile|user|role|rank|level|dan|point|score/i.test(url) ||
        rankAssetPattern.test(url)
      );
    }

    WrappedWebSocket.prototype = NativeWebSocket.prototype;
    Object.setPrototypeOf(WrappedWebSocket, NativeWebSocket);
    window.WebSocket = WrappedWebSocket;
  });
}
