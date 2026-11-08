import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const publicDir = path.resolve(import.meta.dirname, "..", "public");

const BUNDLES = [
  {
    name: "cesium",
    from: (root) => path.join(root, "Build", "Cesium"),
    entries: ["Workers", "ThirdParty", "Assets", "Widgets"],
    to: "cesium",
  },
  {
    name: "world-atlas",
    from: (root) => root,
    entries: ["countries-110m.json", "countries-50m.json"],
    to: "geo",
  },
];

async function copyBundle({ name, from, entries, to }) {
  const root = path.dirname(require.resolve(`${name}/package.json`));
  const { version } = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  const target = path.join(publicDir, to);
  const stamp = path.join(target, ".version");
  const copied = await readFile(stamp, "utf8").catch(() => "");

  if (copied === version) {
    console.log(`${name} ${version} already in public/${to}`);
    return;
  }

  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await Promise.all(
    entries.map((entry) =>
      cp(path.join(from(root), entry), path.join(target, entry), {
        recursive: true,
      }),
    ),
  );
  await writeFile(stamp, version);
  console.log(`${name} ${version} copied to public/${to}`);
}

await Promise.all(BUNDLES.map(copyBundle));
