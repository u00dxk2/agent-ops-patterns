#!/usr/bin/env node
// Renders a "How it decides" card (schema aop-decides-card/v1) as one standalone HTML page.
//
//   node scripts/render-decides-card.mjs gallery/cards/<slug>.json gallery/<slug>/card.html
//   node scripts/render-decides-card.mjs gallery/cards/<slug>.json gallery/<slug>/card.html --check
//
// The page is generated: edit the JSON, then re-render. --check writes nothing and exits 1 when the
// page on disk differs from what the JSON renders to.
//
// Failure posture: fail-closed. A card that breaks the contract (validateCard) is refused with every
// problem listed, and no page is written. Limits: the checks are on shape, not truth. A wrong answer
// with a well-formed evidence pointer passes; only a source re-read and a claims pass can catch it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const STAGES = ["gatekeeping", "done", "limits-memory", "other"];
export const HOLDERS = ["model", "code", "human", "nobody"];
export const HOW = ["re-read at pinned commit", "reproduced", "static"];
export const UPSTREAM = ["fixed", "fix-proposed", "reported", "already-tracked", "not-filed"];
export const METHODS = ["derived-from-full-map", "quick-pass"];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHA = /^[0-9a-f]{40}$/;
// A repository-relative path, a colon, and one line or one inclusive range.
const EVIDENCE = /^[\w.-]+(?:\/[\w.-]+)*:(\d+)(?:-(\d+))?$/;
const SCORE_KEYS = /^(score|scores|grade|grades|total|totals|rating|ratings)$/i;

const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;

function evidenceOk(e) {
  const m = typeof e === "string" && e.match(EVIDENCE);
  return Boolean(m) && (m[2] === undefined || Number(m[2]) >= Number(m[1]));
}

function scoreKeys(value, at = "card") {
  if (Array.isArray(value)) return value.flatMap((v, i) => scoreKeys(v, `${at}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [
      ...(SCORE_KEYS.test(k) ? [`${at}.${k}: no scores, totals or grades`] : []),
      ...scoreKeys(v, `${at}.${k}`),
    ]);
  }
  return [];
}

// Returns a list of problems; an empty list means the card meets the contract's shape.
export function validateCard(card) {
  const errs = [];
  const need = (ok, msg) => { if (!ok) errs.push(msg); };
  if (!card || typeof card !== "object") return ["card is not an object"];
  need(card.schema === "aop-decides-card/v1", "schema is not aop-decides-card/v1");
  const a = card.agent ?? {};
  need(nonEmpty(a.name), "agent.name");
  need(/^[a-z0-9-]+$/.test(a.slug ?? ""), "agent.slug is lower-case letters, digits and dashes");
  need(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(a.repo ?? ""), "agent.repo is a github.com repository URL");
  need(SHA.test(a.commit ?? ""), "agent.commit is a full 40-hex commit");
  need(DATE.test(a.mappedAt ?? ""), "agent.mappedAt is YYYY-MM-DD");
  need(/^https:\/\//.test(card.fullMapUrl ?? ""), "fullMapUrl is an https URL");
  need(nonEmpty(card.summary), "summary");
  need(nonEmpty(card.notChecked), "notChecked");

  const js = Array.isArray(card.judgments) ? card.judgments : [];
  need(js.length >= 8 && js.length <= 12, `judgments: 8-12 expected, found ${js.length}`);
  const ids = new Set();
  js.forEach((j, i) => {
    const at = `judgments[${i}]`;
    need(nonEmpty(j.id), `${at}.id`);
    need(!ids.has(j.id), `${at}.id ${j.id} repeats`);
    ids.add(j.id);
    need(STAGES.includes(j.stage), `${at}.stage is one of ${STAGES.join(", ")}`);
    need(HOLDERS.includes(j.holder), `${at}.holder is one of ${HOLDERS.join(", ")}`);
    need(nonEmpty(j.question), `${at}.question`);
    need(nonEmpty(j.answer), `${at}.answer`);
    need(evidenceOk(j.evidence), `${at}.evidence is path:line or path:start-end`);
  });

  const ps = Array.isArray(card.problems) ? card.problems : [];
  need(ps.length === 3, `problems: exactly 3 expected, found ${ps.length}`);
  ps.forEach((p, i) => {
    const at = `problems[${i}]`;
    need(nonEmpty(p.title), `${at}.title`);
    need(nonEmpty(p.plain), `${at}.plain`);
    need(Array.isArray(p.evidence) && p.evidence.length > 0 && p.evidence.every(evidenceOk), `${at}.evidence is a non-empty list of path:line`);
    need(HOW.includes(p.verified?.how), `${at}.verified.how is one of ${HOW.join(" | ")}`);
    need(nonEmpty(p.verified?.claimsPass), `${at}.verified.claimsPass`);
    const u = p.upstream ?? {};
    need(UPSTREAM.includes(u.status), `${at}.upstream.status is one of ${UPSTREAM.join(", ")}`);
    need(u.url === null || /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(issues|pull)\/\d+$/.test(u.url ?? ""), `${at}.upstream.url is a GitHub issue/PR URL or null`);
    need(u.status === "not-filed" || u.url !== null, `${at}.upstream.url is null only when status is not-filed`);
    need(DATE.test(u.checkedAt ?? ""), `${at}.upstream.checkedAt is YYYY-MM-DD`);
  });

  const pv = card.provenance ?? {};
  need(nonEmpty(pv.mapEdition), "provenance.mapEdition");
  need(nonEmpty(pv.cardCommit), "provenance.cardCommit");
  need(METHODS.includes(pv.method), `provenance.method is one of ${METHODS.join(", ")}`);
  errs.push(...scoreKeys(card));
  return errs;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function evidenceUrl(card, e) {
  const [, file, a, b] = e.match(/^(.*):(\d+)(?:-(\d+))?$/);
  return `${card.agent.repo}/blob/${card.agent.commit}/${file}#L${a}${b ? `-L${b}` : ""}`;
}

function evidenceLink(card, e) {
  const short = e.split("/").pop();
  return `<a href="${esc(evidenceUrl(card, e))}" title="${esc(e)}"><code>${esc(short)}</code></a>`;
}

const STAGE_HEADINGS = {
  gatekeeping: "What it does without asking you",
  done: "How it decides it is done",
  "limits-memory": "Limits and memory",
  other: "Other judgments",
};
const HOLDER_LABELS = { model: "an AI model", code: "plain code", human: "a person", nobody: "nobody" };
const STATUS_LABELS = {
  fixed: "Fixed upstream",
  "fix-proposed": "Reported; a fix is proposed, not merged",
  reported: "Reported; no linked fix found",
  "already-tracked": "Already tracked upstream",
  "not-filed": "Not reported upstream",
};
const HOW_LABELS = {
  "re-read at pinned commit": "the code was re-read at the source version named above",
  reproduced: "reproduced by running the code",
  static: "read from the code, not run",
};
const METHOD_LABELS = { "derived-from-full-map": "taken from the full map", "quick-pass": "a quick pass, not a full map" };

export function renderCard(card) {
  const errs = validateCard(card);
  if (errs.length) throw new Error(`card refused:\n- ${errs.join("\n- ")}`);
  const { agent } = card;
  const short = agent.commit.slice(0, 8);
  const issueNumber = (url) => url.match(/(\d+)$/)[1];

  const judgmentSections = STAGES.filter((s) => card.judgments.some((j) => j.stage === s))
    .map((s) => {
      const items = card.judgments.filter((j) => j.stage === s).map((j) => `<li class="j">
  <p class="q">${esc(j.question)}</p>
  <p class="a"><span class="holder holder-${esc(j.holder)}">Decided by ${esc(HOLDER_LABELS[j.holder])}</span> ${esc(j.answer)}</p>
  <p class="ev">${evidenceLink(card, j.evidence)} · decision ${esc(j.id)} in the full map</p>
</li>`).join("\n");
      return `<h2>${esc(STAGE_HEADINGS[s])}</h2>\n<ul class="judgments">\n${items}\n</ul>`;
    }).join("\n\n");

  const problems = card.problems.map((p, i) => {
    const up = p.upstream.url
      ? `<a href="${esc(p.upstream.url)}">#${esc(issueNumber(p.upstream.url))}</a>`
      : "";
    return `<li class="p">
  <h3>${i + 1}. ${esc(p.title)}</h3>
  <p>${esc(p.plain)}</p>
  <p class="status">${esc(STATUS_LABELS[p.upstream.status])}${up ? ` (${up})` : ""}, checked ${esc(p.upstream.checkedAt)}.</p>
  <p class="ev">Where: ${p.evidence.map((e) => evidenceLink(card, e)).join(", ")}. How we checked: ${esc(HOW_LABELS[p.verified.how])}; the sentences were checked by ${esc(p.verified.claimsPass)}.</p>
</li>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>How ${esc(agent.name)} decides</title>
<meta name="description" content="${esc(card.summary)}">
<style>
:root{--bg:#fbfaf7;--fg:#1d1d1b;--muted:#5d5b55;--line:#dedad0;--card:#ffffff;--code:#f2efe8;--link:#2f6f8f;
  --model:#6b4fa0;--code-h:#2f6f8f;--human:#2e7d4f;--nobody:#a3452f}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --bg:#151513;--fg:#ebe8e0;--muted:#a8a498;--line:#34322d;--card:#1d1c19;--code:#262520;--link:#6fb3d4;
  --model:#b9a2e6;--code-h:#6fb3d4;--human:#7fcf9f;--nobody:#f09a83}}
:root[data-theme="dark"]{--bg:#151513;--fg:#ebe8e0;--muted:#a8a498;--line:#34322d;--card:#1d1c19;--code:#262520;--link:#6fb3d4;
  --model:#b9a2e6;--code-h:#6fb3d4;--human:#7fcf9f;--nobody:#f09a83}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:680px;margin:0 auto;padding:0 16px 56px}
a{color:var(--link)}
code{background:var(--code);padding:1px 4px;border-radius:4px;font-size:.86em;overflow-wrap:anywhere}
.crumbs{font-size:.9rem;color:var(--muted);margin-top:18px}
h1{font-size:1.6rem;line-height:1.2;margin:20px 0 10px}
.summary{font-size:1.08rem}
.meta{color:var(--muted);font-size:.88rem}
h2{font-size:1.15rem;margin:32px 0 8px;padding-top:8px;border-top:1px solid var(--line)}
ul.judgments,ol.problems{list-style:none;margin:0;padding:0}
.j,.p{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin:10px 0}
.j p,.p p{margin:4px 0}
.q{font-weight:650}
.holder{display:inline-block;font-size:.8rem;font-weight:650;border:1px solid currentColor;border-radius:999px;padding:0 8px;margin-right:4px}
.holder-model{color:var(--model)}.holder-code{color:var(--code-h)}.holder-human{color:var(--human)}.holder-nobody{color:var(--nobody)}
.ev{color:var(--muted);font-size:.85rem}
.p h3{font-size:1.05rem;margin:2px 0 6px}
.status{font-weight:600}
.full{display:block;text-align:center;font-weight:650;border:1px solid var(--link);border-radius:8px;padding:12px;margin:28px 0 8px;text-decoration:none}
</style>
</head>
<body>
<main>

<p class="crumbs"><a href="../../">agent-ops-patterns</a> / <a href="../">gallery</a> / <a href="./">${esc(agent.name)} map</a> / how it decides</p>

<h1>How ${esc(agent.name)} decides</h1>

<p class="summary">${esc(card.summary)}</p>

<p class="meta">From <a href="${esc(agent.repo)}"><code>${esc(agent.repo.replace("https://github.com/", ""))}</code></a> at source version <a href="${esc(agent.repo)}/tree/${esc(agent.commit)}"><code>${esc(short)}</code></a>, mapped ${esc(agent.mappedAt)}. Each answer links the code where that decision is made.</p>

${judgmentSections}

<h2>Three problems in the code</h2>
<ol class="problems">
${problems}
</ol>

<a class="full" href="${esc(card.fullMapUrl)}">See the full map →</a>

<p class="meta">${esc(card.notChecked)}</p>
<p class="meta">Map edition ${esc(card.provenance.mapEdition)} · ${esc(METHOD_LABELS[card.provenance.method])} · card data: <a href="https://github.com/u00dxk2/agent-ops-patterns/blob/main/gallery/cards/${esc(agent.slug)}.json"><code>gallery/cards/${esc(agent.slug)}.json</code></a>. Corrections are welcome as an <a href="https://github.com/u00dxk2/agent-ops-patterns/issues">issue</a>.</p>

</main>
</body>
</html>
`;
}

function main(argv) {
  const [src, out, flag] = argv;
  if (!src || !out || (flag !== undefined && flag !== "--check")) {
    process.stderr.write("usage: render-decides-card.mjs <card.json> <out.html> [--check]\n");
    return 2;
  }
  let html;
  try {
    html = renderCard(JSON.parse(fs.readFileSync(src, "utf8")));
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    return 1;
  }
  if (flag === "--check") {
    const same = fs.existsSync(out) && fs.readFileSync(out, "utf8").replace(/\r\n/g, "\n") === html;
    process.stdout.write(same ? `up to date: ${out}\n` : `differs from its JSON: ${out}\n`);
    return same ? 0 : 1;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  process.stdout.write(`wrote ${out}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
