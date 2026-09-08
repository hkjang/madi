import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, open } from "node:fs/promises";

// A disposable development service only. Every suite owns its fixtures; suites
// requiring isolated Go protocol fixtures deliberately remain separate.
const suites = process.argv.slice(2);
if (!suites.length)
  throw new Error("Specify shared-server browser suite names");
await mkdir("test-results/regression-shared", { recursive: true });
let results = [];
try {
  results = JSON.parse(await readFile("test-results/regression-shared/report.json", "utf8"))
    .filter(result => !suites.includes(result.suite));
} catch {}
const html = await (await fetch(process.env.MADI_BASE_URL || "http://127.0.0.1:8080")).text();
const bundle = html.match(/(?:main|index)-[A-Za-z0-9_-]+\.js/)?.[0] || "unknown";
for (const suite of suites) {
  if (!/^[a-z0-9-]+$/.test(suite)) throw new Error("Invalid suite name");
  const log = `test-results/regression-shared/${suite}.log`;
  const output = await open(log, "w");
  const started = Date.now();
  const env = { ...process.env };
  if (env.MADI_REGRESSION_SCREENSHOT_ROOT) {
    env.MADI_SCREENSHOT_DIR = `${env.MADI_REGRESSION_SCREENSHOT_ROOT}/${suite}`;
    await mkdir(env.MADI_SCREENSHOT_DIR, { recursive: true });
  }
  if (suite === "browser" && env.MADI_REGRESSION_EMAIL) {
    env.MADI_TEST_EMAIL = env.MADI_REGRESSION_EMAIL;
    env.MADI_TEST_PASSWORD = env.MADI_REGRESSION_PASSWORD;
  }
  console.log(`START ${suite}`);
  const exitCode = await new Promise((resolve) => {
    const child = spawn(process.execPath, [`tests/${suite}.mjs`], {
      env,
      stdio: ["ignore", output.fd, output.fd],
    });
    const timer = setTimeout(() => child.kill("SIGTERM"), 240_000);
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve(code ?? signal ?? -1);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve(error.message);
    });
  });
  await output.close();
  const result = {
    suite,
    bundle,
    checked_at: new Date().toISOString(),
    ok: exitCode === 0,
    exit_code: exitCode,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    log,
  };
  results.push(result);
  await writeFile(
    "test-results/regression-shared/report.json",
    JSON.stringify(results, null, 2),
  );
  console.log(
    `${result.ok ? "PASS" : "FAIL"} ${suite} (${result.seconds}s) — ${log}`,
  );
}
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
