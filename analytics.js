// analytics.js — Analytics tab

import { getAllLogs, getLogsForTemplate } from './db.js';

const { ref, computed, watch, onMounted, onUnmounted, nextTick } = Vue;

function fmtDate(d) {
  const dt = new Date(d);
  return dt.toLocaleDateString('en-GB', { day:'2-digit', month:'short' });
}

function avgRpe(sets) {
  const v = sets.filter(s => !s.skipped && s.rpe != null).map(s => s.rpe);
  return v.length ? (v.reduce((a,b)=>a+b,0)/v.length) : null;
}

const CHART_DEFS = [
  { key:'volume',   label:'Volume',      type:'line' },
  { key:'maxWeight',label:'Max weight',  type:'line' },
  { key:'reps',     label:'Reps',        type:'line' },
  { key:'rpe',      label:'Avg RPE',     type:'line' },
  { key:'setTime',  label:'Set time',    type:'line' },
  { key:'restTime', label:'Rest time',   type:'line' },
  { key:'wVsRest',  label:'W vs Rest',   type:'scatter' },
  { key:'wVsOrder', label:'W vs Order',  type:'scatter' },
];

export const AnalyticsView = {
  setup() {
    const allLogs      = ref([]);
    const exercises    = ref([]);   // { id, name } distinct list
    const selExId      = ref(null);
    const chartTab     = ref('volume');
    let chartInst      = null;
    const expandedLog  = ref(null);
    const loading      = ref(true);

    async function load() {
      loading.value = true;
      allLogs.value = await getAllLogs();
      // Build exercise list from all logs
      const map = new Map();
      for (const log of allLogs.value) {
        for (const el of (log.exerciseLogs || [])) {
          map.set(el.exerciseId, el.exerciseName);
        }
      }
      exercises.value = [...map.entries()].map(([id, name]) => ({ id, name }));
      if (exercises.value.length) selExId.value = exercises.value[0].id;
      loading.value = false;
    }

    onMounted(load);

    onUnmounted(() => {
      if (chartInst) { chartInst.destroy(); chartInst = null; }
      for (const key in sessionChartInsts) {
        if (sessionChartInsts[key]) { sessionChartInsts[key].destroy(); sessionChartInsts[key] = null; }
      }
    });

    // ── Compute per-exercise data ──────────────────────────────────────────────
    const exData = computed(() => {
      if (!selExId.value) return [];
      const result = [];
      for (const log of [...allLogs.value].reverse()) {
        const el = (log.exerciseLogs || []).find(e => e.exerciseId === selExId.value);
        if (!el) continue;
        const mainSets = (el.sets || []).filter(s => !s.skipped);
        if (!mainSets.length) continue;
        result.push({ date: new Date(log.startedAt), log, el, sets: mainSets });
      }
      return result;
    });

    // ── Build chart data ───────────────────────────────────────────────────────
    const chartData = computed(() => {
      const d = exData.value;
      if (!d.length) return null;
      const labels = d.map(x => fmtDate(x.date));

      if (chartTab.value === 'volume') {
        return { labels, datasets:[{ label:'Volume (kg×reps)', data: d.map(x => x.sets.reduce((a,s)=>a+(s.weight||0)*(s.reps||0),0)), borderColor:'#7D9B76', backgroundColor:'rgba(125,155,118,0.15)', tension:0.3, fill:true }] };
      }
      if (chartTab.value === 'maxWeight') {
        return { labels, datasets:[{ label:'Max weight (kg)', data: d.map(x => Math.max(...x.sets.map(s=>s.weight||0))), borderColor:'#A89070', backgroundColor:'rgba(168,144,112,0.15)', tension:0.3, fill:true }] };
      }
      if (chartTab.value === 'reps') {
        return { labels, datasets:[{ label:'Total reps', data: d.map(x => x.sets.reduce((a,s)=>a+(s.reps||0),0)), borderColor:'#6A9BC5', backgroundColor:'rgba(106,155,197,0.15)', tension:0.3, fill:true }] };
      }
      if (chartTab.value === 'rpe') {
        return { labels, datasets:[{ label:'Avg RPE', data: d.map(x => avgRpe(x.sets)), borderColor:'#C07A6A', backgroundColor:'rgba(192,122,106,0.15)', tension:0.3, fill:true }] };
      }
      if (chartTab.value === 'setTime') {
        return { labels, datasets:[{ label:'Avg set time (s)', data: d.map(x => { const v=x.sets.filter(s=>s.setDurationMs).map(s=>s.setDurationMs/1000); return v.length?(v.reduce((a,b)=>a+b,0)/v.length).toFixed(1):null; }), borderColor:'#9B7DC0', backgroundColor:'rgba(155,125,192,0.15)', tension:0.3, fill:true }] };
      }
      if (chartTab.value === 'restTime') {
        return { labels, datasets:[{ label:'Avg rest time (s)', data: d.map(x => { const v=x.sets.filter(s=>s.restDurationMs).map(s=>s.restDurationMs/1000); return v.length?(v.reduce((a,b)=>a+b,0)/v.length).toFixed(1):null; }), borderColor:'#B8A04A', backgroundColor:'rgba(184,160,74,0.15)', tension:0.3, fill:true }] };
      }
      if (chartTab.value === 'wVsRest') {
        const pts = d.flatMap(x => x.sets.filter(s=>s.weight&&s.restDurationMs).map(s=>({ x: s.restDurationMs/1000, y: s.weight })));
        return { datasets:[{ label:'Weight vs Rest', data: pts, backgroundColor:'rgba(125,155,118,0.6)' }] };
      }
      if (chartTab.value === 'wVsOrder') {
        const pts = d.flatMap((x,i)=>x.sets.map(s=>({ x:i+1, y:s.weight||0 })));
        return { datasets:[{ label:'Weight vs Session order', data: pts, backgroundColor:'rgba(168,144,112,0.6)' }] };
      }
      return null;
    });

    // ── Render chart ───────────────────────────────────────────────────────────
    function renderChart() {
      nextTick(() => {
        const canvas = document.getElementById('ex-chart');
        if (!canvas || !chartData.value) return;
        if (chartInst) { chartInst.destroy(); chartInst = null; }
        const isScatter = ['wVsRest','wVsOrder'].includes(chartTab.value);
        chartInst = new Chart(canvas, {
          type: isScatter ? 'scatter' : 'line',
          data: chartData.value,
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend:{ display:false }, tooltip:{ backgroundColor:'#2C2A27', titleColor:'#FAF9F6', bodyColor:'#FAF9F6' } },
            scales: {
              x: { grid:{ display:false }, ticks:{ color:'#B5B0AA', font:{size:11} } },
              y: { grid:{ color:'#F0EDE8' }, ticks:{ color:'#B5B0AA', font:{size:11} } }
            },
            elements: { point:{ radius:4, hoverRadius:7 } }
          }
        });
      });
    }

    watch([chartTab, selExId], renderChart);
    watch(loading, v => { if (!v) nextTick(renderChart); });

    // ── Session-level charts ───────────────────────────────────────────────────
    let sessionChartInsts = {};
    function renderSessionCharts() {
      nextTick(() => {
        const logs = [...allLogs.value].reverse();
        const labels = logs.map(l => fmtDate(l.startedAt));

        const configs = [
          { id:'s-duration', label:'Duration (min)', data: logs.map(l=>l.totalDuration||0), color:'#7D9B76' },
          { id:'s-physical', label:'Physical score', data: logs.map(l => {
            const e = l.evaluation;
            if (!e) return null;
            const vals = [e.energyLevel, e.overallMuscleSoreness, e.jointComfort, e.bodyRecovery, e.preWorkoutNutrition].filter(v=>v!=null);
            return vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1) : null;
          }), color:'#A89070' },
          { id:'s-mental', label:'Mental score', data: logs.map(l => {
            const e = l.evaluation;
            if (!e) return null;
            const vals = [e.mentalFocus, e.overallSessionRpe, e.sessionEnjoyment, e.preWorkoutStress!=null?10-e.preWorkoutStress:null, e.sleepQuality].filter(v=>v!=null);
            return vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1) : null;
          }), color:'#9B7DC0' },
        ];

        for (const cfg of configs) {
          const canvas = document.getElementById(cfg.id);
          if (!canvas) continue;
          if (sessionChartInsts[cfg.id]) sessionChartInsts[cfg.id].destroy();
          sessionChartInsts[cfg.id] = new Chart(canvas, {
            type: 'line',
            data: { labels, datasets:[{ label:cfg.label, data:cfg.data, borderColor:cfg.color, backgroundColor:cfg.color+'26', tension:0.3, fill:true }] },
            options: {
              responsive:true, maintainAspectRatio:false,
              plugins:{ legend:{display:false}, tooltip:{backgroundColor:'#2C2A27',titleColor:'#FAF9F6',bodyColor:'#FAF9F6'} },
              scales:{ x:{grid:{display:false},ticks:{color:'#B5B0AA',font:{size:11}}}, y:{grid:{color:'#F0EDE8'},ticks:{color:'#B5B0AA',font:{size:11}}} },
              elements:{ point:{radius:4,hoverRadius:7} }
            }
          });
        }
      });
    }
    watch(loading, v => { if (!v) renderSessionCharts(); });

    const hasEnough = computed(() => allLogs.value.length >= 2);

    return { loading, hasEnough, exercises, selExId, chartTab, allLogs, expandedLog, CHART_DEFS, renderChart };
  },
  template: `
    <div class="main-content">
      <div v-if="loading" style="text-align:center; padding:60px 0; color:var(--text-muted);">Loading…</div>

      <div v-else-if="!hasEnough" style="text-align:center; padding:60px 0;">
        <div style="font-size:40px; margin-bottom:16px;">📈</div>
        <p style="font-size:18px; font-weight:600; color:var(--text-secondary);">Complete more sessions to see trends</p>
        <p class="text-sm text-muted mt-2">You need at least 2 sessions.</p>
      </div>

      <div v-else>
        <!-- Exercise selector -->
        <div class="mb-4">
          <label class="text-xs text-secondary" style="font-weight:600; letter-spacing:1px; text-transform:uppercase;">Exercise</label>
          <select class="input mt-1" v-model="selExId" @change="renderChart">
            <option v-for="ex in exercises" :key="ex.id" :value="ex.id">{{ ex.name }}</option>
          </select>
        </div>

        <!-- Chart tabs -->
        <div class="chart-tabs mb-3">
          <button v-for="c in CHART_DEFS" :key="c.key"
            :class="['chart-tab', chartTab===c.key ? 'active' : '']"
            @click="chartTab=c.key">{{ c.label }}</button>
        </div>

        <div class="card mb-4" style="padding:16px;">
          <div style="height:250px; position:relative;">
            <canvas id="ex-chart"></canvas>
          </div>
        </div>

        <!-- Session charts -->
        <p class="section-title">Session trends</p>
        <div v-for="sid in ['s-duration','s-physical','s-mental']" :key="sid" class="card mb-3" style="padding:16px;">
          <p class="text-sm text-secondary mb-2" style="font-weight:600;">
            {{ sid==='s-duration'?'Duration (min)':sid==='s-physical'?'Physical score':'Mental score' }}
          </p>
          <div style="height:200px; position:relative;"><canvas :id="sid"></canvas></div>
        </div>

        <!-- Log browser -->
        <p class="section-title mt-4">Session log</p>
        <div v-for="log in allLogs" :key="log.id" class="log-item">
          <div class="log-header" @click="expandedLog = expandedLog===log.id ? null : log.id">
            <div>
              <p class="log-date">{{ new Date(log.startedAt).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) }}</p>
              <p class="log-meta">{{ log.totalDuration ? log.totalDuration + ' min' : '' }} · {{ (log.exerciseLogs||[]).length }} exercises</p>
            </div>
            <span style="color:var(--text-muted); font-size:18px;">{{ expandedLog===log.id ? '▲' : '▼' }}</span>
          </div>
          <div v-if="expandedLog===log.id" class="log-body">
            <div v-for="el in (log.exerciseLogs||[])" :key="el.exerciseId" style="padding:10px 0; border-bottom:1px solid var(--border);">
              <div class="flex items-center gap-2 mb-1">
                <span style="font-weight:600; font-size:15px;">{{ el.exerciseName }}</span>
              </div>
              <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">
                <span v-for="s in (el.sets||[])" :key="s.setNumber"
                  :style="{background: s.skipped?'var(--bg-card-alt)':'var(--bg-card)', border:'1px solid var(--border)', borderRadius:'8px', padding:'6px 10px', fontSize:'13px', color: s.skipped?'var(--text-muted)':'var(--text-primary)'}">
                  {{ s.skipped ? ('Set ' + s.setNumber + ' \u2013 skipped') : ('Set ' + s.setNumber + ': ' + s.weight + 'kg \xd7 ' + s.reps + ' @ RPE' + s.rpe) }}
                </span>
              </div>
              <p v-if="el.note" class="text-xs text-secondary mt-1" style="font-style:italic;">"{{ el.note }}"</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
};
