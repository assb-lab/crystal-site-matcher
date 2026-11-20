// csm-features: compute Crystal Site Matcher features for CIF files from the command line.
// Built into dist/csm-features.mjs (pnpm build) — a single file that needs only Node.js.
import { readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { availableParallelism } from "node:os";
import { parseArgs } from "node:util";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { DEFAULT_GRID_RES, DEFAULT_HOP_CUTOFF } from "../lib/pipeline";
import { ExtractError, ExtractOptions, ExtractResult, delimited, extractFromText, featureList, featureRows, hopRows, siteRows, toJson } from "./extract";

const VERSION = typeof __CSM_VERSION__ === "string" ? __CSM_VERSION__ : "dev";

const HELP = `csm-features ${VERSION} — structure features from CIF files (Crystal Site Matcher)

Usage: csm-features [options] <file.cif | directory> ...

Each data block with atomic coordinates becomes one row (CSV/TSV) or one entry (JSON).
Mobile-ion hops (distance and bottleneck radius) are written for every structure with a
mobile ion, and, with the BVSE grid, its stable sites (local minima of the landscape,
including empty candidate sites away from the CIF positions). The mobile ion is chosen as in the app: the first of Li, Na, K, Ag, Cu, Mg,
Zn, Ca, Rb, Cs, H (as a cation), F, O (as an anion) present in the structure.

Output
  -o, --output <file>       feature table (default: standard output)
  -f, --format <fmt>        csv | tsv | json (default: from --output extension, else csv)
      --hops-output <file>  hop table for CSV/TSV (default: <output>.hops.<ext> next to
                            --output, header only when empty; JSON embeds hops in each structure)
      --no-hops             do not write hops
      --sites-output <file> stable-site table for CSV/TSV (default: <output>.sites.<ext>;
                            JSON embeds sites in each structure)
      --no-sites            do not write stable sites
      --list-features       print feature keys, units and descriptions, then exit

Calculation
  -m, --mobile <El|none>    mobile ion (default: automatic, see above; a structure without it
                            gets a warning and no mobile ion)
      --ox <list>           oxidation states by element or site label, e.g. "Co=3,O1=-2"
                            (repeatable; default: from the CIF, else charge balance)
      --hop-cutoff <Å>      maximum mobile–mobile hop distance (default ${DEFAULT_HOP_CUTOFF})
      --grid <Å>            BVSE / void grid spacing (default ${DEFAULT_GRID_RES})
      --no-grid             skip the BVSE / void grid (E_*, R_*, maxVoid, siteE_*, stable sites
                            empty); fast

Other
  -r, --recursive           search directories recursively for *.cif / *.mcif
  -j, --jobs <n>            parallel workers (default: CPU count, at most the number of files)
  -q, --quiet               no progress messages
  -h, --help                show this help
  -V, --version             show the version

Examples
  csm-features samples/*.cif -o features.csv          # also features.hops.csv, features.sites.csv
  csm-features cifs/ -r --no-grid -o quick.tsv
  csm-features LiCoO2.cif -f json --mobile Li
`;

class UsageError extends Error {}

interface Task {
  id: number;
  path: string;
  label: string;
}

const failed = (file: string, message: string): ExtractResult => ({ records: [], errors: [{ file, block: null, message }], warnings: [] });

async function runTask(t: Task, opts: ExtractOptions): Promise<ExtractResult> {
  try {
    return await extractFromText(readFileSync(t.path, "utf8"), t.label, opts);
  } catch (e) {
    return failed(t.label, (e as Error)?.message ?? String(e));
  }
}

// ---------------------------------------------------------------------------
// worker side

if (!isMainThread) {
  const opts = workerData as ExtractOptions;
  parentPort!.on("message", async (m) => {
    const t = m as Task;
    const result = await runTask(t, opts);
    parentPort!.postMessage({ id: t.id, result });
  });
}

// ---------------------------------------------------------------------------
// main side

const CIF_EXT = /\.(cif|mcif)$/i;

/**
 * CIF files named on the command line or found in directories. Entries that cannot be read (broken links,
 * directories without permission) become errors of their own instead of stopping the run (#82); under -r,
 * each directory is visited once by its real path, so symbolic-link loops end.
 */
function collectInputs(args: string[], recursive: boolean, warn: (s: string) => void): { tasks: Task[]; errors: ExtractError[] } {
  const out: Task[] = [];
  const errors: ExtractError[] = [];
  const visited = new Set<string>();
  const message = (e: unknown) => (e as Error)?.message ?? String(e);
  const walk = (dir: string) => {
    let names: string[];
    try {
      const real = realpathSync(dir);
      if (visited.has(real)) {
        warn(`warning: ${dir}: directory already visited (symbolic-link loop?); skipped`);
        return;
      }
      visited.add(real);
      names = readdirSync(dir).sort();
    } catch (e) {
      errors.push({ file: dir, block: null, message: `cannot read directory: ${message(e)}` });
      return;
    }
    for (const name of names) {
      const p = join(dir, name);
      let st;
      try {
        st = statSync(p);
      } catch (e) {
        // a broken link to a CIF is a file we could not read; anything else is only noted
        if (CIF_EXT.test(name)) errors.push({ file: p, block: null, message: message(e) });
        else warn(`warning: ${p}: skipped (${message(e)})`);
        continue;
      }
      if (st.isDirectory()) {
        if (recursive) walk(p);
      } else if (st.isFile() && CIF_EXT.test(name)) out.push({ id: out.length, path: p, label: p });
    }
  };
  for (const a of args) {
    let st;
    try {
      st = statSync(a);
    } catch {
      throw new UsageError(`no such file or directory: ${a}`);
    }
    if (st.isDirectory()) walk(a);
    else out.push({ id: out.length, path: a, label: a });
  }
  return { tasks: out, errors };
}

function parseOx(list: string[]): Record<string, number> | undefined {
  if (!list.length) return undefined;
  const ox: Record<string, number> = {};
  for (const item of list.join(",").split(",")) {
    const s = item.trim();
    if (!s) continue;
    const m = /^([A-Za-z][A-Za-z0-9_'()+-]*?)\s*[=:]\s*([+-]?\d+(?:\.\d+)?)([+-]?)$/.exec(s);
    if (!m) throw new UsageError(`cannot parse --ox entry "${s}" (expected e.g. Co=3 or O1=-2)`);
    ox[m[1]] = parseFloat(m[2]) * (m[3] === "-" ? -1 : 1);
  }
  return ox;
}

function positiveNumber(v: unknown, name: string, fallback: number): number {
  if (v === undefined) return fallback;
  const x = Number(v);
  if (!Number.isFinite(x) || x <= 0) throw new UsageError(`--${name} must be a positive number`);
  return x;
}

async function runAll(tasks: Task[], opts: ExtractOptions, jobs: number, log: (s: string) => void): Promise<ExtractResult[]> {
  const results: ExtractResult[] = new Array(tasks.length);
  let done = 0;
  const report = (t: Task, r: ExtractResult, ms: number) => {
    done++;
    const n = r.records.length;
    log(`[${done}/${tasks.length}] ${t.label}: ${n} structure${n === 1 ? "" : "s"}${r.errors.length ? `, ${r.errors.length} error${r.errors.length === 1 ? "" : "s"}` : ""} (${(ms / 1000).toFixed(2)} s)`);
  };
  if (jobs <= 1) {
    for (const t of tasks) {
      const t0 = performance.now();
      results[t.id] = await runTask(t, opts);
      report(t, results[t.id], performance.now() - t0);
    }
    return results;
  }
  const queue = [...tasks];
  const started = new Map<number, number>();
  // A worker that dies (out of memory, an uncaught error) costs only the file it was on: that file
  // becomes an error and a fresh worker takes the rest of the queue (#82). Each death uses up one file.
  const runWorker = (): Promise<void> =>
    new Promise<void>((resolve) => {
      const w = new Worker(new URL(import.meta.url), { workerData: opts });
      let current: Task | undefined;
      let finished = false;
      const next = () => {
        current = queue.shift();
        if (!current) {
          finished = true;
          w.terminate().then(() => resolve(), () => resolve());
          return;
        }
        started.set(current.id, performance.now());
        w.postMessage(current);
      };
      const died = (why: string) => {
        if (finished) return;
        finished = true;
        const t = current;
        current = undefined;
        if (t) {
          results[t.id] = failed(t.label, `worker stopped: ${why}`);
          report(t, results[t.id], performance.now() - (started.get(t.id) ?? 0));
        }
        w.terminate().catch(() => undefined);
        runWorker().then(resolve);
      };
      w.on("message", (m) => {
        const { id, result } = m as { id: number; result: ExtractResult };
        results[id] = result;
        current = undefined;
        report(tasks[id], result, performance.now() - (started.get(id) ?? 0));
        next();
      });
      w.on("error", (e) => died(e?.message ?? String(e)));
      w.on("exit", (code) => died(`exit code ${code}`));
      next();
    });
  await Promise.all(Array.from({ length: jobs }, runWorker));
  return results;
}

function sidePathFor(output: string, part: "hops" | "sites", ext: string) {
  const e = extname(output);
  const stem = e ? output.slice(0, -e.length) : output;
  return `${stem}.${part}${ext}`;
}

async function main(argv: string[]): Promise<number> {
  const { values: v, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      output: { type: "string", short: "o" },
      format: { type: "string", short: "f" },
      "hops-output": { type: "string" },
      "no-hops": { type: "boolean" },
      "sites-output": { type: "string" },
      "no-sites": { type: "boolean" },
      "list-features": { type: "boolean" },
      mobile: { type: "string", short: "m" },
      ox: { type: "string", multiple: true },
      "hop-cutoff": { type: "string" },
      grid: { type: "string" },
      "no-grid": { type: "boolean" },
      recursive: { type: "boolean", short: "r" },
      jobs: { type: "string", short: "j" },
      quiet: { type: "boolean", short: "q" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "V" },
    },
  });
  if (v.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (v.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  const output = v.output as string | undefined;
  const fmt = ((v.format as string | undefined) ?? (output ? extname(output).slice(1).toLowerCase() : "csv")) || "csv";
  if (!["csv", "tsv", "json"].includes(fmt)) throw new UsageError(`unknown format "${fmt}" (csv, tsv or json)`);
  const sep = fmt === "tsv" ? "\t" : ",";

  if (v["list-features"]) {
    const rows = featureList();
    const text = fmt === "json" ? JSON.stringify(rows.slice(1).map((r) => Object.fromEntries(rows[0].map((k, i) => [k, r[i]]))), null, 2) + "\n" : delimited(rows, sep);
    if (output) writeFileSync(output, text);
    else process.stdout.write(text);
    return 0;
  }

  if (!positionals.length) {
    process.stderr.write(HELP);
    return 2;
  }
  const mobileArg = v.mobile as string | undefined;
  const opts: ExtractOptions = {
    mobile: mobileArg === undefined ? undefined : /^(none|-)$/i.test(mobileArg) ? null : mobileArg.charAt(0).toUpperCase() + mobileArg.slice(1).toLowerCase(),
    oxOverride: parseOx((v.ox as string[] | undefined) ?? []),
    hopCutoff: positiveNumber(v["hop-cutoff"], "hop-cutoff", DEFAULT_HOP_CUTOFF),
    grid: v["no-grid"] ? null : positiveNumber(v.grid, "grid", DEFAULT_GRID_RES),
  };
  const warn = (s: string) => void process.stderr.write(s + "\n");
  const { tasks, errors: inputErrors } = collectInputs(positionals, !!v.recursive, warn);
  if (!tasks.length && !inputErrors.length) throw new UsageError("no CIF files found");
  const jobs = Math.max(1, Math.min(Math.max(1, tasks.length), Math.floor(positiveNumber(v.jobs, "jobs", availableParallelism()))));
  const log = v.quiet ? () => undefined : (s: string) => void process.stderr.write(s + "\n");

  const t0 = performance.now();
  const parts = await runAll(tasks, opts, jobs, log);
  const result: ExtractResult = { records: parts.flatMap((p) => p.records), errors: [...inputErrors, ...parts.flatMap((p) => p.errors)], warnings: parts.flatMap((p) => p.warnings) };
  // --ox keys that no structure has as a site label or element (symbols and labels are case-sensitive)
  if (opts.oxOverride && result.records.length) {
    const used = new Set(parts.flatMap((p) => p.oxUsed ?? []));
    for (const k of Object.keys(opts.oxOverride)) if (!used.has(k)) result.warnings.push({ file: "--ox", block: null, message: `"${k}" matches no site label or element (case-sensitive); ignored` });
  }

  const wantHops = !v["no-hops"];
  let text: string;
  if (fmt === "json") {
    text = toJson(result, { version: VERSION, mobile: opts.mobile, hopCutoff: opts.hopCutoff!, grid: opts.grid ?? null, hops: wantHops, sites: !v["no-sites"] });
  } else text = delimited(featureRows(result.records), sep);
  if (output) writeFileSync(output, text);
  else process.stdout.write(text);

  let hopNote = "";
  if (fmt !== "json" && wantHops) {
    const anyHops = result.records.some((r) => r.mobile);
    // always written next to --output (header only when empty), so no stale table from an earlier run remains
    const hopsOut = (v["hops-output"] as string | undefined) ?? (output ? sidePathFor(output, "hops", `.${fmt}`) : undefined);
    if (hopsOut) {
      writeFileSync(hopsOut, delimited(hopRows(result.records), sep));
      hopNote = `, hops → ${hopsOut}`;
    } else if (anyHops) log("note: hops were not written (standard output); use --output or --hops-output to save them");
  }
  if (fmt !== "json" && !v["no-sites"]) {
    const anySites = result.records.some((r) => r.sites.length);
    const sitesOut = (v["sites-output"] as string | undefined) ?? (output ? sidePathFor(output, "sites", `.${fmt}`) : undefined);
    if (sitesOut) {
      writeFileSync(sitesOut, delimited(siteRows(result.records), sep));
      hopNote += `, sites → ${sitesOut}`;
    } else if (anySites) log("note: stable sites were not written (standard output); use --output or --sites-output to save them");
  }

  for (const w of result.warnings) warn(`warning: ${w.file}${w.block ? ` [${w.block}]` : ""}: ${w.message}`);
  for (const e of result.errors) process.stderr.write(`error: ${e.file}${e.block ? ` [${e.block}]` : ""}: ${e.message}\n`);
  const n = result.records.length;
  log(`${n} structure${n === 1 ? "" : "s"} from ${tasks.length} file${tasks.length === 1 ? "" : "s"} in ${((performance.now() - t0) / 1000).toFixed(1)} s${output ? ` → ${basename(output)}` : ""}${hopNote}`);
  return result.errors.length ? 1 : 0;
}

if (isMainThread) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      process.stderr.write(e instanceof UsageError || (e as { code?: string })?.code?.startsWith?.("ERR_PARSE_ARGS") ? `csm-features: ${(e as Error).message}\nTry "csm-features --help".\n` : `csm-features: ${(e as Error)?.stack ?? e}\n`);
      process.exitCode = 2;
    },
  );
}
