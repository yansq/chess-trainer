# Lichess opening catalogue

Source: https://github.com/lichess-org/chess-openings

The opening facts are public domain; Lichess releases any copyright in the curated collection under **CC0-1.0**: https://creativecommons.org/publicdomain/zero/1.0/.

`version.json` pins the upstream commit and SHA-256 of each ECO volume. Run `node scripts/generate-openings.mjs` to regenerate `src/shared/chess/lichess-openings.json` using the installed chess.js version. The generator validates every PGN and verifies the pinned source checksums. Regeneration needs network access; the application is fully offline.

The generated index is shared by TypeScript import parsing and Rust database writes/migration. Keys contain piece placement, side to move, castling rights and legal en-passant rights; move counters are ignored. To classify a game, inspect its positions from last to first and use the first catalogue match. Unmatched games use null ECO/name (displayed as unknown). Platform header names are never used as classification fallbacks; they remain in the original PGN.

Position aliases are resolved deterministically: shortest source line first, then ECO and name in lexical order. Both runtimes consume the same resolved index.

Database migration 7 reclassifies existing mainlines in one transaction. Subsequent imports use the same catalogue, preventing old source labels from being restored by sync. Any future catalogue revision must include an explicit migration to reclassify existing games again.
