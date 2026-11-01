# The seats file and its checker (shared schema S8)

Keep a map's seats as data beside the page. Generate the seat cards and the census counts FROM
this file, and compute any number quoted about the map, on its own page or in a comparison, from
it rather than retyping it.

## Shape

```json
{
  "citationCommit": "<full 40-hex sha every line citation refers to>",
  "repo": "<owner/repo>",
  "builtBy": "<the brief and merge script that produced this file>",
  "retired": [ { "id": "C9", "into": "C4" } ],
  "seats": [
    {
      "id": "D3",
      "stage": "D",
      "part": 3,
      "question": "May this shell command run without asking the user?",
      "answered": "Code decides from a fixed list of safe commands; anything else asks the user.",
      "quadrant": "RULING",
      "holderKind": "code",
      "holder": "`pkg/tools/shell.py:88-104` `is_safe_command`",
      "contract": "n/a",
      "onError": "fail-open: an unparseable command is treated as safe (`pkg/tools/shell.py:101`)",
      "checkedBy": "nothing found: `rg is_safe_command tests` (0 hits; positive control: the same pattern finds `pkg/tools/shell.py:88`)",
      "failureHistory": "none found: issue search \"safe command\" (positive control: \"shell\" returns 40)",
      "notes": "",
      "source": "inventory-3.md:212"
    }
  ]
}
```

The example values are invented to show the shape. They describe no real project.

- `quadrant` is exactly `RULE` or `RULING`. `holderKind` is exactly one of `llm`, `model`,
  `code`, `human`, `external`.
- `whyHuman` appears on human seats only, and `promptPieces` on llm seats only.
- `answered` is the one-sentence default-path answer the page shows under the question. `part`
  says which census reader produced the seat.
- `source` points at the inventory line the seat came from, so a reviewer can walk back from the
  page to the reader's notes.
- A seat that a later pass merges into another moves to `retired`, naming the seat it went
  `into`. It is never deleted, and its id is never reused.
- Gaps live in their own file, keyed by gap number, each naming the seat ids it cites.
- When the lead re-reads seats and corrects them, keep the corrections in their own file keyed by
  id, and assemble the next version of the seats file from the two by script. Never hand-edit
  the assembled file.

## The checker

Write a small script beside the map that exits non-zero when any of these fail:

1. **Census agreement.** The number of seat cards on the page, per stage and per quadrant ×
   holder kind, equals the counts computed from `seats`. If the page leaves some seats out on
   purpose (withheld for a private report, for example), it says how many, and the check counts
   shown + withheld.
2. **Ids.** Every id matches `^[A-I][0-9]+$`, its letter equals `stage`, no id appears twice
   across `seats` and `retired`, and every page anchor `seat-<id>` exists.
3. **Fields.** Every required S5 field that applies to the seat's holder kind is present and
   non-empty. An empty finding is an explicit "none found: <search>" or "n/a", never a blank.
   Only Notes may be blank.
4. **Citations resolve.** Every `file:line` in `holder`, `contract`, `onError` and `checkedBy`
   names a file that exists at `citationCommit`, and the line is within the file's length. When
   the holder names a function, that function is defined within the cited range.
5. **Red proof.** Before trusting the checker, break one thing on purpose (drop a card from the
   page, change one holder kind, point one citation past the end of its file), show that each
   check fails, then restore and show it pass. A checker that has never been seen to fail may be
   unable to.

The same pattern applies to the S11 sidecar: a checker that confirms every `seatId` exists in
the seats file, `recordedHolderKind` matches it (unless the entry sets `recordedFrom` to name the file
that corrected it),
every `at` resolves at the citation commit, and every family has at least two distinct holder
kinds.
