// Every external action in a workflow is pinned to a full commit SHA, not a tag.
// A tag can be moved upstream and change the code CI runs with no change here; the
// read-only token limits what that code can do, it does not stop it running.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const DIR = fileURLToPath(new URL("../.github/workflows/", import.meta.url));

test("every external `uses:` is pinned to a 40-hex commit with its version in a comment (AOP-R7)", () => {
  const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(files.length > 0, "no workflow files found — the check read nothing");
  let refs = 0;
  const unpinned = [];
  for (const f of files) {
    readFileSync(join(DIR, f), "utf8").split(/\r?\n/).forEach((line, i) => {
      const m = /^\s*-?\s*uses:\s*(\S+)(.*)$/.exec(line);
      if (!m) return;
      const ref = m[1];
      if (ref.startsWith("./") || ref.startsWith("docker://")) return; // local or image, not a tag
      refs++;
      if (!/^[^@\s]+@[0-9a-f]{40}$/.test(ref) || !/#\s*v\d/.test(m[2])) unpinned.push(`${f}:${i + 1} ${ref}`);
    });
  }
  assert.ok(refs > 0, "no external uses: lines found — the check read nothing");
  assert.deepEqual(unpinned, []);
});

test("the pins have an update path: Dependabot watches github-actions, and only that", () => {
  // Pins never move on their own; Dependabot is their update path (it proposes a bump by
  // PR, and the test above checks the pin's shape on it). Regex reads, not a YAML parser:
  // this pins the four lines that matter, not the file's validity. The repo has no
  // dependencies, so no other ecosystem belongs in the file.
  const cfg = readFileSync(fileURLToPath(new URL("../.github/dependabot.yml", import.meta.url)), "utf8");
  const ecosystems = [...cfg.matchAll(/package-ecosystem:\s*["']?([\w-]+)/g)].map((m) => m[1]);
  assert.deepEqual(ecosystems, ["github-actions"]);
  assert.match(cfg, /^version:\s*2\s*$/m);
  assert.match(cfg, /directory:\s*["']?\/["']?\s*$/m);
  assert.match(cfg, /^\s*interval:\s*["']?weekly["']?\s*$/m);
});
