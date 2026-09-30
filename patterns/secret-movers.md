# Secret movers: name the source, never hold the value

Agents in production often have to move a credential: from the machine's environment into a host's secret store, from one service to another, or under a new key name. The obvious way is the way a person would do it in a terminal: read the value into a variable, pass it to an API call, check the result. In an agent session every one of those steps is a place the value can end up in the transcript. In both incidents below, the path that leaked was not the one anybody designed. It was the error path.

This pattern is the shape of a small script that moves a secret without the agent ever holding it, plus the shell rules that apply when you cannot use one. The incidents come from one operation running many concurrent Claude Code sessions, described without naming it.

## How the value gets out

**Incident (2026-08-03).** A session defined a one-letter PowerShell helper, `H`, to send a request carrying an API key. `H` already resolved to a built-in alias (`Get-History`), so the call bound the key to that command's parameter. The binding failed, and the error message quoted the argument's value into the transcript. The design had never printed the key, and the error printed it anyway.

**Incident (2026-08-06).** A `catch` block printed the exception's message so that failures would be readable. The message contained the token. The happy path was clean. The leak came out of the catch.

What the two had in common: the value was *bound* in the shell, and a path nobody had designed printed what was bound.

## The mover's shape

A mover is one script with one job. Its contract is about what the caller passes and what the script prints:

- **The caller names a SOURCE, never a value.** A user-scope environment variable's *name*, a file path, or another service plus a key name. The value is never an argument, so it never appears in the command line, the shell history or a permission prompt.
- **The value is read inside the process,** used, and dropped. It never becomes a shell variable.
- **Output carries only facts about the value:** the key name, its length, the HTTP status, and a read-back comparison done in-process, `verified: true | false`. Never the value, and never a prefix of it.
- **Failures print fixed strings.** At most they add an HTTP status. They do not echo the caller's arguments either, because a caller who pastes a value where a name belongs would otherwise get it printed back. An unexpected error prints `FAILED: unexpected error (details withheld)`.
- **Anything ambiguous is refused, not guessed at:** an unknown or repeated flag, a flag with no value, a name that is not a plain identifier, and overwriting a key that already exists without an explicit `--overwrite`.
- **A `--self-test` runs before first real use.** It writes a random dummy value, reads it back, deletes it, and confirms the deletion, through the same write and read functions the real moves use.

A skeleton, in Node. It was run against stub functions for the paths shown in its comments. The host's API is left as functions you supply:

```js
// move-secret.mjs --source-env <NAME> --to <service> [--key <DEST>] [--overwrite]
// You supply readUserScopeEnv, putSecret and getSecret. Your versions must not print either.
// --self-test is left out for length: it moves a random dummy value, deletes it, confirms the delete.
class Fixed extends Error {}
const fail = (msg) => { throw new Fixed(`FAILED: ${msg}`); };
const IDENT = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;   // names only; a REJECTED value is never echoed (accepted names print on success)

function parseArgs(argv) {
  const known = new Set(["--source-env", "--to", "--key"]), flags = new Set(["--overwrite"]);
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a in out) fail("a flag was given twice");
    if (flags.has(a)) { out[a] = true; continue; }
    if (!known.has(a)) fail("unknown argument (run with no arguments for usage)");
    const v = argv[++i];
    if (v === undefined || !IDENT.test(v)) fail(`${a} needs a plain name`);
    out[a] = v;
  }
  if (!out["--source-env"] || !out["--to"]) fail("usage: --source-env <NAME> --to <service> [--key <DEST>] [--overwrite]");
  return out;
}

async function move(sourceName, service, destKey, overwrite) {
  const value = readUserScopeEnv(sourceName);          // read here, never passed in
  if (!value) fail("source is empty or unset");
  if (!overwrite && (await getSecret(service, destKey)) !== undefined) fail("destination exists; pass --overwrite");
  const { status } = await putSecret(service, destKey, value);
  if (status >= 300) fail(`write refused (HTTP ${status})`);
  const back = await getSecret(service, destKey);
  console.log(`${destKey} -> ${service}: length ${value.length}, HTTP ${status}, verified: ${back === value}`);
  return back === value;
}

try {
  const a = parseArgs(process.argv.slice(2));
  process.exitCode = (await move(a["--source-env"], a["--to"], a["--key"] ?? a["--source-env"], a["--overwrite"] === true)) ? 0 : 1;
} catch (e) {
  console.log(e instanceof Fixed ? e.message : "FAILED: unexpected error (details withheld)");
  process.exitCode = 1;
}
```

The `catch` decides what a surprise prints, so it is the line to get right first. It is not the only line that matters. The messages passed to `fail` must not carry input, and the functions you supply must not print, log or spawn anything that echoes the value. A helper that writes the value to its own stderr before throwing leaks whatever this `catch` does.

**Incident (2026-09-26).** In one recorded batch of eleven moves through a mover of this shape, the agent harness's permission classifier allowed nine and refused two, and it also refused a scheduled job's resume and redeploy. The standing rule was that a refusal goes to the human as a list of the refused items and is never routed around. After the mover's exact entry point was added to the permission allowlist, the two refused moves and the resume and redeploy all succeeded. Redeploying goes through the same script, so there is one ruled entry point instead of an ad-hoc API call per action.

## When you have no mover: shell rules

1. **A `catch` in scope of a secret prints a fixed string.** Never the exception message, never the error object, never a response body.
2. **Avoid one- and two-letter shell helpers.** In PowerShell a short name can resolve to a built-in alias before your function, and the resulting binding error quotes your arguments.
3. **Prefer not binding the value at all.** Ask what you actually need to know. Often it is *which account does this token belong to* or *what can it do*. That answer is often in the body or headers of a response to a call that uses the token without the shell ever naming it. Some APIs return the token's scopes in a response header.
4. **Keep retrieval and use in one call.** A value that outlives the call is a value some later command can print.

## When it leaks anyway: size the response to the blast radius

A value that reached a *session transcript* (local logs, the model provider's logs) is not a public disclosure. The response this operation adopted is a controlled rotation: create the replacement, update every consumer, restart whatever read the old value, then delete the old credential. A value that reached a *public* surface (a pushed commit, a public issue, a shared page) is the opposite case: revoke first, then repair. State which case you are in, with evidence, before recommending either. An emergency delete for a transcript leak can break working systems in the rush, and a slow rotation for a public leak leaves it open while you work.

## Limits

- **`verified: true` proves the store holds the value, not that anything uses it.** A consumer can still read a different key, cache the old value, or never restart. Prove the move from the consumer's behaviour ([claims-are-hypotheses](./claims-are-hypotheses.md) §2).
- **The value still passes through process memory.** A mover keeps it out of the invocation, the shell history and the script's own output. It does not protect against anything that can read the process, and it cannot stop a supplied function from printing.
- **The identifier check is a speed bump, not a secret detector.** Some credentials are shaped like plain names, and a name the parser accepts is printed in the success line. The real protection is that no error message echoes its input.
- **Length is a small leak.** It is printed on purpose, as a cheap "is this the right kind of thing" check, but it does narrow a guess. Drop it for short secrets.
- **The mover trusts its source.** If the environment variable holds the wrong key, the mover moves the wrong key perfectly and says `verified: true`. And a reader that falls back to an inherited environment can read a stale copy.
- **Binary secrets need a text form the consumer accepts** (for example PEM for a DER certificate) before they are moved, if the store holds text only.
- **A permission classifier may still refuse a move.** That refusal is an outcome to report, not an obstacle to route around.
