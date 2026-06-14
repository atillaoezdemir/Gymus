// db.js — Dexie database layer for Gymus

const db = new Dexie('GymDB');

db.version(1).stores({
  programs:         '++id, name, createdAt',
  sessionTemplates: '++id, programId, sessionIndex',
  sessionLogs:      '++id, templateId, cycleNumber, sessionIndex, startedAt',
  appState:         'id',
  exerciseDefaults: 'exerciseId'   // persistent drum value per exercise
});

// ── Boot ─────────────────────────────────────────────────────────────────────
async function initDB() {
  let state = await db.appState.get(1);
  if (!state) {
    state = { id: 1, activeProgramId: null, currentCycleNumber: 1, currentSessionIndex: 0, activeSessionLog: null };
    await db.appState.put(state);
  }
  if (navigator.storage?.persist) {
    const ok = await navigator.storage.persist();
    if (!ok) { /* storage persistence denied — expected on localhost */ }
  }
  return state;
}

// ── AppState ──────────────────────────────────────────────────────────────────
async function getAppState() { return db.appState.get(1); }
async function patchAppState(updates) { return db.appState.update(1, plain(updates)); }

// ── Programs ──────────────────────────────────────────────────────────────────
async function getActiveProgram() {
  const s = await getAppState();
  if (!s?.activeProgramId) return null;
  return db.programs.get(s.activeProgramId);
}

// Strip Vue reactive Proxies before any IndexedDB write
function plain(v) { return JSON.parse(JSON.stringify(v)); }

async function saveProgram(name, sessionCount) {
  const id = await db.programs.add(plain({ name, sessionCount, createdAt: new Date() }));
  await patchAppState({ activeProgramId: id, currentCycleNumber: 1, currentSessionIndex: 0 });
  return id;
}

async function deleteActiveProgram() {
  const s = await getAppState();
  if (!s?.activeProgramId) return;
  const templates = await db.sessionTemplates.where('programId').equals(s.activeProgramId).toArray();
  await Promise.all(templates.map(t => db.sessionTemplates.delete(t.id)));
  await db.programs.delete(s.activeProgramId);
  await patchAppState({ activeProgramId: null, activeSessionLog: null, currentCycleNumber: 1, currentSessionIndex: 0 });
}

// ── SessionTemplates ──────────────────────────────────────────────────────────
async function getTemplates(programId) {
  return db.sessionTemplates.where('programId').equals(programId).sortBy('sessionIndex');
}

async function saveTemplate(tpl) {
  const clean = plain(tpl);
  if (clean.id) { await db.sessionTemplates.put(clean); return clean.id; }
  return db.sessionTemplates.add(clean);
}

async function deleteTemplate(id) { return db.sessionTemplates.delete(id); }

// ── SessionLogs ───────────────────────────────────────────────────────────────
async function getAllLogs() {
  return db.sessionLogs.orderBy('startedAt').reverse().toArray();
}

async function getLogsForTemplate(templateId) {
  return db.sessionLogs.where('templateId').equals(templateId).sortBy('startedAt');
}

async function getLastLogForTemplate(templateId) {
  const logs = await getLogsForTemplate(templateId);
  return logs[logs.length - 1] || null;
}

async function addSessionLog(log) { return db.sessionLogs.add(plain(log)); }
async function putSessionLog(log) { return db.sessionLogs.put(plain(log)); }

// ── Exercise Defaults (per-exercise last weight/reps/rpe memory) ───────────────
async function getExerciseDefault(exerciseId) {
  return db.exerciseDefaults.get(exerciseId);
}

async function setExerciseDefault(exerciseId, values) {
  const existing = (await db.exerciseDefaults.get(exerciseId)) || { exerciseId };
  await db.exerciseDefaults.put(plain({ ...existing, ...values, exerciseId }));
}

export {
  db, initDB,
  getAppState, patchAppState,
  getActiveProgram, saveProgram, deleteActiveProgram,
  getTemplates, saveTemplate, deleteTemplate,
  getAllLogs, getLogsForTemplate, getLastLogForTemplate, addSessionLog, putSessionLog,
  getExerciseDefault, setExerciseDefault
};
