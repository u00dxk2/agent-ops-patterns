# Durability-tiered write governance: gate actions by how hard they are to undo

Agent permission systems accrete as case law. An agent does something scary, a rule appears; six months later you have thirty rules, nobody remembers which incidents produced them, and the list is simultaneously over-gated (human approval burning on trivia) and under-gated (the genuinely irreversible action nobody happened to get burned by yet). The missing organizing principle is not "how risky does this feel" — it is **how durable is the write**.

Place every action an agent can take on a three-rung ladder, and put the governance where the durability is. The tiers come from Cliff Rosen's ["The Agent in the Middle"](https://www.orchestratorstudios.ai/articles/the-agent-in-the-middle.html) (Orchestrator Studios), which names them presentation / capability / substrate for agent workspaces; what follows is the operational form we converged on running a 15-product portfolio, plus the tests that make each rung enforceable rather than aspirational.

## The ladder

### Rung 1 — Reads. Never gated.

Deploy-status queries, log reads, metric pulls, campaign reads. Governance here is *authentication* (who may see), never *approval* (may this happen). The enforceable rule: **no permission rule may match a read** — every gate pattern in your system must require a mutation verb. The day a rule fires on "check the deploy status," you have taxed the thing agents do hundreds of times daily and trained your operator to rubber-stamp.

### Rung 2 — Schema-bounded writes. Machine-approved, human-informed.

Writes inside shapes the system already owns: a git push that auto-deploys behind CI, a message appended to a bus, an application-level write through existing code paths. The property that defines this rung is **reversibility by another write of the same shape** — a bad push is reverted by a push, a bad row by an update.

Governance: the schema, the CI gate, and revertability do the work. An orchestrating agent's approval is sufficient; the human learns about it in a digest, not a permission prompt. We un-gated `git push` on exactly this analysis after months of gating it — the gate was burning the scarce resource (operator attention) on the rung whose mistakes are cheap. The discipline cuts both ways: a *candidate* rule for this rung needs a concrete anchor incident where the ungated action caused unrecoverable harm, not "feels risky."

### Rung 3 — Substrate and irreversible writes. Human-direct, grant-minted.

Schema migrations against production, one-off mutations of production data, credential minting, changes to a live pipeline or cron, outward sends to real users, spend, and — less obviously — **the agent modifying its own permission config or reducing its own observability**. Self-modification looks like a rung-2 config edit; it is not, because it rewrites the system that does the governing. Same for anything that dims the operator's view of what agents are doing.

Governance: direct human approval per action — ideally minted as a scoped, single-use, TTL-bounded grant ([`lib/capability-grant.mjs`](../lib/capability-grant.mjs)) rather than a "you have approval, proceed" relayed through a chat or bus message, which any layer can replay, garble, or fabricate. Spend gets no carve-out: our ceiling for autonomous spend is zero, and any budget signal keeps the gate even when the surrounding action is otherwise approved.

## Classify by consequence, not by verb

A bus post is rung 2. A bus post that a downstream automation consumes to send email to real users is rung 3 wearing rung-2 clothes. The rung of an action is the rung of **the furthest irreversible consequence on its known path**, not of the proximate verb. This is the clause that keeps the ladder honest — and the reason classification belongs in a reviewed, versioned rule file rather than in each agent's judgment at 2 a.m.

## The "living workspace" clause

A workspace where using it and extending it are the same activity — skills edited freely, no deployment boundary — is a genuine advance for a single operator and a hazard the moment a second person depends on it: a skill edited mid-task silently changes behavior for everyone downstream. The ladder is the resolution. **Presentation stays living** (anyone reshapes reads and views freely). **Capability writes ride their schemas.** **Substrate changes get a ledger** — versioned, attributable, reviewable — even in a system with no other deployment ceremony.

## Limits

- **The ladder classifies actions, not correctness.** A rung-2 write can still be wrong — just reversibly wrong. Tiering tells you who must approve, not whether the change is good; review is a separate concern.
- **Durability is context-dependent.** The same verb sits on different rungs in different deployments (a Render env-var write is rung 2 on a scratch service and rung 3 on the service holding your production keys). The ladder is a lens you apply to *your* inventory, not a lookup table.
- **Single-operator bias.** Everything above assumes one human principal. At team scale the rungs hold but "human-direct" needs a *which* human — per-principal scopes on rung 3, and the grant lib's operational boundaries (see its [limits](../README.md#capability-grant)) matter more, not less.
- **Case law still accumulates.** The ladder doesn't stop new rules; it makes each one pay an admission test — name the rung, name the anchor incident, and show the rule can fire ([checks-that-cant-fail](./checks-that-cant-fail.md) applies to gate rules too: a class no input has ever matched is decorative).
