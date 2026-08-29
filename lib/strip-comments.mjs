// @ts-check
/**
 * strip-comments.mjs — remove JS/TS or shell comments from source before a
 * string-PRESENCE check reads it.
 *
 * The incident this generalizes: a drift guard asserted that a set of literal
 * UI strings still appears in the app source. A label was renamed; the guard
 * stayed green while production was already broken — because the old label
 * survived in the JSX comment EXPLAINING its removal, and the guard grepped
 * raw source. A guard that a rationale can satisfy is not a guard. Hence the
 * rule this file exists to make cheap:
 *
 *   ANY "string X still appears in file Y" check strips comments FIRST.
 *
 * WHY A SCANNER AND NOT TWO REGEXES. In a DETECTOR, over-stripping only ever
 * produces MORE findings — loud, and survivable. A PRESENCE guard has the
 * opposite error direction, and both of its failures are silent-or-wrong:
 *
 *   - under-strip → the needle survives in a comment → FALSE GREEN (the incident)
 *   - over-strip  → the needle is eaten out of real code → FALSE RED
 *
 * The naive line-comment regex over-strips: a line whose string literal holds
 * a `//`-bearing URL loses everything after it. So this lib cannot pick a
 * fail-direction and be done — it has to be right. The scanner tracks string
 * literals, template-literal text, `${...}` substitutions, and regex
 * literals, so neither error occurs on those shapes.
 *
 * ── A CORRECTION THAT IS PART OF THE CONTRACT. The first cut of this scanner
 * had the very bug it exists to prevent, in the FALSE-GREEN direction, on
 * real files: it tracked string literals but not REGEX literals, so a regex
 * whose body holds a quote or backtick desynchronised the scanner and every
 * comment after it survived. Measured on a real 4,100-line script: one regex
 * with a backtick inside its character class made the scanner read that
 * backtick as a template-literal opener and swallow ~1,700 lines as string
 * content — 215 whole-line `//` comments survived stripping, and a presence
 * probe returned TRUE off a token that existed only in a comment. Quotes in
 * regexes are ordinary; a comment stripper that ignores regex literals is
 * wrong in the reassuring direction.
 *
 * ── THE DIVISION-VS-REGEX HEURISTIC (the hard part, documented so you can
 * judge it rather than trust it). A bare `/` is a regex opener or a division
 * operator depending on the PREVIOUS SIGNIFICANT TOKEN, which is not
 * decidable without a parser. This scanner uses the standard lexer heuristic
 * plus a lookahead confirmation, and BOTH must agree before it enters regex
 * state:
 *
 *   1. PREV-TOKEN TEST. A `/` may start a regex when the previous significant
 *      token (whitespace and comments are not significant) is start-of-file,
 *      a punctuator in REGEX_OK_PUNCT, or a keyword in REGEX_OK_KEYWORDS.
 *      After an identifier, a number, a string/template/regex literal, or
 *      `)` / `]`, it is division.
 *   2. WELL-FORMEDNESS TEST. `scanRegexLiteral` must find a terminating
 *      unescaped `/` ON THE SAME LINE, honouring `\` escapes and `[...]`
 *      character classes (inside a class, `/` is literal). A regex literal
 *      cannot span a newline, so an unterminated candidate is division.
 *
 * Test 2 is what makes test 1's mistakes cheap: regex state COPIES VERBATIM,
 * the same as division would, so a wrongly-entered regex changes the output
 * only if a comment start hides inside the span. The one shape where that
 * bites is `return a / b; // note` (`return` allows a regex, and the `//`
 * supplies a closing `/`), so `scanRegexLiteral` additionally REJECTS a
 * candidate whose closing delimiter is immediately followed by another `/` —
 * that reads as cutting into a line comment, and rejecting costs at most one
 * literal `/` character out of a real regex, never a comment.
 *
 * WHERE IT STOPS:
 *  - ASI: `a = b` ⏎ `/re/.test(c)` is a regex to the parser and division to
 *    this scanner (a newline is not a significant token here); harmless —
 *    both copy verbatim — unless that regex body holds `//`.
 *  - `{` and `}` are treated as regex-allowed, so `({a:1}/2/x)` enters regex
 *    state; same verbatim-copy harmlessness.
 *  - `)` is treated as division, so `if (x) /re/.test(y)` is scanned as
 *    division — verbatim again, visible only if that regex body holds a
 *    comment start.
 *  - No JSX-text awareness: a `/` in JSX text is scanned as JS.
 *    None of these four can strip real code; each can at worst leave a
 *    comment start unrecognised inside a regex body.
 *  - Template-literal TEXT is opaque on purpose: a needle between backticks
 *    is real output, not commentary. `${...}` substitutions are re-entered as
 *    code — a block comment inside a substitution is JS, so it is stripped —
 *    with a brace-depth stack so nested templates don't flip backtick parity.
 *  - Languages: JS/TS/JSX in `stripComments`; POSIX-shell `#` in
 *    `stripShellComments`. No HTML comments; add them when a caller has one.
 */

/**
 * Punctuators after which a `/` may open a regex literal. `)` and `]` are
 * deliberately ABSENT (they end an expression, so `/` after them is
 * division); see WHERE IT STOPS in the header.
 */
const REGEX_OK_PUNCT = new Set([
  "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";",
  "+", "-", "*", "%", "^", "~", "<", ">",
]);

/** Keywords after which a `/` may open a regex literal. */
const REGEX_OK_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "throw", "case", "do", "else", "yield", "await", "default",
]);

const IDENT_CHAR = /[A-Za-z0-9_$]/;
const REGEX_FLAG_CHAR = /[a-z]/;

/**
 * Sentinel "previous token" meaning a complete literal just closed.
 * Deliberately a value REGEX_OK_PUNCT cannot hold, so `/` after a
 * string/template/regex reads as division.
 */
const LITERAL_TOKEN = "<literal>";

/**
 * If a well-formed regex literal starts at `text[start]` (which must be `/`),
 * return the index just PAST it (flags included); otherwise null.
 *
 * Rejects: an unterminated body (a regex literal never spans a newline) and a
 * closing delimiter immediately followed by `/`, which reads as the candidate
 * having cut into a line comment rather than closing a real regex.
 *
 * @param {string} text
 * @param {number} start
 * @returns {number | null}
 */
function scanRegexLiteral(text, start) {
  const n = text.length;
  let j = start + 1;
  let inClass = false;
  while (j < n) {
    const ch = text[j];
    if (ch === "\\") {
      j += 2;
      continue;
    }
    if (ch === "\n" || ch === "\r") return null;
    if (inClass) {
      if (ch === "]") inClass = false;
      j++;
      continue;
    }
    if (ch === "[") {
      inClass = true;
      j++;
      continue;
    }
    if (ch === "/") {
      let k = j + 1;
      while (k < n && REGEX_FLAG_CHAR.test(text[k])) k++;
      if (text[k] === "/") return null; // reads as cutting into a line comment
      return k;
    }
    j++;
  }
  return null;
}

/**
 * Strip `//` and block comments from JS/TS/JSX source, leaving string
 * literals, template-literal text and regex literals intact.
 *
 * Newlines inside stripped spans are PRESERVED by default, so line numbers
 * computed on the result still match the original file — the naive
 * block-comment regex silently shifts them.
 *
 * @param {string} src
 * @param {{keepNewlines?: boolean}} [opts] keepNewlines default true
 * @returns {string}
 */
export function stripComments(src, opts = {}) {
  const text = String(src ?? "");
  const keepNewlines = opts?.keepNewlines !== false;
  let out = "";
  let i = 0;
  const n = text.length;

  // Template state. `inTemplate` = copying backtick TEXT verbatim; a `${`
  // pushes the brace depth at which it opened and returns to code, and the
  // matching `}` pops back into template text.
  let inTemplate = false;
  const templateBraceDepths = [];
  let braceDepth = 0;

  // Previous significant token, for the division-vs-regex heuristic.
  // `atStart` distinguishes start-of-file (regex allowed) from "after an
  // identifier".
  let atStart = true;
  let prevWord = "";
  let prevPunct = null;

  /** Record a code-mode character as the previous significant token. */
  const note = (ch) => {
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") return;
    atStart = false;
    if (IDENT_CHAR.test(ch)) {
      prevWord = prevPunct === null ? prevWord + ch : ch;
      prevPunct = null;
    } else {
      prevWord = "";
      prevPunct = ch;
    }
  };
  /** Record that a complete literal (string / template / regex) just closed. */
  const noteLiteral = () => {
    atStart = false;
    prevWord = "";
    prevPunct = LITERAL_TOKEN; // not in REGEX_OK_PUNCT: `/` after a literal is division
  };

  while (i < n) {
    const c = text[i];

    // ── Template-literal TEXT: opaque, except for `${` which re-enters code.
    if (inTemplate) {
      if (c === "\\") {
        out += text.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === "`") {
        out += c;
        i++;
        inTemplate = false;
        noteLiteral();
        continue;
      }
      if (c === "$" && text[i + 1] === "{") {
        out += "${";
        i += 2;
        templateBraceDepths.push(braceDepth);
        inTemplate = false;
        prevPunct = "{";
        prevWord = "";
        atStart = false;
        continue;
      }
      out += c;
      i++;
      continue;
    }

    const next = text[i + 1];

    // ── Comment starts (only reachable from code — literal states consume their own).
    if (c === "/" && next === "/") {
      i += 2;
      while (i < n && text[i] !== "\n") i++;
      continue; // the \n itself is emitted by the next iteration
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) {
        if (keepNewlines && text[i] === "\n") out += "\n";
        i++;
      }
      i += 2; // past the closing */ (or past the end on an unterminated comment)
      continue;
    }

    // ── Regex literal: both tests must agree (see header).
    if (c === "/") {
      const regexAllowed = atStart
        ? true
        : prevPunct !== null
          ? REGEX_OK_PUNCT.has(prevPunct)
          : REGEX_OK_KEYWORDS.has(prevWord);
      if (regexAllowed) {
        const end = scanRegexLiteral(text, i);
        if (end !== null) {
          out += text.slice(i, end);
          i = end;
          noteLiteral();
          continue;
        }
      }
    }

    // ── String literals: copy verbatim, honoring escapes, so a `//` or `/*`
    // inside one is never read as a comment start.
    if (c === '"' || c === "'") {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        const s = text[i];
        if (s === "\\") {
          out += text.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += s;
        i++;
        if (s === quote) break;
        // An unterminated ' or " ends at the newline, as JS does.
        if (s === "\n") break;
      }
      noteLiteral();
      continue;
    }

    // ── Template-literal opener.
    if (c === "`") {
      out += c;
      i++;
      inTemplate = true;
      continue;
    }

    // ── Plain code, with brace tracking for `${...}` re-entry.
    if (c === "{") {
      braceDepth++;
    } else if (c === "}") {
      if (
        templateBraceDepths.length > 0 &&
        braceDepth === templateBraceDepths[templateBraceDepths.length - 1]
      ) {
        templateBraceDepths.pop();
        out += c;
        i++;
        inTemplate = true;
        continue;
      }
      if (braceDepth > 0) braceDepth--;
    }

    out += c;
    note(c);
    i++;
  }
  return out;
}

/**
 * Does `needle` appear in `src` OUTSIDE of comments? The presence-guard
 * primitive this file exists for; substring match, not regex.
 *
 * @param {string} src
 * @param {string} needle
 * @returns {boolean}
 */
export function includesOutsideComments(src, needle) {
  return stripComments(src).includes(String(needle));
}

/**
 * Strip `#` comments from POSIX-shell text (git hooks, `.sh`), leaving quoted
 * strings intact. Shell's rule, not a regex: `#` opens a comment only at the
 * START OF A WORD (line start, or after whitespace / `;` / `|` / `&` / `(`)
 * and outside single or double quotes — so `$#`, `a#b` and `echo "x # y"`
 * survive. A backslash escapes the next character outside single quotes.
 * Newlines are preserved so line numbers still match.
 *
 * The same incident recurs verbatim in shell: a rationale comment naming a
 * script satisfies a grep for whether the hook RUNS that script.
 *
 * ponytail: no heredoc awareness — a `<<EOF … EOF` body is scanned like code.
 * For a presence guard that errs toward FOUND (a needle inside a heredoc is
 * real text the hook emits), never toward a false absence. Add heredoc
 * tracking when a caller ships one.
 *
 * @param {string} src
 * @returns {string}
 */
export function stripShellComments(src) {
  const text = String(src ?? "");
  let out = "";
  let i = 0;
  const n = text.length;
  let quote = null;
  while (i < n) {
    const c = text[i];
    if (quote) {
      if (c === "\\" && quote === '"') {
        out += text.slice(i, i + 2);
        i += 2;
        continue;
      }
      out += c;
      i++;
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      out += c;
      i++;
      continue;
    }
    if (c === "\\") {
      out += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === "#" && (i === 0 || /[\s;|&(]/.test(text[i - 1]))) {
      while (i < n && text[i] !== "\n") i++;
      continue; // the \n is emitted by the next iteration
    }
    out += c;
    i++;
  }
  return out;
}

/** `includesOutsideComments` for shell text. */
export function includesOutsideShellComments(src, needle) {
  return stripShellComments(src).includes(String(needle));
}
