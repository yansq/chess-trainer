import { readFile, mkdtemp, rm, appendFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
const repo = process.env.GITHUB_REPOSITORY;
const sha = process.env.GITHUB_SHA;
if (repo !== "yansq/chess-trainer" || !/^[a-f0-9]{40}$/.test(sha ?? ""))
  throw Error("Invalid release source");
const { version } = JSON.parse(
  await readFile("src-tauri/tauri.conf.json", "utf8"),
);
const tag = `v${version}`;
const api = (route, body, method = "PATCH") =>
  JSON.parse(
    execFileSync(
      "gh",
      ["api", route, ...(body ? ["--method", method, "--input", "-"] : [])],
      { encoding: "utf8", ...(body ? { input: JSON.stringify(body) } : {}) },
    ),
  );
// Drafts without a published tag are absent from the by-tag endpoint.
const releases = JSON.parse(
  execFileSync(
    "gh",
    ["api", `repos/${repo}/releases?per_page=100`, "--paginate", "--slurp"],
    { encoding: "utf8" },
  ),
).flat();
let release = releases.find((entry) => entry.tag_name === tag);
if (release) {
  if (release.target_commitish !== sha)
    throw Error("Existing release belongs to another source commit");
  if (!release.draft) {
    console.log(`Release ${tag} already published; keeping immutable assets`);
    process.exit(0);
  }
} else {
  release = api(
    `repos/${repo}/releases`,
    {
      tag_name: tag,
      target_commitish: sha,
      draft: true,
      name: `Chess Trainer ${version}`,
      body: await readFile("release/notes.md", "utf8"),
    },
    "POST",
  );
}
const name = `Chess-Trainer_${version}_aarch64.app`;
const files = [
  `${name}.tar.gz`,
  `${name}.tar.gz.sig`,
  `${name}.zip`,
  "latest.json",
  "SHA256SUMS.txt",
];
execFileSync(
  "gh",
  [
    "release",
    "upload",
    tag,
    "--repo",
    repo,
    "--clobber",
    ...files.map((f) => `release/${f}`),
  ],
  { stdio: "inherit" },
);
const temporary = await mkdtemp(join(tmpdir(), "chess-release-readback-"));
try {
  execFileSync(
    "gh",
    ["release", "download", tag, "--repo", repo, "--dir", temporary],
    { stdio: "inherit" },
  );
  for (const file of files) {
    const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
    if (
      hash(await readFile(`release/${file}`)) !==
      hash(await readFile(join(temporary, file)))
    )
      throw Error(`Release asset mismatch: ${file}`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
// Let GitHub determine latest by semantic version even if parallel builds finish out of order.
const published = api(`repos/${repo}/releases/${release.id}`, {
  draft: false,
  make_latest: "legacy",
});
console.log(published.html_url);
if (process.env.GITHUB_STEP_SUMMARY)
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    `## Published ${tag}\n\n[Download release](${published.html_url})\n\nSource: ${sha}\n`,
  );
