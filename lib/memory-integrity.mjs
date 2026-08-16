// @ts-check
/**
 * memory-integrity.mjs — a zero-LLM integrity pass ("dream pass") over a
 * markdown agent-memory directory: an index file (conventionally MEMORY.md)
 * plus per-fact topic files that reference each other with [[wiki-links]].
 * That's the shape Claude Code's auto-memory uses, and the shape most
 * markdown-file agent memories (MEMORY.md/USER.md-style) converge on.
 *
 * Everything here is pure pattern-matching over precomputed artifacts —
 * file names, link targets, frontmatter. No model calls, so it can run on
 * every session close for free.
 *
 * Pattern lineage: the silent-merge check comes from knowledge-graph
 * entity-resolution hygiene (we found a live instance in our own index on
 * day one: two distinct standing rules silently sharing one link target);
 * the link graph + suggest-only repair adapt gbrain's self-wiring graph and
 * dream-cycle repair — by pure pattern-match, no LLM.
 *
 * Checks (PRESENCE / REFERENCE only — whether a memory is CORRECT stays human):
 *   dead-index-link       WARN  the index links to a file that doesn't exist
 *   duplicate-link-target WARN  two index entries with clearly DIFFERENT titles
 *                               point at the same file (the entity-resolution
 *                               failure: distinct facts sharing one identity)
 *   index-over-budget     WARN  the index exceeds the session load budget, so
 *                               part of it silently doesn't load
 *   dangling-wiki-link    INFO  a [[wiki-link]] resolves to no file — allowed
 *                               by convention (it marks something worth writing
 *                               later), surfaced so it eventually gets written
 *   orphan-memory-file    INFO  a memory file no index line points at —
 *                               invisible to recall via the index
 *   near-duplicate-slug   INFO  two same-type files whose name token sets
 *                               overlap heavily (parallel-ingestion dupes)
 *
 * TYPE-GATING: near-duplicate comparison happens only within the same memory
 * type (feedback/project/reference/...), read from frontmatter metadata.type
 * with the filename prefix as fallback. Distinct types never compare.
 *
 * FAIL-SOFT: every ambiguity resolves to NO finding. Malformed frontmatter,
 * unparseable lines, empty inputs — all skip. The lint can only UNDER-report.
 *
 * Repair is SUGGEST-ONLY: suggestMemoryRepairs() names concrete fixes; a
 * human applies them. Nothing here edits anything.
 */

/** Default index load budget. Claude Code's session loader warns at ~24.4KB. */
export const DEFAULT_INDEX_BUDGET_BYTES = Math.floor(24.4 * 1024);

/** Below this normalized-title Jaccard, two entries sharing a target are "clearly different". */
const DUPLICATE_TARGET_MAX_JACCARD = 0.2;

/** At or above this normalized-name Jaccard, two same-type files look like dupes. */
const NEAR_DUP_MIN_JACCARD = 0.7;

const TITLE_STOPWORDS = new Set([
  "a", "an", "and", "as", "at", "by", "for", "from", "in", "is", "it",
  "of", "on", "or", "the", "to", "vs", "via", "with", "—", "-",
]);

function asString(v) {
  return typeof v === "string" ? v : "";
}

/** Lowercase, split on non-alphanumerics, drop stopwords and bare date/number tokens. */
export function significantTokens(text) {
  return asString(text)
    .toLowerCase()
    .split(/[^a-z0-9%]+/i)
    .filter((t) => t.length > 1 && !TITLE_STOPWORDS.has(t) && !/^\d+$/.test(t));
}

/**
 * Tokenizer for FILE-NAME comparison: keeps numeric tokens. In slugs, numbers
 * are the distinguishing part (sprint_18 vs _19, dated files) — dropping them
 * collapses every member of a series into the same token set.
 */
export function slugTokens(text) {
  return asString(text)
    .toLowerCase()
    .split(/[^a-z0-9%]+/i)
    .filter((t) => t.length > 0 && !TITLE_STOPWORDS.has(t));
}

function jaccard(tokensA, tokensB) {
  const a = new Set(tokensA);
  const b = new Set(tokensB);
  if (a.size === 0 || b.size === 0) return null; // fail-soft: incomparable
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Separator-insensitive slug normalization: kebab, snake, and case collapse. */
export function normalizeSlug(name) {
  return asString(name).toLowerCase().replace(/\.md$/i, "").replace(/[-_\s]+/g, "-").trim();
}

/**
 * Parse the cheap bits of a memory file's YAML frontmatter: `name:` and
 * `metadata.type`. Regex-level, not a YAML parser — fail-soft to nulls.
 * @param {string} content
 * @returns {{name: string|null, type: string|null}}
 */
export function parseFrontmatter(content) {
  const out = { name: null, type: null };
  const text = asString(content);
  if (!text.startsWith("---")) return out;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return out;
  const fm = text.slice(0, end);
  const nameMatch = /^name:\s*["']?([^"'\r\n]+)["']?\s*$/m.exec(fm);
  if (nameMatch) out.name = nameMatch[1].trim();
  const typeMatch = /^\s+type:\s*["']?([a-z][a-z0-9_-]*)["']?\s*$/m.exec(fm);
  if (typeMatch) out.type = typeMatch[1].trim().toLowerCase();
  return out;
}

/** Filename-prefix fallback for the memory type (feedback_x.md → "feedback"). */
export function typeFromFileName(fileName) {
  const m = /^([a-z]+)_/i.exec(asString(fileName));
  return m ? m[1].toLowerCase() : null;
}

/**
 * Extract index entries: markdown links whose target is a bare relative .md
 * file (memory-dir-local). Links with path separators or a scheme are
 * external pointers, not memory links — skipped.
 * @param {string} indexText
 * @returns {Array<{title: string, target: string, line: number}>}
 */
export function extractIndexLinks(indexText) {
  const links = [];
  const lines = asString(indexText).split(/\r?\n/);
  const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  for (let i = 0; i < lines.length; i++) {
    let m;
    while ((m = LINK_RE.exec(lines[i])) !== null) {
      if (m.index > 0 && lines[i][m.index - 1] === "!") continue; // image, not a link
      const target = m[2];
      if (!/\.md$/i.test(target)) continue;
      if (/[/\\]|^[a-z]+:/i.test(target)) continue; // path or scheme → not memory-local
      links.push({ title: m[1].trim(), target, line: i + 1 });
    }
  }
  return links;
}

/** Extract [[wiki-link]] names from a memory file body (frontmatter included is fine). */
export function extractWikiLinks(content) {
  const out = [];
  const RE = /\[\[([^\]\r\n]+)\]\]/g;
  let m;
  while ((m = RE.exec(asString(content))) !== null) out.push(m[1].trim());
  return out;
}

/**
 * The full integrity pass. Pure — caller reads the dir and hands in content.
 *
 * @param {object} input
 * @param {string} input.indexText           index file content (conventionally MEMORY.md)
 * @param {Array<{name: string, content?: string}>} input.files  topic files (the index is skipped by name)
 * @param {number} [input.indexByteLength]   byte size of the index on disk
 * @param {number} [input.budgetBytes]       load budget (default ~24.4KB)
 * @returns {{findings: Array<{type: string, severity: "warn"|"info", message: string, detail?: object}>, swept: boolean, coverage: {reached: number, skipped: number, indexRead: boolean}}}
 *
 * An empty `findings` array means one of two very different things, and the
 * caller must not conflate them: nothing was wrong, or nothing was read.
 * `swept === false` is the second. Check it first and escalate it as a probe
 * failure, never as a pass. `coverage.reached` lets you catch the quieter
 * version of the same bug - a sweep that reached three files out of four
 * hundred is technically swept and tells you nothing.
 */
export function lintMemoryIntegrity({ indexText, files, indexByteLength, budgetBytes } = {}) {
  const findings = [];
  const rawList = Array.isArray(files) ? files : [];
  // Three outcomes, counted separately, because they demand different reactions.
  // A malformed entry means your inventory code is broken; the index being
  // excluded is routine; an entry with no readable content was NOT linted even
  // though it has a valid name, and counting it as reached is how a coverage
  // number becomes a lie. `reached` must mean "actually read and linted".
  const indexOnly = [];
  const malformed = [];
  const contentless = [];
  const fileList = [];
  for (const f of rawList) {
    if (!f || typeof f.name !== "string") malformed.push(f);
    else if (f.name.toLowerCase() === "memory.md") indexOnly.push(f);
    else if (typeof f.content !== "string") contentless.push(f);
    else fileList.push(f);
  }

  const byNormalizedSlug = new Map(); // normalized file/frontmatter slug → fileName
  for (const f of fileList) {
    byNormalizedSlug.set(normalizeSlug(f.name), f.name);
    const fm = parseFrontmatter(f.content);
    if (fm.name) byNormalizedSlug.set(normalizeSlug(fm.name), f.name);
  }

  // --- index → file checks ---
  const links = extractIndexLinks(indexText);
  const referencedFiles = new Set();
  const byTarget = new Map(); // target file → [{title, line}]

  for (const link of links) {
    const resolved = byNormalizedSlug.get(normalizeSlug(link.target));
    if (!resolved) {
      findings.push({
        type: "dead-index-link",
        severity: "warn",
        message: `index:${link.line} links "${link.title}" → ${link.target}, which doesn't exist`,
        detail: { title: link.title, target: link.target, line: link.line },
      });
      continue;
    }
    referencedFiles.add(resolved);
    if (!byTarget.has(resolved)) byTarget.set(resolved, []);
    byTarget.get(resolved).push(link);
  }

  // Two entries on one target are fine when they're the SAME fact listed twice
  // (standing rules + topical index). They're a problem when the titles are
  // clearly different facts — that's the silent-merge shape.
  for (const [target, entries] of byTarget) {
    if (entries.length < 2) continue;
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const sim = jaccard(significantTokens(entries[i].title), significantTokens(entries[j].title));
        if (sim !== null && sim < DUPLICATE_TARGET_MAX_JACCARD) {
          findings.push({
            type: "duplicate-link-target",
            severity: "warn",
            message: `"${entries[i].title}" (line ${entries[i].line}) and "${entries[j].title}" (line ${entries[j].line}) both link to ${target} — two distinct facts sharing one file?`,
            detail: { target, titles: [entries[i].title, entries[j].title], lines: [entries[i].line, entries[j].line] },
          });
        }
      }
    }
  }

  // --- index size ---
  const budget = Number.isFinite(budgetBytes) && budgetBytes > 0 ? budgetBytes : DEFAULT_INDEX_BUDGET_BYTES;
  if (Number.isFinite(indexByteLength) && indexByteLength > budget) {
    findings.push({
      type: "index-over-budget",
      severity: "warn",
      message: `index is ${indexByteLength} bytes (budget ${budget}) — the tail won't load; trim digest lines into topic files`,
      detail: { indexByteLength, budgetBytes: budget },
    });
  }

  // --- wiki-links ---
  for (const f of fileList) {
    for (const wiki of extractWikiLinks(f.content)) {
      if (!byNormalizedSlug.has(normalizeSlug(wiki))) {
        findings.push({
          type: "dangling-wiki-link",
          severity: "info",
          message: `${f.name} references [[${wiki}]] — no such memory yet (fine by convention; write it or fix the name)`,
          detail: { file: f.name, wiki },
        });
      }
    }
  }

  // --- orphans ---
  for (const f of fileList) {
    if (!referencedFiles.has(f.name)) {
      findings.push({
        type: "orphan-memory-file",
        severity: "info",
        message: `${f.name} has no index line — invisible to session recall`,
        detail: { file: f.name },
      });
    }
  }

  // --- near-duplicate names, type-gated ---
  const typed = fileList.map((f) => ({
    name: f.name,
    type: parseFrontmatter(f.content).type ?? typeFromFileName(f.name),
    tokens: slugTokens(f.name.replace(/\.md$/i, "").replace(/^[a-z]+_/i, "")),
  }));
  for (let i = 0; i < typed.length; i++) {
    for (let j = i + 1; j < typed.length; j++) {
      if (!typed[i].type || typed[i].type !== typed[j].type) continue; // type-gate
      const sim = jaccard(typed[i].tokens, typed[j].tokens);
      if (sim !== null && sim >= NEAR_DUP_MIN_JACCARD) {
        findings.push({
          type: "near-duplicate-slug",
          severity: "info",
          message: `${typed[i].name} and ${typed[j].name} (both type=${typed[i].type}) have near-identical names — same fact written twice?`,
          detail: { files: [typed[i].name, typed[j].name], type: typed[i].type, similarity: sim },
        });
      }
    }
  }

  // Coverage, so an empty findings list can never be mistaken for a clean bill
  // of health. `patterns/checks-that-cant-fail.md` requires this: a sweep that
  // reached nothing must say NOTHING SWEPT, and a sweep that reached almost
  // nothing must be legible as such. `swept` is false when nothing was actually
  // read - check it BEFORE you read findings.
  //
  // `reached` counts topic files with readable content that this function
  // genuinely linted. It deliberately does NOT count an entry whose name parsed
  // but whose content did not, because such an entry contributes nothing to any
  // check while inflating the number a caller uses to judge coverage. The three
  // skip reasons stay separate: `malformed` means your inventory code is broken,
  // `contentless` means a read failed, `indexExcluded` is routine.
  //
  // `indexRead` is truthy-content, not "the index file existed" — an index that
  // read as an empty string was not read for any purpose that matters here.
  const indexRead = typeof indexText === "string" && indexText.length > 0;
  const swept = fileList.length > 0 || indexRead;
  return {
    findings,
    swept,
    coverage: {
      reached: fileList.length,
      skipped: malformed.length + contentless.length + indexOnly.length,
      malformed: malformed.length,
      contentless: contentless.length,
      indexExcluded: indexOnly.length,
      indexRead,
    },
  };
}

/** Minimum inbound [[links]] for a memory file to count as a graph "hub". */
const HUB_MIN_BACKLINKS = 3;
/** Min slug-token Jaccard for a "did you mean <slug>?" repair candidate. */
const REPAIR_NEAR_MIN_JACCARD = 0.4;
/** YYYY-MM-DD anywhere in a line — the digest's designed-to-age marker. */
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/;

/** Files minus the index file, matching lintMemoryIntegrity's filter. */
function topicFiles(files) {
  return Array.isArray(files)
    ? files.filter((f) => f && typeof f.name === "string" && f.name.toLowerCase() !== "memory.md")
    : [];
}

/**
 * Build the normalized-slug → fileName resolution index used to resolve a
 * [[wiki-link]] to its file (by file NAME or frontmatter `name:`). Mirrors the
 * map lintMemoryIntegrity builds inline.
 * @param {Array<{name: string, content?: string}>} fileList
 * @returns {Map<string,string>}
 */
function buildSlugIndex(fileList) {
  const idx = new Map();
  for (const f of fileList) {
    idx.set(normalizeSlug(f.name), f.name);
    const fm = parseFrontmatter(f.content);
    if (fm.name) idx.set(normalizeSlug(fm.name), f.name);
  }
  return idx;
}

/**
 * Zero-LLM bidirectional `[[wiki-link]]` graph over the memory dir. Where
 * lintMemoryIntegrity only FLAGS a dangling link, this builds the forward +
 * backward graph so a hygiene pass can answer "what links here?", "which
 * facts are disconnected?" (orphans), and "which are load-bearing hubs?".
 * A self-link and a repeated link to the same target are collapsed; a link
 * to a non-existent slug is `dangling`, never an edge.
 * FAIL-SOFT: malformed inputs → empty graph.
 *
 * @param {{files?: Array<{name: string, content?: string}>}} [input]
 * @returns {{
 *   nodes: Array<{file: string, type: string|null, outboundCount: number, backlinkCount: number}>,
 *   edges: Array<{from: string, to: string}>,
 *   backlinks: Record<string, string[]>,
 *   orphans: string[],
 *   hubs: Array<{file: string, backlinkCount: number}>,
 *   dangling: Array<{file: string, wiki: string}>,
 *   stats: {nodeCount: number, edgeCount: number, danglingCount: number, orphanCount: number, hubCount: number}
 * }}
 */
export function buildMemoryLinkGraph({ files } = {}) {
  const fileList = topicFiles(files);
  const slugIndex = buildSlugIndex(fileList);

  const outbound = new Map(); // file → Set<targetFile>
  const backlinks = new Map(); // file → Set<sourceFile>
  const dangling = [];
  for (const f of fileList) {
    outbound.set(f.name, new Set());
    backlinks.set(f.name, new Set());
  }

  for (const f of fileList) {
    const seen = new Set();
    for (const wiki of extractWikiLinks(f.content)) {
      const target = slugIndex.get(normalizeSlug(wiki));
      if (!target) {
        dangling.push({ file: f.name, wiki });
        continue;
      }
      if (target === f.name || seen.has(target)) continue; // self / repeat
      seen.add(target);
      outbound.get(f.name).add(target);
      if (!backlinks.has(target)) backlinks.set(target, new Set());
      backlinks.get(target).add(f.name);
    }
  }

  const edges = [];
  for (const [from, tos] of outbound) for (const to of tos) edges.push({ from, to });

  const typeOf = new Map(
    fileList.map((f) => [f.name, parseFrontmatter(f.content).type ?? typeFromFileName(f.name)]),
  );

  const nodes = fileList
    .map((f) => ({
      file: f.name,
      type: typeOf.get(f.name) ?? null,
      outboundCount: (outbound.get(f.name) ?? new Set()).size,
      backlinkCount: (backlinks.get(f.name) ?? new Set()).size,
    }))
    .sort((a, b) => b.backlinkCount - a.backlinkCount || a.file.localeCompare(b.file));

  const orphans = nodes.filter((n) => n.backlinkCount === 0).map((n) => n.file);
  const hubs = nodes
    .filter((n) => n.backlinkCount >= HUB_MIN_BACKLINKS)
    .map((n) => ({ file: n.file, backlinkCount: n.backlinkCount }));

  const backlinksObj = {};
  for (const [file, set] of backlinks) if (set.size) backlinksObj[file] = [...set].sort();

  return {
    nodes,
    edges,
    backlinks: backlinksObj,
    orphans,
    hubs,
    dangling,
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      danglingCount: dangling.length,
      orphanCount: orphans.length,
      hubCount: hubs.length,
    },
  };
}

/**
 * Nearest existing memory slug to `name` by slug-token Jaccard — for a "did you
 * mean <slug>?" repair candidate. Returns null when nothing clears the threshold
 * (fail-soft — no risky guess).
 * @param {string} name
 * @param {Map<string,string>} slugIndex  normalizeSlug → fileName
 * @param {number} [minJaccard]
 * @returns {{file: string, score: number}|null}
 */
export function nearestSlug(name, slugIndex, minJaccard = REPAIR_NEAR_MIN_JACCARD) {
  if (!(slugIndex instanceof Map)) return null;
  const wanted = slugTokens(normalizeSlug(name));
  let best = null;
  for (const [slug, file] of slugIndex) {
    const score = jaccard(wanted, slugTokens(slug));
    if (score !== null && score >= minJaccard && (best === null || score > best.score)) {
      best = { file, score };
    }
  }
  return best;
}

/**
 * When the index is over budget, suggest the OLDEST dated digest lines as
 * prune-to-rollup candidates (a digest is designed to age; dated lines are the
 * safe thing to move). Suggest-only — names lines + byte savings, never edits.
 * FAIL-SOFT: no dated lines → empty.
 * @param {string} indexText
 * @param {number} [overBytes]  enough candidates to cover this many bytes (else top 5)
 * @returns {Array<{line: number, date: string, bytes: number, text: string}>}
 */
export function suggestPruneCandidates(indexText, overBytes = 0) {
  const lines = asString(indexText).split(/\r?\n/);
  const enc = new TextEncoder();
  const dated = [];
  for (let i = 0; i < lines.length; i++) {
    const m = ISO_DATE_RE.exec(lines[i]);
    if (!m) continue;
    dated.push({
      line: i + 1,
      date: m[0],
      bytes: enc.encode(lines[i]).length + 1,
      text: lines[i].trim().slice(0, 100),
    });
  }
  dated.sort((a, b) => a.date.localeCompare(b.date) || a.line - b.line); // oldest first
  if (Number.isFinite(overBytes) && overBytes > 0) {
    const out = [];
    let saved = 0;
    for (const d of dated) {
      out.push(d);
      saved += d.bytes;
      if (saved >= overBytes) break;
    }
    return out;
  }
  return dated.slice(0, 5);
}

/** Default target length (chars) for an index ENTRY line when compacting. */
export const DEFAULT_MAX_INDEX_LINE_LENGTH = 200;

// A list-entry line carrying a memory-local markdown link. The HEAD group captures
// the load-bearing prefix — bullet (+ optional emoji) + the `[Title](file.md)`
// link + an optional `— `/`: `/`· `/`- ` separator — so the compaction truncates
// ONLY the trailing hook, never the link. Non-greedy `.*?` snaps to the FIRST
// markdown link, leaving any `[[wiki-link]]` in the tail (a wiki-link has no
// `(target)`, so it never matches here as the head's link).
const INDEX_ENTRY_HEAD_RE = /^(\s*[-*]\s+.*?\[[^\]]+\]\([^)\s/\\]+\.md\)\s*(?:[—:·-]\s*)?)(.*)$/;

/**
 * One-pass index-line COMPACTION. When the index exceeds the session-load
 * budget, the "trim a line → re-check the byte count → trim again" cycle is
 * pure friction. This compresses EVERY index ENTRY line longer than `maxLen`
 * CHARS down to ~maxLen in a SINGLE pass, preserving the load-bearing head
 * (bullet + `[Title](file.md)` link + separator) and truncating only the
 * trailing hook with a `…`. Non-entry lines (section headers, blanks, prose
 * with no memory-local link) and already-short lines are untouched. If even
 * the head is ≥ maxLen (a very long title), the line is SKIPPED — never
 * corrupt a link. Truncation snaps back to a word boundary so a token (incl.
 * a `[[wiki-link]]`) isn't cut mid-way where avoidable.
 *
 * Pure + deterministic; returns the compacted text + a per-line change report
 * and byte deltas so a caller previews BEFORE writing (SUGGEST-not-edit — a
 * CLI should require an explicit --write).
 *
 * @param {string} indexText
 * @param {{ maxLen?: number }} [opts]
 * @returns {{ compacted: string, changes: Array<{line:number, beforeChars:number, afterChars:number, savedBytes:number, after:string}>, skipped: Array<{line:number, reason:string}>, totalSavedBytes:number, beforeBytes:number, afterBytes:number }}
 */
export function compactIndexLines(indexText, opts = {}) {
  const text = asString(indexText);
  const maxLen =
    Number.isFinite(opts.maxLen) && opts.maxLen > 20 ? Math.floor(opts.maxLen) : DEFAULT_MAX_INDEX_LINE_LENGTH;
  const enc = new TextEncoder();
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const changes = [];
  const skipped = [];
  const out = lines.map((line, i) => {
    if ([...line].length <= maxLen) return line; // already within the per-line target
    const m = INDEX_ENTRY_HEAD_RE.exec(line);
    if (!m) return line; // not a compactable entry line (header / prose / no link)
    const head = m[1];
    const tail = m[2];
    if (!tail) return line; // nothing after the head to trim
    const headChars = [...head].length;
    if (headChars >= maxLen - 1) {
      skipped.push({ line: i + 1, reason: "head (bullet+link+separator) already at/over the target — left untouched" });
      return line;
    }
    const budget = maxLen - headChars - 1; // reserve 1 char for the ellipsis
    let cut = [...tail].slice(0, budget).join("");
    // Snap back to the last word boundary (avoid mid-token cuts) when it doesn't
    // throw away more than half the budget.
    const lastSpace = cut.lastIndexOf(" ");
    if (lastSpace > budget * 0.5) cut = cut.slice(0, lastSpace);
    // Never sever a markdown or wiki link mid-way: if the cut ends inside an
    // unfinished [Title](target) / [[wiki-link]], cut back to before its "[".
    let lastOpen = cut.lastIndexOf("[");
    if (lastOpen > 0 && cut[lastOpen - 1] === "[") lastOpen -= 1;
    if (lastOpen > -1) {
      const rest = cut.slice(lastOpen);
      const complete = /^\[\[[^\]]+\]\]/.test(rest) || /^\[[^\]]*\]\([^)]*\)/.test(rest);
      if (!complete) cut = cut.slice(0, lastOpen);
    }
    cut = cut.replace(/[\s—:·-]+$/, ""); // drop a dangling separator/space before the ellipsis
    if (!cut) return line; // would leave just "head…" with no content — leave it
    const after = `${head}${cut}…`;
    const savedBytes = enc.encode(line).length - enc.encode(after).length;
    if (savedBytes <= 0) return line; // never grow a line
    changes.push({ line: i + 1, beforeChars: [...line].length, afterChars: [...after].length, savedBytes, after });
    return after;
  });
  const compacted = out.join(nl);
  const beforeBytes = enc.encode(text).length;
  const afterBytes = enc.encode(compacted).length;
  return { compacted, changes, skipped, totalSavedBytes: beforeBytes - afterBytes, beforeBytes, afterBytes };
}

/**
 * Suggest-only repair pass (repair, NOT just lint). Turns the integrity
 * findings + the link graph into concrete SUGGESTED fixes a human can apply.
 * NEVER auto-applies — every entry is advisory. Same input shape as
 * lintMemoryIntegrity. FAIL-SOFT throughout (it composes the fail-soft lint
 * + graph helpers).
 *
 * @param {{indexText?: string, files?: Array<{name: string, content?: string}>, indexByteLength?: number, budgetBytes?: number}} [input]
 * @returns {{suggestions: Array<{kind: string, severity: "warn"|"info", message: string, detail?: object}>}}
 */
export function suggestMemoryRepairs(input = {}) {
  const { indexText, files, indexByteLength, budgetBytes } = input;
  const fileList = topicFiles(files);
  const slugIndex = buildSlugIndex(fileList);
  const referenced = new Set(
    extractIndexLinks(indexText)
      .map((l) => slugIndex.get(normalizeSlug(l.target)))
      .filter(Boolean),
  );
  const { findings } = lintMemoryIntegrity({ indexText, files, indexByteLength, budgetBytes });
  const suggestions = [];

  for (const f of findings) {
    const d = f.detail ?? {};
    if (f.type === "dead-index-link") {
      const cand = nearestSlug(d.target ?? "", slugIndex);
      suggestions.push({
        kind: "fix-dead-link",
        severity: "warn",
        message: cand
          ? `index:${d.line} → ${d.target} is dead; nearest existing file is ${cand.file} — retarget the link, or remove the line.`
          : `index:${d.line} → ${d.target} is dead with no close match — remove the line, or create ${d.target}.`,
        detail: { line: d.line, target: d.target, candidate: cand?.file ?? null },
      });
    } else if (f.type === "dangling-wiki-link") {
      const cand = nearestSlug(d.wiki ?? "", slugIndex);
      if (cand) {
        suggestions.push({
          kind: "fix-dangling-wiki",
          severity: "info",
          message: `${d.file}: [[${d.wiki}]] resolves to nothing — did you mean ${cand.file}? Else write that memory.`,
          detail: { file: d.file, wiki: d.wiki, candidate: cand.file },
        });
      }
      // No close candidate → the lint INFO already says "write it"; don't double-suggest.
    } else if (f.type === "near-duplicate-slug") {
      const [a, b] = d.files ?? [];
      const survivor =
        referenced.has(a) && !referenced.has(b) ? a
        : referenced.has(b) && !referenced.has(a) ? b
        : (asString(a).length >= asString(b).length ? a : b);
      suggestions.push({
        kind: "merge-near-duplicate",
        severity: "info",
        message: `${a} and ${b} (type=${d.type}) look like the same fact — merge into ${survivor} and update the index link.`,
        detail: { files: [a, b], survivor },
      });
    } else if (f.type === "orphan-memory-file") {
      suggestions.push({
        kind: "index-orphan",
        severity: "info",
        message: `${d.file} is not in the index — add a one-line pointer so it's recall-visible (or delete it if stale).`,
        detail: { file: d.file },
      });
    } else if (f.type === "duplicate-link-target") {
      const [t0, t1] = d.titles ?? [];
      suggestions.push({
        kind: "split-shared-target",
        severity: "warn",
        message: `"${t0}" and "${t1}" both point at ${d.target} — split into two files (one per fact), or confirm they're the same and merge the index lines.`,
        detail: { target: d.target, titles: d.titles },
      });
    } else if (f.type === "index-over-budget") {
      const over = (d.indexByteLength ?? 0) - (d.budgetBytes ?? 0);
      const prune = suggestPruneCandidates(indexText, over);
      suggestions.push({
        kind: "prune-index",
        severity: "warn",
        message: prune.length
          ? `index is ${over} bytes over budget — oldest dated digest lines to move into a rollup: ${prune.map((p) => `L${p.line}(${p.date})`).join(", ")}.`
          : `index is ${over} bytes over budget — trim the oldest digest lines into a rollup (no dated lines auto-detected).`,
        detail: { overBytes: over, candidates: prune },
      });
    }
  }

  return { suggestions };
}
