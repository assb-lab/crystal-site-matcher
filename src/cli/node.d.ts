// Minimal typings for the few Node.js APIs the command-line tool uses.
// (Kept local instead of adding @types/node as a dependency; extend when the CLI needs more.)

declare const __CSM_VERSION__: string;

declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string): void;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isDirectory(): boolean; isFile(): boolean };
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function basename(path: string, suffix?: string): string;
  export function extname(path: string): string;
  export function relative(from: string, to: string): string;
  export function resolve(...parts: string[]): string;
}

declare module "node:os" {
  export function availableParallelism(): number;
}

declare module "node:util" {
  interface OptionSpec {
    type: "string" | "boolean";
    short?: string;
    multiple?: boolean;
  }
  export function parseArgs(config: { args?: string[]; options: Record<string, OptionSpec>; allowPositionals?: boolean; strict?: boolean }): {
    values: Record<string, string | boolean | string[] | undefined>;
    positionals: string[];
  };
}

declare module "node:worker_threads" {
  interface Port {
    postMessage(msg: unknown): void;
    on(ev: "message", cb: (msg: unknown) => void): void;
  }
  export const isMainThread: boolean;
  export const parentPort: Port | null;
  export const workerData: unknown;
  export class Worker {
    constructor(url: URL, opts?: { workerData?: unknown });
    postMessage(msg: unknown): void;
    on(ev: "message", cb: (msg: unknown) => void): this;
    on(ev: "error", cb: (err: Error) => void): this;
    on(ev: "exit", cb: (code: number) => void): this;
    terminate(): Promise<number>;
  }
}

declare const process: {
  argv: string[];
  exitCode: number | undefined;
  cwd(): string;
  stdout: { write(s: string): boolean; isTTY?: boolean };
  stderr: { write(s: string): boolean; isTTY?: boolean };
};
