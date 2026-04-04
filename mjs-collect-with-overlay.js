import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const workdir = process.cwd();
const overlayScript = path.join(workdir, "overlay-server.js");
const collectScript = path.join(workdir, "mjs-collect.js");
const matchScript = path.join(workdir, "mjs-match-watch.js");

function spawnNode(scriptPath, label) {
  const child = spawn(process.execPath, [scriptPath], {
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

async function main() {
  const overlay = spawnNode(overlayScript, "overlay");
  const collector = spawnNode(collectScript, "collector");
  const matcher = spawnNode(matchScript, "match");

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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
