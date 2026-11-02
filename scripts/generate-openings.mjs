// Explicit maintenance command; the application never downloads opening data.
import { Chess } from "chess.js";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
const revision = "712a58be746c143f4ab935b68acc50f4bac813eb";
const root = new URL("../", import.meta.url);
const entries = new Map();
const files = {};
let records = 0;
for (const volume of ["a", "b", "c", "d", "e"]) {
  const filename = `${volume}.tsv`;
  const response = await fetch(
    `https://raw.githubusercontent.com/lichess-org/chess-openings/${revision}/${filename}`,
  );
  if (!response.ok) throw Error(`${filename}: HTTP ${response.status}`);
  const text = await response.text();
  files[filename] = createHash("sha256").update(text).digest("hex");
  for (const line of text.trim().split("\n").slice(1)) {
    const [eco, name, pgn] = line.replace(/\r$/, "").split("\t");
    if (!/^[A-E][0-9]{2}$/.test(eco) || !name || !pgn)
      throw Error(`Invalid opening: ${line}`);
    const chess = new Chess();
    chess.loadPgn(pgn);
    // chess.js omits en-passant unless a legal capture exists. Match all four
    // position fields; counters do not identify an opening.
    const key = chess.fen().split(" ").slice(0, 4).join(" ");
    const entry = { eco, name, ply: chess.history().length };
    const prior = entries.get(key);
    // Resolve aliases deterministically, preferring the shortest source line.
    if (
      !prior ||
      entry.ply < prior.ply ||
      (entry.ply === prior.ply &&
        `${eco}\t${name}` < `${prior.eco}\t${prior.name}`)
    )
      entries.set(key, entry);
    records++;
  }
}
const manifest = {
  source: "https://github.com/lichess-org/chess-openings",
  revision,
  license: "CC0-1.0",
  records,
  positions: entries.size,
  sha256: files,
};
const manifestUrl = new URL("data/openings/version.json", root);
// The fixed revision must reproduce the reviewed source checksums.
const previous = await readFile(manifestUrl, "utf8")
  .then(JSON.parse)
  .catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
if (
  previous?.revision === revision &&
  JSON.stringify(previous.sha256) !== JSON.stringify(files)
)
  throw Error("Opening source checksum mismatch");
const data = Object.fromEntries(
  [...entries]
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([fen, entry]) => [fen, [entry.eco, entry.name]]),
);
await writeFile(
  new URL("src/shared/chess/lichess-openings.json", root),
  JSON.stringify(data) + "\n",
);
await writeFile(manifestUrl, JSON.stringify(manifest, null, 2) + "\n");
console.log(
  `Generated ${entries.size} positions from ${records} records (${revision})`,
);
