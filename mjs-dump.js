import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import {
  appDataBaseDir,
  debugPort,
  installHooks
} from "./mjs-common.js";

const outputDir = path.join(appDataBaseDir, "output");

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

  const dump = await page.evaluate(() => {
    const maxDepth = 5;
    const maxEntries = 120;
    const seen = new WeakMap();

    const keyRoots = {
      GameMgr: window.GameMgr,
      GameMgrInst: window.GameMgr?.Inst,
      accountData: window.GameMgr?.Inst?.account_data,
      accountSetting: window.GameMgr?.Inst?.account_setting,
      accountNumericalResource: window.GameMgr?.Inst?.account_numerical_resource,
      accountVerifiedData: window.GameMgr?.Inst?.accountVerifiedData,
      uiscript: window.uiscript,
      uiLobby: window.uiscript?.UI_Lobby,
      uiLobbyInst: window.uiscript?.UI_Lobby?.Inst,
      uiPaiPu: window.uiscript?.UI_PaiPu,
      app: window.app,
      net: window.net,
      game: window.game,
      view: window.view,
      Laya: window.Laya,
      DesktopMgr: window.view?.DesktopMgr
    };

    const serialize = (value, depth = 0, path = "root") => {
      if (value == null) {
        return value;
      }

      const valueType = typeof value;
      if (valueType === "string" || valueType === "number" || valueType === "boolean") {
        return value;
      }

      if (valueType === "function") {
        return {
          __type: "function",
          name: value.name || null,
          keys: Reflect.ownKeys(value)
            .filter((key) => typeof key === "string")
            .slice(0, maxEntries)
        };
      }

      if (seen.has(value)) {
        return { __ref: seen.get(value) };
      }
      seen.set(value, path);

      if (depth >= maxDepth) {
        return {
          __type: Array.isArray(value) ? "array" : "object",
          keys: Reflect.ownKeys(value)
            .filter((key) => typeof key === "string")
            .slice(0, maxEntries)
        };
      }

      if (Array.isArray(value)) {
        return value.slice(0, maxEntries).map((item, index) =>
          serialize(item, depth + 1, `${path}[${index}]`)
        );
      }

      const out = {};
      for (const key of Reflect.ownKeys(value).filter((key) => typeof key === "string").slice(0, maxEntries)) {
        try {
          out[key] = serialize(value[key], depth + 1, `${path}.${key}`);
        } catch (error) {
          out[key] = {
            __error: String(error)
          };
        }
      }
      return out;
    };

    const localStorageDump = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      localStorageDump[key] = localStorage.getItem(key);
    }

    const sessionStorageDump = {};
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      sessionStorageDump[key] = sessionStorage.getItem(key);
    }

    return {
      createdAt: new Date().toISOString(),
      url: location.href,
      title: document.title,
      localStorage: localStorageDump,
      sessionStorage: sessionStorageDump,
      capturedNetwork: window.__mjsCaptured || [],
      resources: performance.getEntriesByType("resource").map((entry) => ({
        name: entry.name,
        initiatorType: entry.initiatorType,
        duration: entry.duration
      })),
      roots: serialize(keyRoots)
    };
  });

  await fs.mkdir(outputDir, { recursive: true });
  const timestamp = dump.createdAt.replace(/[:.]/g, "-");
  const outputPath = path.join(outputDir, `mjs-dump-${timestamp}.json`);
  await fs.writeFile(outputPath, `${JSON.stringify(dump, null, 2)}\n`, "utf8");

  console.log(`Saved dump: ${outputPath}`);

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
