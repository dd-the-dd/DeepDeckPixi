// Pure mapping from an Engine decision request (`view.decision`) to the UI
// primitive that must present it. The Engine stays authoritative: every
// submission produced from this model echoes one of `decision.options[].id`.

export const DECISION_PRIMITIVES = Object.freeze({
    board: 'board',
    cardName: 'cardName',
    cardOrder: 'cardOrder',
    cardSelection: 'cardSelection',
    color: 'color',
    number: 'number',
    options: 'options',
});

// Primitive used for each DecisionKind when the request carries no typed
// `choice`. Resolution and replacement choices are refined from their options
// (colors, board targets, numbers) by `gameSessionDecisionModel`.
export const DECISION_KIND_PRIMITIVES = Object.freeze({
    attackers: DECISION_PRIMITIVES.board,
    blockers: DECISION_PRIMITIVES.board,
    combatDamage: DECISION_PRIMITIVES.number,
    discard: DECISION_PRIMITIVES.board,
    mulligan: DECISION_PRIMITIVES.options,
    mulliganBottom: DECISION_PRIMITIVES.board,
    openingHandSelection: DECISION_PRIMITIVES.board,
    priority: DECISION_PRIMITIVES.board,
    replacementChoice: DECISION_PRIMITIVES.options,
    resolutionChoice: DECISION_PRIMITIVES.options,
    sideboarding: DECISION_PRIMITIVES.cardSelection,
});

// Primitive used for each typed `decision.choice.kind`.
export const DECISION_CHOICE_PRIMITIVES = Object.freeze({
    cardNameSelection: DECISION_PRIMITIVES.cardName,
    cardOrder: DECISION_PRIMITIVES.cardOrder,
    cardSelection: DECISION_PRIMITIVES.cardSelection,
    numberSelection: DECISION_PRIMITIVES.number,
    optionSelection: DECISION_PRIMITIVES.options,
});

export const MAGIC_COLORS = Object.freeze([
    Object.freeze({ color: 'W', name: 'White', symbol: '{W}' }),
    Object.freeze({ color: 'U', name: 'Blue', symbol: '{U}' }),
    Object.freeze({ color: 'B', name: 'Black', symbol: '{B}' }),
    Object.freeze({ color: 'R', name: 'Red', symbol: '{R}' }),
    Object.freeze({ color: 'G', name: 'Green', symbol: '{G}' }),
]);

const colorByName = new Map(MAGIC_COLORS.flatMap(entry => [
    [entry.color.toLowerCase(), entry.color],
    [entry.name.toLowerCase(), entry.color],
    [entry.symbol.toLowerCase(), entry.color],
]));

// Board selection flows keyed by the action field that names the object the
// player clicks first (the attacker, the blocker, the card to cast...).
const SOURCE_MODES = Object.freeze({
    attackers: 'attacker',
    blockers: 'blocker',
    discard: 'card',
    mulliganBottom: 'card',
    openingHandSelection: 'card',
    priority: 'card',
});

const LINK_KINDS = Object.freeze({
    attackers: 'attack',
    blockers: 'block',
});

const boardZones = new Set(['battlefield', 'hand']);

function transport(object, camelKey, snakeKey) {
    return object?.[camelKey] ?? object?.[snakeKey] ?? '';
}

/**
 * Normalizes an Engine `TargetRef` (`{player:{playerId}}`,
 * `{permanent:{instanceId}}`, `{card:{instanceId}}`,
 * `{stackObject:{stackId}}`) to the clickable table entity.
 */
export function decisionTargetEntity(target) {
    if (!target || typeof target !== 'object') {
        return null;
    }
    const playerId = transport(target.player, 'playerId', 'player_id');
    if (playerId) return { id: String(playerId), kind: 'player' };
    const permanentId = transport(target.permanent, 'instanceId', 'instance_id');
    if (permanentId) return { id: String(permanentId), kind: 'card' };
    const cardId = transport(target.card, 'instanceId', 'instance_id');
    if (cardId) return { id: String(cardId), kind: 'card' };
    const stackId = transport(target.stackObject ?? target.stack_object, 'stackId', 'stack_id');
    if (stackId) return { id: String(stackId), kind: 'stack' };
    return null;
}

export function decisionColorOfValue(value) {
    if (Array.isArray(value)) {
        return value.length === 1 ? decisionColorOfValue(value[0]) : null;
    }
    if (typeof value !== 'string') {
        return null;
    }
    return colorByName.get(value.trim().toLowerCase()) ?? null;
}

function actionColor(action, decisionId) {
    const decisions = action?.decisions ?? {};
    if (decisionId && decisionId in decisions) {
        return decisionColorOfValue(decisions[decisionId]);
    }
    if ('manaChoice' in decisions) {
        return decisionColorOfValue(decisions.manaChoice);
    }
    const entries = Object.values(decisions);
    if (entries.length === 1) {
        const color = decisionColorOfValue(entries[0]);
        if (color) return color;
    }
    const label = /^(?:add|choose)\s+(\{[wubrg]\}|white|blue|black|red|green|[wubrg])\s*$/iu
        .exec(String(action?.label ?? ''));
    return label ? decisionColorOfValue(label[1]) : null;
}

/**
 * Color wheel model: the five WUBRG entries in wheel order, each enabled only
 * when an Engine option chooses exactly that color. Options that are not one
 * WUBRG color (colorless, several colors, decline...) stay as text fallbacks.
 * Returns null when the options are not a color choice.
 */
export function decisionColorChoice(actions = [], decisionId = '') {
    const actionByColor = new Map();
    const extras = [];
    for (const action of actions) {
        const color = actionColor(action, decisionId);
        if (!color || actionByColor.has(color)) {
            extras.push({ actionId: action.id, label: action.label ?? action.id });
            continue;
        }
        actionByColor.set(color, action.id);
    }
    if (actionByColor.size < 2) {
        return null;
    }
    return {
        colors: MAGIC_COLORS.map(entry => ({
            ...entry,
            actionId: actionByColor.get(entry.color) ?? null,
            enabled: actionByColor.has(entry.color),
        })),
        extras,
    };
}

export function clampDecisionNumber(value, bounds = {}) {
    const values = Array.isArray(bounds.values) && bounds.values.length
        ? [...bounds.values].sort((left, right) => left - right)
        : null;
    const minimum = values ? values[0] : Number(bounds.minimum ?? 0);
    const maximum = values ? values.at(-1) : Number(bounds.maximum ?? minimum);
    const step = Math.max(1, Number(bounds.step ?? 1));
    let number = Number(value);
    if (Number.isNaN(number)) number = minimum;
    number = Math.min(maximum, Math.max(minimum, Math.round(number)));
    if (values) {
        return values.reduce((best, candidate) => {
            return Math.abs(candidate - number) < Math.abs(best - number) ? candidate : best;
        }, values[0]);
    }
    return minimum + Math.round((number - minimum) / step) * step;
}

export function stepDecisionNumber(value, direction, bounds = {}) {
    const current = clampDecisionNumber(value, bounds);
    if (Array.isArray(bounds.values) && bounds.values.length) {
        const values = [...bounds.values].sort((left, right) => left - right);
        const index = values.indexOf(current);
        return values[Math.min(values.length - 1, Math.max(0, index + Math.sign(direction)))];
    }
    const step = Math.max(1, Number(bounds.step ?? 1));
    return clampDecisionNumber(current + Math.sign(direction) * step, bounds);
}

function stateEntityIndex(state = {}) {
    const cards = new Map();
    const players = new Set();
    const stack = new Set();
    for (const player of state.players ?? []) {
        if (player?.id) players.add(String(player.id));
        for (const zone of [
            'battlefield',
            'hand',
            'graveyard',
            'exile',
            'library',
            'commandZone',
            'sideboard',
        ]) {
            for (const card of player?.[zone] ?? []) {
                if (card?.instanceId) {
                    cards.set(String(card.instanceId), {
                        instance: card,
                        ownerId: String(player.id ?? ''),
                        zone,
                    });
                }
            }
        }
    }
    for (const object of state.stack ?? []) {
        if (object?.id) stack.add(String(object.id));
        if (object?.card?.instanceId && !cards.has(String(object.card.instanceId))) {
            cards.set(String(object.card.instanceId), {
                instance: object.card,
                ownerId: String(object.controller ?? ''),
                zone: 'stack',
            });
        }
    }
    return { cards, players, stack };
}

// Resolution option values are raw IDs or typed IDs (`player:p2`,
// `permanent:…`, `stack:…`). IDs themselves can contain colons.
function optionValueTarget(value, index) {
    if (typeof value !== 'string') return null;
    if (index.players.has(value)) return { player: { playerId: value } };
    if (index.stack.has(value)) return { stackObject: { stackId: value } };
    const card = index.cards.get(value);
    if (card) {
        return card.zone === 'battlefield'
            ? { permanent: { instanceId: value } }
            : { card: { instanceId: value } };
    }
    const separator = value.indexOf(':');
    if (separator < 0) return null;
    const kind = value.slice(0, separator);
    const id = value.slice(separator + 1);
    if (kind === 'player' && index.players.has(id)) return { player: { playerId: id } };
    if (kind === 'permanent' && index.cards.has(id)) return { permanent: { instanceId: id } };
    if (kind === 'card' && index.cards.has(id)) return { card: { instanceId: id } };
    if (kind === 'stack' && index.stack.has(id)) return { stackObject: { stackId: id } };
    return null;
}

function optionSelectionTargets(actions, decisionId, index) {
    let mapped = 0;
    const converted = actions.map(action => {
        const selected = action.decisions?.[decisionId];
        const value = Array.isArray(selected) && selected.length === 1 ? selected[0] : selected;
        const target = optionValueTarget(value, index);
        if (!target) {
            return action;
        }
        mapped += 1;
        return {
            ...action,
            targetOrder: [decisionId],
            targets: { [decisionId]: target },
        };
    });
    return mapped > 0 ? converted : null;
}

function subsetCount(size, minimum, maximum) {
    let total = 0;
    for (let count = Math.max(0, minimum); count <= Math.min(size, maximum); count += 1) {
        let combinations = 1;
        for (let index = 0; index < count; index += 1) {
            combinations = combinations * (size - index) / (index + 1);
        }
        total += combinations;
        if (total > 128) return total;
    }
    return total;
}

function hasTargets(action) {
    return Object.keys(action?.targets ?? {}).length > 0;
}

function sourceIdOf(action, sourceMode) {
    if (sourceMode === 'attacker') {
        return ['declareAttacker', 'cancelAttacker'].includes(action?.kind)
            ? String(transport(action, 'attackerId', 'attacker_id') || '')
            : '';
    }
    if (sourceMode === 'blocker') {
        return action?.kind === 'declareBlocker'
            ? String(transport(action, 'blockerId', 'blocker_id') ||
                transport(action, 'cardInstanceId', 'card_instance_id') || '')
            : '';
    }
    if (sourceMode === 'card') {
        return String(transport(action, 'cardInstanceId', 'card_instance_id') || '');
    }
    return '';
}

function combatDamageNumber(actions) {
    const actionByValue = {};
    let recipientId = '';
    let attackerId = '';
    for (const action of actions) {
        const amount = action?.decisions?.combatDamageAmount;
        if (!Number.isInteger(amount) || amount in actionByValue) {
            return null;
        }
        actionByValue[amount] = action.id;
        recipientId ||= String(action.decisions.combatDamageRecipient ?? '');
        attackerId ||= String(transport(action, 'attackerId', 'attacker_id') || '');
    }
    const values = Object.keys(actionByValue).map(Number).sort((left, right) => left - right);
    if (values.length === 0) {
        return null;
    }
    return {
        actionByValue,
        attackerId,
        maximum: values.at(-1),
        minimum: values[0],
        recipientId,
        step: 1,
        values,
    };
}

function cardDescription(id, index, describeCard, fallbackInstance) {
    const instance = index.cards.get(id)?.instance ?? fallbackInstance ?? null;
    const described = describeCard?.(id, instance) ?? null;
    const definition = instance?.definition ?? {};
    const oracleText = described?.oracleText ?? definition.oracleText ?? '';
    // Fight is the `fightPermanents` effect primitive in the canonical rules.
    const rulesText = JSON.stringify(definition.rules ?? []);
    return {
        fights: rulesText.includes('"fightPermanents"') || /\bfights?\b/iu.test(oracleText),
        id,
        imageUrl: described?.imageUrl ?? instance?.imageUrl ?? definition.imageUrl ?? '',
        name: described?.name ?? definition.name ?? id,
        oracleText,
        typeLine: described?.typeLine ?? definition.typeLine ?? '',
    };
}

/**
 * Builds the presentation model for the pending Engine decision.
 *
 * @param {object} view A `mtg-game-session/v1` view (or `{ state, decision }`).
 * @param {object} [options]
 * @param {(instanceId: string, instance: object|null) => object|null} [options.describeCard]
 *   Display metadata (name, imageUrl, oracleText) for cards outside the table.
 */
export function gameSessionDecisionModel(view, options = {}) {
    const decision = view?.decision ?? null;
    if (!decision) {
        return null;
    }
    const state = view?.state ?? {};
    const index = stateEntityIndex(state);
    const actions = (decision.options ?? []).filter(action => action?.id);
    const choice = decision.choice ?? null;
    const fallbackInstances = new Map(actions.flatMap(action => {
        const candidate = action?.decisions?.openingHandCandidate;
        return candidate?.instanceId ? [[String(candidate.instanceId), candidate]] : [];
    }));
    const describe = id => cardDescription(
        String(id),
        index,
        options.describeCard,
        fallbackInstances.get(String(id)),
    );
    const cardZone = id => {
        const entry = index.cards.get(String(id));
        if (!entry) return fallbackInstances.has(String(id)) ? 'openingHand' : 'unknown';
        return entry.zone;
    };
    const visibleOnBoard = id => {
        const entry = index.cards.get(String(id));
        return Boolean(entry && boardZones.has(entry.zone) &&
            (entry.zone !== 'hand' || entry.ownerId === decision.playerId ||
                entry.instance?.flags?.knownToViewer));
    };
    const sourceCardId = String(
        decision.sourceCardInstanceId ?? decision.sourceCard?.instanceId ?? '',
    );
    const base = {
        actions,
        cardZone,
        choiceKind: choice?.kind ?? null,
        decisionId: decision.id,
        describeCard: describe,
        id: decision.id,
        kind: decision.kind,
        playerId: decision.playerId ?? '',
        prompt: choice?.prompt ?? '',
        sourceCardId,
        unsupported: null,
        visibleOnBoard,
    };
    const unsupported = reason => ({
        ...base,
        primitive: DECISION_PRIMITIVES.options,
        prompt: base.prompt || `Choose an option (${decision.kind}).`,
        textOptions: actions.map(action => ({ actionId: action.id, label: action.label ?? action.id })),
        unsupported: reason,
    });

    if (choice?.kind === 'cardSelection' || choice?.kind === 'cardOrder') {
        const ordered = choice.kind === 'cardOrder';
        const candidateCardIds = (ordered
            ? choice.cardInstanceIds
            : choice.candidateCardInstanceIds ?? []).map(String);
        const sideboardIds = new Set((state.players ?? []).flatMap(player => {
            return (player.sideboard ?? []).map(card => String(card?.instanceId ?? ''));
        }));
        const presets = actions.flatMap(action => {
            const ids = action.decisions?.[choice.decisionId];
            return Array.isArray(ids)
                ? [{ actionId: action.id, cardInstanceIds: ids.map(String) }]
                : [];
        });
        return {
            ...base,
            candidateCardIds,
            choiceDecisionId: choice.decisionId,
            initialSelectedCardIds: decision.kind === 'sideboarding'
                ? candidateCardIds.filter(id => !sideboardIds.has(id))
                : [],
            maximum: ordered ? candidateCardIds.length : Number(choice.maximum ?? 0),
            minimum: ordered ? candidateCardIds.length : Number(choice.minimum ?? 0),
            presets,
            // The Engine enumerates subsets (stopping at 128) and only then
            // filters hidden constraints (same land type, one per color). When
            // enumeration was not truncated, the presets are the legal set.
            presetsComplete: !ordered && presets.length > 1 &&
                subsetCount(candidateCardIds.length, Number(choice.minimum ?? 0), Number(choice.maximum ?? 0)) <= 128,
            primitive: ordered ? DECISION_PRIMITIVES.cardOrder : DECISION_PRIMITIVES.cardSelection,
            prompt: base.prompt || (ordered ? 'Order the cards.' : 'Choose cards.'),
            submitActionId: actions[0]?.id ?? null,
        };
    }
    if (choice?.kind === 'numberSelection') {
        const minimum = Number(choice.minimum ?? 0);
        const maximum = Number(choice.maximum ?? minimum);
        return {
            ...base,
            number: { maximum, minimum, step: 1, submitActionId: actions[0]?.id ?? null },
            primitive: DECISION_PRIMITIVES.number,
            prompt: base.prompt || 'Choose a number.',
        };
    }
    if (choice?.kind === 'cardNameSelection') {
        const action = actions.find(option => option.kind === 'chooseResolution') ?? actions[0];
        return {
            ...base,
            cardName: {
                submitActionId: action?.id ?? null,
                suggestions: Array.isArray(choice.suggestions) ? [...choice.suggestions] : [],
            },
            primitive: DECISION_PRIMITIVES.cardName,
            prompt: base.prompt || 'Choose a card name.',
        };
    }
    if (choice && choice.kind !== 'optionSelection') {
        return unsupported(`choice:${choice.kind}`);
    }

    if (choice?.kind === 'optionSelection' || ['resolutionChoice', 'replacementChoice'].includes(decision.kind)) {
        const colorChoice = decisionColorChoice(actions, choice?.decisionId ?? '');
        if (colorChoice) {
            return {
                ...base,
                color: colorChoice,
                primitive: DECISION_PRIMITIVES.color,
                prompt: base.prompt || 'Choose a color.',
            };
        }
        const targetActions = choice?.kind === 'optionSelection'
            ? optionSelectionTargets(actions, choice.decisionId, index)
            : actions.some(hasTargets) ? actions : null;
        if (targetActions) {
            return boardModel(base, targetActions, '', 'target', describe);
        }
        const damage = combatDamageNumber(actions);
        if (damage) {
            return { ...base, number: damage, primitive: DECISION_PRIMITIVES.number };
        }
        return {
            ...base,
            primitive: DECISION_PRIMITIVES.options,
            prompt: base.prompt || 'Choose an option.',
            textOptions: actions.map(action => ({ actionId: action.id, label: action.label ?? action.id })),
        };
    }
    if (decision.kind === 'combatDamage') {
        const damage = combatDamageNumber(actions);
        return damage
            ? {
                ...base,
                number: damage,
                primitive: DECISION_PRIMITIVES.number,
                prompt: 'Assign combat damage.',
            }
            : unsupported('combatDamage:non-numeric');
    }
    if (decision.kind === 'mulligan') {
        return {
            ...base,
            primitive: DECISION_PRIMITIVES.options,
            prompt: 'Keep this hand or take a mulligan?',
            textOptions: actions.map(action => ({ actionId: action.id, label: action.label ?? action.id })),
        };
    }
    if (decision.kind in SOURCE_MODES) {
        return boardModel(
            base,
            actions,
            SOURCE_MODES[decision.kind],
            LINK_KINDS[decision.kind] ?? 'target',
            describe,
        );
    }
    return unsupported(`kind:${decision.kind}`);
}

function boardModel(base, actions, sourceMode, linkKind, describe) {
    const prompts = {
        attackers: 'Choose an attacker, then what it attacks.',
        blockers: 'Choose a blocker, then the attacker it blocks.',
        discard: 'Choose a card to discard.',
        mulliganBottom: 'Choose a card to put on the bottom of your library.',
        openingHandSelection: 'Choose a card for your opening hand.',
    };
    const fight = actions.some(action => /\bfights?\b/iu.test(String(action.label ?? ''))) ||
        Boolean(base.sourceCardId && describe(base.sourceCardId).fights);
    return {
        ...base,
        board: {
            actions,
            fight,
            linkKind,
            sourceMode,
        },
        primitive: DECISION_PRIMITIVES.board,
        prompt: base.prompt || prompts[base.kind] || '',
    };
}

/** Classifies a decision without building the full model (for tables/tests). */
export function decisionPrimitiveOf(view) {
    return gameSessionDecisionModel(view)?.primitive ?? null;
}

export function boardSourceIdOf(action, sourceMode) {
    return sourceIdOf(action, sourceMode);
}

/**
 * Fight pairs reconstructed from Engine `damageDealt` events. The Engine has no
 * fight event: a fight is two non-combat damage events whose source and
 * recipient creatures are swapped. Restrict to the current turn and step.
 */
export function pixiFightPairs(events = [], scope = {}) {
    const damage = events.filter(event => {
        return event?.kind === 'damageDealt' &&
            !event.detail?.combat &&
            transport(event, 'cardInstanceId', 'card_instance_id') &&
            event.detail?.source &&
            (scope.turnNumber == null || Number(event.turnNumber) === Number(scope.turnNumber)) &&
            (!scope.step || event.step === scope.step);
    });
    const pairs = [];
    const used = new Set();
    damage.forEach((event, eventIndex) => {
        if (used.has(eventIndex)) return;
        const recipient = String(transport(event, 'cardInstanceId', 'card_instance_id'));
        const source = String(event.detail.source);
        if (recipient === source) return;
        const partnerIndex = damage.findIndex((candidate, candidateIndex) => {
            return candidateIndex > eventIndex &&
                candidateIndex <= eventIndex + 3 &&
                !used.has(candidateIndex) &&
                String(candidate.detail.source) === recipient &&
                String(transport(candidate, 'cardInstanceId', 'card_instance_id')) === source;
        });
        if (partnerIndex < 0) return;
        used.add(eventIndex);
        used.add(partnerIndex);
        pairs.push({ firstId: source, secondId: recipient });
    });
    return pairs;
}
