// analytics.js — Analytics tab: Overview · Exercises · History

import { db, getAllLogs } from './db.js';

const { ref, computed, watch, onMounted, onUnmounted, nextTick } = Vue;

// ── Formatting ────────────────────────────────────────────────────────────────
const DAY_MS = 864e5;

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}
function fmtLongDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtNum(v, decimals = 0) {
  if (v == null || Number.isNaN(v)) return '–';
  return Number(v).toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtMs(ms) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
const fmtKg = w => w == null ? '–' : Number(w).toLocaleString('en-GB', { maximumFractionDigits: 2 });
const fmtSet = s => `${fmtKg(s.weight)} kg × ${s.reps} @ RPE ${s.rpe}`;
const mean = arr => {
  const v = arr.filter(x => x != null && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const sum = arr => arr.reduce((a, b) => a + (b || 0), 0);

// ── Data hygiene ──────────────────────────────────────────────────────────────
// Sessions logged before the idle-gap fix could record days of wall-clock time.
// Anything beyond these limits is not real training time.
const MAX_SESSION_MIN = 4 * 60;
const MAX_SET_MS      = 10 * 60 * 1000;
const MAX_REST_MS     = 15 * 60 * 1000;

const validSetMs  = ms => ms > 0 && ms <= MAX_SET_MS;
const validRestMs = ms => ms > 0 && ms <= MAX_REST_MS;

// Trust the recorded duration when plausible, otherwise rebuild it from set timings
function sessionMinutes(log) {
  const d = log.totalDuration;
  if (d != null && d >= 0 && d <= MAX_SESSION_MIN) return d;
  let ms = validRestMs(log.warmupMs) ? log.warmupMs : 0;
  for (const el of (log.exerciseLogs || [])) {
    for (const s of (el.sets || [])) {
      if (validSetMs(s.setDurationMs)) ms += s.setDurationMs;
      if (validRestMs(s.restDurationMs)) ms += s.restDurationMs;
    }
  }
  return ms ? Math.round(ms / 60000) : null;
}

const workSets = el => (el.sets || []).filter(s => !s.skipped);
const setVolume = s => (s.weight || 0) * (s.reps || 0);
// Epley estimate; above ~12 reps it stops meaning much
const e1rm = s => (s.reps > 0 && s.reps <= 12 && s.weight > 0) ? s.weight * (1 + s.reps / 30) : null;

// Evaluation composites (0–10)
function readinessScore(e) {
  if (!e) return null;
  return mean([e.energyLevel, e.overallMuscleSoreness, e.jointComfort, e.bodyRecovery, e.preWorkoutNutrition]);
}
function mentalScore(e) {
  if (!e) return null;
  return mean([e.mentalFocus, e.overallSessionRpe, e.sessionEnjoyment,
    e.preWorkoutStress != null ? 10 - e.preWorkoutStress : null, e.sleepQuality]);
}

// One derived record per logged session
function summarize(log, nameById) {
  // Exercises the user touched (incl. skipped sets); untouched ones are noise
  const exercises = (log.exerciseLogs || [])
    .filter(el => (el.sets || []).length)
    .map(el => ({ ...el, work: workSets(el) }));
  const performed = exercises.filter(el => el.work.length);
  const all = performed.flatMap(el => el.work);
  const ev = log.evaluation || {};
  return {
    id: log.id,
    date: new Date(log.startedAt),
    name: log.sessionName || nameById.get(log.templateId) || 'Session',
    exercises,
    performedCount: performed.length,
    sets: all.length,
    reps: sum(all.map(s => s.reps)),
    volume: sum(all.map(setVolume)),
    avgRpe: mean(all.map(s => s.rpe)),
    minutes: sessionMinutes(log),
    warmupMin: validRestMs(log.warmupMs) ? Math.max(1, Math.round(log.warmupMs / 60000)) : null,
    ev,
    readiness: readinessScore(ev),
    mental: mentalScore(ev),
    empty: all.length === 0,
  };
}

// ── Chart styling ─────────────────────────────────────────────────────────────
const FONT = 'Inter, system-ui, sans-serif';
const TOOLTIP = {
  backgroundColor: 'rgba(44,42,39,0.96)',
  titleColor: '#FAF9F6',
  bodyColor: '#F3F1EC',
  footerColor: '#B5B0AA',
  titleFont: { size: 12, weight: '500', family: FONT },
  bodyFont: { size: 15, weight: '700', family: FONT },
  footerFont: { size: 12, weight: '400', family: FONT },
  padding: 12,
  cornerRadius: 10,
  caretPadding: 10,
  displayColors: false,
  titleMarginBottom: 6,
  footerMarginTop: 8,
  footerSpacing: 3,
};

// Dashed guide under the hovered point so it's clear which session is read out
const hoverLine = {
  id: 'hoverLine',
  afterDatasetsDraw(chart) {
    const active = chart.tooltip?.getActiveElements?.();
    if (!active?.length) return;
    const { ctx, chartArea: { top, bottom } } = chart;
    const x = active[0].element.x;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(44,42,39,0.25)';
    ctx.stroke();
    ctx.restore();
  }
};

// Breaks longer than this are drawn dashed and labelled on date-axis charts
const GAP_DAYS = 21;

// Calendar-aligned ticks (days, weeks or month starts) for a ms range
function dateTicks(min, max) {
  const span = (max - min) / DAY_MS;
  const out = [];
  if (span > 75) {
    const step = span > 400 ? 3 : span > 240 ? 2 : 1;
    const d = new Date(min); d.setDate(1); d.setHours(0, 0, 0, 0);
    for (d.setMonth(d.getMonth() + 1); d.getTime() <= max; d.setMonth(d.getMonth() + step)) out.push(d.getTime());
  } else {
    const step = span > 35 ? 14 : span > 12 ? 7 : span > 5 ? 2 : 1;
    const d = new Date(min); d.setHours(0, 0, 0, 0);
    if (step >= 7) while (d.getDay() !== 1) d.setDate(d.getDate() + 1);  // Mondays
    else d.setDate(d.getDate() + 1);
    for (; d.getTime() <= max; d.setDate(d.getDate() + step)) out.push(d.getTime());
  }
  return out;
}
const fmtTick = (ms, span) => span > 75
  ? new Date(ms).toLocaleDateString('en-GB', { month: 'short' })
  : fmtDate(ms);

function axes({ yUnit = '', decimals = 0, xTitle, yTitle, xLinear = false, xDates = null }) {
  const tick = { color: '#B5B0AA', font: { size: 11, family: FONT } };
  const title = text => text ? { display: true, text, color: '#7A7570', font: { size: 11, weight: '600', family: FONT } } : undefined;
  return {
    x: {
      type: xLinear ? 'linear' : 'category',
      grid: { display: xLinear, color: '#F0EDE8' },
      border: { display: false },
      ticks: { ...tick, maxRotation: 0, autoSkipPadding: 14 },
      title: title(xTitle),
      ...(xDates && dateAxis(xDates)),
    },
    y: {
      grid: { color: '#F0EDE8' },
      border: { display: false },
      ticks: { ...tick, maxTicksLimit: 5, callback: v => fmtNum(v, decimals) + (yUnit ? ' ' + yUnit : '') },
      title: title(yTitle),
    },
  };
}

// Linear x axis over timestamps, so time between sessions is to scale
function dateAxis(xs) {
  const lo = Math.min(...xs), hi = Math.max(...xs);
  const pad = Math.max((hi - lo) * 0.03, 1.5 * DAY_MS);
  const min = lo - pad, max = hi + pad, span = (max - min) / DAY_MS;
  return {
    type: 'linear', min, max,
    grid: { display: false },
    afterBuildTicks: axis => { axis.ticks = dateTicks(min, max).map(value => ({ value })); },
    ticks: { color: '#B5B0AA', font: { size: 11, family: FONT }, maxRotation: 0, autoSkip: false,
             callback: v => fmtTick(v, span) },
  };
}

const compact = lines => (lines || []).filter(Boolean);

// Line chart over a list of "points" (session summaries or exercise entries).
// Tooltip callbacks read the full point, so they show context beyond the value.
function lineConfig({ points, metric, gaps = true }) {
  const color = metric.color;
  const unit = metric.unit ? ' ' + metric.unit : '';
  const xs = points.map(p => new Date(p.date).getTime());
  // Breaks only mean something between individual sessions, not fixed buckets
  const longGap = c => gaps && c.p1.parsed.x - c.p0.parsed.x > GAP_DAYS * DAY_MS;
  return {
    type: 'line',
    data: {
      datasets: [{
        data: points.map((p, i) => { const v = metric.value(p); return { x: xs[i], y: v == null ? null : +v }; }),
        segment: {
          borderDash: c => longGap(c) ? [5, 5] : undefined,
          borderColor: c => longGap(c) ? color + '80' : undefined,
          backgroundColor: c => longGap(c) ? color + '0A' : undefined,
        },
        borderColor: color,
        backgroundColor: color + '1F',
        borderWidth: 2.5,
        tension: 0.3,
        cubicInterpolationMode: 'monotone',  // no overshoot past real values
        fill: true,
        spanGaps: true,
        pointRadius: 4,
        pointHoverRadius: 7,
        pointHitRadius: 14,
        pointBackgroundColor: color,
        pointBorderColor: '#fff',
        pointBorderWidth: 1.5,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...TOOLTIP,
          callbacks: {
            title: items => metric.title(points[items[0].dataIndex]),
            label: item => `${metric.label}: ${fmtNum(item.parsed.y, metric.decimals || 0)}${unit}`,
            footer: items => {
              const i = items[0].dataIndex;
              const gap = gaps && i > 0 ? Math.round((xs[i] - xs[i - 1]) / DAY_MS) : 0;
              return compact([
                ...(metric.footer?.(points[i]) || []),
                gap > GAP_DAYS && `After a ${gap}-day break`,
              ]);
            },
          }
        }
      },
      scales: axes({ yUnit: metric.unit, decimals: metric.decimals || 0, xDates: xs }),
    },
    plugins: [hoverLine],
  };
}

function scatterConfig({ pts, color, xTitle, yTitle, label, footer }) {
  return {
    type: 'scatter',
    data: { datasets: [{ data: pts, backgroundColor: color + 'B3', pointRadius: 5, pointHoverRadius: 8, pointHitRadius: 10 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      interaction: { mode: 'nearest', intersect: true },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...TOOLTIP,
          callbacks: {
            title: () => '',
            label: item => label(item.raw),
            footer: items => compact(footer(items[0].raw)),
          }
        }
      },
      scales: axes({ xTitle, yTitle, xLinear: true, yUnit: 'kg' }),
    }
  };
}

// ── Metric definitions ────────────────────────────────────────────────────────
const outOf10 = v => v != null ? `${fmtNum(v, Number.isInteger(v) ? 0 : 1)}/10` : '–';

// ── Grouping by day / week / month ──────────────────────────────────────────
const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const startOfWeek = d => { const x = startOfDay(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };  // Monday
const startOfMonth = d => { const x = startOfDay(d); x.setDate(1); return x; };

const GROUPINGS = [
  { key: 'day', label: 'Day', start: startOfDay, minSpanDays: 0,
    next: d => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1),
    title: g => g.count === 1 ? `${g.sessions[0].name} · ${fmtLongDate(g.date)}` : `${g.count} sessions · ${fmtLongDate(g.date)}` },
  { key: 'week', label: 'Week', start: startOfWeek, minSpanDays: 14,
    next: d => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7),
    title: g => `Week of ${fmtLongDate(g.date)}` },
  { key: 'month', label: 'Month', start: startOfMonth, minSpanDays: 60,
    next: d => new Date(d.getFullYear(), d.getMonth() + 1, 1),
    title: g => g.date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) },
];

const EV_KEYS = ['overallSessionRpe', 'sessionEnjoyment', 'energyLevel', 'bodyRecovery', 'overallMuscleSoreness',
  'jointComfort', 'preWorkoutNutrition', 'mentalFocus', 'preWorkoutStress', 'sleepQuality', 'sleepTime'];

// One summary-shaped record per bucket: totals add up, survey scores average.
// Week/month buckets with no training stay in as zero points so breaks show.
function groupSessions(list, grouping) {
  if (!list.length) return [];
  const byKey = new Map();
  for (const s of list) {
    const k = grouping.start(s.date).getTime();
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(s);
  }
  const keys = [];
  if (grouping.key === 'day') keys.push(...byKey.keys());
  else {
    // Fill empty past buckets; the current one only counts once it has training
    const current = grouping.start(new Date()).getTime();
    for (let d = grouping.start(list[0].date); d.getTime() <= current; d = grouping.next(d)) {
      if (d.getTime() < current || byKey.has(d.getTime())) keys.push(d.getTime());
    }
  }
  const currentKey = grouping.start(new Date()).getTime();

  return keys.map(k => {
    const ss = byKey.get(k) || [];
    const minutes = ss.map(x => x.minutes).filter(Boolean);
    const warm = ss.map(x => x.warmupMin).filter(v => v != null);
    const g = {
      date: new Date(k), sessions: ss, count: ss.length,
      performedCount: new Set(ss.flatMap(x => x.exercises.filter(e => e.work.length).map(e => e.exerciseId))).size,
      sets: sum(ss.map(x => x.sets)),
      reps: sum(ss.map(x => x.reps)),
      volume: sum(ss.map(x => x.volume)),
      avgRpe: mean(ss.flatMap(x => x.exercises.flatMap(e => e.work.map(w => w.rpe)))),
      minutes: minutes.length ? sum(minutes) : (ss.length ? null : 0),
      warmupMin: warm.length ? Math.round(mean(warm)) : null,
      ev: Object.fromEntries(EV_KEYS.map(key => [key, mean(ss.map(x => x.ev[key]))])),
      readiness: mean(ss.map(x => x.readiness)),
      mental: mean(ss.map(x => x.mental)),
    };
    g.title = grouping.title(g) + (grouping.key !== 'day' && k === currentKey ? ' · so far' : '');
    return g;
  });
}

const groupTitle = g => g.title;
// "3 sessions" / "No training" for buckets that aren't a single session
const countLine = g => g.count === 0 ? 'No training' : g.count > 1 ? `${g.count} sessions` : null;
const ifTrained = (g, lines) => g.count ? lines : [];

const OVERVIEW_METRICS = [
  { key: 'volume', label: 'Volume', unit: 'kg', color: '#7D9B76', value: g => g.volume, title: groupTitle,
    footer: g => [countLine(g), ...ifTrained(g, [`${g.sets} working sets · ${fmtNum(g.reps)} reps`, `${g.performedCount} exercises`])] },
  { key: 'sets', label: 'Working sets', color: '#6A9BC5', value: g => g.sets, title: groupTitle,
    footer: g => [countLine(g), ...ifTrained(g, [`${fmtNum(g.volume)} kg volume`, g.avgRpe != null && `Avg set RPE ${fmtNum(g.avgRpe, 1)}`])] },
  { key: 'duration', label: 'Duration', unit: 'min', color: '#A89070', value: g => g.minutes, title: groupTitle,
    footer: g => [countLine(g), ...ifTrained(g, [g.warmupMin != null && `Warm-up ${g.warmupMin} min${g.count > 1 ? ' avg' : ''}`, g.minutes && `Density ${fmtNum(g.volume / g.minutes)} kg/min`])] },
  { key: 'rpe', label: 'Session RPE', decimals: 1, color: '#C07A6A', value: g => g.ev.overallSessionRpe, title: groupTitle,
    footer: g => [countLine(g), g.avgRpe != null && `Avg set RPE ${fmtNum(g.avgRpe, 1)}`, g.ev.sessionEnjoyment != null && `Enjoyment ${outOf10(g.ev.sessionEnjoyment)}`] },
  { key: 'readiness', label: 'Readiness', decimals: 1, color: '#9B7DC0', value: g => g.readiness, title: groupTitle,
    footer: g => [countLine(g), ...ifTrained(g, [
      `Energy ${outOf10(g.ev.energyLevel)} · Recovery ${outOf10(g.ev.bodyRecovery)}`,
      `Soreness ${outOf10(g.ev.overallMuscleSoreness)} · Joints ${outOf10(g.ev.jointComfort)}`,
      `Nutrition ${outOf10(g.ev.preWorkoutNutrition)}`])] },
  { key: 'mental', label: 'Mental', decimals: 1, color: '#B8A04A', value: g => g.mental, title: groupTitle,
    footer: g => [countLine(g), ...ifTrained(g, [
      `Focus ${outOf10(g.ev.mentalFocus)} · Enjoyment ${outOf10(g.ev.sessionEnjoyment)}`,
      `Stress ${outOf10(g.ev.preWorkoutStress)} · Sleep quality ${outOf10(g.ev.sleepQuality)}`])] },
  { key: 'sleep', label: 'Sleep', unit: 'h', decimals: 1, color: '#5E8C9B', value: g => g.ev.sleepTime, title: groupTitle,
    footer: g => [countLine(g), g.ev.sleepQuality != null && `Quality ${outOf10(g.ev.sleepQuality)}`] },
];

const exTitle = p => `${p.session} · ${fmtLongDate(p.date)}`;
const exFooter = p => p.sets.map((s, i) => `Set ${i + 1}  ${fmtSet(s)}`);
const avgOf = (p, f) => mean(p.sets.map(f));

const EXERCISE_METRICS = [
  { key: 'volume', label: 'Volume', unit: 'kg', color: '#7D9B76', value: p => sum(p.sets.map(setVolume)), title: exTitle, footer: exFooter },
  { key: 'e1rm', label: 'Est. 1RM', unit: 'kg', decimals: 1, color: '#5C7A54', value: p => { const v = p.sets.map(e1rm).filter(Boolean); return v.length ? Math.max(...v) : null; }, title: exTitle, footer: exFooter },
  { key: 'maxWeight', label: 'Top weight', unit: 'kg', decimals: 1, color: '#A89070', value: p => Math.max(...p.sets.map(s => s.weight || 0)), title: exTitle, footer: exFooter },
  { key: 'reps', label: 'Total reps', color: '#6A9BC5', value: p => sum(p.sets.map(s => s.reps)), title: exTitle, footer: exFooter },
  { key: 'rpe', label: 'Avg RPE', decimals: 1, color: '#C07A6A', value: p => avgOf(p, s => s.rpe), title: exTitle, footer: exFooter },
  { key: 'setTime', label: 'Avg set time', unit: 's', color: '#9B7DC0', value: p => avgOf(p, s => validSetMs(s.setDurationMs) ? s.setDurationMs / 1000 : null), title: exTitle, footer: exFooter },
  { key: 'restTime', label: 'Avg rest', unit: 's', color: '#B8A04A', value: p => avgOf(p, s => validRestMs(s.restDurationMs) ? s.restDurationMs / 1000 : null), title: exTitle, footer: exFooter },
  { key: 'wVsRest', label: 'Weight vs rest', scatter: true },
];

const SECTIONS = [
  { key: 'overview',  label: 'Overview' },
  { key: 'exercises', label: 'Exercises' },
  { key: 'history',   label: 'History' },
];
const SECTION_KEY = 'gymus_analytics_section';
const GROUP_KEY = 'gymus_analytics_group';

// ── View ──────────────────────────────────────────────────────────────────────
export const AnalyticsView = {
  setup() {
    const loading = ref(true);
    const sessions = ref([]);        // summaries, oldest → newest
    let initialSection = 'overview';
    try { initialSection = localStorage.getItem(SECTION_KEY) || 'overview'; } catch {}
    const section = ref(SECTIONS.some(s => s.key === initialSection) ? initialSection : 'overview');
    const overviewMetric = ref('volume');
    let initialGroup = 'day';
    try { initialGroup = localStorage.getItem(GROUP_KEY) || 'day'; } catch {}
    const groupBy = ref(initialGroup);
    const exMetric = ref('volume');
    const selExId = ref(null);
    const expanded = ref(null);

    watch(section, v => { try { localStorage.setItem(SECTION_KEY, v); } catch {} });
    watch(groupBy, v => { try { localStorage.setItem(GROUP_KEY, v); } catch {} });

    // Sessions with no working set (opened and ended) would distort every trend
    const trained = computed(() => sessions.value.filter(s => !s.empty));
    const history = computed(() => [...sessions.value].reverse());

    // ── Overview ─────────────────────────────────────────────────────────────
    const periodStats = computed(() => {
      const now = Date.now();
      const inRange = (from, to) => trained.value.filter(s => s.date >= now - from * DAY_MS && s.date < now - to * DAY_MS);
      const cur = inRange(30, 0), prev = inRange(60, 30);
      const delta = (a, b) => (a != null && b ? Math.round(((a - b) / b) * 100) : null);
      const avgDur = list => mean(list.map(s => s.minutes));
      const vol = list => sum(list.map(s => s.volume));
      const sets = list => sum(list.map(s => s.sets));
      return [
        { label: 'Sessions', value: fmtNum(cur.length), unit: '', sub: `${fmtNum(cur.length / (30 / 7), 1)} per week`, delta: delta(cur.length, prev.length), good: true },
        { label: 'Volume', value: fmtNum(vol(cur)), unit: 'kg', delta: delta(vol(cur), vol(prev)), good: true },
        { label: 'Working sets', value: fmtNum(sets(cur)), unit: '', delta: delta(sets(cur), sets(prev)), good: true },
        { label: 'Avg duration', value: fmtNum(avgDur(cur)), unit: 'min', delta: delta(avgDur(cur), avgDur(prev)), good: null },
      ];
    });

    const lastSession = computed(() => history.value.find(s => !s.empty) || null);

    // Week/Month only appear once the data spans enough time to compare
    const groupings = computed(() => {
      const t = trained.value;
      const span = t.length ? (t[t.length - 1].date - t[0].date) / DAY_MS : 0;
      return GROUPINGS.filter(g => span >= g.minSpanDays);
    });
    const activeGrouping = computed(() => groupings.value.find(g => g.key === groupBy.value) || GROUPINGS[0]);
    const overviewPoints = computed(() => groupSessions(trained.value, activeGrouping.value));

    function openInHistory(id) {
      expanded.value = id;
      section.value = 'history';
    }

    // ── Exercises ────────────────────────────────────────────────────────────
    // Only exercises with at least one working set; most recently trained first
    const exercises = computed(() => {
      const map = new Map();
      for (const s of history.value) {
        for (const el of s.exercises) if (el.work.length && !map.has(el.exerciseId)) map.set(el.exerciseId, el.exerciseName);
      }
      return [...map.entries()].map(([id, name]) => ({ id, name }));
    });

    const exPoints = computed(() => {
      if (!selExId.value) return [];
      const out = [];
      for (const s of sessions.value) {
        const el = s.exercises.find(e => e.exerciseId === selExId.value);
        if (el?.work.length) out.push({ date: s.date, session: s.name, sets: el.work });
      }
      return out;
    });

    const exStats = computed(() => {
      const all = exPoints.value.flatMap(p => p.sets.map(s => ({ ...s, date: p.date })));
      if (!all.length) return null;
      const best = all.reduce((a, s) => (e1rm(s) || 0) > (e1rm(a) || 0) ? s : a, all[0]);
      const heaviest = all.reduce((a, s) => (s.weight > a.weight || (s.weight === a.weight && s.reps > a.reps)) ? s : a, all[0]);
      return [
        { label: 'Est. 1RM', value: e1rm(best) ? fmtNum(e1rm(best), 1) : '–', unit: 'kg', sub: e1rm(best) ? `${fmtKg(best.weight)} × ${best.reps} · ${fmtDate(best.date)}` : '' },
        { label: 'Top set', value: fmtKg(heaviest.weight), unit: 'kg', sub: `× ${heaviest.reps} · ${fmtDate(heaviest.date)}` },
        { label: 'Sessions', value: fmtNum(exPoints.value.length), unit: '', sub: `since ${fmtDate(exPoints.value[0].date)}` },
      ];
    });

    async function load() {
      loading.value = true;
      const [logs, templates] = await Promise.all([getAllLogs(), db.sessionTemplates.toArray()]);
      const nameById = new Map(templates.map(t => [t.id, t.name]));
      sessions.value = logs.map(l => summarize(l, nameById)).reverse();
      selExId.value = exercises.value[0]?.id ?? null;
      loading.value = false;
    }

    // ── Charts ───────────────────────────────────────────────────────────────
    const charts = {};
    function destroyCharts() { for (const k of Object.keys(charts)) { charts[k].destroy(); delete charts[k]; } }
    function draw(id, config) {
      const canvas = document.getElementById(id);
      if (canvas) charts[id] = new Chart(canvas, config);
    }

    const overviewHasData = computed(() => overviewPoints.value.length >= 2);
    const exHasData = computed(() => exPoints.value.length >= 1);

    function render() {
      // Charts are rebuilt on every switch; the canvas they drew on may be gone
      destroyCharts();
      nextTick(() => {
        if (loading.value) return;
        if (section.value === 'overview' && overviewHasData.value) {
          const metric = OVERVIEW_METRICS.find(m => m.key === overviewMetric.value);
          draw('ov-chart', lineConfig({ points: overviewPoints.value, metric, gaps: activeGrouping.value.key === 'day' }));
        }
        if (section.value === 'exercises' && exHasData.value) {
          const metric = EXERCISE_METRICS.find(m => m.key === exMetric.value);
          if (metric.scatter) {
            const pts = exPoints.value.flatMap(p => p.sets
              .map((s, i) => ({ s, n: i + 1 }))
              .filter(({ s }) => s.weight && validRestMs(s.restDurationMs))
              .map(({ s, n }) => ({ x: Math.round(s.restDurationMs / 1000), y: s.weight, set: s, n, date: p.date, session: p.session })));
            draw('ex-chart', scatterConfig({
              pts, color: '#7D9B76', xTitle: 'Rest after set (s)', yTitle: 'Weight',
              label: r => `${fmtKg(r.y)} kg · rest ${fmtMs(r.x * 1000)}`,
              footer: r => [`Set ${r.n}  ${fmtSet(r.set)}`, `${r.session} · ${fmtLongDate(r.date)}`],
            }));
          } else {
            draw('ex-chart', lineConfig({ points: exPoints.value, metric }));
          }
        }
      });
    }

    watch([section, overviewMetric, activeGrouping, exMetric, selExId, loading], render);
    onMounted(load);
    onUnmounted(destroyCharts);

    function toggle(id) { expanded.value = expanded.value === id ? null : id; }

    return {
      loading, sessions, history, section, SECTIONS,
      periodStats, lastSession, openInHistory,
      OVERVIEW_METRICS, overviewMetric, overviewHasData, groupings, activeGrouping, groupBy,
      EXERCISE_METRICS, exMetric, exercises, selExId, exStats, exHasData,
      expanded, toggle, fmtNum, fmtLongDate, fmtDate,
    };
  },
  template: `
    <div class="main-content">
      <div v-if="loading" style="text-align:center; padding:60px 0; color:var(--text-muted);">Loading…</div>

      <div v-else-if="!sessions.length" style="text-align:center; padding:60px 0;">
        <div style="font-size:40px; margin-bottom:16px;">📈</div>
        <p style="font-size:18px; font-weight:600; color:var(--text-secondary);">No sessions yet</p>
        <p class="text-sm text-muted mt-2">Finish your first session to see your progress here.</p>
      </div>

      <template v-else>
        <!-- Section switcher -->
        <div class="seg" role="tablist">
          <button v-for="s in SECTIONS" :key="s.key" role="tab" :aria-selected="section===s.key"
            :class="['seg-btn', section===s.key ? 'active' : '']" @click="section=s.key">{{ s.label }}</button>
        </div>

        <!-- ── OVERVIEW ─────────────────────────────────────────────────── -->
        <div v-if="section==='overview'">
          <p class="stat-caption">Last 30 days</p>
          <div class="stat-grid">
            <div v-for="t in periodStats" :key="t.label" class="stat-tile">
              <p class="stat-label">{{ t.label }}</p>
              <p class="stat-value">{{ t.value }}<span v-if="t.unit" class="stat-unit">{{ t.unit }}</span></p>
              <p v-if="t.delta != null" :class="['stat-delta', t.good === null || t.delta === 0 ? '' : ((t.delta > 0) === t.good ? 'up' : 'down')]">
                {{ t.delta > 0 ? '▲' : t.delta < 0 ? '▼' : '' }} {{ Math.abs(t.delta) }}% vs the month before
              </p>
              <p v-else-if="t.sub" class="stat-delta">{{ t.sub }}</p>
            </div>
          </div>

          <div class="chart-tabs mb-3">
            <button v-for="m in OVERVIEW_METRICS" :key="m.key"
              :class="['chart-tab', overviewMetric===m.key ? 'active' : '']" @click="overviewMetric=m.key">{{ m.label }}</button>
          </div>
          <div class="card mb-4" style="padding:16px;">
            <div v-if="groupings.length > 1" class="seg seg--sm" role="tablist" aria-label="Group by">
              <button v-for="g in groupings" :key="g.key" role="tab" :aria-selected="activeGrouping.key===g.key"
                :class="['seg-btn', activeGrouping.key===g.key ? 'active' : '']" @click="groupBy=g.key">{{ g.label }}</button>
            </div>
            <div style="height:240px; position:relative;">
              <canvas v-if="overviewHasData" id="ov-chart"></canvas>
              <div v-else class="chart-empty">Log at least two sessions to see trends.</div>
            </div>
          </div>

          <div v-if="lastSession" class="log-item" style="margin-bottom:0;">
            <div class="log-header" @click="openInHistory(lastSession.id)">
              <div>
                <p class="stat-label" style="margin-bottom:4px;">Last session</p>
                <p class="log-date">{{ lastSession.name }} <span class="log-date-sub">· {{ fmtDate(lastSession.date) }}</span></p>
                <p class="log-meta">{{ lastSession.minutes ? lastSession.minutes + ' min · ' : '' }}{{ lastSession.sets }} sets · {{ fmtNum(lastSession.volume) }} kg</p>
              </div>
              <span class="text-sm" style="color:var(--accent-dark); font-weight:600; white-space:nowrap;">History →</span>
            </div>
          </div>
        </div>

        <!-- ── EXERCISES ────────────────────────────────────────────────── -->
        <div v-else-if="section==='exercises'">
          <p v-if="!exercises.length" class="text-sm text-muted" style="text-align:center; padding:40px 0;">No exercises with logged sets yet.</p>
          <template v-else>
            <select class="input mb-3" v-model="selExId" aria-label="Exercise">
              <option v-for="ex in exercises" :key="ex.id" :value="ex.id">{{ ex.name }}</option>
            </select>

            <div v-if="exStats" class="stat-grid stat-grid--3">
              <div v-for="t in exStats" :key="t.label" class="stat-tile">
                <p class="stat-label">{{ t.label }}</p>
                <p class="stat-value">{{ t.value }}<span v-if="t.unit" class="stat-unit">{{ t.unit }}</span></p>
                <p class="stat-delta">{{ t.sub }}</p>
              </div>
            </div>

            <div class="chart-tabs mb-3">
              <button v-for="m in EXERCISE_METRICS" :key="m.key"
                :class="['chart-tab', exMetric===m.key ? 'active' : '']" @click="exMetric=m.key">{{ m.label }}</button>
            </div>
            <div class="card" style="padding:16px;">
              <div style="height:260px; position:relative;">
                <canvas v-if="exHasData" id="ex-chart"></canvas>
                <div v-else class="chart-empty">No logged sets for this exercise.</div>
              </div>
            </div>
          </template>
        </div>

        <!-- ── HISTORY ──────────────────────────────────────────────────── -->
        <div v-else>
          <div v-for="s in history" :key="s.id" class="log-item">
            <div class="log-header" @click="toggle(s.id)">
              <div>
                <p class="log-date">{{ s.name }} <span class="log-date-sub">· {{ fmtLongDate(s.date) }}</span></p>
                <p v-if="s.empty" class="log-meta">No sets logged</p>
                <p v-else class="log-meta">
                  {{ s.minutes ? s.minutes + ' min · ' : '' }}{{ s.performedCount }} exercise{{ s.performedCount !== 1 ? 's' : '' }} · {{ s.sets }} sets · {{ fmtNum(s.volume) }} kg
                </p>
              </div>
              <span style="color:var(--text-muted); font-size:18px;">{{ expanded===s.id ? '▲' : '▼' }}</span>
            </div>
            <div v-if="expanded===s.id" class="log-body">
              <div class="history-facts">
                <span v-if="s.warmupMin != null">Warm-up {{ s.warmupMin }} min</span>
                <span v-if="s.ev.overallSessionRpe != null">Session RPE {{ s.ev.overallSessionRpe }}</span>
                <span v-if="s.readiness != null">Readiness {{ fmtNum(s.readiness, 1) }}</span>
                <span v-if="s.ev.sleepTime != null">Sleep {{ s.ev.sleepTime }} h</span>
              </div>
              <div v-for="el in s.exercises" :key="el.exerciseId" class="history-ex">
                <p style="font-weight:600; font-size:15px;">{{ el.exerciseName }}</p>
                <div class="set-rows">
                  <div v-for="(st, i) in el.sets" :key="i" :class="['set-row', st.skipped ? 'skipped' : '']">
                    <span class="set-row-num">{{ st.setNumber }}</span>
                    <span v-if="st.skipped" class="set-row-main">Skipped</span>
                    <template v-else>
                      <span class="set-row-main">{{ st.weight }} kg × {{ st.reps }}</span>
                      <span class="set-row-rpe">RPE {{ st.rpe }}</span>
                    </template>
                  </div>
                </div>
                <p v-if="el.note" class="text-xs text-secondary mt-2" style="font-style:italic;">“{{ el.note }}”</p>
              </div>
              <p v-if="!s.exercises.length" class="text-sm text-muted" style="padding-top:12px;">This session was ended before any set was logged.</p>
              <p v-if="s.ev.notes" class="text-sm text-secondary" style="padding-top:12px; font-style:italic;">“{{ s.ev.notes }}”</p>
            </div>
          </div>
        </div>
      </template>
    </div>
  `
};
