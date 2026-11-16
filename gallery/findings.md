# How we know: the evidence behind ten things we learned about how AI agents decide

We read the source code of twelve open-source AI agent systems and drew ten lessons from what we found. This page is
for the reader who doubts them. For each lesson it gives the evidence the lesson rests on: for most, code at the
exact version we read, and whether we only read that code or also ran it. It also lists what we tried that did not
work.

Checked against the pinned code on 15 November 2026. As far as we know, no maintainer of these projects has
reviewed or endorsed this page.

## What we did, in one paragraph

We read the source code of twelve open-source agent systems, each at one fixed version (commits listed below). For
each system we wrote down every recurring decision we found, and who makes it: the AI model, plain code, a person, or
an outside service, within the parts of the system each map names. The published maps show those decisions and say
which ones each edition leaves out. A second AI from a different company (OpenAI's Codex) checked
our sentences against the code. We ran four small tests of our own: two on Cline, one on agno and one on pi. Everything
else is a reading of code, not an observation of the software in use.

## The twelve systems and the versions we read

| System | Version (commit, date) | Map |
|---|---|---|
| OpenHands (agent SDK) | `aae9c437`, 2026-10-06 | [map](https://u00dxk2.github.io/agent-ops-patterns/gallery/openhands/) |
| Cline | `d19f176b`, 2026-11-02 | [map](https://u00dxk2.github.io/agent-ops-patterns/gallery/cline/) |
| opencode | `0093fe57`, 2026-10-24 | [map](https://u00dxk2.github.io/agent-ops-patterns/gallery/opencode/) |
| pi | `1ce44bed`, 2026-10-28 | [map](https://u00dxk2.github.io/agent-ops-patterns/gallery/pi/) |
| agno | `9153aacd`, 2026-10-29 | [map](https://u00dxk2.github.io/agent-ops-patterns/gallery/agno/) |
| AnythingLLM | `d7d68e75`, 2026-10-15 | [map](https://u00dxk2.github.io/agent-ops-patterns/gallery/anythingllm/) |
| browser-use | `b49a68e4`, 2026-10-29 | [map](https://u00dxk2.github.io/agent-ops-patterns/gallery/browser-use/) |
| OpenAI Codex (Rust agent) | `a5c40924`, 2026-11-02 | [map](https://u00dxk2.github.io/agent-ops-patterns/gallery/codex/) |
| goose | `cfb67d72`, 2026-11-02 | [map](https://u00dxk2.github.io/agent-ops-patterns/gallery/goose/) |
| DeerFlow | `14abd9a2`, 2026-11-02 | [map](https://u00dxk2.github.io/agent-ops-patterns/gallery/deer-flow/) |
| LangChain + LangGraph | `efebcf50`, 2026-11-02 + `ee3c043b`, 2026-11-01 | [map](https://u00dxk2.github.io/agent-ops-patterns/gallery/langchain/) |
| Hermes Agent | `b200f5bc`, 2026-11-03 | [map](https://u00dxk2.github.io/agent-ops-patterns/gallery/hermes/) |

Source of this table: [`gallery/README.md`](README.md) in this repository.

## The ten lessons, one by one

<a name="lesson-1"></a>

### 1. A goal is a bundle of decisions you never see

- **Evidence:** the twelve maps. For example, Cline's map lists 116 recurring decisions. Plain code holds 83, the AI
  model 14, a person 13 and an outside service 6.
- **Kind:** read from code. Who makes each decision is our reading.
- **Caveat:** each map covers the parts of the system it names; a decision outside those is not on it. Maps drawn by
  different readers list different decisions. In a comparison limited to decisions that are live by default and not
  held by plain code, a second AI's own list had a counterpart for 51 of our 85, and gave the same holder for 49
of those 51.

<a name="lesson-2"></a>

### 2. The same agent follows different rules depending on how you start it

- **Evidence:** the who-is-asked grid at the end of this page: 21 ways of running the twelve systems, by five kinds of
  action, filled in separately from the code by two AI models from different companies. Of the grid's 105 cells, the two gave the same definite answer in 93, different definite answers in eight, and one of them answered "unclear" in four.
- **Cline:** the only two rows where a person is asked before an ordinary command are both Cline: its VS Code extension
  and its ACP mode. Started from its ordinary command line, the same agent runs the command unasked.
- **The other systems:** of the seven systems with more than one row in the grid, four differ from row to row (Cline,
  Hermes, Codex, AnythingLLM) and three do not (goose, opencode, pi). In Hermes and Codex the unattended row is the
  stricter one: a command on the danger list is refused.
- **The three toolkit rows** (OpenHands SDK, agno, LangChain) are among the 13 that run an ordinary command unasked;
  we added the command tool to them, as a developer would.
- **Cline's ACP mode:** Cline sends the approval request to the app that is driving it and waits
  (`apps/cli/src/acp/permissions.ts:115`); whether a person sees a prompt depends on that app.
- **Kind:** read from code by two readers. Many cells are inferred from the code rather than read off one line, and
  agreement between two readers is not a test of the running software. Nobody ran these.

<a name="lesson-3"></a>

### 3. Sometimes the one asked for permission isn't you

- **Evidence (Hermes `b200f5bc`):**
  - `tools/approval.py:1184-1229`: the command check. A short list is refused outright (line 1193); a command not on
    the approval list runs (lines 1219-1221); one that needs approval goes to a "smart" step when the approval mode is
    `smart` (line 1228).
  - `tools/approval.py:804-808`: if the separate AI call says "approve", the command is approved and no one is asked.
  - `tools/approval_smart.py:89`: the AI call answers approve, deny or escalate.
  - `hermes_cli/config_defaults.py:1663`: the default mode is `smart`.
- **Scope:** the interactive command line's normal check, where "runs" means the command passes this approval check.
  Single-query, scheduled and other unattended uses follow their own unattended settings
  (`tools/approval.py:1209-1216`); messaging platforms that can ask a person are handled separately.
- **Kind:** read from code, not run.

<a name="lesson-4"></a>

### 4. An agent can record an answer nobody gave

- **Evidence (Cline `d19f176b`):** `apps/cli/src/utils/approval.ts:120-126` picks the first option when no terminal is
  attached.
- **We ran it (13 November 2026):** we handed Cline's question tool three options and no terminal. It returned "Delete
  all of them" in 3 milliseconds without printing the question, and the note it passes on reads "The user has answered
  the question. Continue working on their task using that answer."
- **Controls:** a run where the second option was chosen came back with it; a run with no answer at all refused, with
  Cline's own message "The user did not answer."
- **Where it applies:** the command line's default mode, where the question tool is switched on
  (`apps/cli/src/commands/program.ts:135`, `sdk/packages/core/src/extensions/tools/presets.ts:33`). Its `--yolo` mode
  switches the tool off (`presets.ts:106`). The three options and their order were ours; the code takes whichever
  option comes first.
- **Not shown:** the whole Cline program started end to end, an AI model receiving that note, or how often this
  happens.
- **Already reported:** someone else filed it as
  [cline/cline#14800](https://github.com/cline/cline/issues/14800) in October; it was still open on 15 November.

<a name="lesson-5"></a>

### 5. "Failed" doesn't mean nothing happened

- **We ran it (12 November 2026, Cline `d19f176b`):** with a 50 millisecond limit (ours; the real one is 30 seconds)
  and a deliberately slow edit, the tool reported "Editor operation timed out after 50ms" while the file was unchanged;
  the edit then landed.
- **Controls:** a normal edit succeeded; an edit forced to fail left the file unchanged.
- **Where a timeout does stop the work:** for shell commands. opencode's shell code states "A recorded timeout must
  always kill" (`packages/core/src/shell.ts:379`, `0093fe57`), and Cline's own shell tool kills the command when its
  timer runs out (`sdk/packages/core/src/extensions/tools/executors/bash.ts:837-843`). The case above is Cline's file
  edit, not its shell.
- **Already reported:** Cline's tracker has an open report of the same outcome in VS Code, a timeout reported after
  the write had landed ([cline/cline#13267](https://github.com/cline/cline/issues/13267)); it was filed by someone
  else.
- **No AI model was in this test.**

<a name="lesson-6"></a>

### 6. "Completed" doesn't mean finished

- **We ran it (10 November 2026, agno `9153aacd`):** a stand-in AI service sent "Six times seven is forty-" marked as
  cut off at its length limit. agno returned it with status `completed`; one warning in the log said the reply was
  incomplete.
- **Controls:** a whole reply came back completed; a failed service call came back as an error.
- **pi (`1ce44bed`), 12 November:** half and half. In pi's isolated test, the end-of-turn event its add-ons receive
  said "completed" while the stored transcript kept the length-limit flag. The test did not look at what pi does next.
- **Scope:** one version, one kind of connection (agno's default), a fake service. It shows what the code does with a
  cut-off reply, not how often a real service sends one.

<a name="lesson-7"></a>

### 7. The worker often grades its own homework

- **Evidence:** in the systems we read, a common way for a run to end is that the model stops asking for tools and
  replies. Runs can also end on an error, a limit, or certain tool calls, for example LangChain's `return_direct`
  (`factory.py:2086-2100`) or DeerFlow's clarification tool (`clarification_tool.py:22`).
- **browser-use (`b49a68e4`):** a judge is on by default (`browser_use/agent/service.py:186`). It uses the agent's own
  model unless you hand it another (lines 256-257). Its verdict "does NOT override" the agent's own success flag (line
  1632).
- **Kind:** read from code.

<a name="lesson-8"></a>

### 8. Your "yes" can be remembered while your "no" is forgotten

- **Evidence (opencode `0093fe57`, `packages/core/src/permission.ts`):** an "always" answer saves a project rule when
  the request has something to save (lines 290-295); a "reject" answer fails the pending requests without saving a rule
  (lines 267-287).
- **Scope:** opencode only, read and not run. A lasting "no" can be written into a settings file by hand; we did not
  test that.

<a name="lesson-9"></a>

### 9. Every switched-off check is a choice someone made for you

- **pi (`1ce44bed`):** `packages/coding-agent/docs/security.md:3`, "it does not ask for approval before every tool
  call."
- **Hermes (`b200f5bc`):** `hermes_cli/config_defaults.py:204-209` ships the reminder to verify code edits switched
  off, with the comment that "the nudges proved more noise than signal." The reminder itself is described in
  `agent/verification_stop.py:1-3`. It is a message to the model, not a prompt to a person.

<a name="lesson-10"></a>

### 10. Agents checking agents make mistakes, and so did we

- **The claims check:** on an earlier, unpublished draft of our write-up, a second AI's first pass refuted 32 of the
  515 factual claims it judged one by one.
- **The blind test (9 November 2026):** twelve fixed questions per system, pass line 70% written down first. 86 of 127
  comparable answers matched (67.7%). It failed. Reading the 41 mismatches found three errors of ours and one of the
  other AI's.
- **Counts we dropped:** we abandoned an early cross-system count that combined failures recorded as success with
  failures that got no verdict at all. It shrank under review. We quote named cases instead.

## What we tried that didn't work

- **The blind test** missed its own line (lesson 10).
- **A cross-system count** about failures was abandoned after two readers from different companies argued it down.
- **Approval counts across mixed tools** ("N of twelve ask first") did not survive review. We replaced them with the
  action-by-surface grid below.
- **Another planned test**, on AnythingLLM's scheduled jobs, was not run.
- **Seat lists depend on the reader:** a second AI's own list of person-held decisions was larger than ours. That was
  partly because it counted "gives the task" and "presses stop", and partly because of differences in scope and
  classification.

## How the four tests were set up

The test code is not published here. Each test runs another project's code, so we publish a kit only after deciding
on it one at a time. Each test ran against the pinned version named above, and counted only if both of its controls
held: one case that had to pass and one that had to fail.

- **agno (`9153aacd`), 10 November.** A short Python script ran an agno Agent on its default OpenAI connection
  (`OpenAIResponses`), pointed at a stand-in server on our own machine. Three cases: a reply cut off at its length
  limit, a whole reply, and a failed call. The stand-in server logged a request in every case, so each case reached
  it.
- **pi (`1ce44bed`), 12 November.** A test inside pi's own test runner, with a stand-in model whose scripted replies
  carried a length-limit flag, a normal stop, or an error. No real length limit cut a reply. Each case made one call
  to the stand-in model.
- **Cline (`d19f176b`), 12 November.** A test inside Cline's checkout delayed the editor step by 400 milliseconds
  under a 50 millisecond time limit. Its failure control threw before calling the real editor, and its normal control
  used a 5-second limit.
- **Cline (`d19f176b`), 13 November.** In the no-terminal case, the real question tool called the command-line helper
  with three options. Stand-in answer steps supplied the two controls: one returned the second option, and one returned
  an empty answer.

## The whole who-is-asked grid

Each row is one way of running one of the twelve systems at its default settings, with nothing approved earlier; for
the three toolkit rows, shell and file tools were added, as a developer would. Two AI models from different companies
filled it in separately from the code. Many cells are inferred from the code rather than read off one line, and none
was tested on the running software. Cells marked *disputed* include eight where they gave different answers and
four where one of them answered "unclear".

| Surface | Ordinary shell command | Shell command its own danger list would flag | Write a file in the project | Web fetch or search | MCP tool call |
|---|---|---|---|---|---|
| OpenHands SDK, terminal and file tools added | runs unasked | runs unasked | runs unasked | *disputed: runs unasked / no such tool* | no such tool |
| Hermes, interactive CLI | runs unasked | a model decides | runs unasked | runs unasked | runs unasked |
| Hermes, single query (-q) | runs unasked | refused | runs unasked | runs unasked | runs unasked |
| Codex, interactive terminal | runs unasked in a sandbox | asks a person | runs unasked in a sandbox | runs unasked | *disputed: unclear / asks a person* |
| Codex, `codex exec` | *disputed: unclear / runs unasked in a sandbox* | refused | refused | runs unasked | *disputed: unclear / refused* |
| DeerFlow, web UI | no such tool | no such tool | runs unasked in a sandbox | runs unasked | runs unasked |
| Cline, VS Code | asks a person | asks a person | runs unasked | runs unasked | runs unasked |
| Cline, interactive CLI | runs unasked | runs unasked | runs unasked | runs unasked | runs unasked |
| Cline, CLI with no terminal | runs unasked | runs unasked | runs unasked | runs unasked | runs unasked |
| Cline, ACP mode | asks a person | asks a person | asks a person | *disputed: unclear / asks a person* | asks a person |
| goose, CLI | runs unasked | runs unasked | runs unasked | *disputed: runs unasked / no such tool* | runs unasked |
| goose, desktop app | runs unasked | runs unasked | runs unasked | *disputed: runs unasked / no such tool* | runs unasked |
| AnythingLLM, web chat | no such tool | no such tool | no such tool | runs unasked | runs unasked |
| AnythingLLM, scheduled job | no such tool | no such tool | no such tool | no such tool | no such tool |
| opencode, terminal UI | runs unasked | runs unasked | runs unasked | runs unasked | runs unasked |
| opencode, `opencode run` | runs unasked | runs unasked | runs unasked | runs unasked | runs unasked |
| pi, interactive | runs unasked | runs unasked | runs unasked | *disputed: runs unasked / no such tool* | runs unasked |
| pi, print mode | runs unasked | runs unasked | runs unasked | *disputed: runs unasked / no such tool* | runs unasked |
| agno Agent, shell and file tools added | runs unasked | runs unasked | runs unasked | *disputed: runs unasked / no such tool* | no such tool |
| browser-use Agent (page script stands in for shell) | *disputed: runs unasked in a sandbox / runs unasked* | *disputed: runs unasked in a sandbox / runs unasked* | runs unasked in a sandbox | runs unasked | no such tool |
| LangChain create_agent, shell and file tools added | runs unasked | runs unasked | runs unasked | no such tool | no such tool |

Counts over the 21 ways of running them, agreed cells only (a disputed cell is counted as disputed, never as either
answer):

- Ordinary shell command: runs unasked 13 · no such tool 3 · asks a person 2 · runs unasked in a sandbox 1 · disputed 2
- Shell command its own danger list would flag: runs unasked 11 · asks a person 3 · no such tool 3 · refused 2 · a model decides 1 · disputed 1
- Write a file in the project: runs unasked 14 · runs unasked in a sandbox 3 · no such tool 2 · refused 1 · asks a person 1 · disputed 0
- Web fetch or search: runs unasked 12 · no such tool 2 · disputed 7
- MCP tool call: runs unasked 13 · no such tool 5 · asks a person 1 · disputed 2

## What is not published

Our working notes are not published. That covers the cell-by-cell reasoning behind the grid, the test kits and their
full outputs, the review logs, and the blind test's answer sheets.
