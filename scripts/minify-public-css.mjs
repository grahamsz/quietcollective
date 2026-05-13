import { readFile, writeFile } from "node:fs/promises";
import { transform } from "esbuild";

const inputPath = "public/styles.css";
const outputPath = "public/styles.min.css";

const source = await readFile(inputPath, "utf8");
const result = await transform(source, {
  loader: "css",
  minify: true,
  legalComments: "none",
});

await writeFile(outputPath, result.code);

const savings = source.length - result.code.length;
console.log(`Minified ${inputPath} -> ${outputPath} (${source.length}B to ${result.code.length}B, saved ${savings}B)`);
