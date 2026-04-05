import { chromium } from "playwright";
import fs from "node:fs/promises";
import process from "node:process";
import {
  debugPort,
  headless,
  installHooks,
  targetUrl,
  userDataDir,
  windowStatePath
} from "./mjs-common.js";

async function readSavedWindowState() {
  try {
    const raw = await fs.readFile(windowStatePath, "utf8");
    const parsed = JSON.parse(raw);
    const width = Number(parsed?.width);
    const height = Number(parsed?.height);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 300 && height > 200) {
      return { width: Math.round(width), height: Math.round(height) };
    }
  } catch {
    // ignore
  }

  return null;
}

async function saveWindowState(page) {
  try {
    const size = await page.evaluate(() => ({
      width: window.outerWidth,
      height: window.outerHeight
    }));

    if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height)) {
      return;
    }

    await fs.mkdir(userDataDir, { recursive: true });
    await fs.writeFile(
      windowStatePath,
      `${JSON.stringify(
        {
          width: Math.round(size.width),
          height: Math.round(size.height),
          updatedAt: new Date().toISOString()
        },
        null,
        2
      )}\n`,
      "utf8"
    );
  } catch {
    // ignore
  }
}

export async function main() {
  const savedWindowState = await readSavedWindowState();
  const launchArgs = [`--remote-debugging-port=${debugPort}`];

  if (savedWindowState) {
    launchArgs.push(`--window-size=${savedWindowState.width},${savedWindowState.height}`);
  }

  const browserContext = await chromium.launchPersistentContext(userDataDir, {
    channel: "chrome",
    headless,
    viewport: null,
    args: launchArgs
  });

  const page = browserContext.pages()[0] || await browserContext.newPage();
  await installHooks(page);

  if (page.url() === "about:blank") {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  }

  console.log(`Profile dir: ${userDataDir}`);
  console.log(`Remote debug port: ${debugPort}`);
  if (savedWindowState) {
    console.log(`Restored window size: ${savedWindowState.width}x${savedWindowState.height}`);
  } else {
    console.log("Window size: Chrome default (last resize will be remembered)");
  }
  console.log(`Opened: ${page.url()}`);
  console.log("");
  console.log("Use this window for Mahjongsoul.");
  console.log("Sign in manually only when the saved session expires.");
  console.log("Keep this browser open while running the collector script.");

  const saveInterval = setInterval(() => {
    saveWindowState(page).catch(() => {});
  }, 2000);

  const shutdown = async () => {
    clearInterval(saveInterval);
    await saveWindowState(page);
    process.exit(0);
  };

  browserContext.on("close", () => {
    shutdown().catch(() => process.exit(0));
  });

  process.on("SIGINT", () => {
    shutdown().catch(() => process.exit(0));
  });
}

const isDirectRun = process.argv[1] != null && /mjs-launch\.js$/i.test(process.argv[1]);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
