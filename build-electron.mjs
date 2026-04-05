import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { packager } from "@electron/packager";

const projectRoot = process.cwd();
const outputRoot = path.join(projectRoot, "dist");

const targets = {
  launch: {
    appName: "mahjongsoul-launch",
    executableName: "mahjongsoul-launch",
    main: "electron/launch-main.js"
  },
  collect: {
    appName: "mahjongsoul-collect",
    executableName: "mahjongsoul-collect",
    main: "electron/collect-main.js"
  }
};

const ignorePatterns = [
  /^\/\.git($|\/)/,
  /^\/\.pkg-build($|\/)/,
  /^\/dist($|\/)/,
  /^\/electron-dist($|\/)/,
  /^\/output($|\/)/,
  /^\/points($|\/)/,
  /^\/records($|\/)/
];

async function rewritePackageJson(packageJsonPath, target) {
  const raw = await fs.readFile(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw);
  parsed.main = target.main;
  parsed.name = target.appName;
  parsed.productName = target.appName;
  await fs.writeFile(packageJsonPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

async function buildTarget(targetName) {
  const target = targets[targetName];
  if (!target) {
    throw new Error(`Unknown electron build target: ${targetName}`);
  }

  await packager({
    dir: projectRoot,
    name: target.appName,
    out: outputRoot,
    overwrite: true,
    asar: false,
    platform: "win32",
    arch: "x64",
    prune: false,
    executableName: target.executableName,
    appCopyright: "Codex",
    ignore: ignorePatterns,
    afterCopy: [
      async ({ buildPath }) => {
        await rewritePackageJson(path.join(buildPath, "package.json"), target);
      }
    ]
  });
}

async function main() {
  const requested = process.argv[2] || "all";
  await fs.mkdir(outputRoot, { recursive: true });

  if (requested === "all") {
    await buildTarget("launch");
    await buildTarget("collect");
    return;
  }

  await buildTarget(requested);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
