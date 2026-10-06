// The staged READ of scripts/check-staged-secrets.mjs, in real throwaway repos: what git
// prints for the staged diff decides what the scanner can see, so each case here is a
// way of making git print no added lines for content that is added. Ported from the
// fleet scanner (skylark-site c2ffc4fb3, c67f44578), ledger SY-1. Fixture values are
// split at the provider prefix so this file's own text matches no pattern.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/check-staged-secrets.mjs", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "css-read-"));
const TOKEN = "gh" + "p_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
let seq = 0;

function repo() {
  const r = join(root, `r${seq++}`);
  execFileSync("git", ["init", "-q", r]);
  return r;
}
const git = (r, ...args) => execFileSync("git", ["-C", r, ...args], { encoding: "utf8" });
const scan = (r) => spawnSync(process.execPath, [SCRIPT], { cwd: r, encoding: "utf8" });

test("a `-diff` attribute does not hide staged lines (SY-1 a: --text)", () => {
  const r = repo();
  writeFileSync(join(r, ".gitattributes"), "*.cfg -diff\n");
  writeFileSync(join(r, "app.cfg"), `TOKEN=${TOKEN}\n`);
  git(r, "add", ".gitattributes", "app.cfg");
  const out = scan(r);
  assert.equal(out.status, 1, "a -diff file's credential passed: git printed 'Binary files differ'");
  assert.match(out.stderr, /\[github-token\]|\[github/);
});

test("a textconv driver does not replace the staged lines (SY-1 a: --no-textconv)", () => {
  const r = repo();
  writeFileSync(join(r, ".gitattributes"), "*.cfg diff=blank\n");
  git(r, "config", "diff.blank.textconv", "node -e \"\"");
  writeFileSync(join(r, "app.cfg"), `TOKEN=${TOKEN}\n`);
  git(r, "add", ".gitattributes", "app.cfg");
  const out = scan(r);
  assert.equal(out.status, 1, "a textconv driver showed git an empty view and the credential passed");
});

// A staged binary that --text expands past the read buffer. The cap is lowered for the test
// only (SECRET_SCAN_MAX_BUFFER may only lower it).
function bigBinaryRepo() {
  const r = repo();
  const bin = Buffer.alloc(256 * 1024);
  for (let i = 0; i < bin.length; i++) bin[i] = i % 7 === 0 ? 0 : 65 + (i % 26);
  writeFileSync(join(r, "blob.bin"), bin);
  return r;
}
const scanCapped = (r) =>
  spawnSync(process.execPath, [SCRIPT], { cwd: r, encoding: "utf8", env: { ...process.env, SECRET_SCAN_MAX_BUFFER: String(64 * 1024) } });

test("an overflow from --text falls back to the plain read, never to a pass (SY-1 a)", () => {
  const r = bigBinaryRepo();
  writeFileSync(join(r, "app.cfg"), `TOKEN=${TOKEN}\n`);
  git(r, "add", "blob.bin", "app.cfg");
  const out = scanCapped(r);
  assert.equal(out.status, 1, "a large staged binary made the whole commit pass unread");
  assert.match(out.stderr, /scanned without --text/);
});

test("LIMIT: after an overflow fallback, a `-diff` file is not read (the fallback's declared ceiling)", () => {
  const r = bigBinaryRepo();
  writeFileSync(join(r, ".gitattributes"), "*.cfg -diff\n");
  writeFileSync(join(r, "app.cfg"), `TOKEN=${TOKEN}\n`);
  git(r, "add", ".gitattributes", "blob.bin", "app.cfg");
  const out = scanCapped(r);
  assert.equal(out.status, 0);
  assert.match(out.stderr, /a file git treats as binary was not read/);
});

test("a renamed-and-edited file's added line is read (rename detection stays on)", () => {
  // The fleet scanner turned renames off because its filter (ACM) dropped status R.
  // This fork reads R and T, so a rename prints its edit hunks: the added credential
  // is seen, and content that only MOVED is not re-flagged as new.
  const r = repo();
  git(r, "config", "user.email", "t@example.invalid");
  git(r, "config", "user.name", "t");
  const body = Array.from({ length: 40 }, (_, i) => `line ${i} of an ordinary file`).join("\n") + "\n";
  writeFileSync(join(r, "old.txt"), body);
  git(r, "add", "old.txt");
  git(r, "commit", "-q", "-m", "base");
  git(r, "mv", "old.txt", "new.txt");
  writeFileSync(join(r, "new.txt"), body + `TOKEN=${TOKEN}\n`);
  git(r, "add", "new.txt");
  assert.match(git(r, "diff", "--cached", "--name-status"), /^R\d+/m, "fixture precondition: git saw a rename");
  const out = scan(r);
  assert.equal(out.status, 1, "the credential added to a renamed file passed");
});

test("an external diff driver does not replace the staged lines (SY-1 a: --no-ext-diff)", () => {
  const r = repo();
  git(r, "config", "diff.external", "node -e \"\"");
  writeFileSync(join(r, "app.cfg"), `TOKEN=${TOKEN}\n`);
  git(r, "add", "app.cfg");
  const out = scan(r);
  assert.equal(out.status, 1, "diff.external printed nothing and the credential passed");
});
