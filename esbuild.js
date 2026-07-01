// esbuild 번들러 — VSCode 확장은 단일 dist/extension.js 로 번들하는 것이 표준.
const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node18",
    outfile: "dist/extension.js",
    external: ["vscode"], // vscode 모듈은 런타임이 제공
    sourcemap: !production,
    minify: production,
    logLevel: "info",
  });
  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
