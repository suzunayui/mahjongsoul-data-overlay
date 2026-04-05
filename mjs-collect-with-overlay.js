import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { main as overlayMain } from "./overlay-server.js";
import { main as collectMain } from "./mjs-collect.js";
import { main as matchMain } from "./mjs-match-watch.js";

const workdir = process.cwd();
const overlayScript = path.join(workdir, "overlay-server.js");
const collectScript = path.join(workdir, "mjs-collect.js");
const matchScript = path.join(workdir, "mjs-match-watch.js");

function resolveSpawnTarget(scriptPath, exeBaseName) {
  if (process.pkg) {
    return {
      command: path.join(path.dirname(process.execPath), `${exeBaseName}.exe`),
      args: []
    };
  }

  return {
    command: process.execPath,
    args: [scriptPath]
  };
}

function spawnNode(scriptPath, exeBaseName, label) {
  const target = resolveSpawnTarget(scriptPath, exeBaseName);
  const child = spawn(target.command, target.args, {
    cwd: workdir,
    stdio: "inherit"
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      console.log(`${label} exited with signal ${signal}`);
      return;
    }
    console.log(`${label} exited with code ${code ?? 0}`);
  });

  return child;
}

function getOverlayHtmlDir() {
  return process.pkg ? path.join(path.dirname(process.execPath), "html") : workdir;
}

function openOverlayHtmlDir() {
  const htmlDir = getOverlayHtmlDir();
  const htmlFiles = ["obs-rank.html", "obs-points.html", "obs-records.html"];
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

  if (process.pkg) {
    await overlayMain();
    const wrap = (label, task) =>
      task.catch((error) => {
        console.error(`${label} failed:`, error);
      });
    await Promise.all([wrap("collector", collectMain()), wrap("match", matchMain())]);
    return;
  }

  const overlay = spawnNode(overlayScript, "mahjongsoul-overlay", "overlay");
  const collector = spawnNode(collectScript, "mahjongsoul-collect-raw", "collector");
  const matcher = spawnNode(matchScript, "mahjongsoul-match", "match");

  const shutdown = () => {
    if (!overlay.killed) {
      overlay.kill();
    }
    if (!collector.killed) {
      collector.kill();
    }
    if (!matcher.killed) {
      matcher.kill();
    }
  };

  process.on("SIGINT", () => {
    shutdown();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    shutdown();
    process.exit(0);
  });
}

const isDirectRun = process.argv[1] != null && /mjs-collect-with-overlay\.js$/i.test(process.argv[1]);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
