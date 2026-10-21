import { readFile, mkdir, copyFile, writeFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir, arch, platform } from "node:os";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
process.chdir(root);
const config = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const cargo = await readFile("src-tauri/Cargo.toml", "utf8");
const version = config.version;
if (
  !/^\d+\.\d+\.\d+$/.test(version) ||
  pkg.version !== version ||
  !cargo.includes(`version = "${version}"`)
)
  throw Error("Release versions must match");
if (platform() !== "darwin" || arch() !== "arm64")
  throw Error("This release target is macOS Apple Silicon");
const key =
  process.env.TAURI_SIGNING_PRIVATE_KEY ||
  join(homedir(), ".tauri/chess-trainer.key");
await access(key);
const pubkey = (await readFile(`${key}.pub`, "utf8")).trim();
if (pubkey !== config.plugins.updater.pubkey)
  throw Error("Signing key does not match configured updater public key");
const run = (command, args, extra = {}) =>
  execFileSync(command, args, { cwd: root, stdio: "inherit", ...extra });
run("pnpm", ["tauri", "build", "--bundles", "app"], {
  env: {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: key,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD:
      process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "",
    APPLE_SIGNING_IDENTITY: "-",
  },
});
const app = "src-tauri/target/release/bundle/macos/Chess Trainer.app";
const builtVersion = execFileSync(
  "/usr/libexec/PlistBuddy",
  ["-c", "Print :CFBundleShortVersionString", `${app}/Contents/Info.plist`],
  { encoding: "utf8" },
).trim();
if (builtVersion !== version) throw Error("Built app version mismatch");
run("codesign", ["--verify", "--deep", "--strict", app]);
const name = `Chess-Trainer_${version}_aarch64.app`;
await mkdir("release", { recursive: true });
await copyFile(`${app}.tar.gz`, `release/${name}.tar.gz`);
await copyFile(`${app}.tar.gz.sig`, `release/${name}.tar.gz.sig`);
run("ditto", [
  "-c",
  "-k",
  "--sequesterRsrc",
  "--keepParent",
  app,
  `release/${name}.zip`,
]);
const notes = await readFile(`docs/releases/v${version}.md`, "utf8");
const signature = (await readFile(`release/${name}.tar.gz.sig`, "utf8")).trim();
if (!signature) throw Error("Updater signature is empty");
await writeFile(
  "release/latest.json",
  JSON.stringify(
    {
      version,
      notes,
      pub_date: new Date().toISOString(),
      platforms: {
        "darwin-aarch64": {
          signature,
          url: `https://github.com/yansq/chess-trainer/releases/download/v${version}/${name}.tar.gz`,
        },
      },
    },
    null,
    2,
  ) + "\n",
);
const files = [
  `${name}.tar.gz`,
  `${name}.tar.gz.sig`,
  `${name}.zip`,
  "latest.json",
];
const sums = [];
for (const file of files)
  sums.push(
    `${createHash("sha256")
      .update(await readFile(`release/${file}`))
      .digest("hex")}  ${file}`,
  );
await writeFile("release/SHA256SUMS.txt", sums.join("\n") + "\n");
console.log(`Signed release ${version} prepared in ${resolve("release")}`);
