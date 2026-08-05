import { spawnSync } from "node:child_process";

function run(command, args) {
  return spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
  });
}

function hasCommand(command) {
  return (
    spawnSync("command", ["-v", command], {
      shell: true,
      stdio: "ignore",
    }).status === 0
  );
}

if (!hasCommand("gitleaks")) {
  process.stderr.write("gitleaks is required: https://github.com/gitleaks/gitleaks\n");
  process.exit(1);
}

const scan = run("gitleaks", ["git", ".", "--redact", "--no-banner", "--verbose"]);
process.exit(scan.status ?? 1);
