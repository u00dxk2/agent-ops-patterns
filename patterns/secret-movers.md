# Secret movers: name the source, never hold the value

Sooner or later an agent has to move a credential: from the machine's environment into a host's secret store, from one service to another, or under a new key name. The natural way is the way a person would do it in a terminal: read the value into a variable, pass it to an API call, check the result. In an agent session every one of those steps is a place the value can end up in the transcript. The path that leaks is almost never the one you designed. It is the error path.

This pattern is the shape of a small script that moves a secret without the agent ever holding it, plus the shell rules that apply when you cannot use one. The incidents come from one operation running many concurrent Claude Code sessions, described without naming it.

## How the value gets out

**Incident (2026-08-03).** A session defined a one-letter PowerShell helper, `H`, to send a request carrying an API key. `H` already resolved to a built-in alias (`Get-History`), so the call bound the key to that command's parameter. The binding failed, and the error message quoted the argument's value into the transcript. The design had never printed the key, and the error printed it anyway.

**Incident (2026-08-06).** A different session had a `catch` block that printed `$_.Exception.Message` so that failures would be readable. The exception message contained the token. The happy path was clean. The leak came out of the catch.

Both keys were rotated. Both designs looked careful. What they shared: the value was *bound* in the shell, and a path nobody was watching printed what was bound.

## The mover's shape

A mover is one script with one job. Its contract is about what the caller passes and what the script prints:

- **The caller names a SOURCE, never a value.** A user-scope environment variable's *name*, a file path, or another service plus a key name. The value is never an argument, so it never appears in a command line, a shell history or a permission prompt.
- **The value is read inside the process** (fresh, from the store itself), used, and dropped. It never becomes a shell variable.
- **Output carries only facts about the value:** the key name, its length, the HTTP status, and a read-back comparison done in-process, `verified: true | false`. Never the value, and never a prefix of it.
- **Every failure prints a fixed string**, plus at most an HTTP status. No exception message, no response body. An unexpected error prints `FAILED: unexpected error (details withheld)`.
- **Anything ambiguous is refused, not ignored.** A flag that would be silently dropped in this mode is an error. Moving a key onto itself is an error. Overwriting an existing key needs an explicit flag.
- **A `--self-test` runs before first real use.** It writes a random dummy key, reads it back, deletes it, and confirms the deletion, all through the same code path the real moves use.

A skeleton, in Node, with the host's API left as two functions you supply:

```js
// move-secret.mjs --source-env <NAME> --to <service> [--key <DEST>]
// You supply readUserScopeEnv, putSecret and getSecret. --self-test is left out for length;
// it calls move() on a random dummy name, then deletes it and confirms the delete.
class Fixed extends Error {}
const fail = (msg, status) => { throw new Fixed(`FAILED: ${msg}${status ? ` (HTTP ${status})` : ""}`); };

async function move(sourceName, service, destKey) {
  const value = readUserScopeEnv(sourceName);          // read here, never passed in
  if (!value) fail(`source ${sourceName} is empty or unset`);
  const { status } = await putSecret(service, destKey, value);
  if (status >= 300) fail("write refused", status);
  const back = await getSecret(service, destKey);
  console.log(`${destKey} -> ${service}: length ${value.length}, HTTP ${status}, verified: ${back === value}`);
  return back === value;
}

async function main() {
  const arg = (flag) => { const i = process.argv.indexOf(flag); return i > 1 ? process.argv[i + 1] : undefined; };
  const source = arg("--source-env"), service = arg("--to");
  if (!source || !service) fail("give --source-env <NAME> --to <service>");
  return move(source, service, arg("--key") ?? source);
}

try {
  process.exitCode = (await main()) ? 0 : 1;
} catch (e) {
  console.log(e instanceof Fixed ? e.message : "FAILED: unexpected error (details withheld)");
  process.exitCode = 1;
}
```

The `catch` is the whole design. It is the one line that decides whether a surprise prints the secret.

**Incident (2026-09-26).** The first live use of a mover of this shape was eleven moves in one sitting. The agent harness's permission classifier allowed nine and refused two, plus a service restart. The refused items were handed to the human owner by name, not retried through another route. Once a single allowlist rule for the mover's exact entry point was added, the two moves and the restart went through. Restarting and redeploying the service go through the same script, so there is one ruled entry point instead of an ad-hoc API call for each.

## When you have no mover: shell rules

1. **A `catch` in scope of a secret prints a fixed string.** Never the exception message, never the error object, never a response body.
2. **Never define one- or two-letter shell helpers.** They collide with built-in aliases first, and the collision's error message quotes your arguments.
3. **Prefer not binding the value at all.** Ask what you actually need to know. Often it is *which account does this token belong to* or *what scopes does it carry*. That answer is in a response body or a response header (for example an `X-OAuth-Scopes` header) from a call that uses the token without the shell ever naming it.
4. **Keep retrieval and use in one call.** A value that outlives the call is a value some later command can print.

## When it leaks anyway: size the response to the blast radius

A value that reached a *session transcript* (local logs, the model provider's logs) is not a public disclosure. The right response is a controlled rotation: create the replacement, update every consumer, restart whatever read the old value, then delete the old credential. A value that reached a *public* surface (a pushed commit, a public issue, a shared page) is the opposite case: revoke first, then repair. State which case you are in, with evidence, before recommending either. Treating a transcript leak as a public one breaks working systems for no gain, and treating a public leak as a transcript one leaves it open.

## Limits

- **`verified: true` proves the store holds the value, not that anything uses it.** A consumer can still read a different key, cache the old value, or never restart. Prove the move from the consumer's behaviour ([claims-are-hypotheses](./claims-are-hypotheses.md) §2).
- **The value still passes through process memory.** A mover keeps it out of the transcript, the shell history and the arguments. It is not protection against anything that can read the process.
- **Length is a small leak.** It is printed on purpose, as a cheap "is this the right kind of thing" check, but it does narrow a guess. Drop it for short secrets.
- **The mover trusts its source.** If the environment variable holds the wrong key, the mover moves the wrong key perfectly and says `verified: true`.
- **Binary secrets need a text form the consumer accepts** (for example PEM for a DER certificate) before they are moved, if the store holds text only.
- **A permission classifier may still refuse a move.** That refusal is an outcome to report, not an obstacle to route around.
