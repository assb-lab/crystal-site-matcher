// Third-party notices for the two self-contained builds (#60). Minification drops the licence comments of
// the bundled packages, and the reference data in src/data come from pymatgen and BVlain; MIT asks for
// their copyright and permission notices in every copy. This plugin records the npm packages that actually
// end up in a bundle, reads each package's own licence file, adds the licences of the data sources pinned
// in scripts/sources.lock (texts in scripts/data-licenses/), and
//   - puts the notices in a comment at the top of the written file (after the shebang / doctype), and
//   - with `listFile`, also writes them as a plain text file next to the output.
// With `subsetOf`, the build fails if it bundles a package that the given notices file does not list.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin } from "vite-plus";

interface Notice {
  key: string; // npm package name or data source name
  head: string;
  text: string;
}

/** Package directory and name of a module inside node_modules (the last node_modules segment wins). */
function packageOf(id: string): { dir: string; name: string } | null {
  const path = id.replace(/\\/g, "/").replace(/^\0/, "");
  const at = path.lastIndexOf("/node_modules/");
  if (at < 0) return null;
  const rest = path.slice(at + "/node_modules/".length).split("/");
  const name = rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
  return { dir: path.slice(0, at + "/node_modules/".length) + name, name };
}

function packageNotice(dir: string, name: string): Notice {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version: string; license?: string };
  const file = readdirSync(dir).find((f) => /^licen[cs]e(\.(md|txt))?$/i.test(f));
  if (!file) throw new Error(`third-party notices: no licence file in ${name}`);
  return { key: name, head: `${name} ${pkg.version} (${pkg.license ?? "see below"})`, text: readFileSync(join(dir, file), "utf8").trim() };
}

/** Licences of the upstream data sources, from scripts/sources.lock and scripts/data-licenses/<name>.txt. */
function dataNotices(root: string): Notice[] {
  const out: Notice[] = [];
  for (const line of readFileSync(join(root, "scripts/sources.lock"), "utf8").split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [name, repo, commit] = line.trim().split(/\s+/);
    const text = readFileSync(join(root, "scripts/data-licenses", `${name}.txt`), "utf8").trim();
    out.push({ key: `data:${name}`, head: `${name} — reference data in src/data (${repo} @ ${commit.slice(0, 12)})`, text });
  }
  return out;
}

export function noticesText(notices: Notice[]): string {
  return [
    "Crystal Site Matcher — third-party notices",
    "This file contains the following software and data, distributed under the licences below.",
    "The project itself is MIT licensed (see LICENSE, https://github.com/assb-lab/crystal-site-matcher).",
    ...notices.map((n) => `\n==== ${n.head} ====\n\n${n.text}`),
  ].join("\n");
}

export function thirdPartyNotices(opts: { listFile?: string; subsetOf?: string } = {}): Plugin {
  const packages = new Map<string, string>(); // name → directory
  let outDir = "dist";
  let root = ".";
  return {
    name: "third-party-notices",
    apply: "build",
    configResolved(c) {
      root = c.root;
      outDir = resolve(c.root, c.build.outDir);
    },
    renderChunk(_code, chunk) {
      for (const id of chunk.moduleIds) {
        const p = packageOf(id);
        if (p && !packages.has(p.name)) packages.set(p.name, p.dir);
      }
      return null;
    },
    writeBundle(_o, bundle) {
      const notices = [...[...packages].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, dir]) => packageNotice(dir, name)), ...dataNotices(root)];
      const text = noticesText(notices);
      if (opts.subsetOf) {
        const listed = readFileSync(join(outDir, opts.subsetOf), "utf8");
        const missing = [...packages.keys()].filter((name) => !listed.includes(`\n==== ${name} `));
        if (missing.length) throw new Error(`third-party notices: ${missing.join(", ")} not in ${opts.subsetOf}; build the app first`);
      }
      if (/-->|\*\//.test(text)) throw new Error("third-party notices: text would end the comment early");
      for (const name of Object.keys(bundle)) {
        const file = join(outDir, name);
        if (!existsSync(file)) continue;
        const src = readFileSync(file, "utf8");
        if (name.endsWith(".html")) {
          const m = src.match(/^<!doctype html>\s*/i);
          const at = m ? m[0].length : 0;
          writeFileSync(file, `${src.slice(0, at)}<!--\n${text}\n-->\n${src.slice(at)}`);
        } else if (/\.m?js$/.test(name)) {
          const nl = src.startsWith("#!") ? src.indexOf("\n") + 1 : 0;
          writeFileSync(file, `${src.slice(0, nl)}/*!\n${text}\n*/\n${src.slice(nl)}`);
        }
      }
      if (opts.listFile) writeFileSync(join(outDir, opts.listFile), text + "\n");
    },
  };
}
