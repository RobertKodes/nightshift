import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Vite probes Windows network drive mappings via `net use`. This workspace uses local paths.
const originalExec = childProcess.exec;
childProcess.exec = (command, ...args) => {
  if (command !== 'net use') return originalExec(command, ...args);
  const callback = args.at(-1);
  queueMicrotask(() => callback(null, '', ''));
  return new EventEmitter();
};
syncBuiltinESMExports();
process.env.TRUSTED_PROXIES = "127.0.0.0/8,::1";
const { startVitest } = await import('vitest/node');
const root = fileURLToPath(new URL('../apps/engine', import.meta.url));
const ctx = await startVitest('test', process.argv.slice(2), {
  root, config: false, watch: false, pool: 'threads', maxWorkers: 1,
}, {
  esbuild: false,
  plugins: [{
    name: 'local-typescript-without-esbuild-process', enforce: 'pre',
    transform(code, id) {
      if (!/\.[cm]?tsx?(?:\?|$)/.test(id)) return;
      const out = ts.transpileModule(code, { fileName: id.split('?')[0], compilerOptions: {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
        sourceMap: true, inlineSources: true, verbatimModuleSyntax: true,
      } });
      return { code: out.outputText, map: out.sourceMapText };
    },
  }],
});
await ctx.close();
