// setup.js — Setup tab views

import {
  saveProgram, getTemplates, saveTemplate, deleteTemplate,
  deleteActiveProgram, db
} from './db.js';
import { DrumPicker } from './components.js';

const { ref, computed, reactive, watch } = Vue;

function genId() {
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
}

function blankExercise() {
  return { id: genId(), name: '', defaultSets: 3 };
}

// ── Import / Export ───────────────────────────────────────────────────────────
export const ImportExportView = {
  setup() {
    const status = ref('');
    async function doExport() {
      const programs = await db.programs.toArray();
      const sessionTemplates = await db.sessionTemplates.toArray();
      const sessionLogs = await db.sessionLogs.toArray();
      const appState = await db.appState.toArray();
      const exerciseDefaults = await db.exerciseDefaults.toArray();
      const blob = new Blob([JSON.stringify({ programs, sessionTemplates, sessionLogs, appState, exerciseDefaults }, null, 2)],
        { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `training-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      status.value = 'Exported!';
    }
    async function doImport(e) {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data.programs || !data.sessionTemplates) throw new Error('Invalid file');
        await db.programs.clear();
        await db.sessionTemplates.clear();
        await db.sessionLogs.clear();
        await db.appState.clear();
        await db.exerciseDefaults.clear();
        await db.programs.bulkAdd(data.programs);
        await db.sessionTemplates.bulkAdd(data.sessionTemplates);
        if (data.sessionLogs?.length) await db.sessionLogs.bulkAdd(data.sessionLogs);
        if (data.appState?.length) await db.appState.bulkAdd(data.appState);
        if (data.exerciseDefaults?.length) await db.exerciseDefaults.bulkAdd(data.exerciseDefaults);
        status.value = 'Imported! Reload the app.';
        setTimeout(() => location.reload(), 1500);
      } catch (err) {
        status.value = 'Error: ' + err.message;
      }
    }
    return { doExport, doImport, status };
  },
  template: `
    <div>
      <p class="section-title">Import / Export</p>
      <p class="text-sm text-secondary mb-4">Back up or restore all your training data.</p>
      <button class="btn btn-primary mb-3" @click="doExport">⬇ Export JSON backup</button>
      <label class="btn btn-outline" style="cursor:pointer;">
        ⬆ Import JSON
        <input type="file" accept=".json" style="display:none" @change="doImport">
      </label>
      <p v-if="status" class="mt-3 text-sm text-accent" style="text-align:center;">{{ status }}</p>
    </div>
  `
};



// ── Session editor step (one session at a time) ───────────────────────────────
const SessionEditor = {
  props: { session: Object, index: Number, total: Number },
  emits: ['next', 'prev', 'update'],
  components: { DrumPicker },
  setup(props, { emit }) {
    const editingIdx = ref(null);
    const sessionName = ref(props.session.name || '');

    watch(() => props.session, (newSession) => {
      sessionName.value = newSession.name || '';
    });

    function updateName() {
      emit('update', { ...props.session, name: sessionName.value });
    }

    function addExercise() {
      const exercises = [...(props.session.exercises || [])];
      exercises.push(blankExercise());
      emit('update', { ...props.session, exercises });
    }

    function removeExercise(idx) {
      const exercises = props.session.exercises.filter((_, i) => i !== idx);
      emit('update', { ...props.session, exercises });
    }

    function canNext() { return sessionName.value.trim() && props.session.exercises?.length > 0; }

    function next() {
      if (!canNext()) return;
      emit('update', { ...props.session, name: sessionName.value.trim() });
      emit('next');
    }

    return { editingIdx, sessionName, addExercise, removeExercise, canNext, next, updateName };
  },
  template: `
    <div>
      <p class="text-xs text-secondary mb-1" style="font-weight:600; letter-spacing:1.5px; text-transform:uppercase;">
        Session {{ index + 1 }} of {{ total }}
      </p>
      <div class="step-dots mb-4" style="display:flex; gap:6px;">
        <div v-for="i in total" :key="i"
          :style="{height:'4px', flex:1, borderRadius:'2px', background: i-1===index ? 'var(--text-primary)' : 'var(--border)'}"></div>
      </div>

      <div class="mb-4" style="border-bottom: 2px solid var(--border); padding-bottom: 8px;">
        <input v-model="sessionName" @blur="updateName" placeholder="Session name (e.g. Legs)" style="font-size:24px; font-weight:800; background:transparent; border:none; outline:none; color:var(--text-primary); padding:0; width:100%;" />
      </div>

      <div class="mb-3">
        <div class="flex items-center justify-between mb-3">
          <span class="text-sm" style="font-weight:600;">Exercises</span>
        </div>

        <div v-for="(ex, i) in session.exercises" :key="ex.id" class="card mb-2" style="padding:12px; border:1px solid var(--border);">
          <div class="flex items-center justify-between mb-2">
            <input v-model="ex.name" placeholder="Exercise name" style="font-size:16px; font-weight:600; background:transparent; border:none; outline:none; color:var(--text-primary); padding:0; flex:1;" />
            <button class="icon-btn text-danger" @click="removeExercise(i)">✕</button>
          </div>
          <div class="flex gap-4">
            <div style="flex:1;">
              <span class="text-xs text-secondary" style="font-weight:600; letter-spacing:1px; text-transform:uppercase; display:block; text-align:center;">Sets</span>
              <DrumPicker v-model="ex.defaultSets" :small="true" :min="1" :max="20" />
            </div>
          </div>
        </div>
        <button class="btn btn-ghost mt-2 btn-sm" @click="addExercise">+ Add exercise</button>
      </div>

      <div v-if="!canNext() && session.exercises?.length === 0" class="text-xs text-muted mb-3" style="text-align:center;">
        Add at least one exercise to continue
      </div>

      <div class="flex gap-2 mt-4">
        <button v-if="index > 0" class="btn btn-ghost" style="flex:1;" @click="$emit('prev')">Previous</button>
        <button class="btn btn-primary" :style="{flex: index > 0 ? '1' : '1'}" :disabled="!canNext()" @click="next">
          {{ index === total - 1 ? 'Review' : 'Continue' }}
        </button>
      </div>
    </div>
  `
};

// ── Configure Cycle View ──────────────────────────────────────────────────────
export const ConfigureCycleView = {
  components: { DrumPicker, SessionEditor },
  emits: ['saved'],
  setup(_, { emit }) {
    const step = ref('count');  // 'count' | 'sessions' | 'summary'
    const sessionCount = ref(3);
    const sessions = ref([]);
    const curIdx = ref(0);
    const saving = ref(false);

    function confirmCount() {
      sessions.value = Array.from({ length: sessionCount.value }, (_, i) => ({
        tempId: genId(), name: '', exercises: [], sessionIndex: i
      }));
      curIdx.value = 0;
      step.value = 'sessions';
    }

    function updateSession(updated) {
      sessions.value[curIdx.value] = { ...sessions.value[curIdx.value], ...updated };
    }

    function nextSession() {
      if (curIdx.value < sessionCount.value - 1) curIdx.value++;
      else step.value = 'summary';
    }

    function prevSession() { if (curIdx.value > 0) curIdx.value--; }

    // ── Review management ─────────────────────────────────────────
    function deleteSession(idx) {
      sessions.value.splice(idx, 1);
      sessionCount.value = sessions.value.length;
      sessions.value.forEach((s, i) => { s.sessionIndex = i; });
      if (sessions.value.length === 0) step.value = 'count';
    }

    function moveSession(idx, dir) {
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= sessions.value.length) return;
      const arr = [...sessions.value];
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      arr.forEach((s, i) => { s.sessionIndex = i; });
      sessions.value = arr;
    }

    function deleteExercise(sIdx, eIdx) {
      const exercises = sessions.value[sIdx].exercises.filter((_, i) => i !== eIdx);
      sessions.value[sIdx] = { ...sessions.value[sIdx], exercises };
    }

    function moveExercise(sIdx, eIdx, dir) {
      const newIdx = eIdx + dir;
      const exercises = [...sessions.value[sIdx].exercises];
      if (newIdx < 0 || newIdx >= exercises.length) return;
      [exercises[eIdx], exercises[newIdx]] = [exercises[newIdx], exercises[eIdx]];
      sessions.value[sIdx] = { ...sessions.value[sIdx], exercises };
    }

    // ── Drag-to-reorder ───────────────────────────────────────────
    const drag = reactive({
      active: false,
      type: null,   // 'session' | 'exercise'
      sIdx: null,
      eIdx: null,
      startY: 0,
      offsetY: 0,
    });

    function onDragStart(e, type, sIdx, eIdx) {
      const isTouch = e.type === 'touchstart';
      const point = isTouch ? e.touches[0] : e;
      drag.active = true;
      drag.type = type;
      drag.sIdx = sIdx;
      drag.eIdx = eIdx;
      drag.startY = point.clientY;
      drag.offsetY = 0;
      if (isTouch) {
        document.addEventListener('touchmove', onDragMove, { passive: false });
        document.addEventListener('touchend', onDragEnd);
      } else {
        document.addEventListener('mousemove', onDragMove);
        document.addEventListener('mouseup', onDragEnd);
      }
    }

    function onDragMove(e) {
      if (!drag.active) return;
      e.preventDefault();
      const point = e.touches ? e.touches[0] : e;
      drag.offsetY = point.clientY - drag.startY;
      const threshold = drag.type === 'session' ? 60 : 40;
      if (Math.abs(drag.offsetY) > threshold) {
        const dir = drag.offsetY > 0 ? 1 : -1;
        if (drag.type === 'session') {
          const newIdx = drag.sIdx + dir;
          if (newIdx >= 0 && newIdx < sessions.value.length) {
            moveSession(drag.sIdx, dir);
            drag.sIdx = newIdx;
            drag.startY = point.clientY;
            drag.offsetY = 0;
          }
        } else {
          const exercises = sessions.value[drag.sIdx].exercises;
          const newIdx = drag.eIdx + dir;
          if (newIdx >= 0 && newIdx < exercises.length) {
            moveExercise(drag.sIdx, drag.eIdx, dir);
            drag.eIdx = newIdx;
            drag.startY = point.clientY;
            drag.offsetY = 0;
          }
        }
      }
    }

    function onDragEnd() {
      drag.active = false;
      drag.offsetY = 0;
      document.removeEventListener('touchmove', onDragMove);
      document.removeEventListener('touchend', onDragEnd);
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup', onDragEnd);
    }

    // Save programme (iterates sessions array correctly)
    async function saveProg() {
      saving.value = true;
      try {
        const pid = await saveProgram('My Programme', sessionCount.value);
        for (let i = 0; i < sessions.value.length; i++) {
          const s = sessions.value[i];
          // JSON round-trip strips Vue reactive proxies — required for IndexedDB structured clone
          const exercises = JSON.parse(JSON.stringify(s.exercises || []));
          await saveTemplate({ programId: pid, sessionIndex: i, name: s.name, exercises });
        }
        emit('saved');
      } finally { saving.value = false; }
    }

    return { step, sessionCount, sessions, curIdx, confirmCount, updateSession, nextSession, prevSession, deleteSession, deleteExercise, drag, onDragStart, saveProg, saving };
  },
  template: `
    <div>
      <!-- STEP: Count -->
      <transition name="slide-up" mode="out-in">
        <div v-if="step === 'count'" key="count">
          <p class="section-title">Configure training cycle</p>
          <div class="card" style="padding:32px 24px;">
            <DrumPicker v-model="sessionCount" :min="1" :max="30" />
            <p style="text-align:center; margin-top:12px; font-size:14px; color:var(--text-secondary);">
              session{{ sessionCount !== 1 ? 's' : '' }} per cycle
            </p>
          </div>
          <button class="btn btn-primary mt-4" @click="confirmCount">Confirm →</button>
        </div>

        <!-- STEP: Sessions -->
        <div v-else-if="step === 'sessions'" key="sessions">
          <SessionEditor
            :session="sessions[curIdx]"
            :index="curIdx"
            :total="sessionCount"
            @update="updateSession"
            @next="nextSession"
            @prev="prevSession"
          />
        </div>

        <!-- STEP: Summary -->
        <div v-else-if="step === 'summary'" key="summary">
          <p class="section-title">All set!</p>
          <p class="text-secondary text-sm mb-4">Review your {{ sessions.length }}-session cycle.</p>

          <div v-for="(s, sIdx) in sessions" :key="s.tempId" class="card mb-3"
            :style="drag.active && drag.type === 'session' && drag.sIdx === sIdx
              ? {transform: 'translateY('+drag.offsetY+'px)', transition: 'none', zIndex: 10, position: 'relative', boxShadow: 'var(--shadow-lg)', opacity: 0.92}
              : {transition: 'transform 180ms ease'}">
            <div class="flex items-center" style="gap:12px; margin-bottom:8px;">
              <div class="drag-handle"
                @touchstart.prevent="onDragStart($event, 'session', sIdx, null)"
                @mousedown.prevent="onDragStart($event, 'session', sIdx, null)">
                <svg width="14" height="20" viewBox="0 0 14 20" fill="currentColor" style="display:block;">
                  <circle cx="4" cy="4" r="2"/><circle cx="10" cy="4" r="2"/>
                  <circle cx="4" cy="10" r="2"/><circle cx="10" cy="10" r="2"/>
                  <circle cx="4" cy="16" r="2"/><circle cx="10" cy="16" r="2"/>
                </svg>
              </div>
              <div style="flex:1; min-width:0;">
                <p style="font-size:17px; font-weight:700;">{{ s.name }}</p>
                <p class="text-xs text-secondary mt-1">{{ s.exercises.length }} exercise{{ s.exercises.length !== 1 ? 's' : '' }}</p>
              </div>
              <button class="review-action-btn review-action-btn--danger" @click="deleteSession(sIdx)" title="Delete session">✕</button>
            </div>
            <div>
              <div v-for="(ex, eIdx) in s.exercises" :key="ex.id" class="flex items-center"
                :style="{
                  padding: '8px 0',
                  borderBottom: eIdx < s.exercises.length - 1 ? '1px solid var(--border)' : 'none',
                  transform: drag.active && drag.type === 'exercise' && drag.sIdx === sIdx && drag.eIdx === eIdx ? 'translateY('+drag.offsetY+'px)' : '',
                  transition: drag.active && drag.type === 'exercise' && drag.sIdx === sIdx && drag.eIdx === eIdx ? 'none' : 'transform 180ms ease',
                  zIndex: drag.active && drag.type === 'exercise' && drag.sIdx === sIdx && drag.eIdx === eIdx ? 5 : 'auto',
                  position: 'relative',
                  background: drag.active && drag.type === 'exercise' && drag.sIdx === sIdx && drag.eIdx === eIdx ? 'var(--bg-card)' : ''
                }">
                <div class="drag-handle drag-handle--sm"
                  @touchstart.prevent="onDragStart($event, 'exercise', sIdx, eIdx)"
                  @mousedown.prevent="onDragStart($event, 'exercise', sIdx, eIdx)">
                  <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" style="display:block;">
                    <circle cx="3" cy="3" r="1.5"/><circle cx="7" cy="3" r="1.5"/>
                    <circle cx="3" cy="8" r="1.5"/><circle cx="7" cy="8" r="1.5"/>
                    <circle cx="3" cy="13" r="1.5"/><circle cx="7" cy="13" r="1.5"/>
                  </svg>
                </div>
                <span class="exercise-row-name" style="font-size:15px; flex:1; padding:0 8px;">{{ ex.name }}</span>
                <button class="review-action-btn review-action-btn--sm review-action-btn--danger" @click="deleteExercise(sIdx, eIdx)" title="Delete exercise">✕</button>
              </div>
            </div>
          </div>

          <button class="btn btn-accent mt-2" :disabled="saving || sessions.length === 0" @click="saveProg">
            {{ saving ? 'Saving…' : 'Save programme' }}
          </button>
          <button class="btn btn-ghost mt-2" @click="step='sessions'; curIdx=sessions.length-1">Edit sessions</button>
        </div>
      </transition>
    </div>
  `
};

// ── Edit Existing Programme ───────────────────────────────────────────────────
export const EditProgrammeView = {
  props: { program: Object, templates: Array },
  emits: ['deleted', 'refresh'],
  components: { DrumPicker },
  setup(props, { emit }) {
    const confirmDelete = ref(false);
    const editingTpl = ref(null);

    async function doDelete() {
      await deleteActiveProgram();
      emit('deleted');
    }

    function startEditTpl(tpl) { editingTpl.value = JSON.parse(JSON.stringify(tpl)); }

    async function saveTpl() {
      await saveTemplate(editingTpl.value);
      emit('refresh');
      editingTpl.value = null;
    }

    function addEx() {
      editingTpl.value.exercises.push(blankExercise());
    }

    function removeEx(i) { editingTpl.value.exercises.splice(i, 1); }

    return { confirmDelete, doDelete, editingTpl, startEditTpl, saveTpl, addEx, removeEx };
  },
  template: `
    <div>
      <div class="flex items-center justify-between mb-4">
        <div>
          <p class="section-title" style="margin-bottom:2px;">{{ program.name }}</p>
          <p class="text-sm text-secondary">{{ program.sessionCount }} sessions per cycle</p>
        </div>
        <button class="btn btn-sm btn-danger" style="width:auto;" @click="confirmDelete=true">Delete</button>
      </div>

      <div v-if="confirmDelete" class="card mb-4" style="border-color:var(--danger); background:var(--danger-light);">
        <p class="text-sm mb-3" style="color:var(--danger); font-weight:600;">Delete this programme? This won't remove historical logs.</p>
        <div class="flex gap-2">
          <button class="btn btn-danger" style="flex:1;" @click="doDelete">Yes, delete</button>
          <button class="btn btn-ghost"  style="flex:1;" @click="confirmDelete=false">Cancel</button>
        </div>
      </div>

      <!-- Template list -->
      <div v-if="!editingTpl">
        <div v-for="tpl in templates" :key="tpl.id" class="card mb-3">
          <div class="flex items-center justify-between">
            <div>
              <p style="font-weight:700; font-size:16px;">{{ tpl.name }}</p>
              <p class="text-xs text-secondary mt-1">{{ tpl.exercises?.length || 0 }} exercises</p>
            </div>
            <button class="btn btn-sm btn-outline" style="width:auto;" @click="startEditTpl(tpl)">Edit</button>
          </div>
        </div>
      </div>

      <!-- Editing a template -->
      <div v-else>
        <div class="flex items-center justify-between mb-4" style="border-bottom: 2px solid var(--border); padding-bottom: 8px;">
          <input v-model="editingTpl.name" placeholder="Session name" style="font-size:24px; font-weight:800; background:transparent; border:none; outline:none; color:var(--text-primary); padding:0; flex:1;" />
          <button class="icon-btn" @click="editingTpl=null">✕</button>
        </div>

        <div v-for="(ex, i) in editingTpl.exercises" :key="ex.id" class="card mb-2" style="padding:12px; border:1px solid var(--border);">
          <div class="flex items-center justify-between mb-2">
            <input v-model="ex.name" placeholder="Exercise name" style="font-size:16px; font-weight:600; background:transparent; border:none; outline:none; color:var(--text-primary); padding:0; flex:1;" />
            <button class="icon-btn text-danger" @click="removeEx(i)">✕</button>
          </div>
          <div class="flex gap-4">
            <div style="flex:1;">
              <span class="text-xs text-secondary" style="font-weight:600; letter-spacing:1px; text-transform:uppercase; display:block; text-align:center;">Sets</span>
              <DrumPicker v-model="ex.defaultSets" :small="true" :min="1" :max="20" />
            </div>
          </div>
        </div>
        <button class="btn btn-ghost mt-2 btn-sm" @click="addEx">+ Add exercise</button>
        <button class="btn btn-accent mt-3" @click="saveTpl">Save changes</button>
      </div>
    </div>
  `
};

// ── Setup Root ────────────────────────────────────────────────────────────────
export const SetupView = {
  props: { program: Object, templates: Array },
  emits: ['saved', 'refresh'],
  components: { ConfigureCycleView, EditProgrammeView, ImportExportView },
  setup(props, { emit }) {
    const tab = ref(props.program ? 'edit' : 'configure');
    // New programme created → tell App to reload data AND navigate to session
    function onSaved() { emit('saved'); }
    // Template edited / programme deleted → just reload data, stay on Setup
    function onDeleted() { tab.value = 'configure'; emit('refresh'); }
    function onRefresh() { emit('refresh'); }
    return { tab, onSaved, onDeleted, onRefresh };
  },
  template: `
    <div class="main-content">
      <!-- Sub-tabs -->
      <div class="flex gap-2 mb-4" style="border-bottom:1px solid var(--border); padding-bottom:12px;">
        <button v-if="!program"  :class="['btn btn-sm', tab==='configure' ? 'btn-primary' : 'btn-ghost']" style="flex:1;" @click="tab='configure'">Setup</button>
        <button v-if="program"   :class="['btn btn-sm', tab==='edit'      ? 'btn-primary' : 'btn-ghost']" style="flex:1;" @click="tab='edit'">Programme</button>
        <button :class="['btn btn-sm', tab==='export' ? 'btn-primary' : 'btn-ghost']" style="flex:1;" @click="tab='export'">Backup</button>
      </div>

      <transition name="fade" mode="out-in">
        <ConfigureCycleView v-if="tab==='configure'" key="cfg" @saved="onSaved" />
        <EditProgrammeView  v-else-if="tab==='edit'" key="edit" :program="program" :templates="templates" @deleted="onDeleted" @refresh="onRefresh" />
        <ImportExportView   v-else key="export" />
      </transition>
    </div>
  `
};
