// components.js — shared reusable components

const { ref, computed, watch, onMounted, onUnmounted } = Vue;

// ── DrumPicker ────────────────────────────────────────────────────────────────
// Horizontal drag-to-select numeric input snapping to `step` multiples.
export const DrumPicker = {
  props: {
    modelValue: { type: Number, default: 0 },
    step: { type: Number, default: 1 },
    min: { type: Number, default: 0 },
    max: { type: Number, default: 9999 },
    unit: { type: String, default: '' },
    decimals: { type: Number, default: 0 },
    small: { type: Boolean, default: false }
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const startX = ref(null);
    const baseVal = ref(props.modelValue);
    const liveVal = ref(props.modelValue);
    const dragging = ref(false);
    const PX = 72; // pixels per step

    watch(() => props.modelValue, v => { baseVal.value = v; liveVal.value = v; });

    function clampSnap(v) {
      const snapped = Math.round(v / props.step) * props.step;
      const clamped = Math.max(props.min, Math.min(props.max, snapped));
      return parseFloat(clamped.toFixed(10)); // avoid float drift
    }

    function fmt(v) { return Number(v).toFixed(props.decimals); }

    const leftVal = computed(() => {
      const raw = liveVal.value - props.step;
      return raw < props.min ? '•' : fmt(clampSnap(raw));
    });
    const rightVal = computed(() => {
      const raw = liveVal.value + props.step;
      return raw > props.max ? '•' : fmt(clampSnap(raw));
    });

    function onStart(x) { startX.value = x; baseVal.value = props.modelValue; dragging.value = true; }

    function onMove(x) {
      if (!dragging.value) return;
      const delta = startX.value - x;
      const steps = Math.round(delta / PX);
      liveVal.value = clampSnap(baseVal.value + steps * props.step);
    }

    function onEnd() {
      if (!dragging.value) return;
      dragging.value = false;
      emit('update:modelValue', liveVal.value);
    }

    return { liveVal, leftVal, rightVal, fmt, dragging, onStart, onMove, onEnd };
  },
  template: `
    <div style="user-select:none; touch-action:none; cursor:ew-resize;"
         :class="{'drum-small': small}"
         @touchstart.prevent="onStart($event.touches[0].clientX)"
         @touchmove.prevent="onMove($event.touches[0].clientX)"
         @touchend="onEnd"
         @mousedown="onStart($event.clientX)"
         @mousemove="dragging && onMove($event.clientX)"
         @mouseup="onEnd"
         @mouseleave="dragging && onEnd()">
      <div class="drum-container" style="display:flex; justify-content:center; align-items:center;">
        <div class="drum-item" style="flex:1; display:flex; justify-content:flex-end;"><span class="drum-side">{{ leftVal }}</span></div>
        <div class="drum-item" style="flex:none; display:flex; justify-content:center; align-items:baseline; min-width:inherit;" :class="small ? 'drum-center-box-small' : 'drum-center-box'">
          <span class="drum-center-val" style="min-width:auto; text-align:right;">{{ fmt(liveVal) }}</span>
          <span v-if="unit" class="drum-unit" style="padding-left:6px;">{{ unit }}</span>
        </div>
        <div class="drum-item" style="flex:1; display:flex; justify-content:flex-start;"><span class="drum-side">{{ rightVal }}</span></div>
      </div>
    </div>
  `
};



// ── SetIndicator ──────────────────────────────────────────────────────────────
export const SetIndicator = {
  props: {
    total: { type: Number, default: 0 },
    current: { type: Number, default: 0 },
    sets: { type: Array, default: () => [] },
  },
  template: `
    <div class="set-indicator">
      <div v-for="i in total" :key="i"
           :class="['set-dot',
             sets[i-1]?.skipped ? 'skipped' :
             i - 1 < current ? 'done' :
             i - 1 === current ? 'active' : '']">
      </div>
    </div>
  `
};



// ── Stopwatch composable ──────────────────────────────────────────────────────
export function useStopwatch(autoStart = false) {
  const elapsed = ref(0);
  const running = ref(false);
  let startTime = null;
  let interval = null;

  function start() {
    if (running.value) return;
    startTime = Date.now() - elapsed.value * 1000;
    running.value = true;
    interval = setInterval(() => { elapsed.value = Math.floor((Date.now() - startTime) / 1000); }, 500);
  }
  function stop() { running.value = false; clearInterval(interval); }
  function reset() { stop(); elapsed.value = 0; }
  function restart() { reset(); start(); }

  function fmt(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  onUnmounted(() => clearInterval(interval));
  if (autoStart) onMounted(() => start());

  return { elapsed, running, start, stop, reset, restart, fmt };
}
