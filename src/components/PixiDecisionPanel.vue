<template>
  <section
    class="pixi-decision-panel"
    :data-primitive="view.primitive"
    :data-stage="view.stage"
    role="dialog"
    aria-modal="false"
    :aria-label="headline"
  >
    <header>
      <strong>{{ headline }}</strong>
      <small v-if="counter">{{ counter }}</small>
    </header>

    <p v-if="hint" class="pixi-decision-hint">
      {{ hint }}
    </p>

    <PixiColorWheel
      v-if="view.color"
      :colors="view.color.colors"
      @choose="emit('color', $event)"
    />

    <PixiNumberPicker
      v-if="view.number"
      :bounds="view.number"
      :label="headline"
      :model-value="selection.numberValue"
      @update:model-value="emit('number', $event)"
    />

    <label v-if="view.cardName" class="pixi-decision-card-name">
      <span>Card name</span>
      <input
        type="text"
        maxlength="256"
        :list="`pixi-card-names-${decisionKey}`"
        :value="selection.cardName"
        autocomplete="off"
        @input="emit('card-name', $event.target.value)"
        @keydown.enter="emit('confirm')"
      >
      <datalist :id="`pixi-card-names-${decisionKey}`">
        <option v-for="name in view.cardName.suggestions" :key="name" :value="name" />
      </datalist>
    </label>

    <div v-if="trayCards.length" class="pixi-decision-tray">
      <button
        v-for="card in trayCards"
        :key="card.id"
        type="button"
        class="pixi-decision-tray-card"
        :class="{ selectable: card.selectable, selected: card.selected }"
        :disabled="!card.selectable && !card.selected"
        :aria-pressed="card.selected ? 'true' : 'false'"
        @click="emit('tray-card', card.id)"
        @mouseenter="emit('card-hover', card)"
        @mouseleave="emit('card-leave')"
      >
        <img v-if="card.imageUrl" :src="card.imageUrl" :alt="card.name">
        <span>{{ card.name }}</span>
        <b v-if="card.order" class="pixi-decision-order">{{ card.order }}</b>
      </button>
    </div>

    <div v-if="view.textOptions.length" class="pixi-decision-options">
      <button
        v-for="option in view.textOptions"
        :key="option.actionId ?? option.variantKey"
        type="button"
        @click="emit('option', option)"
      >
        {{ option.label }}
      </button>
    </div>

    <details v-if="showAllOptions" class="pixi-decision-all" :open="view.stage === 'empty' || Boolean(view.unsupported)">
      <summary>All Engine options · {{ model.actions.length }}</summary>
      <div class="pixi-decision-options">
        <button
          v-for="action in model.actions"
          :key="action.id"
          type="button"
          @click="emit('option', { actionId: action.id })"
        >
          {{ action.label || action.id }}
        </button>
      </div>
    </details>

    <footer v-if="view.cancelable || needsConfirm">
      <button v-if="view.cancelable" type="button" @click="emit('cancel')">
        Cancel
      </button>
      <button
        v-if="needsConfirm"
        type="button"
        class="primary"
        :disabled="!view.confirmable"
        @click="emit('confirm')"
      >
        Confirm
      </button>
    </footer>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import PixiColorWheel from './PixiColorWheel.vue';
import PixiNumberPicker from './PixiNumberPicker.vue';

const props = defineProps({
    model: {
        required: true,
        type: Object,
    },
    selection: {
        required: true,
        type: Object,
    },
    view: {
        required: true,
        type: Object,
    },
});
const emit = defineEmits([
    'cancel',
    'card-hover',
    'card-leave',
    'card-name',
    'color',
    'confirm',
    'number',
    'option',
    'tray-card',
]);

const decisionKey = computed(() => String(props.model.decisionId ?? '').replace(/[^\w-]/gu, '_'));

const stageHints = {
    confirm: 'Confirm these choices.',
    menu: 'Choose an action.',
    source: '',
    target: 'Choose a highlighted target.',
};

const headline = computed(() => {
    if (props.view.stage === 'target' && props.model.board?.linkKind === 'attack') {
        return 'Choose what this creature attacks.';
    }
    if (props.view.stage === 'target' && props.model.board?.linkKind === 'block') {
        return 'Choose the attacker to block.';
    }
    if (props.view.stage === 'menu' && props.model.kind === 'priority') {
        return 'Choose an action for this card.';
    }
    return props.view.prompt || stageHints[props.view.stage] || 'Choose an option.';
});

const hint = computed(() => {
    if (props.view.unsupported) {
        return `This decision (${props.view.unsupported}) has no dedicated control; choose an Engine option below.`;
    }
    if (props.view.stage === 'source' && (props.view.cardIds.length || props.view.playerIds.length)) {
        return 'Highlighted cards can be selected.';
    }
    if (props.view.stage === 'target' && props.view.playerIds.length) {
        return 'Highlighted cards and life totals are legal choices.';
    }
    return '';
});

const counter = computed(() => {
    if (!['cardSelection', 'cardOrder'].includes(props.view.primitive)) {
        return '';
    }
    const count = props.view.selectedCardIds.length;
    return props.view.minimum === props.view.maximum
        ? `${count} / ${props.view.maximum}`
        : `${count} / ${props.view.minimum}–${props.view.maximum}`;
});

const needsConfirm = computed(() => {
    return ['cardSelection', 'cardOrder', 'cardName'].includes(props.view.primitive) ||
        props.view.stage === 'confirm' ||
        Boolean(props.view.number);
});

const showAllOptions = computed(() => {
    return props.model.actions.length > 0 &&
        (props.view.primitive === 'board' || props.view.stage === 'empty' || Boolean(props.view.unsupported));
});

const trayCards = computed(() => {
    const selectable = new Set(props.view.cardIds);
    return props.view.trayCardIds.map(id => {
        const card = props.model.describeCard(id);
        const selectedIndex = props.view.selectedCardIds.indexOf(id);
        return {
            ...card,
            order: props.view.ordered && selectedIndex >= 0 ? selectedIndex + 1 : null,
            selectable: selectable.has(id),
            selected: selectedIndex >= 0,
        };
    });
});
</script>

<style scoped>
.pixi-decision-panel {
    background: rgb(255 253 251 / 97%);
    border: 1px solid #9a8378;
    border-radius: 0.7rem;
    box-shadow: 0 0.8rem 2rem rgb(16 24 40 / 22%);
    color: #101828;
    display: grid;
    gap: 0.55rem;
    left: 1rem;
    max-height: min(32rem, 62vh);
    max-width: min(24rem, calc(100% - 2rem));
    overflow: auto;
    padding: 0.7rem 0.8rem;
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: max-content;
    z-index: 30;
}

@media (max-width: 700px) {
    .pixi-decision-panel {
        bottom: calc(var(--pixi-toolbar-height, 0px) + 4.2rem);
        left: 50%;
        top: auto;
        transform: translateX(-50%);
    }
}

.pixi-decision-panel header {
    align-items: baseline;
    display: flex;
    gap: 0.6rem;
    justify-content: space-between;
}

.pixi-decision-panel header strong { font-size: 0.86rem; }
.pixi-decision-panel header small { color: #475467; font-weight: 700; }

.pixi-decision-hint {
    color: #667085;
    font-size: 0.7rem;
    margin: 0;
}

.pixi-decision-options {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
}

.pixi-decision-options button,
.pixi-decision-panel footer button {
    background: #fff;
    border: 1px solid #98a2b3;
    border-radius: 0.45rem;
    color: #344054;
    cursor: pointer;
    font-size: 0.74rem;
    font-weight: 700;
    padding: 0.4rem 0.65rem;
    text-align: left;
}

.pixi-decision-options button:hover,
.pixi-decision-options button:focus-visible {
    border-color: #f59e0b;
    box-shadow: 0 0 0 2px rgb(245 158 11 / 30%);
    outline: none;
}

.pixi-decision-panel footer {
    display: flex;
    gap: 0.4rem;
    justify-content: flex-end;
}

.pixi-decision-panel footer button.primary {
    background: linear-gradient(145deg, #7d2f36, #552027);
    border-color: #552027;
    color: #fff;
}

.pixi-decision-panel footer button:disabled { cursor: not-allowed; opacity: 0.5; }

.pixi-decision-card-name {
    display: grid;
    font-size: 0.7rem;
    font-weight: 700;
    gap: 0.25rem;
}

.pixi-decision-card-name input {
    border: 2px solid #f59e0b;
    border-radius: 0.45rem;
    font-size: 0.9rem;
    padding: 0.35rem 0.5rem;
}

.pixi-decision-tray {
    display: flex;
    gap: 0.45rem;
    overflow-x: auto;
    padding: 0.3rem 0.1rem;
}

.pixi-decision-tray-card {
    background: #fff;
    border: 3px solid #d0d5dd;
    border-radius: 0.5rem;
    cursor: pointer;
    display: grid;
    flex: 0 0 5.6rem;
    gap: 0.2rem;
    padding: 0.2rem;
    position: relative;
}

.pixi-decision-tray-card img {
    aspect-ratio: 63 / 88;
    border-radius: 0.3rem;
    object-fit: cover;
    width: 100%;
}

.pixi-decision-tray-card span {
    font-size: 0.6rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.pixi-decision-tray-card.selectable { border-color: #f59e0b; }
.pixi-decision-tray-card.selected { border-color: #16a34a; }
.pixi-decision-tray-card:disabled { cursor: default; opacity: 0.55; }

.pixi-decision-order {
    background: #16a34a;
    border-radius: 999px;
    color: #fff;
    font-size: 0.7rem;
    left: 0.3rem;
    min-width: 1.3rem;
    padding: 0.1rem 0.3rem;
    position: absolute;
    text-align: center;
    top: 0.3rem;
}

.pixi-decision-all summary {
    color: #475467;
    cursor: pointer;
    font-size: 0.68rem;
    font-weight: 700;
}

.pixi-decision-all .pixi-decision-options { margin-top: 0.35rem; }
</style>
