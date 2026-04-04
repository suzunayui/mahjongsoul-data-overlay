import { chromium } from "playwright";
import process from "node:process";
import {
  debugPort,
  headless,
  installHooks,
  launchHeight,
  launchWidth,
  targetUrl,
  userDataDir
} from "./mjs-common.js";

export async function main() {
  const browserContext = await chromium.launchPersistentContext(userDataDir, {
    channel: "chrome",
    headless,
    viewport: {
      width: launchWidth,
      height: launchHeight
    },
    args: [
      `--remote-debugging-port=${debugPort}`,
      `--window-size=${launchWidth},${launchHeight}`
    ]
  });

  const page = browserContext.pages()[0] || await browserContext.newPage();
  await installHooks(page);

  if (page.url() === "about:blank") {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  }

  console.log(`Profile dir: ${userDataDir}`);
  console.log(`Remote debug port: ${debugPort}`);
  console.log(`Window size: ${launchWidth}x${launchHeight}`);
  console.log(`Opened: ${page.url()}`);
  console.log("");
  console.log("Use this window for Mahjongsoul.");
  console.log("Sign in manually only when the saved session expires.");
  console.log("Keep this browser open while running the collector script.");

  browserContext.on("close", () => process.exit(0));
}

const isDirectRun = process.argv[1] != null && /mjs-launch\.js$/i.test(process.argv[1]);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
