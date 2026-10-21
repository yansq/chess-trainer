import { readFile, access, mkdtemp, rm } from "node:fs/promises";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

export async function verifyAppIcon(app) {
  const icon = execFileSync(
    "/usr/libexec/PlistBuddy",
    ["-c", "Print :CFBundleIconFile", join(app, "Contents/Info.plist")],
    { encoding: "utf8" },
  ).trim();
  if (!icon || basename(icon) !== icon)
    throw Error("App icon is missing or invalid");
  const path = join(
    app,
    "Contents/Resources",
    icon.endsWith(".icns") ? icon : `${icon}.icns`,
  );
  const bytes = await readFile(path);
  if (bytes.toString("ascii", 0, 4) !== "icns" || bytes.length < 256)
    throw Error("App icon is not a valid ICNS");
  const temporary = await mkdtemp(join(tmpdir(), "chess-app-icon-"));
  try {
    const iconset = join(temporary, "app.iconset");
    execFileSync("iconutil", ["-c", "iconset", "-o", iconset, path]);
    await access(join(iconset, "icon_32x32.png"));
    await access(join(iconset, "icon_512x512.png"));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  console.log(`App icon verified: ${icon}`);
}
