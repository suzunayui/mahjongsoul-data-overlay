import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { main as overlayMain } from "./overlay-server.js";
import { main as collectMain } from "./mjs-collect.js";
import { main as matchMain } from "./mjs-match-watch.js";
import { connectMahjongSoulPage } from "./mjs-common.js";
import { registerShutdown } from "./mjs-runtime.js";

const moduleDir =
  typeof __dirname === "string"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));
function getOverlayHtmlDir() {
  return process.pkg ? path.join(path.dirname(process.execPath), "html") : path.join(moduleDir, "html");
}

function openOverlayHtmlDir() {
  const htmlDir = getOverlayHtmlDir();
  const htmlFiles = ["obs-rank.html", "obs-points.html", "obs-records.html", "obs-han.html"];
  const fileList = htmlFiles.map((name) => path.join(htmlDir, name));

  console.log(`OBS overlay HTML folder: ${htmlDir}`);
  for (const filePath of fileList) {
    console.log(`- ${filePath}`);
  }

  if (!process.pkg) {
    return;
  }

  try {
    const child = spawn("explorer.exe", [htmlDir], {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
  } catch (error) {
    console.error("Failed to open overlay HTML folder:", error);
  }
}

export async function main() {
  openOverlayHtmlDir();
  await overlayMain();

  const session = await connectMahjongSoulPage();
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    try {
      await session.browser?.close();
    } finally {
      process.exit(0);
    }
  };

  registerShutdown(shutdown);

  const wrap = (label, task) =>
    task.catch((error) => {
      console.error(`${label} failed:`, error);
    });

  await Promise.all([
    wrap("collector", collectMain({ session, manageProcessSignals: false })),
    wrap("match", matchMain({ session, manageProcessSignals: false }))
  ]);
}

const isDirectRun = process.argv[1] != null && /mjs-collect-with-overlay\.js$/i.test(process.argv[1]);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
