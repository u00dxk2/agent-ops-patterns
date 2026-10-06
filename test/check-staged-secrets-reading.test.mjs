// The staged READ of scripts/check-staged-secrets.mjs, in real throwaway repos: what git
// prints for the staged diff decides what the scanner can see, so each case here is a
// way of making git print no added lines for content that is added. Ported from the
// fleet scanner (skylark-site c2ffc4fb3, c67f44578), ledger SY-1. Fixture values are
// split at the provider prefix so this file's own text matches no pattern.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
  git(r, "config", "user.email", "t@example.invalid");
  git(r, "config", "user.name", "t");
  git(r, "config", "commit.gpgSign", "false");
  return r;
}
const git = (r, ...args) => execFileSync("git", ["-C", r, ...args], { encoding: "utf8" });
const scan = (cwd, env = {}) => spawnSync(process.execPath, [SCRIPT], { cwd, encoding: "utf8", env: { ...process.env, ...env } });

/** Exit 1 is not enough (a crash exits 1 too): the finding line must name the pattern and file. */
function assertCaught(out, file, why) {
  assert.equal(out.status, 1, why);
  assert.match(out.stderr, new RegExp(String.raw`\[github-pat\]\s+${file.replace(".", "\\.")}`), `${why} — no github-pat finding for ${file}`);
}

test("a `-diff` attribute does not hide staged lines (SY-1 a: --text)", () => {
  const r = repo();
  writeFileSync(join(r, ".gitattributes"), "*.cfg -diff\n");
  writeFileSync(join(r, "app.cfg"), `TOKEN=${TOKEN}\n`);
  git(r, "add", ".gitattributes", "app.cfg");
  assertCaught(scan(r), "app.cfg", "a -diff file's credential passed: git printed 'Binary files differ'");
});

test("a textconv driver does not replace the staged lines (SY-1 a: --no-textconv)", () => {
  const r = repo();
  writeFileSync(join(r, ".gitattributes"), "*.cfg diff=blank\n");
  git(r, "config", "diff.blank.textconv", "node -e \"\"");
  writeFileSync(join(r, "app.cfg"), `TOKEN=${TOKEN}\n`);
  git(r, "add", ".gitattributes", "app.cfg");
  assertCaught(scan(r), "app.cfg", "a textconv driver showed git an empty view and the credential passed");
});

test("an external diff driver does not replace the staged lines (SY-1 a: --no-ext-diff)", () => {
  const r = repo();
  git(r, "config", "diff.external", "node -e \"\"");
  writeFileSync(join(r, "app.cfg"), `TOKEN=${TOKEN}\n`);
  git(r, "add", "app.cfg");
  assertCaught(scan(r), "app.cfg", "diff.external printed nothing and the credential passed");
});

// The full read can fail where the old one did not. The cap is lowered for the test only
// (SECRET_SCAN_MAX_BUFFER may only lower it), so a 256 KB file overflows it.
const CAPPED = { SECRET_SCAN_MAX_BUFFER: String(64 * 1024) };
function bigFile(r, name, byte) {
  const b = Buffer.alloc(256 * 1024);
  for (let i = 0; i < b.length; i++) b[i] = byte === 0 && i % 7 === 0 ? 0 : 65 + (i % 26);
  writeFileSync(join(r, name), b);
}

test("a failed full read falls back to the old read, never to a pass (SY-1 a, Codex round 1)", () => {
  const r = repo();
  bigFile(r, "blob.bin", 0);
  writeFileSync(join(r, "app.cfg"), `TOKEN=${TOKEN}\n`);
  git(r, "add", "blob.bin", "app.cfg");
  const out = scan(r, CAPPED);
  assertCaught(out, "app.cfg", "a large staged binary made the whole commit pass unread");
  assert.match(out.stderr, /fell back to the plain read/);
});

test("a file a textconv driver kept small does not make both reads overflow (Codex round 1)", () => {
  // --no-textconv expands the large file in the full read. The fallback is the OLD read,
  // which still applies the driver, so it stays small and the other file's credential is
  // caught, as it was before SY-1.
  const r = repo();
  writeFileSync(join(r, ".gitattributes"), "*.large diff=compact\n");
  git(r, "config", "diff.compact.textconv", "node -e \"\"");
  bigFile(r, "a.large", 65);
  writeFileSync(join(r, "z.cfg"), `TOKEN=${TOKEN}\n`);
  git(r, "add", ".gitattributes", "a.large", "z.cfg");
  assertCaught(scan(r, CAPPED), "z.cfg", "both reads overflowed and the commit passed unread");
});

test("a full read that fails WITHOUT overflowing also falls back (Codex round 3)", () => {
  // A diff driver marked binary, with a broken hunk-header regex: the old read never applies
  // the regex to a binary file, but --text does, and git exits 128. No large file involved.
  const r = repo();
  writeFileSync(join(r, ".gitattributes"), "*.dat diff=broken\n");
  git(r, "config", "diff.broken.binary", "true");
  git(r, "config", "diff.broken.xfuncname", "[");
  writeFileSync(join(r, "a.dat"), "ordinary\ncontent\n");
  writeFileSync(join(r, "z.cfg"), `TOKEN=${TOKEN}\n`);
  git(r, "add", ".gitattributes", "a.dat", "z.cfg");
  const out = scan(r);
  assertCaught(out, "z.cfg", "a full read that git refused made the commit pass unread");
  assert.match(out.stderr, /fell back to the plain read/);
});

test("LIMIT: after a fallback, a `-diff` file is not read (the fallback's declared ceiling)", () => {
  const r = repo();
  bigFile(r, "blob.bin", 0);
  writeFileSync(join(r, ".gitattributes"), "*.cfg -diff\n");
  writeFileSync(join(r, "app.cfg"), `TOKEN=${TOKEN}\n`);
  git(r, "add", ".gitattributes", "blob.bin", "app.cfg");
  const capped = scan(r, CAPPED);
  assert.equal(capped.status, 0);
  assert.match(capped.stderr, /a file git treats as binary/);
  // Positive control: uncapped, the same index is caught, so the 0 above is the fallback.
  assertCaught(scan(r), "app.cfg", "control: the uncapped full read should catch it");
});

test("a renamed-and-edited file's added line is read", () => {
  const r = repo();
  const body = Array.from({ length: 40 }, (_, i) => `line ${i} of an ordinary file`).join("\n") + "\n";
  writeFileSync(join(r, "old.txt"), body);
  git(r, "add", "old.txt");
  git(r, "commit", "-q", "-m", "base");
  git(r, "mv", "old.txt", "new.txt");
  writeFileSync(join(r, "new.txt"), body + `TOKEN=${TOKEN}\n`);
  git(r, "add", "new.txt");
  assert.match(git(r, "diff", "--cached", "--name-status"), /^R\d+/m, "fixture precondition: git saw a rename");
  assertCaught(scan(r), "new.txt", "the credential added to a renamed file passed");
});

test("an unchanged rename of a credential file is flagged: renames are off (Codex round 2, declared cost)", () => {
  // With rename detection on, this prints as R100 with no lines. Detection is off, so the
  // new path is an addition and the moved credential is flagged again. That is the
  // intended cost of not letting git settings decide what counts as added.
  const r = repo();
  writeFileSync(join(r, "old.cfg"), `TOKEN=${TOKEN}\n`);
  git(r, "add", "old.cfg");
  git(r, "commit", "-q", "--no-verify", "-m", "base");
  git(r, "mv", "old.cfg", "new.cfg");
  for (const setting of ["true", "false", "copies"]) {
    git(r, "config", "diff.renames", setting);
    assertCaught(scan(r), "new.cfg", `diff.renames=${setting}: an unchanged rename hid the moved credential`);
  }
});

test("diff.renames=copies does not hide a copied file (Codex round 1)", () => {
  const r = repo();
  writeFileSync(join(r, "old.cfg"), `TOKEN=${TOKEN}\n`);
  git(r, "add", "old.cfg");
  git(r, "commit", "-q", "--no-verify", "-m", "base");
  writeFileSync(join(r, "new.cfg"), `TOKEN=${TOKEN}\n`);
  writeFileSync(join(r, "old.cfg"), `TOKEN=${TOKEN}\nordinary edit\n`);
  git(r, "add", "old.cfg", "new.cfg");
  git(r, "config", "diff.renames", "copies");
  assert.match(git(r, "diff", "--cached", "--name-status"), /^C\d+/m, "fixture precondition: git saw a copy");
  assertCaught(scan(r), "new.cfg", "a copied file printed as C100 with no lines");
});

test("diff.relative does not drop staged files outside the current directory (Codex round 1)", () => {
  const r = repo();
  mkdirSync(join(r, "sub"));
  writeFileSync(join(r, "app.cfg"), `TOKEN=${TOKEN}\n`);
  git(r, "add", "app.cfg");
  git(r, "config", "diff.relative", "true");
  assertCaught(scan(join(r, "sub")), "app.cfg", "run from sub/, diff.relative hid a file at the root");
});
