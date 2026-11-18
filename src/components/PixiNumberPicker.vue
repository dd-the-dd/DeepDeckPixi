<template>
  <div class="pixi-number-picker" role="group" :aria-label="label">
    <button
      type="button"
      class="pixi-number-step"
      aria-label="Decrease"
      :disabled="current <= lowest"
      @click="step(-1)"
    >
      −
    </button>
    <input
      class="pixi-number-input"
      type="number"
      inputmode="numeric"
      :min="lowest"
      :max="highest"
      :step="bounds.step ?? 1"
      :value="current"
      :aria-label="label"
      @change="set($event.target.value)"
    >
    <button
      type="button"
      class="pixi-number-step"
      aria-label="Increase"
      :disabled="current >= highest"
      @click="step(1)"
    >
      +
    </button>
    <input
      v-if="highest > lowest"
      class="pixi-number-range"
      type="range"
      :min="lowest"
      :max="highest"
      :step="bounds.values ? 1 : bounds.step ?? 1"
      :value="current"
      aria-hidden="true"
      tabindex="-1"
      @input="set($event.target.value)"
    >
    <small class="pixi-number-bounds">{{ lowest }} – {{ highest }}</small>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { clampDecisionNumber, stepDecisionNumber } from '../helpers/DecisionPrimitives.mjs';

const props = defineProps({
    bounds: {
        required: true,
        type: Object,
    },
    label: {
        default: 'Number',
        type: String,
    },
    modelValue: {
        default: null,
        type: Number,
    },
});
const emit = defineEmits(['update:modelValue']);

const lowest = computed(() => clampDecisionNumber(-Infinity, props.bounds));
const highest = computed(() => clampDecisionNumber(Infinity, props.bounds));
const current = computed(() => clampDecisionNumber(props.modelValue ?? lowest.value, props.bounds));

function set(value) {
    emit('update:modelValue', clampDecisionNumber(value, props.bounds));
}

function step(direction) {
    emit('update:modelValue', stepDecisionNumber(current.value, direction, props.bounds));
}
</script>

<style scoped>
.pixi-number-picker {
    align-items: center;
    display: grid;
    gap: 0.35rem;
    grid-template-columns: 2.2rem 4.2rem 2.2rem;
    justify-content: center;
}

.pixi-number-step {
    background: #fff;
    border: 1px solid #98a2b3;
    border-radius: 999px;
    color: #344054;
    cursor: pointer;
    font-size: 1.1rem;
    font-weight: 800;
    height: 2.2rem;
}

.pixi-number-step:disabled { cursor: default; opacity: 0.45; }

.pixi-number-input {
    border: 2px solid #f59e0b;
    border-radius: 0.45rem;
    font-size: 1.15rem;
    font-weight: 800;
    padding: 0.25rem;
    text-align: center;
}

.pixi-number-range {
    grid-column: 1 / -1;
    width: 100%;
}

.pixi-number-bounds {
    color: #667085;
    font-size: 0.65rem;
    grid-column: 1 / -1;
    text-align: center;
}
</style>
