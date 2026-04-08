import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { build } from "electron-builder";

const projectDir = process.cwd();
const distDir = path.join(projectDir, "dist");

const target = {
  name: "mahjongsoul-data-overlay",
  productName: "MahjongSoul Data Overlay",
  main: "electron/collect-main.js",
  artifactName: "mahjongsoul-data-overlay-setup-${version}.${ext}",
  executableName: "mahjongsoul-data-overlay"
};

function getConfig(target) {
  return {
    appId: `local.codex.${target.name}`,
    productName: target.productName,
    directories: {
      output: "dist"
    },
    files: [
      "electron/**/*",
      "html/**/*",
      "overlay/**/*",
      "*.js",
      "package.json",
      "!dist{,/**/*}",
      "!electron-dist{,/**/*}",
      "!output{,/**/*}",
      "!points{,/**/*}",
      "!records{,/**/*}",
      "!.git{,/**/*}"
    ],
    extraMetadata: {
      main: target.main,
      name: target.name,
      productName: target.productName
    },
    asar: false,
    win: {
      target: [
        {
          target: "nsis",
          arch: ["x64"]
        }
      ],
      signAndEditExecutable: false,
      executableName: target.executableName,
      artifactName: target.artifactName
    },
    nsis: {
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      deleteAppDataOnUninstall: false
    },
    publish: null
  };
}

async function buildTarget(targetName) {
  if (targetName !== "app") {
    throw new Error(`Unknown installer target: ${targetName}`);
  }

  await build({
    projectDir,
    publish: "never",
    config: getConfig(target)
  });
}

async function getCurrentVersion() {
  const raw = await fs.readFile(path.join(projectDir, "package.json"), "utf8");
  const pkg = JSON.parse(raw);
  return String(pkg.version);
}

async function cleanupDist() {
  const version = await getCurrentVersion();
  const keepNames = new Set([`mahjongsoul-data-overlay-setup-${version}.exe`]);

  let entries = [];
  try {
    entries = await fs.readdir(distDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const targetPath = path.join(distDir, entry.name);
    if (entry.isFile() && keepNames.has(entry.name)) {
      continue;
    }
    await fs.rm(targetPath, { recursive: true, force: true });
  }
}

async function main() {
  const requested = process.argv[2] || "app";

  if (requested === "all") {
    await buildTarget("app");
    await cleanupDist();
    return;
  }

  await buildTarget(requested);
  await cleanupDist();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
