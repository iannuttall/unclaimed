// One-off: check a list of markdown-filename words as <word>.md.
// Run: pnpm exec tsx scripts/check-md.ts
import { checkDomain, setWhoisTransport } from "../packages/core/src/resolvers";
import { whoisQuery } from "../packages/cli/src/whois-node";
setWhoisTransport(whoisQuery);

const CLASSIC = [
  "readme", "license", "licence", "changelog", "contributing", "security",
  "authors", "notice", "todo", "install", "usage", "faq", "roadmap", "support",
  "funding", "history", "credits", "maintainers", "governance", "releases",
  "glossary", "manifest", "overview", "index", "docs", "guide", "tutorial",
  "examples", "reference", "spec", "notes", "template", "conventions",
  "standards", "workflow", "makefile", "dockerfile", "gemfile", "codeowners",
  "readme", "about", "setup", "build", "deploy", "config",
];
const AI = [
  "agents", "agent", "claude", "cursor", "llms", "copilot", "gemini",
  "windsurf", "cline", "aider", "codex", "jules", "devin", "zed", "continue",
  "factory", "rules", "context", "prompts", "prompt", "memory", "instructions",
  "system", "persona", "skills", "tools", "plan", "tasks", "prd", "guidelines",
  "knowledge", "playbook", "runbook", "rule", "model", "models", "chat",
];

async function run(label: string, words: string[], avail: string[]) {
  console.log(`\n== ${label} ==`);
  for (const w of [...new Set(words)]) {
    const r = await checkDomain(`${w}.md`);
    const mark = r.status === "available" ? "\x1b[32m✓ AVAILABLE\x1b[0m" : r.status;
    console.log(`  ${(w + ".md").padEnd(20)} ${mark}`);
    if (r.status === "available") avail.push(`${w}.md`);
  }
}

const avail: string[] = [];
await run("classic github", CLASSIC, avail);
await run("ai / agent era", AI, avail);
console.log(`\n\x1b[1mAVAILABLE (${avail.length}) — all flat ~$57/yr on .md:\x1b[0m`);
console.log("  " + (avail.join(", ") || "none"));
