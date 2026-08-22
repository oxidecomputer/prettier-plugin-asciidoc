import { rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  format: "esm",
  sourcemap: "external",
  external: ["prettier"],
});
