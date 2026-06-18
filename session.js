// session.js — Session tab (pre-session, active session, evaluation)

import {
  getAppState, patchAppState,
  getLogsForTemplate, getLastLogForTemplate,
  addSessionLog, putSessionLog
} from './db.js';
import { DrumPicker, SetIndicator, useStopwatch } from './components.js';

const { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } = Vue;

function genId() {
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
}

function fmt2(n) { return String(n).padStart(2, '0'); }
function fmtSecs(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${fmt2(m)}:${fmt2(sec)}` : `${fmt2(m)}:${fmt2(sec)}`;
}

// ── No Program View ───────────────────────────────────────────────────────────
export const NoProgramView = {
  emits: ['go-setup'],
  template: `
    <div class="main-content" style="display:flex; flex-direction:column; justify-content:center; min-height:60vh;">
      <div class="card" style="text-align:center; padding:40px 28px;">
        <div style="font-size:48px; margin-bottom:20px;">🏋️</div>
        <h2 style="font-size:26px; font-weight:800; letter-spacing:-0.5px; margin-bottom:8px;">Still on the couch?</h2>
        <p style="font-size:16px; color:var(--text-secondary); margin-bottom:28px;">
          You don't have a programme yet.<br>Set one up and get to work.
        </p>
        <button class="btn btn-primary" @click="$emit('go-setup')">Configure training →</button>
      </div>
    </div>
  `
};

// ── Pre-Session View ──────────────────────────────────────────────────────────
export const PreSessionView = {
  props: { tpl: Object, appState: Object },
  emits: ['start', 'skip'],
  setup(props) {
    const lastDate = ref(null);
    onMounted(async () => {
      if (!props.tpl?.id) return;   // guard: null template means DB is in bad state
      const last = await getLastLogForTemplate(props.tpl.id);
      lastDate.value = last ? new Date(last.startedAt) : null;
    });
    const lastDateStr = computed(() => {
      if (!lastDate.value) return 'First time';
      return lastDate.value.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    });
    return { lastDateStr };
  },
  template: `
    <div class="main-content" style="display:flex; flex-direction:column; justify-content:center; min-height:60vh;">
      <div class="card" style="padding:32px 24px; margin-bottom:16px;">
        <p class="text-xs text-secondary" style="font-weight:700; letter-spacing:1.5px; text-transform:uppercase; margin-bottom:8px;">
          Cycle {{ appState.currentCycleNumber }}
        </p>
        <h2 style="font-size:28px; font-weight:800; letter-spacing:-0.5px; line-height:1.2; margin-bottom:8px;">
          {{ tpl.name }}
        </h2>
        <p class="text-sm text-secondary" style="margin-bottom:24px;">
          Last performed: <strong>{{ lastDateStr }}</strong>
        </p>
        <div style="background:var(--bg-card-alt); border-radius:var(--radius-sm); padding:14px;">
          <p class="text-xs text-muted mb-2" style="font-weight:700; letter-spacing:1px; text-transform:uppercase;">Exercises</p>
          <div v-for="ex in tpl.exercises" :key="ex.id" class="flex items-center gap-2" style="padding:4px 0;">
            <span style="font-size:15px; font-weight:500;">{{ ex.name }}</span>
            <span class="text-xs text-muted">{{ ex.defaultSets }} sets</span>
          </div>
        </div>
      </div>
      <button class="btn btn-accent mb-3" style="font-size:18px; min-height:60px;" @click="$emit('start')">Let's do it</button>
      <button class="btn btn-ghost" @click="$emit('skip')">Skip session</button>
    </div>
  `
};

// ── Active Session ───────────────────────────────────────────────────────────
export const ActiveSessionView = {
  props: { tpl: Object, appState: Object },
  emits: ['session-done'],
  components: { DrumPicker, SetIndicator },
  setup(props, { emit }) {
    // ── Session-level state ────────────────────────────────────────────────────
    const phase = ref('break');     // 'break' | 'in-set' | 'data-entry' | 'eval'
    const dataCard = ref(0);           // 0=mass, 1=reps, 2=rpe
    const exIdx = ref(0);           // current exercise index
    const showExList = ref(false);

    // Timers
    const sessionSecs = ref(0);
    const phaseSecs = ref(0);
    let sessionTimer = null;
    let phaseTimer = null;
    let phaseStart = Date.now();
    let sessionStart = Date.now();

    // ── Resume or start fresh ──────────────────────────────────────────────────
    const sessionLog = ref(null);         // the in-progress log object
    const prevLog = ref(null);         // last completed log for this template

    // Per-exercise notes (ref map)
    const notes = ref({});           // exerciseId -> string

    // Drum values for current data-entry card
    const drumMass = ref(0);
    const drumReps = ref(8);
    const drumRpe = ref(7);

    // Previous set data for current exercise+set
    const prevSetData = ref(null);

    // Completed sets per exerciseId
    const completedSets = ref({});           // exerciseId -> [set objects]

    // ── Sorted exercises ───────────────────────────────────────────────────────
    const exercises = computed(() => {
      const exs = [...(props.tpl.exercises || [])];
      exs.sort((a, b) => a.order - b.order);
      return exs;
    });
    const curEx = computed(() => exercises.value[exIdx.value] || null);

    // sets for current exercise
    const curSets = computed(() => completedSets.value[curEx.value?.id] || []);
    const curSetNum = computed(() => curSets.value.length); // 0-based index of NEXT set

    // sets allowed for current exercise
    const totalSets = computed(() => {
      if (!curEx.value) return 1;
      return Math.max(curSetNum.value + 1, curEx.value.defaultSets || 3);
    });

    // ── Timer helpers ──────────────────────────────────────────────────────────
    function tickSession() { sessionSecs.value = Math.floor((Date.now() - sessionStart) / 1000); }
    function tickPhase() { phaseSecs.value = Math.floor((Date.now() - phaseStart) / 1000); }
    function resetPhase() { 
      phaseStart = Date.now(); 
      phaseSecs.value = 0; 
      localStorage.setItem('gymus_phase_start', phaseStart.toString());
    }

    function startTimers() {
      sessionTimer = setInterval(tickSession, 500);
      phaseTimer = setInterval(tickPhase, 500);
    }

    onUnmounted(() => { clearInterval(sessionTimer); clearInterval(phaseTimer); });

    // ── Prev data helpers ──────────────────────────────────────────────────────
    function getPrevSetForExercise(exerciseId, setIndex) {
      if (!prevLog.value) return null;
      const el = (prevLog.value.exerciseLogs || []).find(e => e.exerciseId === exerciseId);
      if (!el || !el.sets) return null;
      return el.sets[setIndex] || null;
    }

    function getPrevExLog(exerciseId) {
      if (!prevLog.value) return null;
      return (prevLog.value.exerciseLogs || []).find(e => e.exerciseId === exerciseId) || null;
    }

    function loadDrumDefaults(exerciseId, setIndex) {
      const prevSet = getPrevSetForExercise(exerciseId, setIndex);
      drumMass.value = prevSet?.weight ?? 0;
      drumReps.value = prevSet?.reps ?? 8;
      drumRpe.value = prevSet?.rpe ?? 7;
      prevSetData.value = prevSet;
    }

    // ── Mount: resume or new ───────────────────────────────────────────────────
    onMounted(async () => {
      prevLog.value = await getLastLogForTemplate(props.tpl.id);
      const aState = await getAppState();

      if (aState.activeSessionLog) {
        // Auto-resume
        sessionLog.value = aState.activeSessionLog;
        sessionStart = new Date(sessionLog.value.startedAt).getTime();
        // Reconstruct completedSets
        for (const el of (sessionLog.value.exerciseLogs || [])) {
          completedSets.value[el.exerciseId] = el.sets || [];
          notes.value[el.exerciseId] = el.note || '';
        }
        // Find first incomplete exercise
        const incomplete = exercises.value.findIndex(ex => {
          const done = (completedSets.value[ex.id] || []).length;
          return done < (ex.defaultSets || 3);
        });
        exIdx.value = incomplete >= 0 ? incomplete : 0;
        phase.value = 'break';
        const savedPhaseStart = localStorage.getItem('gymus_phase_start');
        if (savedPhaseStart) {
          phaseStart = parseInt(savedPhaseStart, 10) || Date.now();
        }
      } else {
        // New session
        sessionLog.value = {
          templateId: props.tpl.id,
          cycleNumber: props.appState.currentCycleNumber,
          sessionIndex: props.appState.currentSessionIndex,
          startedAt: new Date().toISOString(),
          endedAt: null,
          totalDuration: null,
          skipped: false,
          evaluation: {},
          exerciseLogs: []
        };
        await patchAppState({ activeSessionLog: sessionLog.value });
      }

      // Load note defaults from prev session
      for (const ex of exercises.value) {
        if (!notes.value[ex.id]) {
          const prevEl = getPrevExLog(ex.id);
          notes.value[ex.id] = prevEl?.note || '';
        }
      }

      await loadDrumDefaults(curEx.value?.id, curSetNum.value);
      startTimers();
    });

    // ── Persist after every set ────────────────────────────────────────────────
    // Strip Vue reactivity before IndexedDB writes (structured clone can't serialize Proxy)
    function plain(obj) { return JSON.parse(JSON.stringify(obj)); }

    async function persist() {
      // Rebuild exerciseLogs from completedSets
      const exerciseLogs = exercises.value.map((ex, i) => ({
        exerciseId: ex.id,
        exerciseName: ex.name,
        performedOrder: i,
        duration: null,
        note: notes.value[ex.id] || '',
        sets: plain(completedSets.value[ex.id] || [])
      }));
      sessionLog.value.exerciseLogs = exerciseLogs;
      await patchAppState({ activeSessionLog: plain(sessionLog.value) });
    }

    // ── Exercise navigation ────────────────────────────────────────────────────
    async function goToExercise(idx) {
      exIdx.value = idx;
      showExList.value = false;
      phase.value = 'break';
      resetPhase();
      // Use exercises.value[idx] directly — curEx computed may lag one tick
      const ex = exercises.value[idx];
      if (ex) await loadDrumDefaults(ex.id, (completedSets.value[ex.id] || []).length);
    }

    // ── Set controls ───────────────────────────────────────────────────────────
    function onReady() { phase.value = 'in-set'; resetPhase(); }

    function onDone() { phase.value = 'data-entry'; dataCard.value = 0; }

    async function onSkipSet() {
      const setNum = curSetNum.value + 1;
      const setObj = {
        setNumber: setNum, skipped: true, weight: 0, reps: 0, rpe: 0,
        setDurationMs: 0, restDurationMs: Math.round(phaseSecs.value * 1000)
      };
      if (!completedSets.value[curEx.value.id]) completedSets.value[curEx.value.id] = [];
      completedSets.value[curEx.value.id].push(setObj);
      await persist();

      if (curEx.value.type === 'main' && curSetNum.value < (curEx.value.defaultSets || 3)) {
        phase.value = 'break';
        resetPhase();
        await loadDrumDefaults(curEx.value.id, curSetNum.value);
      } else {
        phase.value = 'post-set';
      }
    }

    async function confirmDataCard() {
      if (dataCard.value === 0) { dataCard.value = 1; return; }
      if (dataCard.value === 1) { dataCard.value = 2; return; }
      // Card 2 (RPE) confirmed → save set
      if (dataCard.value === 2) {
        const setNum = curSetNum.value + 1;
        const exerciseId = curEx.value.id;
        const timeSecs = phaseSecs.value;
        const setObj = {
          setNumber: setNum,
          skipped: false,
          weight: drumMass.value,
          reps: drumReps.value,
          rpe: drumRpe.value,
          setDurationMs: Math.round(phaseSecs.value * 1000),
          restDurationMs: 0
        };
        if (!completedSets.value[exerciseId]) completedSets.value[exerciseId] = [];
        completedSets.value[exerciseId].push(setObj);

        await persist();

        if (curSetNum.value < (curEx.value.defaultSets || 3)) {
          phase.value = 'break';
          resetPhase();
          await loadDrumDefaults(exerciseId, curSetNum.value);
        } else {
          phase.value = 'post-set';
        }
      }
    }

    async function addMoreSet() {
      // User wants another set for this exercise beyond defaultSets
      phase.value = 'break';
      resetPhase();
      await loadDrumDefaults(curEx.value?.id, curSetNum.value);
    }

    async function nextExercise() {
      phase.value = 'break';
      resetPhase();
      // Move rest duration to last set
      const exId = curEx.value.id;
      const sets = completedSets.value[exId];
      if (sets?.length) sets[sets.length - 1].restDurationMs = Math.round(phaseSecs.value * 1000);

      if (exIdx.value < exercises.value.length - 1) {
        exIdx.value++;
        await loadDrumDefaults(curEx.value?.id, curSetNum.value);
      } else {
        // All exercises done
        askEndSession();
      }
    }



    // ── End session ────────────────────────────────────────────────────────────
    const showEndOverlay = ref(false);
    function askEndSession() { showEndOverlay.value = true; }

    // ── Evaluations ───────────────────────────────────────────────────────────
    const evalPhase = ref(false);
    const evalStep = ref(0);
    const evalSkipRow = ref(0);
    const showEndEvalOverlay = ref(false);
    const evalVal = ref(7);
    const evalNotes = ref('');

    const EVAL_FIELDS = [
      { key: 'energyLevel', label: 'Energy level', min: 0, max: 10, step: 1, default: 7 },
      { key: 'overallMuscleSoreness', label: 'Muscle soreness', min: 0, max: 10, step: 1, default: 7 },
      { key: 'jointComfort', label: 'Joint comfort', min: 0, max: 10, step: 1, default: 7 },
      { key: 'bodyRecovery', label: 'Body recovery', min: 0, max: 10, step: 1, default: 7 },
      { key: 'sleepTime', label: 'Sleep time (hours)', min: 0, max: 24, step: 0.5, default: 7 },
      { key: 'preWorkoutNutrition', label: 'Pre-workout nutrition', min: 0, max: 10, step: 1, default: 7 },
      { key: 'mentalFocus', label: 'Mental focus', min: 0, max: 10, step: 1, default: 7 },
      { key: 'overallSessionRpe', label: 'Overall session RPE', min: 0, max: 10, step: 1, default: 8 },
      { key: 'sessionEnjoyment', label: 'Session enjoyment', min: 0, max: 10, step: 1, default: 7 },
      { key: 'preWorkoutStress', label: 'Pre-workout stress', min: 0, max: 10, step: 1, default: 3 },
      { key: 'sleepQuality', label: 'Sleep quality', min: 0, max: 10, step: 1, default: 7 },
    ];

    const evalAnswers = reactive({});

    function startEval() {
      showEndOverlay.value = false;
      evalPhase.value = true;
      evalStep.value = 0;
      evalSkipRow.value = 0;
      evalVal.value = EVAL_FIELDS[0].default;
      clearInterval(phaseTimer); clearInterval(sessionTimer);
    }

    function evalConfirm() {
      const field = EVAL_FIELDS[evalStep.value];
      evalAnswers[field.key] = evalVal.value;
      evalSkipRow.value = 0;
      if (evalStep.value < EVAL_FIELDS.length - 1) {
        evalStep.value++;
        evalVal.value = EVAL_FIELDS[evalStep.value].default;
      } else {
        showNotesStep.value = true;
      }
    }

    const showNotesStep = ref(false);

    function evalSkip() {
      evalSkipRow.value++;
      if (evalSkipRow.value >= 2) { showEndEvalOverlay.value = true; return; }
      evalAnswers[EVAL_FIELDS[evalStep.value].key] = null;
      if (evalStep.value < EVAL_FIELDS.length - 1) {
        evalStep.value++;
        evalVal.value = EVAL_FIELDS[evalStep.value].default;
      } else {
        showNotesStep.value = true;
      }
    }

    function endEvalNow() {
      // skip remaining evals
      for (let i = evalStep.value; i < EVAL_FIELDS.length; i++) evalAnswers[EVAL_FIELDS[i].key] = null;
      showEndEvalOverlay.value = false;
      showNotesStep.value = true;
    }

    async function saveAndFinish() {
      const durationMin = Math.round(sessionSecs.value / 60);
      const finalLog = plain({
        ...sessionLog.value,
        endedAt: new Date().toISOString(),
        totalDuration: durationMin,
        evaluation: { ...evalAnswers, notes: evalNotes.value },
        exerciseLogs: exercises.value.map((ex, i) => ({
          exerciseId: ex.id,
          exerciseName: ex.name,
          type: ex.type,
          performedOrder: i,
          duration: null,
          note: notes.value[ex.id] || '',
          sets: completedSets.value[ex.id] || []
        }))
      });

      if (sessionLog.value.id) {
        await putSessionLog({ ...finalLog, id: sessionLog.value.id });
      } else {
        await addSessionLog(finalLog);
      }

      // Advance session index
      const count = props.tpl._sessionCount || props.appState._totalSessions || 1;
      let nextIdx = props.appState.currentSessionIndex + 1;
      let nextCycle = props.appState.currentCycleNumber;
      if (nextIdx >= count) { nextIdx = 0; nextCycle++; }

      await patchAppState({ activeSessionLog: null, currentSessionIndex: nextIdx, currentCycleNumber: nextCycle });
      emit('session-done');
    }

    const curField = computed(() => EVAL_FIELDS[evalStep.value]);

    return {
      phase, dataCard, exIdx, showExList, exercises, curEx, curSets, curSetNum, totalSets,
      sessionSecs, phaseSecs, fmtSecs,
      drumMass, drumReps, drumRpe, prevSetData,
      notes, completedSets,
      showEndOverlay, showEndEvalOverlay, showNotesStep,
      evalPhase, evalStep, evalVal, evalNotes, evalAnswers, EVAL_FIELDS, curField,
      evalSkipRow,
      onReady, onDone, onSkipSet, confirmDataCard, addMoreSet, nextExercise,
      goToExercise, askEndSession, startEval, evalConfirm, evalSkip, endEvalNow, saveAndFinish,
      getPrevSetForExercise, getPrevExLog,
    };
  },
  template: `
  <div style="display:flex; flex-direction:column; height:100%;">

    <!-- ── EVALUATION PHASE ──────────────────────────────────────────────── -->
    <div v-if="evalPhase" style="position:fixed;inset:0;background:var(--bg);z-index:300;display:flex;flex-direction:column;padding:env(safe-area-inset-top) 20px env(safe-area-inset-bottom);overflow-y:auto;">

      <!-- Notes step -->
      <div v-if="showNotesStep" style="flex:1;display:flex;flex-direction:column;justify-content:center;">
        <p class="panel-heading">NOTES</p>
        <p style="font-size:18px; font-weight:600; color:var(--text-secondary); margin-bottom:24px;">Any notes about this session?</p>
        <textarea class="input" style="min-height:120px; resize:none;" v-model="evalNotes" placeholder="Optional…"></textarea>
        <button class="btn btn-accent mt-4" @click="saveAndFinish">💾 Save &amp; finish</button>
      </div>

      <!-- Eval cards -->
      <div v-else style="flex:1;display:flex;flex-direction:column;justify-content:center;">
        <div style="text-align:center; margin-bottom:32px;">
          <p class="panel-heading">{{ curField.label.toUpperCase() }}</p>
          <p style="font-size:15px; color:var(--text-secondary);">How would you rate it?</p>
        </div>
        <DrumPicker v-model="evalVal" :step="curField.step" :min="curField.min" :max="curField.max" :decimals="curField.step<1?1:0" />
        <div class="flex gap-2 mt-6">
          <button class="btn btn-accent" style="flex:2;" @click="evalConfirm">→</button>
          <button class="btn btn-ghost" style="flex:1;" @click="evalSkip">Skip</button>
        </div>
        <p class="text-xs text-muted mt-3" style="text-align:center;">{{ evalStep+1 }} / {{ EVAL_FIELDS.length }}</p>

        <!-- End eval overlay -->
        <div v-if="showEndEvalOverlay" style="position:fixed;inset:0;background:rgba(44,42,39,0.5);z-index:500;display:flex;align-items:center;justify-content:center;padding:20px;">
          <div class="card" style="width:100%;max-width:360px;">
            <p style="font-size:18px; font-weight:700; margin-bottom:16px;">Skip remaining evaluations?</p>
            <div class="flex gap-2">
              <button class="btn btn-danger" style="flex:1;" @click="endEvalNow">Yes, skip all</button>
              <button class="btn btn-ghost"  style="flex:1;" @click="showEndEvalOverlay=false">Continue</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── DATA ENTRY PHASE (MASS / REPs / RPE) ───────────────────────────── -->
    <div v-else-if="phase==='data-entry'" style="position:fixed;inset:0;background:var(--bg);z-index:300;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;padding-bottom:max(20px,env(safe-area-inset-bottom));">
      <p class="text-xs text-muted mb-2" style="letter-spacing:2px; text-transform:uppercase; font-weight:700;">Set {{ curSetNum + 1 }}</p>

      <!-- Card 0: MASS -->
      <transition name="slide-up" mode="out-in">
        <div v-if="dataCard===0" key="mass" style="width:100%; text-align:center;">
          <p class="panel-heading">MASS</p>
          <DrumPicker v-model="drumMass" :step="1.25" :min="0" :max="500" unit="kg" :decimals="2" />
          <p v-if="prevSetData" class="panel-subtext">Prev: {{ prevSetData.weight }}kg</p>
          <p v-if="drumMass === 0" class="text-sm text-muted mt-2" style="font-weight: 500;">Please enter a mass above 0 kg</p>
          <button class="btn btn-primary mt-4" :disabled="drumMass === 0" @click="confirmDataCard">→</button>
        </div>

        <!-- Card 1: REPs -->
        <div v-else-if="dataCard===1" key="reps" style="width:100%; text-align:center;">
          <p class="panel-heading">REPs</p>
          <DrumPicker v-model="drumReps" :step="1" :min="0" :max="100" :decimals="0" />
          <p v-if="prevSetData" class="panel-subtext">Prev: {{ prevSetData.reps }} reps</p>
          <button class="btn btn-primary mt-6" @click="confirmDataCard">→</button>
        </div>

        <!-- Card 2: RPE -->
        <div v-else-if="dataCard===2" key="rpe" style="width:100%; text-align:center;">
          <p class="panel-heading">RPE</p>
          <DrumPicker v-model="drumRpe" :step="0.5" :min="0" :max="10" :decimals="1" />
          <p v-if="prevSetData" class="panel-subtext">Prev: {{ prevSetData.rpe }} RPE</p>
          <button class="btn btn-accent mt-6" @click="confirmDataCard">→</button>
        </div>
      </transition>
    </div>

    <!-- ── POST-SET OPTIONS ────────────────────────────────────────────────── -->
    <div v-else-if="phase==='post-set'" style="position:fixed;inset:0;background:var(--bg);z-index:300;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;">
      <div class="card" style="width:100%; text-align:center; padding:32px 24px; margin-bottom:24px;">
        <p class="text-xs text-muted mb-3" style="letter-spacing:2px; text-transform:uppercase;">Set {{ curSetNum }} done</p>
        <p style="font-size:28px; font-weight:800;">{{ drumReps }} × {{ drumMass }}kg</p>
        <p class="text-secondary mt-1">RPE {{ drumRpe }}</p>
      </div>
      <button class="btn btn-primary mb-3" @click="nextExercise">Next exercise →</button>
      <button class="btn btn-outline" @click="addMoreSet">+ Add set</button>
      <button class="btn btn-ghost mt-2" @click="askEndSession">End session</button>
    </div>

    <!-- ── MAIN ACTIVE SESSION UI ─────────────────────────────────────────── -->
    <template v-else>

      <!-- Session header: timers -->
      <div class="session-header">
        <div class="timer-block">
          <span class="timer-label">Session</span>
          <span class="timer-value">{{ fmtSecs(sessionSecs) }}</span>
        </div>
        <div class="timer-block">
          <span class="timer-label">{{ phase==='break' ? 'Break' : 'Exercise' }}</span>
          <span class="timer-value">{{ fmtSecs(phaseSecs) }}</span>
        </div>
        <button class="btn btn-sm btn-ghost" style="width:auto; padding:8px 12px; font-size:13px;" @click="askEndSession">End</button>
      </div>

      <!-- Scrollable area -->
      <div class="scrollable" style="flex:1;">

        <!-- Exercise name (tappable in break, not in set) -->
        <div style="text-align:center; padding:20px 16px 8px;">
          <button v-if="phase==='break'" @click="showExList=true" style="font-size:26px; font-weight:800; letter-spacing:-0.5px; color:var(--text-primary); text-decoration:underline; text-decoration-color:var(--accent); text-underline-offset:4px; background:none; border:none; cursor:pointer;">
            {{ curEx?.name }} ↓
          </button>
          <h2 v-else style="font-size:26px; font-weight:800; letter-spacing:-0.5px;">{{ curEx?.name }}</h2>
        </div>

        <!-- Set indicator -->
        <div style="padding:0 16px 8px;">
          <SetIndicator :total="totalSets" :current="curSetNum" :sets="curSets" />
        </div>

        <!-- Previous session set data -->
        <div class="prev-data-card">
          <p class="prev-data-label">LAST TIME</p>
          <div v-if="getPrevSetForExercise(curEx.id, curSetNum)" class="prev-set-row">
            <span class="prev-set-main">{{ getPrevSetForExercise(curEx.id, curSetNum).reps }} × {{ getPrevSetForExercise(curEx.id, curSetNum).weight}} kg</span>
            <span class="prev-set-rpe">RPE {{ getPrevSetForExercise(curEx.id, curSetNum).rpe }}</span>
          </div>
          <p v-else class="text-sm text-muted">No previous data</p>
        </div>

        <!-- Sticky note area -->
        <div class="note-area">
          <p class="text-xs text-muted mb-1" style="font-weight:600; letter-spacing:1px; text-transform:uppercase;">Note</p>
          <textarea style="width:100%; background:transparent; border:none; outline:none; resize:none; font-size:14px; color:var(--text-primary); min-height:52px; font-family:inherit; line-height:1.5;" :value="notes[curEx?.id]||''" @input="notes[curEx.id]=$event.target.value" placeholder="Add a note for this exercise…"></textarea>
        </div>

        <!-- Completed sets -->
        <div class="completed-sets mt-2" v-if="curSets.length">
          <p class="text-xs text-muted mb-2" style="font-weight:600; letter-spacing:1px; padding:0 2px;">Completed sets</p>
          <div v-for="s in curSets" :key="s.setNumber" class="completed-set-row">
            <div :class="['completed-set-num', s.skipped?'skipped':'']">{{ s.setNumber }}</div>
            <div class="completed-set-data">
              <span v-if="s.skipped" class="text-muted">Skipped</span>
              <span v-else>{{ s.weight }}kg × {{ s.reps }} <span class="text-secondary">@ RPE{{ s.rpe }}</span></span>
            </div>
          </div>
        </div>

        <!-- MAIN exercise controls -->
        <div style="padding:16px; display:flex; flex-direction:column; gap:10px;">
          <div v-if="phase==='break'" class="flex gap-2">
            <button class="btn btn-accent" style="flex:2;" @click="onReady">Ready! 🔥</button>
            <button class="btn btn-ghost"  style="flex:1;" @click="onSkipSet">Skip set</button>
          </div>
          <div v-else-if="phase==='in-set'" class="flex gap-2">
            <button class="btn btn-primary" style="flex:2;" @click="onDone">Done ✓</button>
            <button class="btn btn-ghost"   style="flex:1;" @click="onSkipSet">Skip set</button>
          </div>
        </div>

        <div style="height:40px;"></div>
      </div>

      <!-- End session overlay -->
      <div v-if="showEndOverlay" class="overlay-backdrop" @click.self="showEndOverlay=false">
        <div class="bottom-sheet">
          <div class="bottom-sheet-handle"></div>
          <p style="font-size:20px; font-weight:700; text-align:center; margin-bottom:16px;">End session?</p>
          <button class="btn btn-accent mb-3" @click="startEval">Yes, rate &amp; finish</button>
          <button class="btn btn-ghost"        @click="showEndOverlay=false">Keep going</button>
        </div>
      </div>

      <!-- Exercise list overlay -->
      <div v-if="showExList" class="overlay-backdrop" @click.self="showExList=false">
        <div class="bottom-sheet">
          <div class="bottom-sheet-handle"></div>
          <p class="text-sm text-secondary mb-3" style="font-weight:600;">Jump to exercise</p>
          <div v-for="(ex, i) in exercises" :key="ex.id" @click="goToExercise(i)"
            :style="{padding:'14px 4px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:'12px', cursor:'pointer', fontWeight: i===exIdx?'700':'400'}">
            <span style="flex:1; font-size:16px;">{{ ex.name }}</span>
            <span v-if="i===exIdx" style="color:var(--accent);">●</span>
          </div>
        </div>
      </div>

    </template>
  </div>
  `
};

// ── Session Root ──────────────────────────────────────────────────────────────
export const SessionView = {
  props: { program: Object, templates: Array, appState: Object },
  emits: ['session-done', 'go-setup', 'refresh'],
  components: { NoProgramView, PreSessionView, ActiveSessionView },
  setup(props, { emit }) {
    const active = ref(false);

    // Check for in-progress session on mount
    onMounted(async () => {
      if (props.appState?.activeSessionLog) active.value = true;
    });

    const curTemplate = computed(() => {
      if (!props.templates?.length) return null;
      const idx = props.appState?.currentSessionIndex || 0;
      const tpl = props.templates[idx] || props.templates[0];
      // Attach session count so ActiveSession can advance the index correctly
      if (tpl) tpl._sessionCount = props.templates.length;
      return tpl;
    });

    // Augment appState with _totalSessions for use inside ActiveSession
    const augmentedAppState = computed(() => ({
      ...(props.appState || {}),
      _totalSessions: props.templates?.length || 1
    }));

    function onSkip() {
      const count = props.templates.length;
      let nextIdx = (props.appState.currentSessionIndex + 1) % count;
      let nextCycle = props.appState.currentCycleNumber;
      if (nextIdx === 0) nextCycle++;
      patchAppState({ currentSessionIndex: nextIdx, currentCycleNumber: nextCycle }).then(() => emit('refresh'));
    }

    function onSessionDone() { active.value = false; emit('session-done'); }

    return { active, augmentedAppState, curTemplate, onSkip, onSessionDone };
  },
  template: `
    <div style="flex:1; display:flex; flex-direction:column;">
      <NoProgramView  v-if="!program || !curTemplate" @go-setup="$emit('go-setup')" />
      <ActiveSessionView v-else-if="active" :tpl="curTemplate" :appState="augmentedAppState" @session-done="onSessionDone" />
      <PreSessionView    v-else :tpl="curTemplate" :appState="appState" @start="active=true" @skip="onSkip" />
    </div>
  `
};

// Re-export patchAppState so session.js is self-contained when needed
export { patchAppState };
