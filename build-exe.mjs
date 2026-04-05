import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { build } from "esbuild";

const projectRoot = process.cwd();
const buildDir = path.join(projectRoot, ".pkg-build");
const distDir = path.join(projectRoot, "dist");
const htmlSrcDir = path.join(projectRoot, "html");
const htmlDistDir = path.join(distDir, "html");
const overlaySrcDir = path.join(projectRoot, "overlay");
const overlayDistDir = path.join(distDir, "overlay");
const pageHelpersSrcPath = path.join(projectRoot, "page-helpers.js");
const pageHelpersDistPath = path.join(distDir, "page-helpers.js");
const obsWrapperFiles = [
  "obs-rank.html",
  "obs-points.html",
  "obs-records.html",
  "obs-han.html"
];

const targets = {
  launch: {
    entry: "app-launch.js",
    bundleOut: path.join(buildDir, "app-launch.bundle.js"),
    exeOut: path.join(distDir, "mahjongsoul-launch.exe")
  },
  collect: {
    entry: "app-collect.js",
    bundleOut: path.join(buildDir, "app-collect.bundle.js"),
    exeOut: path.join(distDir, "mahjongsoul-collect.exe")
  }
};

function run(command, args) {
  return new Promise((resolve, reject) => {
    const finalCommand = process.platform === "win32" && command === "npx" ? "npx.cmd" : command;
    const child = spawn(finalCommand, args, {
      cwd: projectRoot,
      stdio: "inherit",
      shell: process.platform === "win32"
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });

    child.on("error", reject);
  });
}

async function bundleTarget(target) {
  await build({
    entryPoints: [path.join(projectRoot, target.entry)],
    outfile: target.bundleOut,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node18",
    packages: "external"
  });
}

async function copyDirectory(sourceDir, destinationDir) {
  await fs.mkdir(destinationDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath);
      continue;
    }
    await fs.copyFile(sourcePath, destinationPath);
  }
}

async function buildTarget(name) {
  const target = targets[name];
  if (!target) {
    throw new Error(`Unknown build target: ${name}`);
  }

  await bundleTarget(target);
  await run("npx.cmd", [
    "pkg",
    target.bundleOut,
    "--targets",
    "node18-win-x64",
    "--output",
    target.exeOut
  ]);
}

async function main() {
  const requested = process.argv[2] || "all";
  await fs.mkdir(buildDir, { recursive: true });
  await fs.mkdir(distDir, { recursive: true });
  await copyDirectory(overlaySrcDir, overlayDistDir);
  await fs.copyFile(pageHelpersSrcPath, pageHelpersDistPath);
  await fs.mkdir(htmlDistDir, { recursive: true });
  for (const fileName of obsWrapperFiles) {
    await fs.copyFile(path.join(htmlSrcDir, fileName), path.join(htmlDistDir, fileName));
  }

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
