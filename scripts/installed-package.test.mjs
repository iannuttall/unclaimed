import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const packageDirectory = join(root, "packages", "cli");
const tempRoot = await mkdtemp(join(tmpdir(), "unclaimed-package-"));
const archiveDirectory = join(tempRoot, "archive");
const consumerDirectory = join(tempRoot, "consumer");
const dataDirectory = join(tempRoot, "data");
const configDirectory = join(tempRoot, "config");
const packageJson = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8"));

try {
  await mkdir(archiveDirectory);
  const packed = await execFileAsync(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", archiveDirectory],
    { cwd: packageDirectory },
  );
  const [{ filename }] = JSON.parse(packed.stdout);
  const tarball = join(archiveDirectory, filename);

  await mkdir(consumerDirectory);
  await writeFile(
    join(consumerDirectory, "package.json"),
    JSON.stringify({ name: "unclaimed-consumer", private: true, type: "module" }),
  );
  await execFileAsync("npm", ["install", "--no-audit", "--no-fund", tarball], {
    cwd: consumerDirectory,
    maxBuffer: 1024 * 1024,
  });

  const binary = join(consumerDirectory, "node_modules", ".bin", "unclaimed");
  const env = {
    ...process.env,
    NO_COLOR: "1",
    XDG_CONFIG_HOME: configDirectory,
    XDG_DATA_HOME: dataDirectory,
  };
  const version = await execFileAsync(binary, ["--version"], { env });
  assert.equal(version.stdout.trim(), packageJson.version);

  const config = await execFileAsync(binary, ["config"], { env });
  assert.equal(JSON.parse(config.stdout).database, join(dataDirectory, "unclaimed", "domains.db"));

  const loaded = await execFileAsync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      [
        "import * as unclaimed from 'unclaimed'",
        "if (typeof unclaimed.checkDomain !== 'function') process.exit(1)",
        "if (!Array.isArray(unclaimed.words) || unclaimed.words.length < 1000) process.exit(1)",
      ].join(";"),
    ],
    { cwd: consumerDirectory, env },
  );
  assert.equal(loaded.stderr, "");

  const installedRoot = join(consumerDirectory, "node_modules", "unclaimed");
  await readFile(join(installedRoot, "skills", "unclaimed", "SKILL.md"), "utf8");

  const runtimeFiles = (await readdir(join(installedRoot, "dist"))).filter((file) =>
    file.endsWith(".js"),
  );
  for (const file of runtimeFiles) {
    const source = await readFile(join(installedRoot, "dist", file), "utf8");
    assert.doesNotMatch(source, /(?:from\s*|import\()["']@unclaimed\//);
  }

  process.stdout.write("Clean package install passed.\n");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
