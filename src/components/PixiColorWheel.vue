<template>
  <div class="pixi-color-wheel" role="radiogroup" aria-label="Choose a color">
    <button
      v-for="(entry, index) in colors"
      :key="entry.color"
      type="button"
      role="radio"
      class="pixi-color-pip"
      :class="[`pixi-color-${entry.color.toLowerCase()}`, { enabled: entry.enabled }]"
      :style="pipStyle(index)"
      :disabled="!entry.enabled"
      :aria-checked="false"
      :aria-label="entry.name"
      :title="entry.enabled ? entry.name : `${entry.name} (not available)`"
      @click="emit('choose', entry.color)"
    >
      <i class="ms ms-cost" :class="`ms-${entry.color.toLowerCase()}`" aria-hidden="true" />
      <span class="pixi-color-letter" aria-hidden="true">{{ entry.color }}</span>
    </button>
  </div>
</template>

<script setup>
defineProps({
    colors: {
        required: true,
        type: Array,
    },
});
const emit = defineEmits(['choose']);

// White at the top, then clockwise U, B, R, G as on the back of a Magic card.
function pipStyle(index) {
    const angle = -Math.PI / 2 + index * (2 * Math.PI / 5);
    return {
        left: `${50 + Math.cos(angle) * 36}%`,
        top: `${50 + Math.sin(angle) * 36}%`,
    };
}
</script>

<style scoped>
.pixi-color-wheel {
    aspect-ratio: 1;
    background: radial-gradient(circle, rgb(255 253 251 / 96%) 30%, rgb(52 64 84 / 12%) 31%, transparent 70%);
    border-radius: 50%;
    margin: 0 auto;
    position: relative;
    width: 11rem;
}

.pixi-color-pip {
    align-items: center;
    border: 3px solid #d0d5dd;
    border-radius: 50%;
    cursor: pointer;
    display: grid;
    height: 3.1rem;
    justify-items: center;
    padding: 0;
    position: absolute;
    transform: translate(-50%, -50%);
    width: 3.1rem;
}

.pixi-color-pip.enabled {
    border-color: #f59e0b;
    box-shadow: 0 0 0 3px rgb(245 158 11 / 28%);
}

.pixi-color-pip.enabled:hover,
.pixi-color-pip.enabled:focus-visible {
    outline: none;
    transform: translate(-50%, -50%) scale(1.1);
}

.pixi-color-pip:disabled {
    cursor: not-allowed;
    filter: grayscale(0.9);
    opacity: 0.35;
}

.pixi-color-pip .ms { font-size: 1.35rem; }

.pixi-color-letter {
    font-size: 0.6rem;
    font-weight: 900;
    line-height: 1;
}

.pixi-color-w { background: #f8f1d4; color: #3b3218; }
.pixi-color-u { background: #b3dcf2; color: #0d3a57; }
.pixi-color-b { background: #c9c1bd; color: #1d1717; }
.pixi-color-r { background: #f3b49a; color: #5c1608; }
.pixi-color-g { background: #a9d5b5; color: #0f3f1f; }
</style>
