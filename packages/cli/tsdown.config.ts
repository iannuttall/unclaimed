import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    index: "src/index.ts",
  },
  clean: true,
  deps: {
    alwaysBundle: ["@unclaimed/core"],
  },
  dts: true,
  fixedExtension: false,
  format: ["esm"],
  minify: true,
  platform: "node",
  sourcemap: true,
  target: "node24",
});
