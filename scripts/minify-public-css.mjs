import { readFile, writeFile } from "node:fs/promises";
import { transform } from "esbuild";

const appCssPath = "public/styles.css";
const easyMdeCssPath = "node_modules/easymde/dist/easymde.min.css";
const outputPath = "public/styles.min.css";

const [easyMdeCss, appCss] = await Promise.all([
  readFile(easyMdeCssPath, "utf8"),
  readFile(appCssPath, "utf8"),
]);
const source = `${easyMdeCss}\n${appCss}`;
const result = await transform(source, {
  loader: "css",
  minify: true,
  legalComments: "none",
});

await writeFile(outputPath, result.code);

const savings = source.length - result.code.length;
console.log(`Bundled and minified CSS -> ${outputPath} (${source.length}B to ${result.code.length}B, saved ${savings}B)`);
