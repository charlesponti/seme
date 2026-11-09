// Renders an eval run as a standalone HTML page (monotone, matching the app's
// design spec) and as Markdown for PRs and terminals.

type Num = number | null;

interface RunLike {
  id: string;
  category: string;
  tags: string[];
  repeat: number;
  pass: boolean;
  error?: string;
  latency_ms: number;
  grade: null | {
    checks: { name: string; pass: boolean; detail: string }[];
    counts: Record<string, number | boolean>;
    missed_claims: string[];
  };
  pred: null | {
    entities: { name: string; type: string }[];
    relations: { source: string; target: string; relation_type: string }[];
    memories: { value_text: string; kind: string; modality: string }[];
    feedback_events: number;
  };
  judge: null | {
    groundedness: { index: number; verdict: string; why: string }[];
    coverage: { claim: string; covered: boolean; why: string }[];
  };
}

export interface ResultLike {
  meta: {
    ts: string;
    cases: number;
    runs: number;
    repeats: number;
    concurrency: number;
    judge_model: string | null;
    duration_s: number;
    baseline: boolean;
  };
  metrics: Record<string, Num>;
  categories: Record<string, { cases: number; runs: number; pass_rate: number }>;
  gates: { name: string; value: Num; threshold: number; kind: 'hard' | 'soft'; pass: boolean }[];
  regressions: { metric: string; baseline: number; current: number; drop: number }[];
  calibration: null | { accuracy: number; n: number; misses: string[] };
  runs: RunLike[];
}

export interface HistoryPoint {
  ts: string;
  pass_rate: number;
  entity_f1: Num;
  memory_recall: Num;
  relation_f1: Num;
}

const pct = (v: Num) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const LABELS: Record<string, string> = {
  pass_rate: 'Pass rate',
  pass_at_k: 'Pass@k',
  pass_pow_k: 'Pass^k',
  entity_precision: 'Entity precision',
  entity_recall: 'Entity recall',
  entity_f1: 'Entity F1',
  entity_type_accuracy: 'Entity type accuracy',
  relation_precision: 'Relation precision',
  relation_recall: 'Relation recall',
  relation_f1: 'Relation F1',
  memory_recall: 'Memory recall',
  memory_precision: 'Memory precision',
  entity_precision_exhaustive: 'Entity precision (exhaustive cases)',
  relation_precision_exhaustive: 'Relation precision (exhaustive cases)',
  precision_scored_cases: 'Exhaustive cases scored',
  forbidden_violations: 'Forbidden violations',
  provenance_rate: 'Verbatim provenance',
  abstention_pass_rate: 'Abstention',
  safety_pass_rate: 'Safety',
  feedback_pass_rate: 'Feedback',
  judge_supported_rate: 'Judge: supported',
  judge_contradicted: 'Judge: contradicted',
  judge_coverage_rate: 'Judge: coverage',
  latency_p50_ms: 'Latency p50 (ms)',
  latency_p95_ms: 'Latency p95 (ms)',
};

const HEADLINE = [
  'pass_rate',
  'entity_f1',
  'relation_f1',
  'memory_recall',
  'memory_precision',
  'provenance_rate',
  'forbidden_violations',
  'judge_supported_rate',
];

function sparkline(points: number[]): string {
  if (points.length < 2) return '<p class="muted">Run the suite again to see a trend.</p>';
  const w = 560;
  const h = 72;
  const xs = points.map((_, i) => (i / (points.length - 1)) * (w - 8) + 4);
  const ys = points.map((p) => h - 6 - p * (h - 12));
  const line = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const dots = xs
    .map((x, i) => `<circle cx="${x.toFixed(1)}" cy="${ys[i].toFixed(1)}" r="2.5" fill="#171717"/>`)
    .join('');
  return `<svg viewBox="0 0 ${w} ${h}" class="spark" role="img" aria-label="Pass rate over runs"><line x1="0" x2="${w}" y1="${h - 6 - (h - 12)}" y2="${h - 6 - (h - 12)}" stroke="#eaeaea"/><polyline points="${line}" fill="none" stroke="#171717" stroke-width="1.5"/>${dots}</svg>`;
}

function bar(value: number): string {
  const w = Math.max(0, Math.min(1, value)) * 100;
  return `<div class="bar"><div class="fill" style="width:${w.toFixed(1)}%"></div></div>`;
}

function caseDetail(r: RunLike): string {
  const checks = (r.grade?.checks ?? [])
    .map(
      (c) =>
        `<li class="${c.pass ? 'ok' : 'bad'}"><span class="mark">${c.pass ? '✓' : '✕'}</span><b>${esc(c.name)}</b> <span class="muted">${esc(c.detail)}</span></li>`,
    )
    .join('');
  const ents =
    (r.pred?.entities ?? [])
      .map((e) => `<li>${esc(e.name)} <span class="mono muted">${esc(e.type)}</span></li>`)
      .join('') || '<li class="muted">none</li>';
  const rels =
    (r.pred?.relations ?? [])
      .map(
        (x) =>
          `<li>${esc(x.source)} <span class="mono muted">${esc(x.relation_type)}</span> ${esc(x.target)}</li>`,
      )
      .join('') || '<li class="muted">none</li>';
  const mems =
    (r.pred?.memories ?? [])
      .map(
        (m) =>
          `<li>${esc(m.value_text)} <span class="mono muted">${esc(m.kind)} · ${esc(m.modality)}</span></li>`,
      )
      .join('') || '<li class="muted">none</li>';
  const judge = r.judge
    ? `<div class="col"><h4>Judge</h4><ul>${r.judge.groundedness.map((g) => `<li class="${g.verdict === 'supported' ? 'ok' : 'bad'}">#${g.index} ${esc(g.verdict)} <span class="muted">${esc(g.why)}</span></li>`).join('')}${r.judge.coverage.map((c) => `<li class="${c.covered ? 'ok' : 'bad'}">claim ${c.covered ? 'covered' : 'missed'}: ${esc(c.claim)}</li>`).join('')}</ul></div>`
    : '';
  const err = r.error ? `<p class="bad">Run error: ${esc(r.error)}</p>` : '';
  return `${err}<div class="grid3"><div class="col"><h4>Checks</h4><ul class="checks">${checks}</ul></div><div class="col"><h4>Extracted</h4><h5>Entities</h5><ul>${ents}</ul><h5>Relations</h5><ul>${rels}</ul><h5>Memories</h5><ul>${mems}</ul></div>${judge}</div>`;
}

export function renderHtml(result: ResultLike, history: HistoryPoint[] = []): string {
  const m = result.metrics;
  const hard = result.gates.filter((g) => g.kind === 'hard');
  const hardOk = hard.every((g) => g.pass);
  const statCards = HEADLINE.map((k) => {
    const v = m[k];
    const shown =
      k === 'forbidden_violations' || k === 'precision_scored_cases' ? String(v ?? 'n/a') : pct(v);
    return `<div class="stat"><div class="num">${shown}</div><div class="lab">${esc(LABELS[k] ?? k)}</div></div>`;
  }).join('');

  const gateRows = result.gates
    .map((g) => {
      const status = g.pass ? 'ok' : g.kind === 'hard' ? 'FAIL' : 'warn';
      const op = g.name === 'forbidden_violations' ? '=' : '≥';
      const val =
        g.value === null
          ? 'n/a'
          : g.name === 'forbidden_violations'
            ? String(g.value)
            : pct(g.value);
      const thr = g.name === 'forbidden_violations' ? String(g.threshold) : pct(g.threshold);
      return `<tr><td><span class="pill ${status}">${status}</span></td><td>${esc(g.name)}</td><td class="mono">${val}</td><td class="mono muted">${op} ${thr}</td><td class="muted">${g.kind}</td></tr>`;
    })
    .join('');

  const cats = Object.entries(result.categories)
    .sort((a, b) => a[1].pass_rate - b[1].pass_rate)
    .map(
      ([name, c]) =>
        `<div class="cat"><div class="cat-top"><span>${esc(name.replace(/_/g, ' '))}</span><span class="mono">${pct(c.pass_rate)} <span class="muted">${c.cases} cases</span></span></div>${bar(c.pass_rate)}</div>`,
    )
    .join('');

  const regs = result.regressions.length
    ? `<section><h2>Regressions vs baseline</h2><ul class="regs">${result.regressions
        .map(
          (r) =>
            `<li><span class="pill FAIL">regressed</span> <b>${esc(LABELS[r.metric] ?? r.metric)}</b> <span class="mono">${pct(r.baseline)} → ${pct(r.current)}</span> <span class="muted">−${(r.drop * 100).toFixed(1)} pts</span></li>`,
        )
        .join('')}</ul></section>`
    : '';

  const calib = result.calibration
    ? `<section><h2>Judge calibration</h2><p><span class="mono">${pct(result.calibration.accuracy)}</span> agreement with ${result.calibration.n} hand-labelled pairs.</p>${result.calibration.misses.length ? `<ul class="muted">${result.calibration.misses.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</section>`
    : '';

  // Cases: one row per case, with per-repeat outcomes.
  const byCase = new Map<string, RunLike[]>();
  for (const r of result.runs) byCase.set(r.id, [...(byCase.get(r.id) ?? []), r]);
  const rows = [...byCase.entries()]
    .map(([id, runs]) => {
      const passing = runs.filter((r) => r.pass).length;
      const status = passing === runs.length ? 'pass' : passing === 0 ? 'fail' : 'flaky';
      const first = runs[0];
      const failing = (first.grade?.checks ?? []).filter((c) => !c.pass).map((c) => c.name);
      const detail = runs
        .map(
          (r) =>
            `<div class="run"><div class="run-h"><span class="pill ${r.pass ? 'ok' : 'FAIL'}">${r.pass ? 'pass' : 'fail'}</span> <span class="mono muted">run ${r.repeat} · ${r.latency_ms} ms</span></div>${caseDetail(r)}</div>`,
        )
        .join('');
      return `<details class="case ${status}" data-status="${status}" data-search="${esc(`${id} ${first.category} ${first.tags.join(' ')}`)}">
        <summary><span class="pill ${status === 'pass' ? 'ok' : status === 'fail' ? 'FAIL' : 'warn'}">${status}</span> <span class="mono">${esc(id)}</span> <span class="muted">${esc(first.category.replace(/_/g, ' '))}</span> <span class="muted">${passing}/${runs.length}</span> ${failing.length ? `<span class="fails">${failing.map(esc).join(', ')}</span>` : ''}</summary>
        <div class="body">${detail}</div>
      </details>`;
    })
    .join('');

  const trend = sparkline(history.map((h) => h.pass_rate));
  const headerStatus = hardOk
    ? '<span class="pill ok">hard gates pass</span>'
    : '<span class="pill FAIL">hard gate failed</span>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Seme extraction eval</title>
<style>
:root{--bg:#fff;--sub:#fafafa;--hover:#f5f5f5;--line:#eaeaea;--line2:#d4d4d4;--ink:#171717;--ink2:#666;--ink3:#888;--black:#000}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/20px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:1200px;margin:0 auto;padding:32px 24px 64px}
h1{font-family:"Geist Pixel",ui-monospace,monospace;font-weight:400;font-size:28px;line-height:36px;margin:0}
h2{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink3);font-weight:500;margin:40px 0 12px;border-bottom:1px solid var(--line);padding-bottom:8px}
h4{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink3);font-weight:500;margin:0 0 8px}
h5{font-size:12px;color:var(--ink2);font-weight:500;margin:10px 0 4px}
.top{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;padding-bottom:16px;border-bottom:1px solid var(--line)}
.meta{font:12px/18px ui-monospace,"Geist Mono",monospace;color:var(--ink2)}
.stats{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);border-radius:8px;margin-top:24px;overflow:hidden}
.stat{padding:18px 20px;border-left:1px solid var(--line)}
.stat:first-child{border-left:0}
.num{font:500 26px/32px ui-monospace,"Geist Mono",monospace;font-variant-numeric:tabular-nums}
.lab{margin-top:4px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink3)}
table{width:100%;border-collapse:collapse}
td,th{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink3);font-weight:500}
.mono{font-family:ui-monospace,"Geist Mono",monospace;font-variant-numeric:tabular-nums}
.muted{color:var(--ink3)}
.pill{display:inline-block;font:500 11px/18px ui-monospace,"Geist Mono",monospace;padding:0 6px;border-radius:4px;border:1px solid var(--line2);color:var(--ink2);text-transform:lowercase}
.pill.ok{color:var(--ink);border-color:var(--ink)}
.pill.FAIL{background:var(--ink);color:#fff;border-color:var(--ink)}
.pill.warn{border-style:dashed}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:32px}
.cat{margin:10px 0}
.cat-top{display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px}
.bar{height:6px;background:var(--line);border-radius:3px;overflow:hidden}
.fill{height:100%;background:var(--ink)}
.spark{width:100%;height:72px;display:block}
.toolbar{display:flex;gap:8px;align-items:center;margin:8px 0 12px;flex-wrap:wrap}
.toolbar input{height:32px;border:1px solid var(--line2);border-radius:6px;padding:0 10px;font:13px ui-sans-serif,system-ui;min-width:260px}
.toolbar button{height:32px;border:1px solid var(--line2);background:#fff;border-radius:6px;padding:0 12px;font:13px ui-sans-serif,system-ui;cursor:pointer}
.toolbar button.on{background:var(--black);color:#fff;border-color:var(--black)}
details.case{border-bottom:1px solid var(--line)}
details.case>summary{list-style:none;cursor:pointer;padding:10px 4px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
details.case>summary::-webkit-details-marker{display:none}
details.case>summary:hover{background:var(--hover)}
details.case[open]>summary{background:var(--sub)}
.fails{font:12px ui-monospace,"Geist Mono",monospace;color:var(--ink2)}
.body{padding:4px 4px 16px}
.run{border:1px solid var(--line);border-radius:8px;padding:12px;margin:8px 0}
.run-h{display:flex;gap:8px;align-items:center;margin-bottom:8px}
.grid3{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:20px}
.grid3 ul,.checks{margin:0;padding:0;list-style:none}
.grid3 li,.checks li{padding:4px 0;border-bottom:1px dashed var(--line)}
.checks .mark{display:inline-block;width:16px;color:var(--ink3)}
li.ok .mark,.checks li.ok .mark{color:var(--ink)}
li.bad,.checks li.bad{color:var(--ink)}
.regs{list-style:none;margin:0;padding:0}
.regs li{padding:6px 0;border-bottom:1px solid var(--line)}
p.bad{color:var(--ink);font-weight:500}
@media (max-width:820px){.stats{grid-template-columns:repeat(2,1fr)}.stat:nth-child(odd){border-left:0}.cols,.grid3{grid-template-columns:1fr}}
</style>
</head>
<body>
<main>
  <div class="top">
    <div>
      <h1>Seme extraction eval</h1>
      <div class="meta">${esc(result.meta.ts.replace('T', ' ').slice(0, 19))} UTC · ${result.meta.cases} cases · ${result.meta.runs} runs (${result.meta.repeats}× repeats) · ${result.meta.duration_s}s${result.meta.judge_model ? ` · judge ${esc(result.meta.judge_model)}` : ' · no judge'}</div>
    </div>
    <div>${headerStatus}</div>
  </div>

  <div class="stats">${statCards}</div>

  <div class="cols">
    <section>
      <h2>Gates</h2>
      <table><thead><tr><th></th><th>Gate</th><th>Value</th><th>Threshold</th><th>Kind</th></tr></thead><tbody>${gateRows}</tbody></table>
    </section>
    <section>
      <h2>Pass rate by category</h2>
      ${cats}
      <h2>Trend</h2>
      ${trend}
    </section>
  </div>

  ${regs}
  ${calib}

  <section>
    <h2>Consistency</h2>
    <p class="meta">pass@${result.meta.repeats} ${pct(m.pass_at_k)} · pass^${result.meta.repeats} ${pct(m.pass_pow_k)} · latency p50 ${m.latency_p50_ms ?? 'n/a'} ms, p95 ${m.latency_p95_ms ?? 'n/a'} ms</p>
  </section>

  <section>
    <h2>Cases</h2>
    <div class="toolbar">
      <input id="q" placeholder="Filter by id, category or tag" aria-label="Filter cases">
      <button data-f="all" class="on">All</button>
      <button data-f="fail">Failing</button>
      <button data-f="flaky">Flaky</button>
      <button data-f="pass">Passing</button>
    </div>
    <div id="cases">${rows}</div>
  </section>
</main>
<script>
(function(){
  var q=document.getElementById('q'),btns=[].slice.call(document.querySelectorAll('.toolbar button')),cases=[].slice.call(document.querySelectorAll('details.case'));
  var filter='all';
  function apply(){
    var term=(q.value||'').toLowerCase();
    cases.forEach(function(d){
      var okStatus=filter==='all'||d.dataset.status===filter;
      var okText=!term||(d.dataset.search||'').toLowerCase().indexOf(term)>=0;
      d.style.display=(okStatus&&okText)?'':'none';
    });
  }
  q.addEventListener('input',apply);
  btns.forEach(function(b){b.addEventListener('click',function(){btns.forEach(function(x){x.classList.remove('on')});b.classList.add('on');filter=b.dataset.f;apply();});});
})();
</script>
</body>
</html>`;
}

export function renderMarkdown(result: ResultLike): string {
  const m = result.metrics;
  const lines: string[] = [];
  lines.push(`# Seme extraction eval`);
  lines.push('');
  lines.push(
    `${result.meta.ts} · ${result.meta.cases} cases · ${result.meta.runs} runs · judge: ${result.meta.judge_model ?? 'off'}`,
  );
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('| --- | --- |');
  for (const [k, v] of Object.entries(m)) {
    const shown =
      k.startsWith('latency_') ||
      k === 'forbidden_violations' ||
      k === 'judge_contradicted' ||
      k === 'precision_scored_cases'
        ? String(v ?? 'n/a')
        : pct(v);
    lines.push(`| ${LABELS[k] ?? k} | ${shown} |`);
  }
  lines.push('');
  lines.push('## Gates');
  lines.push('');
  lines.push('| Status | Gate | Value | Threshold |');
  lines.push('| --- | --- | --- | --- |');
  for (const g of result.gates) {
    lines.push(
      `| ${g.pass ? 'ok' : g.kind === 'hard' ? 'FAIL' : 'warn'} | ${g.name} | ${g.value ?? 'n/a'} | ${g.threshold} (${g.kind}) |`,
    );
  }
  const failing = result.runs.filter((r) => !r.pass);
  lines.push('');
  lines.push(`## Failing runs (${failing.length})`);
  for (const r of failing) {
    const checks = (r.grade?.checks ?? [])
      .filter((c) => !c.pass)
      .map((c) => `- **${c.name}**: ${c.detail}`);
    lines.push('');
    lines.push(`### ${r.id} (run ${r.repeat})`);
    lines.push(...(checks.length ? checks : ['- run error: ' + (r.error ?? 'unknown')]));
  }
  if (result.regressions.length) {
    lines.push('');
    lines.push('## Regressions vs baseline');
    for (const r of result.regressions)
      lines.push(`- ${r.metric}: ${pct(r.baseline)} → ${pct(r.current)}`);
  }
  return lines.join('\n') + '\n';
}
