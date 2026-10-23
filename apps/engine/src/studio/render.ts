import { fork } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";
import { Resvg } from "@resvg/resvg-js";
import { type PlannerSpec, templateInput } from "./planner.js";

/**
 * The studio's renderer: Typst in process (no browser, no shell), with the fonts we ship. A planner
 * of 450 pages takes seconds. Previews are single pages rendered alone (without links) to SVG, then
 * to PNG; listing images place those pages on a scene drawn the same way.
 */
const here = dirname(fileURLToPath(import.meta.url));
const FONTS = join(here, "..", "..", "assets", "fonts");
const TEMPLATE = readFileSync(join(here, "planner.typ"), "utf8");
/** Shadow files (page images for listings) live under this made-up folder in the compiler's world. */
const WORLD = join(here, "world");

let compiler: NodeCompiler | null = null;
function typst(): NodeCompiler {
  compiler ??= NodeCompiler.create({ workspace: WORLD, fontArgs: [{ fontBlobs: readdirSync(FONTS).filter((f) => f.endsWith(".ttf")).map((f) => readFileSync(join(FONTS, f))) }] });
  return compiler;
}

export class RenderError extends Error {}

function run<T>(what: string, f: () => T): T {
  try { return f(); } catch (e) {
    const code = (e as { code?: string }).code ?? (e as Error).message;
    throw new RenderError(`${what}: ${String(code).slice(0, 400)}`);
  }
}

/** Pages and link annotations in a PDF Typst wrote (its objects are not compressed into streams). */
export function pdfFacts(pdf: Buffer): { pages: number; links: number } {
  const s = pdf.toString("latin1");
  return { pages: (s.match(/\/Type\s*\/Page[^s]/g) ?? []).length, links: (s.match(/\/Subtype\s*\/Link/g) ?? []).length };
}

/** The whole planner. A link to a page that does not exist fails the compile, so every link that ships resolves. */
export function renderPlanner(spec: PlannerSpec): { pdf: Buffer; pages: number; links: number; ms: number } {
  const t0 = Date.now();
  const pdf = run("the planner did not render", () => typst().pdf({ mainFileContent: TEMPLATE, inputs: { spec: templateInput(spec) } }));
  typst().evictCache(10);
  return { pdf, ...pdfFacts(pdf), ms: Date.now() - t0 };
}

export type Rendered = { pdf: Buffer; pages: number; links: number; ms: number };

/** One job in a child process (worker.ts): its memory goes back to the system when it exits. */
function inChild<T>(job: object, timeoutMs: number, read: (m: Record<string, unknown>) => T): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = fork(join(here, "worker.ts"), [], { execArgv: process.execArgv, serialization: "advanced", stdio: ["ignore", "inherit", "inherit", "ipc"] });
    let settled = false;
    const end = (f: () => void) => { if (!settled) { settled = true; clearTimeout(timer); f(); } };
    const timer = setTimeout(() => { child.kill("SIGKILL"); end(() => reject(new RenderError("the planner took more than 3 minutes to render"))); }, timeoutMs);
    child.once("message", (m: Record<string, unknown>) => end(() => (m.ok ? resolve(read(m)) : reject(new RenderError(String(m.error ?? "the studio job failed"))))));
    child.once("exit", (code, signal) => end(() => reject(new RenderError(`the render stopped (${signal ?? `exit ${code}`})`))));
    child.once("error", (e) => end(() => reject(new RenderError(e.message))));
    child.send(job);
  });
}

/** The whole planner, rendered in a child process. */
export const renderInChild = (spec: PlannerSpec, timeoutMs = 180_000): Promise<Rendered> =>
  inChild({ spec }, timeoutMs, (m) => ({ pdf: Buffer.from(m.pdf as Uint8Array), pages: m.pages as number, links: m.links as number, ms: m.ms as number }));

/** The listing images, made in a child process too. */
export const listingInChild = (spec: PlannerSpec, facts: { pages: number; links: number; files: string[] }, keys: { hero: [string, string]; inside: [string, string][] }, timeoutMs = 120_000): Promise<{ name: string; png: Buffer }[]> =>
  inChild({ spec, listing: { facts, keys } }, timeoutMs, (m) => (m.images as { name: string; png: Uint8Array }[]).map((i) => ({ name: i.name, png: Buffer.from(i.png) })));

/** One page alone, as SVG (its links left out). `key` is the page's key in planner.typ: cover, year, month-10, week-14, day-200... */
export function pageSvg(spec: PlannerSpec, key: string): string {
  return run(`the page ${key} did not render`, () => typst().plainSvg({ mainFileContent: TEMPLATE, inputs: { spec: templateInput(spec), preview: key } }));
}

export const png = (svg: string, width: number): Buffer => Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: width }, background: "rgba(0,0,0,0)" }).render().asPng());

/** A scene (Typst source) with page images placed in it as files named in `files`, rendered to PNG. */
export function scenePng(source: string, files: Record<string, string>, width: number, inputs: Record<string, string> = {}): Buffer {
  const c = typst();
  for (const [name, svg] of Object.entries(files)) c.mapShadow(join(WORLD, name), Buffer.from(svg));
  try {
    return png(run("the listing image did not render", () => c.plainSvg({ mainFileContent: source, inputs })), width);
  } finally {
    for (const name of Object.keys(files)) c.unmapShadow(join(WORLD, name));
  }
}
