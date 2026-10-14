// csm-features: compute Crystal Site Matcher features for CIF files from the command line.
// Built into dist/csm-features.mjs (pnpm build) — a single file that needs only Node.js.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { availableParallelism } from "node:os";
import { parseArgs } from "node:util";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { DEFAULT_GRID_RES, DEFAULT_HOP_CUTOFF } from "../lib/pipeline";
import { ExtractOptions, ExtractResult, delimited, extractFromText, featureList, featureRows, hopRows, toJson } from "./extract";

const VERSION = typeof __CSM_VERSION__ === "string" ? __CSM_VERSION__ : "dev";

const HELP = `csm-features ${VERSION} — structure features from CIF files (Crystal Site Matcher)

Usage: csm-features [options] <file.cif | directory> ...

Each data block with atomic coordinates becomes one row (CSV/TSV) or one entry (JSON).
Mobile-ion hops (distance and bottleneck radius) are written for every structure with a
mobile ion. The mobile ion is chosen as in the app: the first of Li, Na, K, Ag, Cu, Mg,
Zn, Ca, Rb, Cs, H (as a cation), F, O (as an anion) present in the structure.

Output
  -o, --output <file>       feature table (default: standard output)
  -f, --format <fmt>        csv | tsv | json (default: from --output extension, else csv)
      --hops-output <file>  hop table for CSV/TSV (default: <output>.hops.<ext> next to
                            --output; JSON embeds hops in each structure)
      --no-hops             do not write hops
      --list-features       print feature keys, units and descriptions, then exit

Calculation
  -m, --mobile <El|none>    mobile ion (default: automatic, see above)
      --ox <list>           oxidation states by element or site label, e.g. "Co=3,O1=-2"
                            (repeatable; default: from the CIF, else charge balance)
      --hop-cutoff <Å>      maximum mobile–mobile hop distance (default ${DEFAULT_HOP_CUTOFF})
      --grid <Å>            BVSE / void grid spacing (default ${DEFAULT_GRID_RES})
      --no-grid             skip the BVSE / void grid (E_*, R_*, maxVoid, siteE_* empty); fast

Other
  -r, --recursive           search directories recursively for *.cif / *.mcif
  -j, --jobs <n>            parallel workers (default: CPU count, at most the number of files)
  -q, --quiet               no progress messages
  -h, --help                show this help
  -V, --version             show the version

Examples
  csm-features samples/*.cif -o features.csv          # also writes features.hops.csv
  csm-features cifs/ -r --no-grid -o quick.tsv
  csm-features LiCoO2.cif -f json --mobile Li
`;

class UsageError extends Error {}

interface Task {
  id: number;
  path: string;
  label: string;
}

async function runTask(t: Task, opts: ExtractOptions): Promise<ExtractResult> {
  let text: string;
  try {
    text = readFileSync(t.path, "utf8");
  } catch (e) {
    return { records: [], errors: [{ file: t.label, block: null, message: (e as Error).message }] };
  }
  return extractFromText(text, t.label, opts);
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

function collectInputs(args: string[], recursive: boolean): Task[] {
  const out: Task[] = [];
  const walk = (dir: string, depth: number) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (recursive) walk(p, depth + 1);
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
    if (st.isDirectory()) walk(a, 0);
    else out.push({ id: out.length, path: a, label: a });
  }
  return out;
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
  await Promise.all(
    Array.from({ length: jobs }, () => {
      const w = new Worker(new URL(import.meta.url), { workerData: opts });
      return new Promise<void>((resolve, reject) => {
        const next = () => {
          const t = queue.shift();
          if (!t) {
            w.terminate().then(() => resolve(), reject);
            return;
          }
          started.set(t.id, performance.now());
          w.postMessage(t);
        };
        w.on("message", (m) => {
          const { id, result } = m as { id: number; result: ExtractResult };
          results[id] = result;
          report(tasks[id], result, performance.now() - (started.get(id) ?? 0));
          next();
        });
        w.on("error", reject);
        next();
      });
    }),
  );
  return results;
}

function hopsPathFor(output: string, ext: string) {
  const e = extname(output);
  const stem = e ? output.slice(0, -e.length) : output;
  return `${stem}.hops${ext}`;
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
  const tasks = collectInputs(positionals, !!v.recursive);
  if (!tasks.length) throw new UsageError("no CIF files found");
  const jobs = Math.max(1, Math.min(tasks.length, Math.floor(positiveNumber(v.jobs, "jobs", availableParallelism()))));
  const log = v.quiet ? () => undefined : (s: string) => void process.stderr.write(s + "\n");

  const t0 = performance.now();
  const parts = await runAll(tasks, opts, jobs, log);
  const result: ExtractResult = { records: parts.flatMap((p) => p.records), errors: parts.flatMap((p) => p.errors) };

  const wantHops = !v["no-hops"];
  let text: string;
  if (fmt === "json") {
    text = toJson(result, { version: VERSION, mobile: opts.mobile, hopCutoff: opts.hopCutoff!, grid: opts.grid ?? null, hops: wantHops });
  } else text = delimited(featureRows(result.records), sep);
  if (output) writeFileSync(output, text);
  else process.stdout.write(text);

  let hopNote = "";
  if (fmt !== "json" && wantHops) {
    const anyHops = result.records.some((r) => r.mobile);
    const hopsOut = (v["hops-output"] as string | undefined) ?? (output && anyHops ? hopsPathFor(output, `.${fmt}`) : undefined);
    if (hopsOut) {
      writeFileSync(hopsOut, delimited(hopRows(result.records), sep));
      hopNote = `, hops → ${hopsOut}`;
    } else if (anyHops) log("note: hops were not written (standard output); use --output or --hops-output to save them");
  }

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
