import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function releaseVersion(base, runNumber) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(base);
  if (!match || !/^[1-9]\d*$/.test(String(runNumber)))
    throw Error("Invalid release version or run number");
  const patch = Number(match[3]) + Number(runNumber);
  if (!Number.isSafeInteger(patch)) throw Error("Release number overflow");
  return `${match[1]}.${match[2]}.${patch}`;
}

async function main() {
  const sha = process.env.GITHUB_SHA;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!/^[a-f0-9]{40}$/.test(sha ?? "") || repo !== "yansq/chess-trainer")
    throw Error("Invalid release source");
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const config = JSON.parse(
    await readFile("src-tauri/tauri.conf.json", "utf8"),
  );
  const version = releaseVersion(pkg.version, process.env.GITHUB_RUN_NUMBER);
  if (config.version !== pkg.version) throw Error("Source versions must match");
  const cargo = await readFile("src-tauri/Cargo.toml", "utf8");
  if (!cargo.includes(`version = "${pkg.version}"`))
    throw Error("Cargo source version mismatch");
  await writeFile(
    "src-tauri/Cargo.toml",
    cargo.replace(`version = "${pkg.version}"`, `version = "${version}"`),
  );
  const lock = await readFile("src-tauri/Cargo.lock", "utf8");
  const nextLock = lock.replace(
    /(\[\[package\]\]\nname = "chess-trainer"\nversion = ")[^"]+(".*)/,
    (_match, prefix, suffix) => `${prefix}${version}${suffix}`,
  );
  if (lock === nextLock) throw Error("Cargo lock version was not updated");
  await writeFile("src-tauri/Cargo.lock", nextLock);
  pkg.version = version;
  config.version = version;
  await writeFile("package.json", JSON.stringify(pkg, null, 2) + "\n");
  await writeFile(
    "src-tauri/tauri.conf.json",
    JSON.stringify(config, null, 2) + "\n",
  );
  const subject = execFileSync("git", ["show", "-s", "--format=%s", sha], {
    encoding: "utf8",
  }).trim();
  await mkdir("release", { recursive: true });
  await writeFile(
    "release/notes.md",
    `# Chess Trainer ${version}\n\n${subject}\n\n源码：[${sha.slice(0, 7)}](https://github.com/${repo}/commit/${sha})\n\n由 main 分支推送自动构建、签名并发布。适用于 macOS Apple Silicon。\n\n在「设置 → 应用更新」检查并安装。首次安装可下载 .app.zip。应用采用 ad-hoc 签名，尚未进行 Apple 公证。\n`,
  );
  if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  console.log(`CI release version: ${version}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
