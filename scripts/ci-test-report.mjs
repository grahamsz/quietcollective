import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const inGitHubActions = process.env.GITHUB_ACTIONS === "true";
const reportDir = "test-results";
const logPath = join(reportDir, "test-log.txt");
const summaryPath = join(reportDir, "summary.md");
const junitPath = join(reportDir, "junit.xml");

const suites = [
  {
    name: "Public asset check",
    command: "npm",
    args: ["run", "web:build"],
    description: "Required static files and service-worker cache rules",
  },
  {
    name: "Worker typecheck",
    command: "npm",
    args: ["run", "worker:typecheck"],
    description: "Strict TypeScript checks for the Cloudflare Worker",
  },
  {
    name: "Security regression tests",
    command: "npm",
    args: ["run", "test:security"],
    description: "Route guards, permissions, private media, and config checks",
  },
  {
    name: "Work permission unit tests",
    command: "npm",
    args: ["run", "test:permissions"],
    description: "Post ownership, gallery permissions, and work collaborator edit rules",
  },
];

await mkdir(reportDir, { recursive: true });

const results = [];
for (const suite of suites) {
  results.push(await runSuite(suite));
}

const summary = renderSummary(results);
const fullLog = renderLog(results);
const junit = renderJUnit(results);

await writeFile(logPath, fullLog);
await writeFile(summaryPath, summary);
await writeFile(junitPath, junit);

if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

const failed = results.filter((result) => !result.passed);
if (failed.length > 0) {
  process.exitCode = 1;
}

async function runSuite(suite) {
  const command = formatCommand(suite);
  const suiteLogPath = join(reportDir, `${slugify(suite.name)}.log`);
  startGroup(suite.name);
  console.log(`$ ${command}`);

  const startedAt = process.hrtime.bigint();

  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn("bash", ["-c", buildLoggedCommand(suite, suiteLogPath)], {
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", resolve);
  });

  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  const output = await readFile(suiteLogPath, "utf8").catch(() => "");
  const result = {
    ...suite,
    commandLine: command,
    durationMs,
    output,
    passed: exitCode === 0,
    exitCode,
  };

  if (!result.passed && inGitHubActions) {
    const firstLine = firstUsefulLine(output) ?? `${suite.name} exited with code ${exitCode}`;
    console.log(`::error title=${escapeGitHubCommand(`${suite.name} failed`)}::${escapeGitHubCommand(firstLine)}`);
  }

  endGroup();
  return result;
}

function startGroup(name) {
  if (inGitHubActions) {
    console.log(`::group::${name}`);
    return;
  }

  console.log(`\n## ${name}`);
}

function endGroup() {
  if (inGitHubActions) {
    console.log("::endgroup::");
  }
}

function renderSummary(runResults) {
  const passed = runResults.filter((result) => result.passed).length;
  const failed = runResults.length - passed;
  const totalDurationMs = runResults.reduce((sum, result) => sum + result.durationMs, 0);
  const status = failed === 0 ? "PASSED" : "FAILED";
  const commit = process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 7) : "local";
  const branch = process.env.GITHUB_REF_NAME ?? "local";
  const regressionChecks = parseOkChecks(runResults);

  const lines = [
    "# QuietCollective Test Report",
    "",
    `**Overall:** ${status} (${passed}/${runResults.length} suites passed)`,
    `**Duration:** ${formatDuration(totalDurationMs)}`,
    `**Ref:** ${branch}`,
    `**Commit:** ${commit}`,
    "",
    "| Suite | Result | Duration | Command | Coverage |",
    "| --- | --- | ---: | --- | --- |",
    ...runResults.map(
      (result) =>
        `| ${escapeMarkdown(result.name)} | ${result.passed ? "PASS" : "FAIL"} | ${formatDuration(result.durationMs)} | \`${escapeMarkdown(result.commandLine)}\` | ${escapeMarkdown(result.description)} |`,
    ),
  ];

  if (regressionChecks.length > 0) {
    lines.push(
      "",
      "## Regression Checks",
      "",
      "| Check | Result |",
      "| --- | --- |",
      ...regressionChecks.map((check) => `| ${escapeMarkdown(check.name)} | ${check.passed ? "PASS" : "FAIL"} |`),
    );
  }

  const failedResults = runResults.filter((result) => !result.passed);
  if (failedResults.length > 0) {
    lines.push("", "## Failure Output");
    for (const result of failedResults) {
      lines.push(
        "",
        `<details><summary>${escapeHtml(result.name)}</summary>`,
        "",
        "```text",
        trimOutput(result.output),
        "```",
        "",
        "</details>",
      );
    }
  }

  lines.push("", `Artifacts: \`${summaryPath}\`, \`${logPath}\`, and \`${junitPath}\`.`);
  return `${lines.join("\n")}\n`;
}

function renderLog(runResults) {
  const started = new Date().toISOString();
  const lines = [
    "QuietCollective CI Test Log",
    `Generated: ${started}`,
    "",
  ];

  for (const result of runResults) {
    lines.push(
      `## ${result.name}`,
      `Command: ${result.commandLine}`,
      `Result: ${result.passed ? "PASS" : "FAIL"}`,
      `Duration: ${formatDuration(result.durationMs)}`,
      "",
      trimOutput(result.output, Number.POSITIVE_INFINITY),
      "",
    );
  }

  return `${lines.join("\n")}\n`;
}

function renderJUnit(runResults) {
  const failures = runResults.filter((result) => !result.passed).length;
  const totalTime = (runResults.reduce((sum, result) => sum + result.durationMs, 0) / 1000).toFixed(3);
  const testCases = runResults
    .map((result) => {
      const output = escapeXml(trimOutput(result.output, Number.POSITIVE_INFINITY));
      const failure = result.passed
        ? ""
        : `\n      <failure message="${escapeXml(result.name)} failed" type="exit_code_${result.exitCode}">${output}</failure>`;

      return `    <testcase classname="quietcollective.ci" name="${escapeXml(result.name)}" time="${(result.durationMs / 1000).toFixed(3)}">${failure}
      <system-out>${output}</system-out>
    </testcase>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="quietcollective" tests="${runResults.length}" failures="${failures}" time="${totalTime}">
  <testsuite name="quietcollective.verify" tests="${runResults.length}" failures="${failures}" time="${totalTime}">
${testCases}
  </testsuite>
</testsuites>
`;
}

function parseOkChecks(runResults) {
  return runResults.flatMap((result) =>
    result.output
      .split(/\r?\n/)
      .map((line) => line.match(/^(not )?ok - (.+)$/))
      .filter(Boolean)
      .map((match) => ({
        passed: !match[1],
        name: match[2],
      })),
  );
}

function formatCommand({ command, args }) {
  return [command, ...args].join(" ");
}

function buildLoggedCommand(suite, suiteLogPath) {
  const command = [suite.command, ...suite.args].map(quoteShell).join(" ");
  return `set -o pipefail\n${command} 2>&1 | tee ${quoteShell(suiteLogPath)}`;
}

function quoteShell(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function slugify(value) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/(^-|-$)/g, "");
}

function formatDuration(durationMs) {
  if (durationMs < 1000) {
    return `${Math.round(durationMs)} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} s`;
}

function firstUsefulLine(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith(">"));
}

function trimOutput(output, maxLines = 80) {
  const lines = output.trimEnd().split(/\r?\n/);
  if (!Number.isFinite(maxLines) || lines.length <= maxLines) {
    return lines.join("\n");
  }

  return [`... ${lines.length - maxLines} earlier lines omitted`, ...lines.slice(-maxLines)].join("\n");
}

function escapeGitHubCommand(value) {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeMarkdown(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
