import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Vite's optional Windows network-drive probe cannot spawn in this sandbox.
childProcess.exec = (command, ...args) => {
  if (command !== "net use") throw new Error(`Child process forbidden: ${command}`);
  const callback = args.at(-1);
  if (typeof callback === "function") queueMicrotask(() => callback(null, "", ""));
  return new EventEmitter();
};
childProcess.spawn = () => { throw new Error("Child processes forbidden in the in-process runner."); };
childProcess.fork = () => { throw new Error("Worker processes forbidden in the in-process runner."); };
syncBuiltinESMExports();

const { startVitest } = await import("vitest/node");
const { init, runBaseTests, setupEnvironment } = await import("vitest/worker");
const root = fileURLToPath(new URL(`../apps/${process.argv[2] ?? "engine"}/`, import.meta.url));
const pool = {
  name: "in-process",
  createPoolWorker() {
    const incoming = new EventEmitter(), outgoing = new EventEmitter();
    return {
      name: "in-process", cacheFs: false,
      on: (event, fn) => outgoing.on(event, fn), off: (event, fn) => outgoing.off(event, fn),
      deserialize: (v) => v,
      send: (message) => queueMicrotask(() => incoming.emit("message", message)),
      async start() {
        init({ on: (fn) => incoming.on("message", fn), off: (fn) => incoming.off("message", fn), post: (message) => queueMicrotask(() => outgoing.emit("message", message)),
          setup: setupEnvironment, runTests: (state, traces) => runBaseTests("run", state, traces), collectTests: (state, traces) => runBaseTests("collect", state, traces) });
      },
      async stop() { incoming.removeAllListeners(); outgoing.removeAllListeners(); },
    };
  },
};
const vitest = await startVitest("test", process.argv.slice(3), {
  root, config: false, watch: false, api: false, pool, maxWorkers: 1, fileParallelism: false,
  disableConsoleIntercept: true, reporters: ["default"],
  deps: { optimizer: { ssr: { enabled: false }, client: { enabled: false } } },
}, {
  configFile: false, esbuild: false, optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, watch: null },
  plugins: [{ name: "typescript-in-process", enforce: "pre", transform(code, id) {
    if (!/\.[cm]?tsx?(?:\?|$)/.test(id) || id.includes("node_modules")) return;
    const result = ts.transpileModule(code, { fileName: id.split("?")[0], compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, sourceMap: true, inlineSources: true, verbatimModuleSyntax: true } });
    return { code: result.outputText, map: result.sourceMapText };
  } }],
});
await vitest.close();
