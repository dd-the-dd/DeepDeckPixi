<template>
  <section
    class="pixi-game-prototype"
    :class="{
      'pixi-game-live': isPlay,
      'pixi-game-mobile-focus': mobileFocusEnabled,
    }"
    :data-mode="mode"
    aria-label="Client de jeu PixiJS"
    @touchstart.passive="beginMobilePlayerSwipe"
    @touchend.passive="endMobilePlayerSwipe"
  >
    <div
      ref="canvasHost"
      class="pixi-game-canvas"
      :aria-busy="imageDiagnostics.loading > 0 ? 'true' : 'false'"
      :data-card-images-expected="imageDiagnostics.expected"
      :data-card-images-failed="imageDiagnostics.failed"
      :data-card-images-loading="imageDiagnostics.loading"
      :data-card-images-missing="imageDiagnostics.missing"
      :data-card-images-ready="imageDiagnostics.ready"
    />

    <header class="pixi-game-topbar">
      <div class="pixi-game-brand">
        <span class="pixi-game-live-dot" />
        <img
          v-if="brandLogoUrl"
          class="pixi-game-brand-logo"
          :src="brandLogoUrl"
          :alt="brandName"
        >
        <strong v-else class="pixi-game-brand-name">{{ brandName }}</strong>
      </div>
      <span class="pixi-game-mode">Oracle Engine · PixiJS / WebGL</span>
      <div class="pixi-game-menu-actions">
        <span class="pixi-game-frame-rate">{{ fps }} FPS</span>
        <button v-if="!isReplay" type="button" class="pixi-return-menu" @click="emit('exit')">
          Retour au menu
        </button>
      </div>
    </header>

    <div v-if="scene?.outcome" class="pixi-game-outcome" role="status" aria-live="polite">
      <span>{{ scene.outcome.draw ? 'Game over' : 'Victory' }}</span>
      <strong>{{ scene.outcome.draw ? 'Draw game' : `GG, ${scene.outcome.winnerName}!` }}</strong>
      <small>{{ outcomeDetail }}</small>
    </div>

    <button
      v-for="(player, playerIndex) in displayPlayers"
      :key="player.id"
      type="button"
      class="pixi-player-hud"
      :class="hudClasses(player, playerIndex)"
      :style="playerHudStyle(player, playerIndex)"
      :disabled="isLiveGame && !player.targetable"
      @click="handlePlayerClick(player)"
    >
      <span class="pixi-player-identity">
        <strong>{{ player.name }}</strong>
        <span v-if="player.priority">priorité</span>
        <span
          v-for="damage in commanderDamageEntries(player)"
          :key="`${player.id}:${damage.commanderId}`"
          class="pixi-commander-damage"
          :style="commanderDamageStyle(damage)"
        >
          {{ damage.commanderName }} : {{ damage.amount }}
        </span>
      </span>
      <span class="pixi-turn-hud" :class="player.local ? 'pixi-turn-hud-bottom' : 'pixi-turn-hud-top'">
        <div class="pixi-phase-orbit">
          <span v-if="player.mana?.length" class="pixi-mana-pool" aria-label="Réserve de mana">
            <span v-for="mana in player.mana" :key="`${player.id}-${mana.symbol}`">
              <i
                class="ms ms-cost"
                :class="`ms-${mana.symbol.toLowerCase()}`"
                aria-hidden="true"
              />{{ mana.amount }}
            </span>
          </span>
          <span
            v-for="phaseOption in phaseMarkers"
            :key="`${player.id}-${phaseOption.id}`"
            class="pixi-phase-marker"
            :class="{ active: isPhaseMarkerActive(player, phaseOption) }"
            :data-phase-key="phaseOption.id"
            :aria-label="phaseOption.label"
            :title="phaseOption.label"
          >
            {{ phaseOption.glyph }}
          </span>
        </div>
        <span class="pixi-life-orb" :class="{ local: player.local }">{{ player.life }}</span>
      </span>
    </button>

    <nav
      v-if="mobileFocusEnabled"
      class="pixi-mobile-player-navigator"
      aria-label="Changer le joueur observé"
    >
      <button type="button" aria-label="Joueur précédent" @click="focusAdjacentOpponent(-1)">
        ‹
      </button>
      <div class="pixi-mobile-player-summaries">
        <button
          v-for="player in summarizedPlayers"
          :key="player.id"
          type="button"
          :style="playerHudStyle(player, allPlayers.indexOf(player))"
          @click="focusOpponent(player.id)"
        >
          <span>{{ player.name }}</span>
          <strong>{{ player.life }} PV · {{ permanentCount(player) }} perm.</strong>
        </button>
      </div>
      <button type="button" aria-label="Joueur suivant" @click="focusAdjacentOpponent(1)">
        ›
      </button>
    </nav>

    <aside
      v-if="inspectedZone"
      ref="zoneInspectorElement"
      class="pixi-zone-inspector"
      :class="inspectedZone.player.local
        ? 'pixi-zone-inspector-local'
        : 'pixi-zone-inspector-opponent'"
      role="dialog"
      aria-modal="false"
      :aria-label="`${knownZoneLabel(inspectedZone.zone.id)} de ${inspectedZone.player.name}`"
      tabindex="-1"
      @keydown.esc="closeKnownZone"
    >
      <header>
        <div>
          <span>{{ inspectedZone.player.name }}</span>
          <strong>{{ knownZoneLabel(inspectedZone.zone.id) }} · {{ inspectedZone.zone.count }}</strong>
        </div>
        <button type="button" aria-label="Fermer la zone" @click="closeKnownZone">
          ×
        </button>
      </header>
      <div class="pixi-zone-inspector-grid">
        <button
          v-for="card in inspectedZone.zone.cards"
          :key="card.id"
          type="button"
          :class="{ linked: card.linkedTo }"
          @click="handleKnownZoneCardClick(card, inspectedZone.player, inspectedZone.zone.id)"
          @focus="emitCardHover(card)"
          @blur="emit('card-leave')"
          @mouseenter="emitCardHover(card)"
          @mouseleave="emit('card-leave')"
        >
          <img :src="card.imageUrl || magicCardBackUrl" :alt="card.name">
          <span>{{ card.name }}</span>
          <small v-if="card.linkedTo">Exil lié</small>
        </button>
      </div>
    </aside>

    <aside v-if="displayStackItems.length" class="pixi-stack-panel">
      <div class="pixi-panel-title">
        <strong>Stack</strong>
        <span>Priorité : Avatar Aang</span>
      </div>
      <div class="pixi-stack-card-fan" :style="{ '--stack-count': displayStackItems.length }">
        <button
          v-for="(item, index) in displayStackItems"
          :key="item.id"
          type="button"
          class="pixi-stack-item"
          :class="{
            top: index === displayStackItems.length - 1,
            ability: item.type !== 'INSTANT' && item.type !== 'spell',
            targetable: item.targetable,
          }"
          :style="{ '--stack-index': index }"
          @click="handleStackClick(item)"
          @mouseenter="emitCardHover(item.card)"
          @mouseleave="emit('card-leave')"
        >
          <strong>{{ item.name }}</strong>
          <img
            class="pixi-stack-art"
            :src="item.imageUrl || magicCardBackUrl"
            :alt="item.name"
          >
          <span>{{ item.type === 'TRIGGER' ? 'Triggered ability' : item.type }}</span>
          <small>{{ item.detail }}</small>
        </button>
      </div>
    </aside>

    <div class="pixi-game-controls">
      <template v-if="isReplay">
        <span class="pixi-replay-label">{{ scene.spectator ? 'Live spectator' : 'Official replay' }}</span>
      </template>
      <template v-else-if="isLiveGame">
        <button
          type="button"
          class="pixi-auto-pass"
          :class="{ active: scene.controls?.autoPassActive }"
          :aria-pressed="scene.controls?.autoPassActive ? 'true' : 'false'"
          @click="emit('toggle-priority')"
        >
          Auto-pass: {{ scene.controls?.autoPassActive ? 'ON' : 'OFF' }}
        </button>
        <button
          v-if="scene.controls?.showPassStack"
          type="button"
          :class="{ danger: scene.controls.passStackActive }"
          :disabled="!scene.controls.canPassStack"
          @click="emit('toggle-pass-stack')"
        >
          {{ scene.controls.passStackActive ? 'Arrêter auto-pass' : 'Passer toute la pile' }}
        </button>
        <button
          v-if="scene.controls?.showPassPriority"
          type="button"
          class="primary pixi-pass-priority"
          :disabled="!scene.controls?.canPassPriority"
          @click="emit('pass-priority')"
        >
          Pass priority
        </button>
        <button
          v-else
          type="button"
          class="primary"
          :disabled="!scene.controls?.canAdvance"
          @click="emit('advance')"
        >
          {{ scene.controls?.advanceLabel || 'Continuer' }}
        </button>
      </template>
      <template v-else>
        <button type="button" class="primary" :disabled="animating" @click="animateCombat">
          {{ animating ? 'Combat…' : 'Animer une attaque' }}
        </button>
        <button type="button" @click="drawCard">
          Piocher
        </button>
        <button type="button" @click="createToken">
          Créer un token
        </button>
        <button type="button" @click="toggleStack">
          Ajouter à la pile
        </button>
      </template>
    </div>

    <div class="pixi-game-hint">
      <strong>{{ displayStatus }}</strong>
      <span>{{ isReplay
        ? 'Les décisions enregistrées défilent automatiquement dans la table Pixi.'
        : isLiveGame
          ? 'Les cartes et les actions proviennent de la session Rust active.'
          : 'La main reste ancrée au viewport; le survol ne déplace aucun élément DOM.' }}</span>
    </div>

    <div class="pixi-zone-label pixi-zone-label-opponent">
      BATTLEFIELD ADVERSE
    </div>
    <div class="pixi-zone-label pixi-zone-label-local">
      VOTRE BATTLEFIELD
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
    Application,
    Container,
    Graphics,
    Rectangle,
    Sprite,
    Text,
    TextStyle,
    Texture,
} from 'pixi.js';
import {
    pixiCardOutlineColor,
    pixiHandScale,
    pixiPermanentScale,
    pixiPrivateZonePosition,
    pixiToggledZoneKey,
} from '../helpers/PixiGameLayout.mjs';

const props = defineProps({
    cardBackUrl: {
        default: 'https://cards.scryfall.io/back.png',
        type: String,
    },
    brandLogoUrl: {
        default: '',
        type: String,
    },
    brandName: {
        default: 'DeepDeck Pixi',
        type: String,
    },
    mode: {
        default: 'play',
        type: String,
        validator: value => ['play', 'replay'].includes(value),
    },
    scene: {
        default: null,
        type: Object,
    },
});
const emit = defineEmits([
    'advance',
    'card-click',
    'card-double-click',
    'card-hover',
    'card-leave',
    'exit',
    'player-click',
    'pass-priority',
    'stack-click',
    'toggle-pass-stack',
    'toggle-priority',
]);
const canvasHost = ref(null);
const fps = ref(60);
const phase = ref('main');
const opponentLife = ref(37);
const animating = ref(false);
const status = ref('Survolez une carte de la main pour la révéler.');
const compactViewport = ref(typeof window !== 'undefined' && window.innerWidth <= 700);
const focusedOpponentId = ref('');
const inspectedZoneKey = ref(null);
const zoneInspectorElement = ref(null);
const swipeStartX = ref(null);
const stackItems = ref([
    {
        id: 'stack-1',
        type: 'TRIGGER',
        name: 'Firebending Lesson',
        detail: 'Deal 2 damage to any target',
    },
]);

const demoPlayers = computed(() => [
    {
        active: false,
        handCount: 6,
        id: 'katara',
        life: opponentLife.value,
        local: false,
        mana: [],
        name: 'Katara',
    },
    {
        active: true,
        handCount: handViews.length || handModels.length,
        id: 'aang',
        life: 40,
        local: true,
        mana: [
            { amount: 1, symbol: 'W' },
            { amount: 2, symbol: 'U' },
            { amount: 1, symbol: 'R' },
        ],
        name: 'Avatar Aang',
        priority: true,
    },
]);
const isPlay = computed(() => props.mode === 'play');
const isLiveGame = computed(() => isPlay.value && Boolean(props.scene));
const isReplay = computed(() => props.mode === 'replay');
const allPlayers = computed(() => props.scene?.players ?? demoPlayers.value);
const localPlayer = computed(() => {
    return allPlayers.value.find(player => player.local) ?? allPlayers.value[0] ?? null;
});
const opponentPlayers = computed(() => {
    return allPlayers.value.filter(player => player.id !== localPlayer.value?.id);
});
const mobileFocusEnabled = computed(() => {
    return compactViewport.value && allPlayers.value.length > 2;
});
const focusedOpponent = computed(() => {
    const selected = opponentPlayers.value.find(player => player.id === focusedOpponentId.value);
    const active = opponentPlayers.value.find(player => player.active);
    return selected ?? active ?? opponentPlayers.value[0] ?? null;
});
const displayPlayers = computed(() => {
    if (!mobileFocusEnabled.value) {
        return allPlayers.value;
    }
    return [focusedOpponent.value, localPlayer.value].filter(Boolean);
});
const summarizedPlayers = computed(() => {
    const visibleIds = new Set(displayPlayers.value.map(player => player.id));
    return allPlayers.value.filter(player => !visibleIds.has(player.id));
});
const inspectedZone = computed(() => {
    if (!inspectedZoneKey.value) {
        return null;
    }
    const player = allPlayers.value.find(candidate => {
        return candidate.id === inspectedZoneKey.value.playerId;
    });
    const zone = player?.zones?.find(candidate => {
        return candidate.id === inspectedZoneKey.value.zoneId;
    });
    return player && zone ? { player, zone } : null;
});
const displayStackItems = computed(() => props.scene?.stack ?? stackItems.value);
const displayPhase = computed(() => props.scene?.phase ?? phase.value);
const displayStatus = computed(() => props.scene?.status ?? status.value);
const outcomeDetail = computed(() => {
    const reason = props.scene?.outcome?.reason;
    const messages = {
        commanderDamage: 'The game was decided by 21 commander damage.',
        drawFromEmptyLibrary: 'The last opponent could not draw from an empty library.',
        lifeTotal: 'The last opponent fell to 0 life.',
        mandatoryLoop: 'A mandatory loop ended the game in a draw.',
        poison: 'The game was decided by 10 poison counters.',
        simultaneous: 'Every remaining player lost at the same time.',
        simulationLimit: 'The game reached its simulation limit.',
        spellOrAbility: 'A spell or ability decided the game.',
        unpaidPact: 'The last opponent could not pay a pact cost.',
    };
    return messages[reason] ?? (props.scene?.outcome?.draw
        ? 'No winner this time.'
        : 'Well played. The game is yours.');
});

const phaseMarkers = [
    { glyph: '↻', id: 'untap', label: 'Dégagement, entretien et pioche', phases: ['untap', 'upkeep', 'draw'] },
    { glyph: '✦', id: 'main', label: 'Première phase principale', main: true, phases: ['main'] },
    { glyph: '⚔', id: 'combat', label: 'Attaque et blessures de combat', phases: ['attack', 'combat', 'damageOrder'] },
    { glyph: '◆', id: 'blockers', label: 'Déclaration des bloqueurs', phases: ['blockers'] },
    { glyph: '✦', id: 'main2', label: 'Deuxième phase principale', main: true, phases: ['main2', 'secondMain'] },
    { glyph: '☾', id: 'end', label: 'Fin de tour et nettoyage', phases: ['end', 'discard'] },
];

const handModels = [
    { accent: '#4db4ff', art: ['#183b68', '#4a9dd0'], name: 'Multiverse Passage', rules: 'Choose a color as this land enters.', type: 'Land' },
    { accent: '#ffd45a', art: ['#6e4c18', '#d5a943'], name: 'Firebending Lesson', rules: 'Firebend 2, then deal 2 damage.', type: 'Sorcery' },
    { accent: '#80e2ca', art: ['#174f4b', '#5ebba5'], name: 'Studious First Year', rules: 'Prowess. Whenever you cast…', stats: '2/2', type: 'Creature' },
    { accent: '#7ac7ff', art: ['#13375f', '#5ba6d7'], name: 'Counterspell', rules: 'Counter target spell.', type: 'Instant' },
    { accent: '#eac079', art: ['#49351c', '#ba8c50'], name: 'Talon Gates', rules: '{1}, {T}: Add one mana of any color.', type: 'Land' },
    { accent: '#e9f1ff', art: ['#33415d', '#9baec8'], name: 'Day of Judgment', rules: 'Destroy all creatures.', type: 'Sorcery' },
    { accent: '#89d68b', art: ['#254b2b', '#6cae68'], name: 'Forest', rules: '{T}: Add {G}.', type: 'Basic Land' },
];

const localPermanentModels = [
    { accent: '#67c7ff', art: ['#17385d', '#518ac0'], counters: 2, name: 'Avatar Aang', rules: 'Flying, vigilance', stats: '6/6', type: 'Legendary Creature' },
    { accent: '#80e2ca', art: ['#193d3a', '#5f9d91'], name: 'Studious First Year', rules: 'Prowess', stats: '2/2', type: 'Creature' },
    { accent: '#d7b071', art: ['#3f321f', '#967245'], name: 'Talon Gates', rules: 'Mana ability', type: 'Land' },
    { accent: '#69b9f0', art: ['#183a55', '#4f92b9'], name: 'Island', rules: '{T}: Add {U}.', type: 'Basic Land' },
];

const opponentPermanentModels = [
    { accent: '#b9d8ff', art: ['#263d60', '#688bb6'], name: 'Katara, the Fearless', rules: 'Ward {2}', stats: '4/4', type: 'Legendary Creature' },
    { accent: '#bcc6d8', art: ['#303742', '#7d8797'], name: 'Smothering Abomination', rules: 'Flying. Sacrifice a creature…', stats: '4/3', type: 'Creature' },
    { accent: '#98c78f', art: ['#29432b', '#678b5f'], name: 'Exotic Orchard', rules: 'Add a color an opponent could produce.', type: 'Land' },
];

let app = null;
let backgroundLayer = null;
let combatLayer = null;
let cardLayer = null;
let effectLayer = null;
let handLayer = null;
let opponentHandLayer = null;
let localPermanentViews = [];
let opponentPermanentViews = [];
let handViews = [];
let opponentHandViews = [];
let tokenViews = [];
let livePlayerViews = [];
let linkedExileViews = [];
let livePlayerAnchors = new Map();
const liveCardPositions = new Map();
let frameCounter = 0;
let elapsedFpsTime = 0;
let arrowAlpha = 0;
let attackArrow = null;
let mobileFocusTimer = null;
const textures = new Set();
const imageTexturePromises = new Map();
const animatedViews = new Set();
const imageDiagnostics = ref({
    expected: 0,
    failed: 0,
    loading: 0,
    missing: 0,
    ready: 0,
});

const cardWidth = 118;
const cardHeight = 166;
// Scryfall publishes the canonical card back independently from individual
// printings. Hosts can override this with a same-origin cached/proxied URL.
const magicCardBackUrl = props.cardBackUrl || 'https://cards.scryfall.io/back.png';
const imageLoadMaxAttempts = 4;
const imageLoadMaxConcurrent = 6;
const imageLoadRetryDelayMs = 250;
const imageLoadTimeoutMs = 8_000;
const queuedImageLoads = [];
let activeImageLoads = 0;

function runQueuedImageLoads() {
    while (activeImageLoads < imageLoadMaxConcurrent && queuedImageLoads.length) {
        const queued = queuedImageLoads.shift();
        activeImageLoads += 1;
        Promise.resolve()
            .then(queued.task)
            .then(queued.resolve, queued.reject)
            .finally(() => {
                activeImageLoads -= 1;
                runQueuedImageLoads();
            });
    }
}

function enqueueImageLoad(task) {
    return new Promise((resolve, reject) => {
        queuedImageLoads.push({ reject, resolve, task });
        runQueuedImageLoads();
    });
}

function waitForImageRetry(attempt) {
    return new Promise(resolve => {
        window.setTimeout(resolve, imageLoadRetryDelayMs * (2 ** attempt));
    });
}

function pixiImageUrl(url) {
    try {
        const parsed = new URL(url, window.location.href);
        if (parsed.protocol === 'https:' && parsed.hostname === 'cards.scryfall.io') {
            return `/api/scryfall-images${parsed.pathname}${parsed.search}`;
        }
    } catch {
        // Let the image loader report malformed or unsupported URLs normally.
    }
    return url;
}

function loadDecodedImage(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        let settled = false;
        const finish = (callback, value) => {
            if (settled) {
                return;
            }
            settled = true;
            window.clearTimeout(timeoutId);
            image.onload = null;
            image.onerror = null;
            callback(value);
        };
        const timeoutId = window.setTimeout(() => {
            // An Image request can remain pending indefinitely. Because Pixi limits
            // concurrent downloads, a handful of stalled CDN requests otherwise
            // prevents every image still in the queue from ever starting.
            finish(reject, new Error(`Timed out loading card image: ${url}`));
            image.src = '';
        }, imageLoadTimeoutMs);
        image.crossOrigin = 'anonymous';
        image.decoding = 'async';
        image.onload = async () => {
            try {
                await image.decode?.();
                finish(resolve, image);
            } catch (error) {
                if (image.complete && image.naturalWidth > 0) {
                    finish(resolve, image);
                } else {
                    finish(reject, error);
                }
            }
        };
        image.onerror = () => finish(
            reject,
            new Error(`Unable to load card image: ${url}`),
        );
        image.src = pixiImageUrl(url);
    });
}

async function loadImageTextureWithRetries(url) {
    for (let attempt = 0; attempt < imageLoadMaxAttempts; attempt += 1) {
        try {
            return await enqueueImageLoad(async () => {
                const image = await loadDecodedImage(url);
                const texture = Texture.from(image);
                if (!texture || texture.destroyed || texture.baseTexture?.destroyed) {
                    throw new Error(`Pixi rejected card image texture: ${url}`);
                }
                textures.add(texture);
                return texture;
            });
        } catch {
            if (attempt === imageLoadMaxAttempts - 1) {
                return null;
            }
            await waitForImageRetry(attempt);
        }
    }
    return null;
}

function loadImageTexture(url) {
    if (!url) {
        return Promise.resolve(null);
    }
    const cachedPromise = imageTexturePromises.get(url);
    if (cachedPromise) {
        return cachedPromise.then(texture => {
            if (!texture?.destroyed) {
                return texture;
            }
            if (imageTexturePromises.get(url) === cachedPromise) {
                imageTexturePromises.delete(url);
            }
            return loadImageTexture(url);
        });
    }
    const texturePromise = loadImageTextureWithRetries(url).then(texture => {
        if (!texture && imageTexturePromises.get(url) === texturePromise) {
            imageTexturePromises.delete(url);
        }
        return texture;
    });
    imageTexturePromises.set(url, texturePromise);
    return texturePromise;
}

function replaceSpriteTextureWhenReady(
    sprite,
    url,
    width,
    height,
    onReady = null,
    onError = null,
) {
    const requestingApp = app;
    loadImageTexture(url).then(texture => {
        if (!texture) {
            onError?.();
            return;
        }
        if (!requestingApp || app !== requestingApp || sprite.destroyed) {
            if (!app || app !== requestingApp) {
                textures.delete(texture);
                texture.destroy(true);
            }
            return;
        }
        if (sprite.requestedImageUrl && sprite.requestedImageUrl !== url) {
            return;
        }
        sprite.texture = texture;
        sprite.width = width;
        sprite.height = height;
        onReady?.();
    });
}

function refreshImageDiagnostics() {
    const sprites = livePlayerViews.flatMap(entry => [
        ...entry.permanentViews,
        ...entry.handViews,
        ...(entry.zoneViews ?? []),
    ]).map(view => view.cardSprite).filter(Boolean);
    const states = sprites
        .filter(sprite => sprite.requestedImageUrl !== magicCardBackUrl)
        .map(sprite => sprite.imageLoadState);
    imageDiagnostics.value = {
        expected: states.length,
        failed: states.filter(state => state === 'failed').length,
        loading: states.filter(state => state === 'loading').length,
        missing: states.filter(state => state === 'missing').length,
        ready: states.filter(state => state === 'ready').length,
    };
}

function createFaceUpPlaceholder(model, width, height) {
    const placeholder = new Container();
    const frame = new Graphics();
    frame.beginFill(0xf8f5ec);
    frame.lineStyle(2, 0x9b8f78, 0.9);
    frame.drawRoundedRect(-width / 2, -height / 2, width, height, 8);
    frame.endFill();

    const art = new Graphics();
    art.beginFill(0xdde5e8);
    art.drawRect(-width / 2 + 7, -height / 2 + 25, width - 14, Math.max(28, height * 0.42));
    art.endFill();

    const name = new Text(model.name, new TextStyle({
        fill: 0x17212b,
        fontFamily: 'system-ui',
        fontSize: Math.max(8, Math.min(12, width / 9)),
        fontWeight: '700',
        wordWrap: true,
        wordWrapWidth: width - 14,
    }));
    name.anchor.set(0.5, 0);
    name.position.set(0, -height / 2 + 7);

    const type = new Text(model.type, new TextStyle({
        fill: 0x475467,
        fontFamily: 'system-ui',
        fontSize: Math.max(7, Math.min(10, width / 11)),
        wordWrap: true,
        wordWrapWidth: width - 14,
    }));
    type.anchor.set(0.5, 0);
    type.position.set(0, height * 0.05);

    placeholder.addChild(frame, art, name, type);
    return placeholder;
}

function targetView(view, x, y, rotation = view.rotation, scale = 1) {
    view.targetX = x;
    view.targetY = y;
    view.targetRotation = rotation;
    view.targetScale = scale;
    animatedViews.add(view);
}

function createBadge(container, value) {
    const badge = new Container();
    const circle = new Graphics();
    circle.beginFill(0xe6a63f);
    circle.lineStyle(2, 0xffe1a2);
    circle.drawCircle(0, 0, 12);
    circle.endFill();
    const label = new Text(String(value), new TextStyle({
        fill: 0x1b1206,
        fontFamily: 'system-ui',
        fontSize: 12,
        fontWeight: '700',
    }));
    label.anchor.set(0.5);
    badge.addChild(circle, label);
    badge.position.set(cardWidth / 2 - 4, -cardHeight / 2 + 5);
    container.addChild(badge);
}

function createSelectionOrderBadge(container, value, width, height) {
    const badge = new Container();
    const shadow = new Graphics();
    shadow.beginFill(0x101828, 0.38);
    shadow.drawCircle(1, 2, 16);
    shadow.endFill();
    const circle = new Graphics();
    circle.beginFill(0xdc2626);
    circle.lineStyle(3, 0xffffff);
    circle.drawCircle(0, 0, 15);
    circle.endFill();
    const label = new Text(String(value), new TextStyle({
        fill: 0xffffff,
        fontFamily: 'system-ui',
        fontSize: 15,
        fontWeight: '900',
        stroke: 0x7f1d1d,
        strokeThickness: 2,
    }));
    label.anchor.set(0.5);
    badge.addChild(shadow, circle, label);
    badge.position.set(-width / 2 + 15, -height / 2 + 15);
    badge.eventMode = 'none';
    badge.label = 'card-selection-order';
    container.addChild(badge);
}

function createStatsBadge(container, value) {
    const badge = new Container();
    const shadow = new Graphics();
    shadow.beginFill(0x000000, 0.42);
    shadow.drawRoundedRect(-21, -11, 42, 24, 10);
    shadow.endFill();
    const background = new Graphics();
    background.beginFill(0x101828, 1);
    background.lineStyle(2, 0xffffff, 1);
    background.drawRoundedRect(-20, -12, 40, 24, 10);
    background.endFill();
    const label = new Text(String(value), new TextStyle({
        fill: 0xffffff,
        fontFamily: 'system-ui',
        fontSize: 12,
        fontWeight: '800',
        stroke: 0x101828,
        strokeThickness: 2,
    }));
    label.anchor.set(0.5);
    badge.addChild(shadow, background, label);
    badge.position.set(cardWidth / 2 - 14, cardHeight / 2 - 12);
    container.addChild(badge);
    return badge;
}

function createKnownCardBadge(container, width = cardWidth, height = cardHeight) {
    const badge = new Container();
    const background = new Graphics();
    background.beginFill(0x101828, 0.92);
    background.lineStyle(2, 0xffffff, 0.95);
    background.drawCircle(0, 0, 13);
    background.endFill();
    const eye = new Graphics();
    eye.lineStyle(2, 0xffffff, 1);
    eye.drawEllipse(0, 0, 8, 5);
    eye.beginFill(0x60a5fa, 1);
    eye.drawCircle(0, 0, 3);
    eye.endFill();
    badge.addChild(background, eye);
    badge.position.set(-width / 2 + 15, -height / 2 + 15);
    badge.eventMode = 'none';
    badge.label = 'known-card-indicator';
    container.addChild(badge);
    return badge;
}

function createHoveredStatsBadge(container, value) {
    const badge = new Container();
    const shadow = new Graphics();
    shadow.beginFill(0x000000, 0.48);
    shadow.drawRoundedRect(-34, -20, 68, 42, 16);
    shadow.endFill();
    const background = new Graphics();
    background.beginFill(0x101828, 1);
    background.lineStyle(3, 0xffffff, 1);
    background.drawRoundedRect(-32, -20, 64, 40, 15);
    background.endFill();
    const label = new Text(String(value), new TextStyle({
        fill: 0xffffff,
        fontFamily: 'system-ui',
        fontSize: 21,
        fontWeight: '900',
        stroke: 0x101828,
        strokeThickness: 3,
    }));
    label.anchor.set(0.5);
    badge.addChild(shadow, background, label);
    badge.position.set(cardWidth / 2 - 18, cardHeight / 2 - 18);
    badge.visible = false;
    container.addChild(badge);
    return badge;
}

function createZoneBadge(container, zoneId, count) {
    const shortName = {
        commandZone: 'CMD',
        exile: 'EX',
        graveyard: 'GY',
        linkedExile: 'LIÉ',
        library: 'LIB',
    }[zoneId] ?? zoneId.toUpperCase();
    const label = new Text(
        `${shortName} ${count}`,
        new TextStyle({
            fill: 0xffffff,
            fontFamily: 'system-ui',
            fontSize: 16,
            fontWeight: '800',
            stroke: 0x101828,
            strokeThickness: 5,
        }),
    );
    label.anchor.set(0.5);
    label.position.set(0, cardHeight / 2 - 11);
    container.addChild(label);
    return label;
}

function createCardView(model, options = {}) {
    const view = new Container();
    const width = options.width ?? cardWidth;
    const height = options.height ?? cardHeight;
    const showsBack = Boolean(options.back);
    const imageUrl = showsBack ? magicCardBackUrl : model.imageUrl;
    const retainedSprite = options.sprite ?? null;
    const retainedTextureReady = retainedSprite?.loadedImageUrl === imageUrl;
    const placeholder = showsBack ? null : createFaceUpPlaceholder(model, width, height);
    const sprite = retainedSprite ?? new Sprite(
        showsBack ? Texture.from(magicCardBackUrl) : Texture.WHITE,
    );
    sprite.anchor.set(0.5);
    sprite.width = width;
    sprite.height = height;
    sprite.visible = showsBack || retainedTextureReady;
    sprite.requestedImageUrl = imageUrl;
    sprite.imageLoadState = showsBack
        ? 'ready'
        : retainedTextureReady
            ? 'ready'
            : imageUrl
                ? 'loading'
                : 'missing';
    if (retainedTextureReady) {
        if (placeholder) {
            placeholder.visible = false;
        }
    } else if (imageUrl) {
        sprite.texture = showsBack ? Texture.from(magicCardBackUrl) : Texture.WHITE;
        replaceSpriteTextureWhenReady(sprite, imageUrl, width, height, () => {
            if (sprite.requestedImageUrl !== imageUrl) {
                return;
            }
            sprite.loadedImageUrl = imageUrl;
            sprite.imageLoadState = 'ready';
            sprite.visible = true;
            if (placeholder) {
                placeholder.visible = false;
            }
            refreshImageDiagnostics();
        }, () => {
            if (!sprite.destroyed && sprite.requestedImageUrl === imageUrl) {
                sprite.imageLoadState = 'failed';
                refreshImageDiagnostics();
            }
        });
    }
    if (placeholder) {
        view.addChild(placeholder);
    }
    view.addChild(sprite);
    const outlineColor = pixiCardOutlineColor({
        ...model,
        sceneZone: model.sceneZone || options.sceneZone,
    });
    if (outlineColor !== null) {
        const outline = new Graphics();
        const outlineWidth = model.targetable ? 5 : 4;
        const outlineInset = outlineWidth / 2;
        outline.lineStyle(outlineWidth + 5, outlineColor, 0.24);
        outline.drawRoundedRect(
            -width / 2 - 4,
            -height / 2 - 4,
            width + 8,
            height + 8,
            11,
        );
        outline.lineStyle(outlineWidth, outlineColor, 1);
        outline.drawRoundedRect(
            -width / 2 + outlineInset,
            -height / 2 + outlineInset,
            width - outlineWidth,
            height - outlineWidth,
            7,
        );
        outline.eventMode = 'none';
        outline.label = 'card-action-outline';
        view.addChild(outline);
        view.cardOutline = outline;
    }
    view.model = model;
    view.cardSprite = sprite;
    view.targetX = 0;
    view.targetY = 0;
    view.targetRotation = 0;
    view.targetScale = 1;
    view.eventMode = options.interactive ? 'static' : 'none';
    view.cursor = options.interactive ? 'pointer' : 'default';
    view.hitArea = new Rectangle(-cardWidth / 2, -cardHeight / 2, cardWidth, cardHeight);
    if (model.counters) {
        createBadge(view, model.counters);
    }
    if (Number(model.selectionOrder) > 0) {
        createSelectionOrderBadge(view, model.selectionOrder, width, height);
    }
    if (model.knownToViewer) {
        createKnownCardBadge(view, width, height);
    }
    if (options.showStats && model.stats) {
        createStatsBadge(view, model.stats);
        view.hoveredStatsBadge = createHoveredStatsBadge(view, model.stats);
    }
    if (options.interactive && options.sceneCard) {
        view.sceneCard = options.sceneCard;
        view.scenePlayer = options.scenePlayer;
        view.sceneZone = options.sceneZone;
        let lastClickAt = 0;
        view.on('pointerover', () => {
            view.hovered = true;
            view.parent.sortableChildren = true;
            view.parent.zIndex = 100;
            view.zIndex = 1000;
            if (view.hoveredStatsBadge) {
                view.hoveredStatsBadge.visible = true;
                view.hoveredStatsBadge.scale.set(1 / Math.max(0.5, view.restScale ?? 1));
            }
            if (view.sceneZone === 'hand' && view.scenePlayer?.local) {
                targetView(
                    view,
                    view.restX,
                    app.screen.height - cardHeight / 2 - 24,
                    0,
                    Math.max(1.18, (view.restScale ?? 1) * 1.08),
                );
            } else if (view.sceneZone !== 'battlefield') {
                targetView(view, view.restX, view.restY - 34, 0, 0.86);
            } else {
                targetView(view, view.restX, view.restY, view.restRotation, view.restScale * 1.06);
            }
            emit('card-hover', {
                card: view.sceneCard.raw ?? view.sceneCard,
                player: view.scenePlayer.raw ?? view.scenePlayer,
            });
        });
        view.on('pointerout', () => {
            view.hovered = false;
            view.parent.zIndex = view.parent.restZIndex ?? 0;
            view.zIndex = view.restZIndex ?? view.handIndex ?? 10;
            if (view.hoveredStatsBadge) {
                view.hoveredStatsBadge.visible = false;
            }
            targetView(view, view.restX, view.restY, view.restRotation, view.restScale);
            emit('card-leave');
        });
        view.on('pointertap', () => {
            if (
                ['graveyard', 'exile'].includes(view.sceneZone) &&
                Array.isArray(view.zoneCards)
            ) {
                openKnownZone(view.scenePlayer, {
                    cards: view.zoneCards,
                    count: view.zoneCount,
                    id: view.sceneZone,
                });
                return;
            }
            const eventPayload = {
                card: view.sceneCard.raw ?? view.sceneCard,
                player: view.scenePlayer.raw ?? view.scenePlayer,
                zone: view.sceneZone,
            };
            const clickedAt = performance.now();
            emit('card-click', eventPayload);
            if (clickedAt - lastClickAt < 320) {
                emit('card-double-click', eventPayload);
            }
            lastClickAt = clickedAt;
        });
    } else if (options.interactive) {
        view.on('pointerover', () => {
            view.hovered = true;
            view.parent.sortableChildren = true;
            view.zIndex = 100;
            if (options.hoverOnly) {
                targetView(
                    view,
                    view.restX,
                    view.restY,
                    view.restRotation,
                    view.restScale * 1.28,
                );
            } else {
                targetView(view, view.restX, app.screen.height - cardHeight / 2 - 18, 0, 1.13);
            }
            status.value = options.hoverLabel || `${model.name} · ${model.type}`;
        });
        view.on('pointerout', () => {
            view.hovered = false;
            view.zIndex = view.restZIndex ?? view.handIndex ?? 10;
            targetView(
                view,
                view.restX,
                view.restY,
                view.restRotation,
                options.hoverOnly ? view.restScale : 1,
            );
            status.value = 'Survolez une carte de la main pour la révéler.';
        });
    }
    return view;
}

function sceneCardModel(card, sceneZone = '') {
    const raw = card.raw ?? card;
    const power = card.currentPower ?? raw.currentPower ?? card.power ?? raw.power;
    const toughness = card.currentToughness ??
        raw.currentToughness ??
        card.toughness ??
        raw.toughness;
    return {
        accent: card.targetable ? '#dc2626' : (card.commander ? '#d4a72c' : '#667085'),
        actionable: Boolean(card.actionable),
        art: ['#344054', '#98a2b3'],
        commander: Boolean(card.commander),
        counters: Number(card.counters ?? 0),
        imageUrl: card.imageUrl ??
            card.urlFront ??
            card.selectedOption?.imageUrl ??
            card.selectedOption?.urlFront ??
            raw.imageUrl ??
            raw.urlFront ??
            raw.selectedOption?.imageUrl ??
            raw.selectedOption?.urlFront ??
            '',
        knownToViewer: Boolean(card.knownToViewer ?? raw.knownToViewer),
        name: card.name ?? raw.name ?? 'Unknown card',
        rules: raw.oracleText ?? '',
        sceneZone: card.sourceZone || raw.sourceZone || sceneZone,
        selectionOrder: Number(card.selectionOrder ?? 0),
        stats: power !== null && power !== undefined
            ? `${power}/${toughness ?? 0}`
            : '',
        targetable: Boolean(card.targetable),
        type: raw.typeLine ?? card.typeLine ?? 'Card',
    };
}

function indexLiveSceneViews() {
    const indexedViews = new Map();
    for (const entry of livePlayerViews) {
        for (const view of [
            ...entry.permanentViews,
            ...entry.handViews,
            ...(entry.zoneViews ?? []),
        ]) {
            if (view.cardId) {
                liveCardPositions.set(view.cardId, {
                    rotation: view.rotation,
                    scale: view.scale.x,
                    x: view.x,
                    y: view.y,
                });
                indexedViews.set(view.cardId, view);
            }
        }
    }
    for (const view of linkedExileViews) {
        if (view.cardId) {
            liveCardPositions.set(view.cardId, {
                rotation: view.rotation,
                scale: view.scale.x,
                x: view.x,
                y: view.y,
            });
            indexedViews.set(view.cardId, view);
        }
    }
    return indexedViews;
}

function liveViewFingerprint(card, zone, options = {}) {
    const model = sceneCardModel(card, zone);
    return JSON.stringify([
        zone,
        Boolean(options.back),
        Boolean(options.showStats),
        options.zoneCount ?? null,
        model.accent,
        model.actionable,
        model.commander,
        model.counters,
        model.imageUrl,
        model.knownToViewer,
        model.name,
        model.rules,
        model.selectionOrder,
        model.stats,
        model.targetable,
        model.type,
    ]);
}

function reuseLiveView(indexedViews, card, player, zone, fingerprint) {
    const view = indexedViews.get(card.id);
    if (!view || view.liveFingerprint !== fingerprint) {
        return null;
    }
    indexedViews.delete(card.id);
    view.model = sceneCardModel(card, zone);
    view.sceneCard = card;
    view.scenePlayer = player;
    view.sceneZone = zone;
    view.attachedTo = card.attachedTo ?? null;
    view.linkedTo = card.linkedTo ?? null;
    view.cardKind = card.kind ?? 'other';
    view.tapped = Boolean(card.tapped);
    return view;
}

function destroyStaleLiveViews(indexedViews) {
    for (const view of indexedViews.values()) {
        animatedViews.delete(view);
        view.parent?.removeChild(view);
        view.destroy({ children: true, texture: false, baseTexture: false });
    }
}

function resetLiveSceneIndexes() {
    handViews = [];
    opponentHandViews = [];
    localPermanentViews = [];
    opponentPermanentViews = [];
    tokenViews = [];
    livePlayerViews = [];
    linkedExileViews = [];
    livePlayerAnchors = new Map();
}

function createLiveCardView(card, player, zone, indexedViews) {
    const model = sceneCardModel(card, zone);
    const fingerprint = liveViewFingerprint(card, zone, {
        back: Boolean(card.faceDown),
        showStats: zone === 'battlefield' && card.kind === 'creature',
    });
    const existingView = reuseLiveView(indexedViews, card, player, zone, fingerprint);
    if (existingView) {
        return existingView;
    }
    const view = createCardView(model, {
        back: Boolean(card.faceDown),
        interactive: true,
        sceneCard: card,
        scenePlayer: player,
        sceneZone: zone,
        showStats: zone === 'battlefield' && card.kind === 'creature',
    });
    view.cardId = card.id;
    view.liveFingerprint = fingerprint;
    view.attachedTo = card.attachedTo ?? null;
    view.linkedTo = card.linkedTo ?? null;
    view.cardKind = card.kind ?? 'other';
    view.tapped = Boolean(card.tapped);
    const previousPosition = liveCardPositions.get(view.cardId);
    if (previousPosition) {
        view.position.set(previousPosition.x, previousPosition.y);
        view.rotation = previousPosition.rotation;
        view.scale.set(previousPosition.scale);
    } else if (app) {
        view.position.set(app.screen.width / 2, app.screen.height / 2);
        view.scale.set(0.45);
    }
    return view;
}

function createLiveZoneView(zone, player, indexedViews) {
    const topCard = zone.cards?.at(-1) ?? null;
    if (!topCard) {
        return null;
    }
    const isLibrary = zone.id === 'library';
    const showsLibraryBack = isLibrary && !topCard.knownToViewer;
    const model = sceneCardModel(topCard, zone.id);
    const zoneCount = Number(zone.count ?? zone.cards?.length ?? 0);
    const fingerprint = liveViewFingerprint(topCard, zone.id, {
        back: showsLibraryBack,
        zoneCount,
    });
    const existingView = reuseLiveView(
        indexedViews,
        topCard,
        player,
        zone.id,
        fingerprint,
    );
    if (existingView) {
        existingView.zoneId = zone.id;
        existingView.zoneCount = zoneCount;
        existingView.zoneCards = zone.cards ?? [];
        return existingView;
    }
    const view = createCardView(model, {
        back: showsLibraryBack,
        hoverLabel: isLibrary
            ? `Library · ${Number(zone.count ?? 0)} cards`
            : '',
        hoverOnly: isLibrary,
        interactive: true,
        sceneCard: showsLibraryBack ? null : topCard,
        scenePlayer: player,
        sceneZone: zone.id,
    });
    view.cardId = topCard.id;
    view.liveFingerprint = fingerprint;
    view.cardKind = 'zone';
    view.tapped = false;
    view.zoneId = zone.id;
    view.zoneCount = zoneCount;
    view.zoneCards = zone.cards ?? [];
    const zoneBadge = createZoneBadge(view, zone.id, view.zoneCount);
    if (isLibrary) {
        zoneBadge.visible = false;
        view.on('pointerover', () => {
            zoneBadge.visible = true;
        });
        view.on('pointerout', () => {
            zoneBadge.visible = false;
        });
    }
    const previousPosition = liveCardPositions.get(view.cardId);
    if (previousPosition) {
        view.position.set(previousPosition.x, previousPosition.y);
        view.rotation = previousPosition.rotation;
        view.scale.set(previousPosition.scale);
    } else if (app) {
        view.position.set(app.screen.width / 2, app.screen.height / 2);
        view.scale.set(0.36);
    }
    return view;
}

function renderLiveScene() {
    if (!app || !props.scene) {
        return;
    }
    const indexedViews = indexLiveSceneViews();
    resetLiveSceneIndexes();
    for (const player of displayPlayers.value) {
        const permanentViews = (player.battlefield ?? []).map(card => {
            const view = createLiveCardView(card, player, 'battlefield', indexedViews);
            cardLayer.addChild(view);
            return view;
        });
        const zoneViews = (player.zones ?? []).map(zone => {
            const view = createLiveZoneView(zone, player, indexedViews);
            if (view) {
                cardLayer.addChild(view);
            }
            return view;
        }).filter(Boolean);
        const playerHandViews = (player.hand ?? []).map(card => {
            const view = createLiveCardView(card, player, 'hand', indexedViews);
            if (player.local) {
                handLayer.addChild(view);
            } else {
                opponentHandLayer.addChild(view);
            }
            return view;
        });
        if (player.local) {
            handViews = playerHandViews;
            localPermanentViews = permanentViews;
        } else {
            opponentHandViews.push(...playerHandViews);
            opponentPermanentViews.push(...permanentViews);
        }
        livePlayerViews.push({
            handViews: playerHandViews,
            permanentViews,
            player,
            zoneViews,
        });
    }
    linkedExileViews = allPlayers.value.flatMap(player => {
        const exile = (player.zones ?? []).find(zone => zone.id === 'exile');
        return (exile?.cards ?? []).filter(card => card.linkedTo).map(card => {
            const linkedCard = {
                ...card,
                id: `${card.id}:linked-exile`,
            };
            const view = createLiveCardView(
                linkedCard,
                player,
                'linkedExile',
                indexedViews,
            );
            view.linkedCardId = card.id;
            view.linkedTo = card.linkedTo;
            createZoneBadge(view, 'linkedExile', 1);
            cardLayer.addChild(view);
            return view;
        });
    });
    destroyStaleLiveViews(indexedViews);
    refreshImageDiagnostics();
    layoutScene();
}

function buildScene() {
    backgroundLayer = new Graphics();
    combatLayer = new Graphics();
    cardLayer = new Container();
    effectLayer = new Container();
    handLayer = new Container();
    opponentHandLayer = new Container();
    app.stage.sortableChildren = true;
    cardLayer.sortableChildren = true;
    handLayer.sortableChildren = true;
    backgroundLayer.restZIndex = 0;
    opponentHandLayer.restZIndex = 10;
    cardLayer.restZIndex = 20;
    combatLayer.restZIndex = 30;
    effectLayer.restZIndex = 40;
    handLayer.restZIndex = 50;
    for (const layer of [
        backgroundLayer,
        opponentHandLayer,
        cardLayer,
        combatLayer,
        effectLayer,
        handLayer,
    ]) {
        layer.zIndex = layer.restZIndex;
    }
    app.stage.addChild(
        backgroundLayer,
        opponentHandLayer,
        cardLayer,
        combatLayer,
        effectLayer,
        handLayer,
    );

    if (props.scene) {
        renderLiveScene();
        return;
    }

    localPermanentViews = localPermanentModels.map((model, index) => {
        const view = createCardView(model);
        view.zIndex = index + 10;
        cardLayer.addChild(view);
        return view;
    });
    opponentPermanentViews = opponentPermanentModels.map((model, index) => {
        const view = createCardView(model);
        view.zIndex = index + 10;
        cardLayer.addChild(view);
        return view;
    });
    handViews = handModels.map((model, index) => {
        const view = createCardView(model, { interactive: true });
        view.handIndex = index;
        view.zIndex = index;
        handLayer.addChild(view);
        return view;
    });
    opponentHandViews = Array.from({ length: 6 }, (_, index) => {
        const view = createCardView({}, {
            back: true,
            height: cardHeight * 0.76,
            width: cardWidth * 0.76,
        });
        view.rotation = (index - 2.5) * 0.035;
        opponentHandLayer.addChild(view);
        return view;
    });
    createEquipmentView();
    layoutScene();
}

function createEquipmentView() {
    const equipment = createCardView({
        accent: '#d4a556',
        art: ['#3b2b1b', '#9f7441'],
        name: 'Swiftfoot Boots',
        rules: 'Equipped creature has hexproof and haste.',
        type: 'Artifact — Equipment',
    });
    equipment.scale.set(0.82);
    equipment.zIndex = 8;
    equipment.isEquipment = true;
    localPermanentViews.splice(1, 0, equipment);
    cardLayer.addChild(equipment);
}

function drawBackground(width, height) {
    backgroundLayer.clear();
    backgroundLayer.beginFill(0xf5f6f8);
    backgroundLayer.drawRect(0, 0, width, height);
    backgroundLayer.endFill();

    const centerY = height * 0.5;
    backgroundLayer.lineStyle(1, 0x667085, 0.18);
    backgroundLayer.moveTo(24, centerY);
    backgroundLayer.lineTo(width - 24, centerY);
    backgroundLayer.lineStyle(1, 0x98a2b3, 0.12);
    for (let offset = 1; offset <= 5; offset += 1) {
        backgroundLayer.drawCircle(width / 2, centerY, offset * 58);
    }
    backgroundLayer.beginFill(0xffffff, 0.78);
    backgroundLayer.drawRoundedRect(18, 70, width - 36, Math.max(180, height - 150), 28);
    backgroundLayer.endFill();
    backgroundLayer.lineStyle(1.5, 0x98a2b3, 0.28);
    backgroundLayer.drawRoundedRect(18, 70, width - 36, Math.max(180, height - 150), 28);

    backgroundLayer.beginFill(0xe9edf2, 0.92);
    backgroundLayer.drawRoundedRect(width / 2 - 86, centerY - 22, 172, 44, 22);
    backgroundLayer.endFill();
}

function layoutRow(views, centerX, centerY, maxWidth, scale = 0.78) {
    const visibleViews = views.filter(view => !view.isEquipment);
    const spacing = Math.min(cardWidth * scale * 0.86, maxWidth / Math.max(1, visibleViews.length));
    const startX = centerX - ((visibleViews.length - 1) * spacing) / 2;
    let visibleIndex = 0;
    for (const view of views) {
        if (view.isEquipment) {
            const creature = views[0];
            targetView(view, creature.targetX + 12, creature.targetY + 16, -0.04, scale * 0.82);
            continue;
        }
        targetView(view, startX + visibleIndex * spacing, centerY, 0, scale);
        visibleIndex += 1;
    }
}

function layoutHand(width, height) {
    const count = handViews.length;
    const scale = pixiHandScale({ cardCount: count, local: true, width });
    const minimumWidth = width < 480 ? 80 : (width < 640 ? 160 : 240);
    const available = Math.min(980, Math.max(minimumWidth, width - 520));
    const spacing = count <= 1
        ? 0
        : Math.min(cardWidth * scale * 0.74, available / (count - 1));
    const startX = width / 2 - ((count - 1) * spacing) / 2;
    const visibleHeight = Math.min(124, cardHeight * scale * 0.64);
    const restY = height + cardHeight * scale / 2 - visibleHeight;
    handViews.forEach((view, index) => {
        const centerOffset = index - (count - 1) / 2;
        const rotation = centerOffset * 0.025;
        view.handIndex = index;
        view.restX = startX + index * spacing;
        view.restY = restY + Math.abs(centerOffset) * 2.5;
        view.restRotation = rotation;
        view.restScale = scale;
        if (!view.hovered) {
            targetView(view, view.restX, view.restY, rotation, scale);
        }
    });
}

function layoutOpponentHand(width) {
    const spacing = 30;
    const startX = width / 2 - ((opponentHandViews.length - 1) * spacing) / 2;
    opponentHandViews.forEach((view, index) => {
        view.position.set(startX + index * spacing, 54 - Math.abs(index - 2.5) * 2);
    });
}

function placeLiveView(view, x, y, rotation, scale, zIndex) {
    view.restX = x;
    view.restY = y;
    view.restRotation = rotation;
    view.restScale = scale;
    view.restZIndex = zIndex;
    view.zIndex = zIndex;
    targetView(view, x, y, rotation, scale);
}

function layoutLiveGroup(
    views,
    centerX,
    centerY,
    availableWidth,
    scale,
    baseZIndex,
    rotationForView = view => view.tapped ? Math.PI / 2 : 0,
) {
    if (views.length === 0) {
        return;
    }
    const spacing = Math.min(cardWidth * scale * 0.82, availableWidth / Math.max(1, views.length));
    const startX = centerX - ((views.length - 1) * spacing) / 2;
    views.forEach((view, index) => {
        placeLiveView(
            view,
            startX + index * spacing,
            centerY,
            rotationForView(view),
            scale,
            baseZIndex + index,
        );
    });
}

function liveOpponentAnchor(opponentIndex, opponentCount, width, height) {
    if (opponentCount <= 1) {
        return { x: width * 0.5, y: height * 0.29 };
    }
    if (opponentCount === 2) {
        return {
            x: width * (opponentIndex === 0 ? 0.3 : 0.7),
            y: height * 0.29,
        };
    }
    return [
        { x: width * 0.27, y: height * 0.31 },
        { x: width * 0.5, y: height * 0.27 },
        { x: width * 0.73, y: height * 0.31 },
    ][opponentIndex] ?? { x: width * 0.5, y: height * 0.25 };
}

function layoutLiveHand(views, player, anchor, width, height) {
    if (player.local) {
        handViews = views;
        layoutHand(width, height);
        views.forEach((view, index) => {
            view.restScale = pixiHandScale({
                cardCount: views.length,
                local: true,
                width,
            });
            view.restZIndex = index;
        });
        return;
    }
    const scale = pixiHandScale({ cardCount: views.length, local: false, width });
    const spacing = Math.min(
        cardWidth * scale * 0.55,
        Math.max(14, 240 / Math.max(1, views.length)),
    );
    const startX = anchor.x - ((views.length - 1) * spacing) / 2;
    const handY = Math.max(62, anchor.y - cardHeight * 0.56);
    views.forEach((view, index) => {
        const rotation = (index - (views.length - 1) / 2) * 0.025;
        placeLiveView(view, startX + index * spacing, handY, rotation, scale, 120 + index);
    });
}

function layoutLivePlayerBoard(entry, anchor, width, playerCount) {
    const regionWidth = playerCount > 2 ? width * 0.3 : width * 0.86;
    const unattached = entry.permanentViews.filter(view => !view.attachedTo);
    const groups = {
        creature: unattached.filter(view => view.cardKind === 'creature'),
        land: unattached.filter(view => view.cardKind === 'land'),
        other: unattached.filter(view => !['creature', 'land'].includes(view.cardKind)),
    };
    const largestGroup = Math.max(0, ...Object.values(groups).map(group => group.length));
    const scale = pixiPermanentScale({ largestGroup, playerCount, width });
    const groupWidth = regionWidth / 3;
    const verticalDirection = entry.player.local ? 1 : -1;
    layoutLiveGroup(
        groups.land,
        anchor.x - groupWidth,
        anchor.y + verticalDirection * 26,
        groupWidth,
        scale,
        20,
    );
    layoutLiveGroup(groups.creature, anchor.x, anchor.y, groupWidth, scale, 40);
    layoutLiveGroup(
        groups.other,
        anchor.x + groupWidth,
        anchor.y + verticalDirection * 12,
        groupWidth,
        scale,
        30,
    );
    for (const attachment of entry.permanentViews.filter(view => view.attachedTo)) {
        const host = entry.permanentViews.find(view => view.cardId === attachment.attachedTo);
        if (host) {
            placeLiveView(
                attachment,
                host.restX + 12,
                host.restY + verticalDirection * 18,
                host.restRotation - 0.04,
                scale * 0.82,
                Math.max(1, host.restZIndex - 1),
            );
        } else {
            placeLiveView(attachment, anchor.x, anchor.y, 0, scale * 0.82, 10);
        }
    }
    // Private zones stay on their owner's side of the table. Moving the row
    // toward the outside edge keeps it clear of both hands and battlefield lands.
    const privateZonePosition = pixiPrivateZonePosition({
        anchorX: anchor.x,
        anchorY: anchor.y,
        local: entry.player.local,
        regionWidth,
        width,
    });
    layoutLiveGroup(
        entry.zoneViews,
        privateZonePosition.x,
        privateZonePosition.y,
        Math.min(regionWidth * 0.82, 210),
        Math.min(0.66, scale * 0.7),
        150,
        view => view.zoneId === 'exile' ? Math.PI / 2 : 0,
    );
}

function layoutLiveScene(width, height) {
    const localEntry = livePlayerViews.find(entry => entry.player.local) ?? livePlayerViews[0];
    const opponents = livePlayerViews.filter(entry => entry !== localEntry);
    const playerCount = livePlayerViews.length;
    if (localEntry) {
        const anchor = { x: width * 0.5, y: height * 0.64 };
        livePlayerAnchors.set(localEntry.player.id, anchor);
        layoutLivePlayerBoard(localEntry, anchor, width, playerCount);
        layoutLiveHand(localEntry.handViews, localEntry.player, anchor, width, height);
    }
    opponents.forEach((entry, opponentIndex) => {
        const anchor = liveOpponentAnchor(opponentIndex, opponents.length, width, height);
        livePlayerAnchors.set(entry.player.id, anchor);
        layoutLivePlayerBoard(entry, anchor, width, playerCount);
        layoutLiveHand(entry.handViews, entry.player, anchor, width, height);
    });
    layoutLinkedExileViews();
}

function layoutLinkedExileViews() {
    const permanentViews = livePlayerViews.flatMap(entry => entry.permanentViews);
    const sourceViews = new Map(permanentViews.map(view => [view.cardId, view]));
    const linkIndexes = new Map();
    for (const view of linkedExileViews) {
        const source = sourceViews.get(view.linkedTo);
        if (!source) {
            view.visible = false;
            continue;
        }
        view.visible = true;
        const index = Number(linkIndexes.get(view.linkedTo) ?? 0) + 1;
        linkIndexes.set(view.linkedTo, index);
        const sourceEntry = livePlayerViews.find(entry => {
            return entry.permanentViews.includes(source);
        });
        const direction = sourceEntry?.player?.local ? 1 : -1;
        placeLiveView(
            view,
            source.restX + index * 11,
            source.restY + direction * index * 20,
            source.restRotation + 0.035 * index,
            source.restScale * 0.78,
            Math.max(1, source.restZIndex - index - 1),
        );
    }
}

function layoutScene() {
    if (!app) {
        return;
    }
    const { width, height } = app.screen;
    drawBackground(width, height);
    if (props.scene) {
        layoutLiveScene(width, height);
        drawCombatArrow();
        return;
    }
    const rowWidth = Math.max(360, width - 310);
    layoutRow(opponentPermanentViews, width / 2, height * 0.33, rowWidth, width < 900 ? 0.62 : 0.72);
    layoutRow(localPermanentViews, width / 2, height * 0.66, rowWidth, width < 900 ? 0.66 : 0.78);
    layoutHand(width, height);
    layoutOpponentHand(width);
    drawCombatArrow();
}

function drawCombatArrow() {
    combatLayer.clear();
    if (props.scene?.combat?.length) {
        const cardViews = new Map(
            livePlayerViews.flatMap(entry => entry.permanentViews.map(view => [view.cardId, view])),
        );
        for (const link of props.scene.combat) {
            const source = cardViews.get(link.sourceCardId);
            const target = cardViews.get(link.targetCardId) ??
                livePlayerAnchors.get(link.targetPlayerId);
            if (!source || !target) {
                continue;
            }
            const targetX = target.targetX ?? target.x;
            const targetY = target.targetY ?? target.y;
            const color = link.kind === 'block' ? 0x2563eb : 0xdc2626;
            combatLayer.lineStyle(5, color, 0.82);
            combatLayer.moveTo(source.targetX, source.targetY);
            combatLayer.bezierCurveTo(
                source.targetX,
                (source.targetY + targetY) / 2,
                targetX,
                (source.targetY + targetY) / 2,
                targetX,
                targetY,
            );
            combatLayer.beginFill(color, 0.9);
            combatLayer.drawCircle(targetX, targetY, 7);
            combatLayer.endFill();
        }
        return;
    }
    if (!attackArrow) {
        return;
    }
    const source = attackArrow.source;
    const targetX = app.screen.width / 2;
    const targetY = 105;
    const alpha = 0.65 + arrowAlpha * 0.35;
    combatLayer.lineStyle(5, 0xffc857, alpha);
    combatLayer.moveTo(source.x, source.y - cardHeight * 0.33);
    combatLayer.bezierCurveTo(
        source.x + 30,
        source.y - 100,
        targetX - 45,
        targetY + 70,
        targetX,
        targetY,
    );
    combatLayer.beginFill(0xffc857, alpha);
    combatLayer.drawPolygon([
        targetX,
        targetY,
        targetX - 12,
        targetY + 22,
        targetX + 13,
        targetY + 18,
    ]);
    combatLayer.endFill();
}

function updateAnimations() {
    const easing = Math.min(1, 0.17 * app.ticker.deltaTime);
    for (const view of animatedViews) {
        view.x += (view.targetX - view.x) * easing;
        view.y += (view.targetY - view.y) * easing;
        view.rotation += (view.targetRotation - view.rotation) * easing;
        const scale = view.scale.x + (view.targetScale - view.scale.x) * easing;
        view.scale.set(scale);
        if (
            Math.abs(view.x - view.targetX) < 0.2 &&
            Math.abs(view.y - view.targetY) < 0.2 &&
            Math.abs(view.scale.x - view.targetScale) < 0.002
        ) {
            view.position.set(view.targetX, view.targetY);
            view.rotation = view.targetRotation;
            view.scale.set(view.targetScale);
            animatedViews.delete(view);
        }
    }
    arrowAlpha = (Math.sin(performance.now() / 130) + 1) / 2;
    if (attackArrow) {
        drawCombatArrow();
    }
    frameCounter += 1;
    elapsedFpsTime += app.ticker.deltaMS;
    if (elapsedFpsTime >= 500) {
        fps.value = Math.round((frameCounter * 1000) / elapsedFpsTime);
        frameCounter = 0;
        elapsedFpsTime = 0;
    }
}

function delay(milliseconds) {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

function showDamage(amount) {
    const damage = new Text(`-${amount}`, new TextStyle({
        dropShadow: true,
        dropShadowBlur: 8,
        dropShadowColor: 0x000000,
        fill: 0xffd166,
        fontFamily: 'system-ui',
        fontSize: 44,
        fontWeight: '800',
        stroke: 0x4a190b,
        strokeThickness: 5,
    }));
    damage.anchor.set(0.5);
    damage.position.set(app.screen.width / 2, 124);
    effectLayer.addChild(damage);
    let life = 0;
    const animate = () => {
        life += app.ticker.deltaMS;
        damage.y -= app.ticker.deltaMS * 0.045;
        damage.alpha = Math.max(0, 1 - life / 900);
        damage.scale.set(1 + life / 1800);
        if (life >= 900) {
            app.ticker.remove(animate);
            damage.destroy();
        }
    };
    app.ticker.add(animate);
}

async function animateCombat() {
    if (animating.value || !localPermanentViews[0]) {
        return;
    }
    animating.value = true;
    phase.value = 'combat';
    status.value = 'Avatar Aang attaque Katara.';
    const attacker = localPermanentViews[0];
    const original = {
        rotation: attacker.targetRotation,
        scale: attacker.targetScale,
        x: attacker.targetX,
        y: attacker.targetY,
    };
    attacker.zIndex = 80;
    targetView(attacker, original.x, original.y - 70, -0.03, original.scale * 1.08);
    await delay(280);
    attackArrow = { source: attacker };
    await delay(620);
    opponentLife.value = Math.max(0, opponentLife.value - 6);
    showDamage(6);
    status.value = '6 dégâts de commandant infligés.';
    await delay(720);
    attackArrow = null;
    drawCombatArrow();
    attacker.zIndex = 10;
    targetView(attacker, original.x, original.y, original.rotation, original.scale);
    await delay(320);
    animating.value = false;
}

function drawCard() {
    const model = {
        accent: '#cba9ff',
        art: ['#382559', '#8a63b8'],
        name: `Oracle Insight ${handViews.length - 6}`,
        rules: 'Scry 2, then draw a card.',
        type: 'Instant',
    };
    const view = createCardView(model, { interactive: true });
    view.handIndex = handViews.length;
    view.position.set(app.screen.width - 90, app.screen.height / 2);
    view.scale.set(0.5);
    handLayer.addChild(view);
    handViews.push(view);
    layoutHand(app.screen.width, app.screen.height);
    status.value = 'Carte piochée; la main se recompresse sans élargir le viewport.';
}

function createToken() {
    const model = {
        accent: '#ffb253',
        art: ['#5c2d13', '#d37a29'],
        name: `Warrior Token ${tokenViews.length + 1}`,
        rules: 'Haste. Sacrifice at the next end step.',
        stats: '1/1',
        type: 'Token Creature — Warrior',
    };
    const view = createCardView(model);
    view.scale.set(0.3);
    view.position.set(app.screen.width / 2, app.screen.height / 2);
    cardLayer.addChild(view);
    tokenViews.push(view);
    localPermanentViews.push(view);
    layoutScene();
    status.value = 'Token ajouté; les permanents se condensent dans la zone.';
}

function toggleStack() {
    if (stackItems.value.length >= 3) {
        stackItems.value = [];
        status.value = 'Tous les éléments de la pile ont été passés.';
        return;
    }
    stackItems.value = [
        ...stackItems.value,
        {
            detail: 'Counter target spell',
            id: `stack-${Date.now()}`,
            name: 'Counterspell',
            type: 'INSTANT',
        },
    ];
    status.value = 'Une réponse a été ajoutée à la pile.';
}

function hudClasses(player, playerIndex) {
    if (player.local) {
        return {
            'pixi-player-hud-local': true,
            'pixi-player-hud-targetable': player.targetable,
        };
    }
    const opponents = displayPlayers.value.filter(candidate => !candidate.local);
    const opponentIndex = opponents.findIndex(candidate => candidate.id === player.id);
    let position = 'top';
    if (opponents.length === 2) {
        position = opponentIndex === 0 ? 'top-left' : 'top-right';
    } else if (opponents.length >= 3) {
        position = ['left', 'top', 'right'][opponentIndex] ?? 'top';
    }
    return {
        [`pixi-player-hud-${position}`]: true,
        'pixi-player-hud-opponent': opponents.length === 1,
        'pixi-player-hud-targetable': player.targetable,
        [`pixi-player-hud-seat-${playerIndex + 1}`]: true,
    };
}

function playerHudStyle(player, playerIndex) {
    return {
        '--pixi-player-accent': playerAccent(player, playerIndex),
    };
}

function playerAccent(player, playerIndex) {
    const colors = ['#2563eb', '#dc2626', '#16a34a', '#9333ea'];
    return player?.accent ?? colors[Math.max(0, playerIndex) % colors.length];
}

function knownZoneLabel(zoneId) {
    return zoneId === 'graveyard' ? 'Cimetière' : zoneId === 'exile' ? 'Exil' : zoneId;
}

function permanentCount(player) {
    return Number(player?.battlefield?.length ?? 0);
}

async function openKnownZone(player, zone) {
    if (!player || !zone || !['graveyard', 'exile'].includes(zone.id)) {
        return;
    }
    inspectedZoneKey.value = pixiToggledZoneKey(
        inspectedZoneKey.value,
        player.id,
        zone.id,
    );
    if (!inspectedZoneKey.value) {
        emit('card-leave');
        return;
    }
    await nextTick();
    zoneInspectorElement.value?.focus();
}

function closeKnownZone() {
    inspectedZoneKey.value = null;
    emit('card-leave');
}

function handleKnownZoneCardClick(card, player, zone) {
    emit('card-click', {
        card: card.raw ?? card,
        player: player.raw ?? player,
        zone,
    });
}

function focusOpponent(playerId) {
    if (!opponentPlayers.value.some(player => player.id === playerId)) {
        return;
    }
    focusedOpponentId.value = playerId;
    window.clearTimeout(mobileFocusTimer);
    mobileFocusTimer = window.setTimeout(() => {
        mobileFocusTimer = null;
        const active = opponentPlayers.value.find(player => player.active);
        if (active) {
            focusedOpponentId.value = active.id;
        }
    }, 8_000);
}

function focusAdjacentOpponent(direction) {
    const opponents = opponentPlayers.value;
    if (opponents.length === 0) {
        return;
    }
    const currentIndex = Math.max(
        0,
        opponents.findIndex(player => player.id === focusedOpponent.value?.id),
    );
    const nextIndex = (currentIndex + direction + opponents.length) % opponents.length;
    focusOpponent(opponents[nextIndex].id);
}

function beginMobilePlayerSwipe(event) {
    swipeStartX.value = mobileFocusEnabled.value
        ? event.changedTouches?.[0]?.clientX ?? null
        : null;
}

function endMobilePlayerSwipe(event) {
    if (swipeStartX.value === null || !mobileFocusEnabled.value) {
        return;
    }
    const endX = event.changedTouches?.[0]?.clientX ?? swipeStartX.value;
    const deltaX = endX - swipeStartX.value;
    swipeStartX.value = null;
    if (Math.abs(deltaX) >= 48) {
        focusAdjacentOpponent(deltaX < 0 ? 1 : -1);
    }
}

function updateCompactViewport() {
    compactViewport.value = window.innerWidth <= 700;
}

function commanderDamageEntries(player) {
    return Array.isArray(player?.commanderDamage)
        ? player.commanderDamage.filter(damage => Number(damage?.amount) > 0)
        : [];
}

function commanderDamageStyle(damage) {
    const ownerIndex = displayPlayers.value.findIndex(player => player.id === damage?.ownerId);
    const owner = ownerIndex >= 0 ? displayPlayers.value[ownerIndex] : null;
    return {
        color: playerAccent(owner, ownerIndex),
    };
}

function isPhaseMarkerActive(player, marker) {
    return Boolean(player.active && marker.phases.includes(displayPhase.value));
}

function handlePlayerClick(player) {
    if (isLiveGame.value && player.targetable) {
        emit('player-click', player.raw ?? player);
    }
}

function handleStackClick(item) {
    if (!isLiveGame.value || item.targetable) {
        emit('stack-click', item.raw ?? item);
    }
}

function emitCardHover(card) {
    if (card) {
        emit('card-hover', { card: card.raw ?? card, player: null });
    }
}

watch(
    () => [props.scene, focusedOpponentId.value, compactViewport.value],
    () => {
        if (app) {
            renderLiveScene();
        }
    },
    { deep: true, flush: 'post' },
);

watch(
    () => opponentPlayers.value.find(player => player.active)?.id ?? '',
    activeOpponentId => {
        if (activeOpponentId && !mobileFocusTimer) {
            focusedOpponentId.value = activeOpponentId;
        }
    },
    { immediate: true },
);

onMounted(async () => {
    await nextTick();
    window.addEventListener('resize', updateCompactViewport);
    updateCompactViewport();
    if (import.meta.env.MODE === 'test') {
        return;
    }
    app = new Application({
        antialias: true,
        autoDensity: true,
        backgroundAlpha: 0,
        powerPreference: 'high-performance',
        resizeTo: canvasHost.value,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    app.view.classList.add('pixi-game-webgl-view');
    app.view.setAttribute('aria-label', 'Battlefield rendu par PixiJS WebGL');
    canvasHost.value.appendChild(app.view);
    buildScene();
    app.ticker.add(updateAnimations);
    app.renderer.on('resize', layoutScene);
});

onBeforeUnmount(() => {
    window.removeEventListener('resize', updateCompactViewport);
    window.clearTimeout(mobileFocusTimer);
    mobileFocusTimer = null;
    if (!app) {
        return;
    }
    app.renderer.off('resize', layoutScene);
    app.ticker.remove(updateAnimations);
    app.destroy(true, { children: true, texture: false, baseTexture: false });
    for (const texture of textures) {
        texture.destroy(true);
    }
    textures.clear();
    imageTexturePromises.clear();
    liveCardPositions.clear();
    app = null;
});
</script>

<style scoped>
.pixi-game-prototype {
    background: #04100d;
    border: 1px solid #1f5546;
    border-radius: 0.8rem;
    box-shadow: 0 1.2rem 3rem rgb(0 0 0 / 35%);
    color: #e9fff7;
    height: calc(100vh - 7.2rem);
    min-height: 650px;
    overflow: hidden;
    position: relative;
}

.pixi-game-canvas,
.pixi-game-canvas :deep(canvas) {
    height: 100%;
    inset: 0;
    position: absolute;
    width: 100%;
}

.pixi-game-canvas :deep(canvas) {
    display: block;
    touch-action: none;
}

.pixi-game-topbar {
    align-items: center;
    backdrop-filter: blur(16px);
    background: linear-gradient(180deg, rgb(4 16 13 / 96%), rgb(4 16 13 / 62%));
    border-bottom: 1px solid rgb(125 225 190 / 18%);
    display: grid;
    gap: 1rem;
    grid-template-columns: auto minmax(0, 1fr) auto;
    left: 0;
    padding: 0.55rem 0.8rem;
    position: absolute;
    right: 0;
    top: 0;
    z-index: 20;
}

.pixi-game-brand {
    align-items: center;
    color: #a9f5d9;
    display: flex;
    font-size: 0.65rem;
    font-weight: 800;
    gap: 0.45rem;
    letter-spacing: 0.12em;
}

.pixi-game-brand-logo {
    display: block;
    height: 2.2rem;
    object-fit: contain;
    width: auto;
}

.pixi-game-live-dot {
    background: #62f6b9;
    border-radius: 50%;
    box-shadow: 0 0 0.8rem #62f6b9;
    height: 0.48rem;
    width: 0.48rem;
}

.pixi-phase-track {
    display: flex;
    gap: 0.2rem;
    justify-content: center;
    min-width: 0;
}

.pixi-phase-track button {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 999px;
    color: #7fa99b;
    cursor: pointer;
    font-size: 0.6rem;
    padding: 0.28rem 0.5rem;
    transition: 140ms ease;
    white-space: nowrap;
}

.pixi-phase-track button span {
    margin-right: 0.2rem;
}

.pixi-phase-track button:hover,
.pixi-phase-track button.active {
    background: rgb(104 230 186 / 13%);
    border-color: rgb(104 230 186 / 42%);
    color: #c7ffec;
}

.pixi-phase-track button.active {
    box-shadow: inset 0 0 1rem rgb(88 225 177 / 12%), 0 0 1rem rgb(88 225 177 / 10%);
}

.pixi-game-frame-rate {
    color: #8bc8b4;
    font-family: ui-monospace, monospace;
    font-size: 0.62rem;
}

.pixi-player-hud {
    align-items: center;
    backdrop-filter: blur(12px);
    background: rgb(7 24 20 / 86%);
    border: 1px solid rgb(128 226 192 / 22%);
    border-radius: 999px;
    box-shadow: 0 0.7rem 2rem rgb(0 0 0 / 22%);
    display: flex;
    gap: 0.55rem;
    padding: 0.35rem 0.42rem;
    position: absolute;
    z-index: 15;
}

.pixi-player-hud-opponent {
    left: 1.2rem;
    top: 4.4rem;
}

.pixi-player-hud-local {
    bottom: 1rem;
    left: 1rem;
}

.pixi-player-avatar,
.pixi-life-orb {
    align-items: center;
    background: linear-gradient(135deg, #226a59, #102c26);
    border: 1px solid #63cbae;
    border-radius: 50%;
    display: flex;
    font-weight: 800;
    height: 2.2rem;
    justify-content: center;
    width: 2.2rem;
}

.pixi-life-orb {
    background: radial-gradient(circle at 35% 30%, #ffdf74, #8f3d1c 72%);
    border-color: #ffd474;
    box-shadow: 0 0 1rem rgb(255 177 77 / 25%);
    margin-left: 0.2rem;
}

.pixi-life-orb.local {
    background: radial-gradient(circle at 35% 30%, #baffdf, #166a55 72%);
    border-color: #84edca;
}

.pixi-player-hud strong,
.pixi-player-hud span {
    display: block;
}

.pixi-player-hud strong {
    font-size: 0.74rem;
}

.pixi-player-hud div > span {
    color: #8cb5a7;
    font-size: 0.58rem;
}

.pixi-mana-pool {
    display: flex;
    gap: 0.22rem;
    margin-left: 0.5rem;
}

.pixi-mana-pool span {
    border-radius: 999px;
    color: #122018;
    font-size: 0.58rem;
    font-weight: 800;
    padding: 0.18rem 0.32rem;
}

.mana-w { background: #fff2c9; }
.mana-u { background: #8ed5ff; }
.mana-r { background: #ff9f75; }

.pixi-stack-panel {
    backdrop-filter: blur(14px);
    background: rgb(4 15 13 / 82%);
    border: 1px solid rgb(133 225 194 / 20%);
    border-radius: 0.65rem;
    box-shadow: 0 0.8rem 2.2rem rgb(0 0 0 / 28%);
    max-height: 48%;
    overflow: hidden;
    padding: 0.45rem;
    position: absolute;
    right: 0.8rem;
    top: 4.3rem;
    width: min(14rem, 22vw);
    z-index: 14;
}

.pixi-panel-title {
    color: #89cbb5;
    display: flex;
    font-size: 0.58rem;
    font-weight: 800;
    justify-content: space-between;
    letter-spacing: 0.1em;
    padding: 0.1rem 0.2rem 0.4rem;
}

.pixi-stack-item {
    background: linear-gradient(135deg, rgb(25 58 49 / 96%), rgb(11 31 27 / 94%));
    border: 1px solid rgb(137 221 193 / 19%);
    border-left: 3px solid #e8b65f;
    border-radius: 0.38rem;
    display: grid;
    gap: 0.08rem;
    margin-top: 0.3rem;
    padding: 0.38rem 0.45rem;
    transform: translateX(calc(var(--stack-index) * -0.18rem));
}

.pixi-stack-type {
    color: #eac376;
    font-size: 0.48rem;
    font-weight: 800;
    letter-spacing: 0.08em;
}

.pixi-stack-item strong { font-size: 0.65rem; }
.pixi-stack-item small { color: #88ad9f; font-size: 0.53rem; }
.pixi-stack-empty { color: #789b90; font-size: 0.6rem; padding: 0.55rem 0.2rem; }

.pixi-game-controls {
    bottom: 1rem;
    display: flex;
    gap: 0.3rem;
    position: absolute;
    right: 0.8rem;
    z-index: 25;
}

.pixi-game-controls button {
    backdrop-filter: blur(12px);
    background: rgb(12 35 29 / 90%);
    border: 1px solid rgb(119 222 187 / 28%);
    border-radius: 999px;
    color: #c9f8e8;
    cursor: pointer;
    font-size: 0.61rem;
    font-weight: 700;
    padding: 0.42rem 0.62rem;
}

.pixi-game-controls button:hover,
.pixi-game-controls button.primary {
    background: linear-gradient(135deg, #2b8c70, #155744);
    border-color: #7de1bf;
}

.pixi-game-controls button:disabled { cursor: wait; opacity: 0.65; }

.pixi-replay-label {
    color: #f4eadb;
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
}

.pixi-game-hint {
    background: rgb(3 13 11 / 76%);
    border: 1px solid rgb(120 222 188 / 12%);
    border-radius: 0.45rem;
    bottom: 4.1rem;
    display: grid;
    gap: 0.12rem;
    left: 1rem;
    max-width: min(27rem, 45vw);
    padding: 0.38rem 0.5rem;
    position: absolute;
    z-index: 12;
}

.pixi-game-hint strong { color: #d8fff1; font-size: 0.62rem; }
.pixi-game-hint span { color: #739c8e; font-size: 0.53rem; }

.pixi-zone-label {
    color: rgb(151 220 197 / 42%);
    font-size: 0.48rem;
    font-weight: 800;
    left: 50%;
    letter-spacing: 0.18em;
    pointer-events: none;
    position: absolute;
    transform: translateX(-50%);
    z-index: 4;
}

.pixi-zone-label-opponent { top: 17%; }
.pixi-zone-label-local { bottom: 27%; }

@media (max-width: 900px) {
    .pixi-game-prototype { min-height: 590px; }
    .pixi-game-brand-logo { height: 1.7rem; }
    .pixi-game-topbar { grid-template-columns: auto minmax(0, 1fr) auto; }
    .pixi-phase-track { justify-content: flex-start; overflow-x: auto; }
    .pixi-phase-track button { font-size: 0; padding: 0.32rem 0.45rem; }
    .pixi-phase-track button span { font-size: 0.7rem; margin: 0; }
    .pixi-stack-panel { width: 10rem; }
    .pixi-game-controls { flex-wrap: wrap; justify-content: flex-end; max-width: 14rem; }
    .pixi-game-hint { display: none; }
    .pixi-mana-pool { display: none; }
}

/* Full-viewport proposal: existing light UI language around the Pixi card scene. */
.pixi-game-prototype {
    background:
        radial-gradient(circle at 12% 10%, rgb(125 47 54 / 7%), transparent 28rem),
        radial-gradient(circle at 88% 8%, rgb(52 75 96 / 8%), transparent 30rem),
        #f4f0ec;
    border: 0;
    border-radius: 0;
    box-shadow: none;
    color: #101828;
    height: 100dvh;
    inset: 0;
    min-height: 36rem;
    position: fixed;
    width: 100vw;
    z-index: 5000;
}

.pixi-game-prototype.pixi-game-live {
    z-index: 2000;
}

.pixi-game-topbar {
    background:
        linear-gradient(90deg, rgb(125 47 54 / 9%), transparent 32%),
        rgb(255 253 251 / 96%);
    border-bottom: 1px solid #d8cbc3;
    box-shadow: 0 0.25rem 1rem rgb(16 24 40 / 8%);
    grid-template-columns: auto 1fr auto;
    min-height: 3rem;
}

.pixi-game-brand {
    color: #202f3d;
}

.pixi-game-live-dot {
    background: #7d2f36;
    box-shadow: 0 0 0 0.22rem rgb(125 47 54 / 16%);
}

.pixi-game-mode {
    color: #526575;
    font-size: 0.66rem;
    font-weight: 700;
    justify-self: center;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.pixi-game-menu-actions {
    align-items: center;
    display: flex;
    gap: 0.65rem;
}

.pixi-game-frame-rate {
    color: #667085;
}

.pixi-game-outcome {
    animation: pixi-outcome-enter 240ms ease-out both;
    background: rgb(255 253 251 / 96%);
    border: 1px solid #9a8378;
    border-radius: 6px;
    box-shadow: 0 1rem 3rem rgb(16 24 40 / 22%);
    display: grid;
    gap: 0.35rem;
    left: 50%;
    max-width: min(22rem, calc(100vw - 2rem));
    padding: 1.1rem 1.4rem;
    position: absolute;
    text-align: center;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 100%;
    z-index: 40;
}

.pixi-game-outcome span {
    color: #7d2f36;
    font-size: 0.62rem;
    font-weight: 850;
    letter-spacing: 0.12em;
    text-transform: uppercase;
}

.pixi-game-outcome strong {
    color: #101828;
    font: 500 1.7rem/1.1 Georgia, serif;
}

.pixi-game-outcome small {
    color: #667085;
    font-size: 0.72rem;
}

@keyframes pixi-outcome-enter {
    from { opacity: 0; transform: translate(-50%, calc(-50% + 0.75rem)); }
    to { opacity: 1; transform: translate(-50%, -50%); }
}

.pixi-return-menu {
    background: #fffdfb;
    border: 1px solid #9a8378;
    border-radius: 0.38rem;
    color: #344054;
    cursor: pointer;
    font-size: 0.68rem;
    font-weight: 800;
    padding: 0.38rem 0.62rem;
}

.pixi-return-menu:hover {
    background: #f3e5e3;
    border-color: #7d2f36;
    color: #552027;
}

.pixi-player-hud {
    align-items: center;
    backdrop-filter: none;
    background: transparent;
    border: 0;
    border-radius: 0;
    box-shadow: none;
    color: #101828;
    gap: 0.6rem;
    padding: 0;
    text-align: left;
}

.pixi-player-hud:disabled {
    cursor: default;
    opacity: 1;
}

.pixi-player-hud-targetable {
    cursor: crosshair;
}

.pixi-player-hud-targetable .pixi-life-orb {
    box-shadow: 0 0 0 2px #fff, 0 0 0 5px rgb(220 38 38 / 46%);
}

.pixi-player-hud-opponent {
    left: 1.1rem;
    top: 3.7rem;
}

.pixi-player-hud-top {
    left: 50%;
    top: 3.7rem;
    transform: translateX(-50%);
}

.pixi-player-hud-top-left {
    left: 30%;
    top: 3.7rem;
    transform: translateX(-50%);
}

.pixi-player-hud-top-right {
    right: 30%;
    top: 3.7rem;
    transform: translateX(50%);
}

.pixi-player-hud-left {
    left: 27%;
    top: 3.7rem;
    transform: translateX(-50%);
}

.pixi-player-hud-right {
    left: 73%;
    right: auto;
    top: 3.7rem;
    transform: translateX(-50%);
}

.pixi-player-hud-local {
    bottom: 0.75rem;
    left: 1rem;
    transform: none;
}

.pixi-player-identity {
    background: rgb(255 255 255 / 94%);
    border: 1px solid color-mix(in srgb, var(--pixi-player-accent) 52%, #d0d5dd);
    border-radius: 0.45rem;
    box-shadow: 0 0.35rem 1rem rgb(16 24 40 / 12%);
    min-width: 7.5rem;
    padding: 0.35rem 0.5rem;
}

.pixi-player-identity strong,
.pixi-player-identity > span {
    display: block;
}

.pixi-player-identity > .pixi-commander-damage {
    font-size: 0.62rem;
    font-weight: 800;
}

.pixi-player-hud strong {
    color: #101828;
}

.pixi-player-hud div > span {
    color: #667085;
}

.pixi-turn-hud {
    height: 3rem;
    position: relative;
    width: 8.5rem;
}

.pixi-phase-orbit {
    inset: 0;
    position: absolute;
}

.pixi-phase-orbit::before {
    border-color: color-mix(in srgb, var(--pixi-player-accent) 34%, transparent);
    content: "";
    height: 1.9rem;
    left: 0.7rem;
    position: absolute;
    width: 7.1rem;
}

.pixi-turn-hud-bottom .pixi-phase-orbit::before {
    border-radius: 50% 50% 0 0;
    border-top-style: solid;
    border-top-width: 1px;
    bottom: 0.18rem;
}

.pixi-turn-hud-top .pixi-phase-orbit::before {
    border-bottom-style: solid;
    border-bottom-width: 1px;
    border-radius: 0 0 50% 50%;
    top: 0.18rem;
}

.pixi-phase-marker {
    align-items: center;
    background: #fff;
    border: 1px solid color-mix(in srgb, var(--pixi-player-accent) 52%, #d0d5dd);
    border-radius: 999px;
    color: var(--pixi-player-accent);
    cursor: pointer;
    display: inline-flex;
    height: 1.05rem;
    justify-content: center;
    padding: 0;
    position: absolute;
    width: 1.05rem;
    z-index: 1;
}

.pixi-phase-marker.active {
    background: var(--pixi-player-accent);
    border-color: var(--pixi-player-accent);
    box-shadow: 0 0 0 2px #fff, 0 0 0 4px color-mix(in srgb, var(--pixi-player-accent) 34%, transparent);
    color: #fff;
    z-index: 3;
}

.pixi-phase-marker[data-phase-key="main"],
.pixi-phase-marker[data-phase-key="main2"] {
    height: 1.35rem;
    width: 1.35rem;
}

.pixi-turn-hud-bottom .pixi-phase-marker[data-phase-key="untap"] { bottom: 0; left: 0.12rem; }
.pixi-turn-hud-bottom .pixi-phase-marker[data-phase-key="main"] { bottom: 0.52rem; left: 1.28rem; }
.pixi-turn-hud-bottom .pixi-phase-marker[data-phase-key="combat"] { bottom: 1.78rem; left: 2.72rem; }
.pixi-turn-hud-bottom .pixi-phase-marker[data-phase-key="blockers"] { bottom: 1.78rem; right: 2.72rem; }
.pixi-turn-hud-bottom .pixi-phase-marker[data-phase-key="main2"] { bottom: 0.52rem; right: 1.28rem; }
.pixi-turn-hud-bottom .pixi-phase-marker[data-phase-key="end"] { bottom: 0; right: 0.12rem; }
.pixi-turn-hud-top .pixi-phase-marker[data-phase-key="untap"] { left: 0.12rem; top: 0; }
.pixi-turn-hud-top .pixi-phase-marker[data-phase-key="main"] { left: 1.28rem; top: 0.52rem; }
.pixi-turn-hud-top .pixi-phase-marker[data-phase-key="combat"] { left: 2.72rem; top: 1.78rem; }
.pixi-turn-hud-top .pixi-phase-marker[data-phase-key="blockers"] { right: 2.72rem; top: 1.78rem; }
.pixi-turn-hud-top .pixi-phase-marker[data-phase-key="main2"] { right: 1.28rem; top: 0.52rem; }
.pixi-turn-hud-top .pixi-phase-marker[data-phase-key="end"] { right: 0.12rem; top: 0; }

.pixi-life-orb,
.pixi-life-orb.local {
    background: #101828;
    border: 2px solid var(--pixi-player-accent);
    box-shadow: 0 0 0 2px #fff;
    color: #fff;
    font-size: 0.78rem;
    height: 1.7rem;
    left: 50%;
    margin: 0;
    min-width: 1.7rem;
    position: absolute;
    transform: translateX(-50%);
    width: auto;
    z-index: 4;
}

.pixi-player-hud {
    height: 3rem;
    justify-content: center;
    width: 8.5rem;
}

.pixi-player-hud .pixi-player-identity {
    position: absolute;
    right: calc(100% + 0.45rem);
    top: 50%;
    transform: translateY(-50%);
}

.pixi-player-hud-local .pixi-player-identity {
    left: calc(100% + 0.45rem);
    right: auto;
}

.pixi-turn-hud-bottom .pixi-life-orb { bottom: 0; }
.pixi-turn-hud-top .pixi-life-orb { top: 0; }

.pixi-mana-pool {
    align-items: center;
    background: rgb(15 23 42 / 90%);
    border: 1px solid rgb(255 255 255 / 40%);
    border-radius: 999px;
    box-shadow: 0 2px 7px rgb(15 23 42 / 28%);
    display: flex;
    gap: 0.26rem;
    left: 50%;
    margin: 0;
    padding: 0.18rem 0.3rem;
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 5;
}

.pixi-mana-pool span {
    align-items: center;
    color: #fff;
    display: inline-flex;
    font-size: 0.66rem;
    font-weight: 800;
    gap: 0.1rem;
    padding: 0;
}

.pixi-mana-pool .ms {
    font-size: 0.88rem;
}

.pixi-stack-panel {
    background: transparent;
    border: 0;
    border-radius: 0;
    box-shadow: none;
    max-height: 92vh;
    overflow: visible;
    padding: 0;
    right: 0.55rem;
    top: 50%;
    transform: translateY(-50%);
    width: clamp(10.5rem, 14vw, 13.5rem);
}

.pixi-panel-title {
    align-items: flex-end;
    background: rgb(255 255 255 / 96%);
    border: 1px solid #98a2b3;
    border-radius: 0.3rem;
    box-shadow: 0 0.35rem 1rem rgb(16 24 40 / 16%);
    color: #101828;
    flex-direction: column;
    letter-spacing: normal;
    padding: 0.28rem 0.38rem;
}

.pixi-panel-title strong {
    align-self: flex-start;
    font-size: 0.75rem;
}

.pixi-panel-title span {
    color: #667085;
    font-size: 0.58rem;
}

.pixi-stack-card-fan {
    height: calc(18rem + (var(--stack-count) - 1) * 2rem);
    margin-top: 0.35rem;
    position: relative;
}

.pixi-stack-item {
    background: #fff;
    border: 2px solid #667085;
    border-left-width: 2px;
    border-radius: 0.48rem;
    box-shadow: 0 0.55rem 1.25rem rgb(16 24 40 / 22%);
    display: block;
    height: 18rem;
    left: 0;
    margin: 0;
    overflow: hidden;
    padding: 0;
    position: absolute;
    top: calc(var(--stack-index) * 2rem);
    transform: none;
    width: 100%;
    text-align: left;
}

.pixi-stack-item.ability { border-color: #0e7490; }
.pixi-stack-item.top { box-shadow: 0 0.8rem 1.6rem rgb(16 24 40 / 28%); }

.pixi-stack-item > strong {
    border-bottom: 1px solid #d0d5dd;
    display: block;
    font-size: 0.72rem;
    height: 2rem;
    overflow: hidden;
    padding: 0.42rem 0.46rem;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.pixi-stack-art {
    background:
        radial-gradient(circle at 65% 35%, rgb(255 255 255 / 42%), transparent 28%),
        linear-gradient(145deg, #173f72, #6ab0d8 58%, #d9b66a);
    height: 10.4rem;
    object-fit: cover;
    width: 100%;
}

.pixi-stack-item > span {
    background: #ecfeff;
    border: 1px solid #67e8f9;
    border-radius: 0.22rem;
    color: #155e75;
    display: inline-block;
    font-size: 0.55rem;
    font-weight: 800;
    margin: 0.38rem;
    padding: 0.14rem 0.24rem;
}

.pixi-stack-item small {
    color: #475467;
    display: block;
    font-size: 0.55rem;
    line-height: 1.35;
    padding: 0 0.38rem;
}

.pixi-game-controls button {
    background: rgb(255 255 255 / 96%);
    border-color: #98a2b3;
    color: #344054;
}

.pixi-game-controls button:hover,
.pixi-game-controls button.primary {
    background: linear-gradient(145deg, #7d2f36, #552027);
    border-color: #552027;
    color: #fff;
}

.pixi-game-controls button.danger {
    border-color: #b42318;
    color: #b42318;
}

.pixi-game-controls button.pixi-auto-pass.active {
    background: #ecfdf3;
    border-color: #12b76a;
    color: #027a48;
}

.pixi-game-hint {
    background: rgb(255 255 255 / 94%);
    border-color: #d0d5dd;
    box-shadow: 0 0.35rem 1rem rgb(16 24 40 / 10%);
    max-width: 17rem;
}

.pixi-game-hint strong { color: #101828; }
.pixi-game-hint span { color: #667085; }
.pixi-zone-label { color: rgb(71 84 103 / 46%); }

@media (max-width: 900px) {
    .pixi-game-prototype { min-height: 36rem; }
    .pixi-game-mode { display: none; }
    .pixi-game-topbar { grid-template-columns: 1fr auto; }
    .pixi-player-identity { display: none; }
    .pixi-stack-panel { width: clamp(8rem, 20vw, 10rem); }
    .pixi-stack-card-fan { height: calc(14rem + (var(--stack-count) - 1) * 1.5rem); }
    .pixi-stack-art { height: 7.6rem; }
    .pixi-stack-item { height: 14rem; top: calc(var(--stack-index) * 1.5rem); }
    .pixi-game-frame-rate { display: none; }
    .pixi-game-controls { max-width: 10rem; }
}

.pixi-zone-inspector {
    background: rgb(255 253 251 / 98%);
    border: 1px solid #9a8378;
    border-radius: 0.6rem;
    box-shadow: 0 1.2rem 3.5rem rgb(16 24 40 / 28%);
    color: #101828;
    left: 50%;
    max-height: min(42vh, 26rem);
    max-width: min(52rem, calc(100vw - 2rem));
    overflow: hidden;
    position: absolute;
    transform: translateX(-50%);
    width: 100%;
    z-index: 35;
}

.pixi-zone-inspector-local { top: 4rem; }
.pixi-zone-inspector-opponent { bottom: 4.5rem; }

.pixi-zone-inspector > header {
    align-items: center;
    border-bottom: 1px solid #d0d5dd;
    display: flex;
    justify-content: space-between;
    padding: 0.65rem 0.75rem;
}

.pixi-zone-inspector > header div { display: grid; gap: 0.08rem; }
.pixi-zone-inspector > header span { color: #667085; font-size: 0.62rem; }
.pixi-zone-inspector > header strong { font-size: 0.85rem; }
.pixi-zone-inspector > header button {
    background: #fff;
    border: 1px solid #98a2b3;
    border-radius: 999px;
    cursor: pointer;
    font-size: 1.05rem;
    height: 2rem;
    width: 2rem;
}

.pixi-zone-inspector-grid {
    display: grid;
    gap: 0.65rem;
    grid-template-columns: repeat(auto-fill, minmax(6.2rem, 1fr));
    max-height: calc(min(42vh, 26rem) - 4rem);
    overflow: auto;
    padding: 0.75rem;
}

.pixi-zone-inspector-grid > button {
    background: #fff;
    border: 2px solid #d0d5dd;
    border-radius: 0.45rem;
    color: #101828;
    cursor: pointer;
    display: grid;
    gap: 0.25rem;
    min-width: 0;
    padding: 0.25rem;
    text-align: left;
}

.pixi-zone-inspector-grid > button.linked { border-color: #0e7490; }
.pixi-zone-inspector-grid img { aspect-ratio: 63 / 88; object-fit: cover; width: 100%; }
.pixi-zone-inspector-grid span { font-size: 0.63rem; font-weight: 750; }
.pixi-zone-inspector-grid small { color: #0e7490; font-size: 0.55rem; font-weight: 800; }

.pixi-mobile-player-navigator { display: none; }

@media (max-width: 700px) {
    .pixi-game-mobile-focus .pixi-player-hud-top,
    .pixi-game-mobile-focus .pixi-player-hud-opponent {
        left: 50%;
        right: auto;
        top: 6.4rem;
        transform: translateX(-50%);
    }

    .pixi-game-mobile-focus .pixi-player-identity {
        display: block;
        left: 50%;
        min-width: 5.4rem;
        padding: 0.24rem 0.35rem;
        right: auto;
        top: -0.8rem;
        transform: translate(-50%, -100%);
    }

    .pixi-game-mobile-focus .pixi-player-hud-local .pixi-player-identity {
        left: calc(100% + 0.25rem);
        top: 50%;
        transform: translateY(-50%);
    }

    .pixi-mobile-player-navigator {
        align-items: center;
        display: grid;
        gap: 0.28rem;
        grid-template-columns: auto minmax(0, 1fr) auto;
        left: 0.35rem;
        position: absolute;
        right: 0.35rem;
        top: 3.35rem;
        z-index: 24;
    }

    .pixi-mobile-player-navigator > button {
        background: rgb(255 253 251 / 96%);
        border: 1px solid #98a2b3;
        border-radius: 999px;
        color: #344054;
        font-size: 1rem;
        height: 1.85rem;
        width: 1.85rem;
    }

    .pixi-mobile-player-summaries {
        display: flex;
        gap: 0.28rem;
        justify-content: center;
        min-width: 0;
    }

    .pixi-mobile-player-summaries button {
        background: rgb(255 253 251 / 96%);
        border: 1px solid var(--pixi-player-accent);
        border-radius: 999px;
        color: #344054;
        display: grid;
        max-width: 8rem;
        min-width: 0;
        padding: 0.22rem 0.5rem;
        text-align: center;
    }

    .pixi-mobile-player-summaries span,
    .pixi-mobile-player-summaries strong {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .pixi-mobile-player-summaries span { font-size: 0.48rem; }
    .pixi-mobile-player-summaries strong { font-size: 0.55rem; }

    .pixi-zone-inspector { max-height: min(44vh, 24rem); max-width: calc(100vw - 1rem); }
    .pixi-zone-inspector-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        max-height: calc(min(44vh, 24rem) - 4rem);
    }
}
</style>
