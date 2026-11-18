// Pure interaction state for a decision model built by
// `gameSessionDecisionModel`. Every function returns new objects; the
// component only stores the selection and renders `decisionSelectionView`.

import {
    DECISION_PRIMITIVES,
    boardSourceIdOf,
    clampDecisionNumber,
    decisionTargetEntity,
} from './DecisionPrimitives.mjs';

export function createDecisionSelection(model) {
    const number = model?.number;
    return {
        cardName: '',
        decisionId: model?.decisionId ?? null,
        numberValue: number ? clampDecisionNumber(number.minimum, number) : null,
        path: [],
        selectedCardIds: [...(model?.initialSelectedCardIds ?? [])],
        sourceId: '',
        variantKey: '',
    };
}

function variantSignature(action) {
    const targetSlots = new Set([
        ...(action.targetOrder ?? []),
        ...Object.keys(action.targets ?? {}),
    ]);
    const decisions = Object.entries(action.decisions ?? {})
        .filter(([key]) => !targetSlots.has(key))
        .sort(([left], [right]) => left.localeCompare(right));
    return JSON.stringify({
        attackerId: targetSlots.has('attacker') ? null : action.attackerId ?? null,
        blockerId: action.blockerId ?? null,
        cardInstanceId: action.cardInstanceId ?? null,
        decisions,
        kind: action.kind,
        paymentSources: [...(action.paymentSources ?? [])].sort(),
    });
}

function targetEntityOf(action, slot) {
    return decisionTargetEntity(action?.targets?.[slot]);
}

function boardCandidates(model, selection) {
    const { actions, sourceMode } = model.board;
    return actions.filter(action => {
        if (selection.sourceId && boardSourceIdOf(action, sourceMode) !== selection.sourceId) {
            return false;
        }
        if (selection.variantKey && variantSignature(action) !== selection.variantKey) {
            return false;
        }
        return selection.path.every(({ entityId, slot }) => {
            return targetEntityOf(action, slot)?.id === entityId;
        });
    });
}

function slotOrder(actions) {
    const slots = [];
    for (const action of actions) {
        for (const slot of [...(action.targetOrder ?? []), ...Object.keys(action.targets ?? {})]) {
            if (!slots.includes(slot)) slots.push(slot);
        }
    }
    return slots;
}

function uniqueLabels(actions) {
    const counts = new Map();
    for (const action of actions) {
        const label = action.label ?? action.id;
        counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const seen = new Map();
    return actions.map(action => {
        const label = action.label ?? action.id;
        if (counts.get(label) === 1) return label;
        const index = (seen.get(label) ?? 0) + 1;
        seen.set(label, index);
        return `${label} (${index})`;
    });
}

function emptyHighlights() {
    return { cardIds: [], playerIds: [], stackIds: [] };
}

function entityHighlights(entities) {
    const highlights = emptyHighlights();
    for (const entity of entities) {
        const list = entity.kind === 'player'
            ? highlights.playerIds
            : entity.kind === 'stack' ? highlights.stackIds : highlights.cardIds;
        if (!list.includes(entity.id)) list.push(entity.id);
    }
    return highlights;
}

function isFight(model, selection) {
    const sourceId = selection.sourceId || model.sourceCardId;
    return Boolean(model.board.fight || (sourceId && model.describeCard(sourceId).fights));
}

function boardStage(model, selection) {
    const { sourceMode } = model.board;
    const actions = boardCandidates(model, selection);
    if (actions.length === 0) {
        return { stage: 'empty', textOptions: [], ...emptyHighlights() };
    }
    if (sourceMode && !selection.sourceId) {
        const sources = [];
        const direct = [];
        for (const action of actions) {
            const sourceId = boardSourceIdOf(action, sourceMode);
            if (sourceId) {
                if (!sources.includes(sourceId)) sources.push(sourceId);
            } else {
                direct.push(action);
            }
        }
        return {
            ...entityHighlights(sources.map(id => ({ id, kind: 'card' }))),
            stage: 'source',
            textOptions: direct.map((action, index) => ({
                actionId: action.id,
                label: uniqueLabels(direct)[index],
            })),
        };
    }
    if (!selection.variantKey) {
        const groups = new Map();
        for (const action of actions) {
            const key = variantSignature(action);
            groups.set(key, [...(groups.get(key) ?? []), action]);
        }
        if (groups.size > 1) {
            const entries = [...groups.entries()];
            const xValues = entries.map(([, group]) => group[0].decisions?.xValue);
            if (
                xValues.every(Number.isInteger) &&
                new Set(xValues).size === xValues.length
            ) {
                const values = [...xValues].sort((left, right) => left - right);
                return {
                    ...emptyHighlights(),
                    number: {
                        maximum: values.at(-1),
                        minimum: values[0],
                        step: 1,
                        values,
                        variantByValue: Object.fromEntries(entries.map(([key, group]) => {
                            return [group[0].decisions.xValue, key];
                        })),
                    },
                    stage: 'number',
                    textOptions: [],
                };
            }
            const representatives = entries.map(([, group]) => group[0]);
            const labels = uniqueLabels(representatives);
            return {
                ...emptyHighlights(),
                stage: 'menu',
                textOptions: entries.map(([key], index) => ({ label: labels[index], variantKey: key })),
            };
        }
    }
    const chosenSlots = new Set(selection.path.map(entry => entry.slot));
    const slot = slotOrder(actions).find(candidate => {
        return !chosenSlots.has(candidate) && actions.some(action => targetEntityOf(action, candidate));
    });
    if (slot) {
        const entities = actions.flatMap(action => {
            const entity = targetEntityOf(action, slot);
            return entity ? [entity] : [];
        });
        const untargeted = actions.filter(action => !targetEntityOf(action, slot));
        const labels = uniqueLabels(untargeted);
        return {
            ...entityHighlights(entities),
            slot,
            stage: 'target',
            textOptions: untargeted.map((action, index) => ({
                actionId: action.id,
                label: labels[index],
            })),
        };
    }
    if (actions.length === 1) {
        // A fight is confirmed with its arrow drawn between both creatures.
        const stage = isFight(model, selection) && selection.path.length >= 2 ? 'confirm' : 'submit';
        return { ...emptyHighlights(), actionId: actions[0].id, stage, textOptions: [] };
    }
    const labels = uniqueLabels(actions);
    return {
        ...emptyHighlights(),
        stage: 'menu',
        textOptions: actions.map((action, index) => ({ actionId: action.id, label: labels[index] })),
    };
}

function legalCardSelectionIds(model, selectedCardIds) {
    const selected = new Set(selectedCardIds);
    if (selected.size >= model.maximum) {
        return [];
    }
    const remaining = model.candidateCardIds.filter(id => !selected.has(id));
    if (!model.presetsComplete || model.primitive === DECISION_PRIMITIVES.cardOrder) {
        return remaining;
    }
    // Restrict to cards that still extend the current pick into a complete
    // Engine-enumerated subset (preserves hidden constraints such as
    // "same land type" that the free-selection payload does not describe).
    return remaining.filter(id => model.presets.some(preset => {
        return preset.cardInstanceIds.includes(id) &&
            [...selected].every(selectedId => preset.cardInstanceIds.includes(selectedId));
    }));
}

function matchingPreset(model, selectedCardIds) {
    return model.presets.find(preset => {
        if (preset.cardInstanceIds.length !== selectedCardIds.length) return false;
        return model.primitive === DECISION_PRIMITIVES.cardOrder
            ? preset.cardInstanceIds.every((id, index) => id === selectedCardIds[index])
            : preset.cardInstanceIds.every(id => selectedCardIds.includes(id));
    }) ?? null;
}

function cardSelectionConfirmable(model, selectedCardIds) {
    const count = selectedCardIds.length;
    if (count < model.minimum || count > model.maximum) return false;
    if (model.primitive === DECISION_PRIMITIVES.cardSelection && model.presetsComplete) {
        return Boolean(matchingPreset(model, selectedCardIds));
    }
    return true;
}

function pendingLinks(model, selection) {
    const links = [];
    if (model.primitive === DECISION_PRIMITIVES.number && model.number?.recipientId) {
        const attackerId = model.number.attackerId;
        if (attackerId) {
            links.push({
                key: `pending:damage:${attackerId}:${model.number.recipientId}`,
                kind: 'pending',
                sourceCardId: attackerId,
                targetCardId: model.number.recipientId,
                targetPlayerId: '',
            });
        }
        return links;
    }
    if (model.primitive !== DECISION_PRIMITIVES.board) {
        return links;
    }
    const sourceId = selection.sourceId || model.sourceCardId;
    const chosen = selection.path.map(entry => {
        const action = model.board.actions.find(candidate => {
            return targetEntityOf(candidate, entry.slot)?.id === entry.entityId;
        });
        return targetEntityOf(action, entry.slot);
    }).filter(Boolean);
    const cardTargets = chosen.filter(entity => entity.kind === 'card');
    if (isFight(model, selection) && cardTargets.length >= 2) {
        links.push({
            key: `pending:fight:${cardTargets[0].id}:${cardTargets[1].id}`,
            kind: 'fight',
            sourceCardId: cardTargets[0].id,
            targetCardId: cardTargets[1].id,
            targetPlayerId: '',
        });
        return links;
    }
    if (sourceId) {
        for (const entity of chosen) {
            if (entity.kind === 'stack' || entity.id === sourceId) continue;
            links.push({
                key: `pending:${sourceId}:${entity.id}`,
                kind: 'pending',
                sourceCardId: sourceId,
                targetCardId: entity.kind === 'card' ? entity.id : '',
                targetPlayerId: entity.kind === 'player' ? entity.id : '',
            });
        }
    }
    return links;
}

/**
 * What the table and the decision panel show for the current selection:
 * highlighted (legal) cards/players/stack objects, selected cards, text
 * options, and pending arrows.
 */
export function decisionSelectionView(model, selection) {
    if (!model) {
        return null;
    }
    const base = {
        cardName: null,
        color: null,
        confirmable: false,
        links: [],
        number: null,
        ordered: false,
        primitive: model.primitive,
        prompt: model.prompt,
        selectedCardIds: [],
        stage: model.primitive,
        textOptions: [],
        trayCardIds: [],
        unsupported: model.unsupported,
        ...emptyHighlights(),
    };
    const withTray = view => ({
        ...view,
        trayCardIds: [...new Set([...view.cardIds, ...view.selectedCardIds])]
            .filter(id => !model.visibleOnBoard(id)),
    });
    switch (model.primitive) {
    case DECISION_PRIMITIVES.board: {
        const stage = boardStage(model, selection);
        const selectedCardIds = [
            ...(selection.sourceId ? [selection.sourceId] : []),
            ...selection.path.flatMap(entry => {
                const action = model.board.actions.find(candidate => {
                    return targetEntityOf(candidate, entry.slot)?.id === entry.entityId;
                });
                return targetEntityOf(action, entry.slot)?.kind === 'card' ? [entry.entityId] : [];
            }),
        ];
        return withTray({
            ...base,
            ...stage,
            cancelable: Boolean(selection.sourceId || selection.variantKey || selection.path.length),
            confirmable: stage.stage === 'confirm',
            links: pendingLinks(model, selection),
            primitive: stage.stage === 'number' ? DECISION_PRIMITIVES.number : base.primitive,
            selectedCardIds,
        });
    }
    case DECISION_PRIMITIVES.cardSelection:
    case DECISION_PRIMITIVES.cardOrder: {
        const ordered = model.primitive === DECISION_PRIMITIVES.cardOrder;
        const view = {
            ...base,
            cancelable: selection.selectedCardIds.length > 0,
            cardIds: legalCardSelectionIds(model, selection.selectedCardIds),
            confirmable: cardSelectionConfirmable(model, selection.selectedCardIds),
            maximum: model.maximum,
            minimum: model.minimum,
            ordered,
            selectedCardIds: [...selection.selectedCardIds],
        };
        return {
            ...view,
            trayCardIds: model.candidateCardIds.filter(id => !model.visibleOnBoard(id)),
        };
    }
    case DECISION_PRIMITIVES.number:
        return withTray({
            ...base,
            confirmable: true,
            links: pendingLinks(model, selection),
            number: model.number,
            selectedCardIds: model.number.recipientId ? [model.number.recipientId] : [],
        });
    case DECISION_PRIMITIVES.color:
        return { ...base, color: model.color, textOptions: model.color.extras };
    case DECISION_PRIMITIVES.cardName:
        return {
            ...base,
            cardName: model.cardName,
            confirmable: selection.cardName.trim().length > 0,
        };
    default:
        return { ...base, textOptions: model.textOptions ?? [] };
    }
}

function advance(model, selection) {
    if (model.primitive !== DECISION_PRIMITIVES.board) {
        return { selection };
    }
    const stage = boardStage(model, selection);
    if (stage.stage === 'submit') {
        return { selection, submission: { actionId: stage.actionId, decisionId: model.decisionId } };
    }
    return { selection };
}

/**
 * Applies a click on a table entity (`{ kind: 'card'|'player'|'stack', id }`).
 * Returns `{ selection, submission?, ignored? }`; illegal clicks are ignored.
 */
export function selectDecisionEntity(model, selection, entity) {
    const view = decisionSelectionView(model, selection);
    if (!view || !entity?.id) {
        return { ignored: true, selection };
    }
    const id = String(entity.id);
    const kind = entity.kind ?? 'card';
    if (model.primitive === DECISION_PRIMITIVES.cardSelection ||
        model.primitive === DECISION_PRIMITIVES.cardOrder) {
        if (kind !== 'card') return { ignored: true, selection };
        if (selection.selectedCardIds.includes(id)) {
            const index = selection.selectedCardIds.indexOf(id);
            const selectedCardIds = model.primitive === DECISION_PRIMITIVES.cardOrder
                ? selection.selectedCardIds.slice(0, index)
                : selection.selectedCardIds.filter(candidate => candidate !== id);
            return { selection: { ...selection, selectedCardIds } };
        }
        if (!view.cardIds.includes(id)) return { ignored: true, selection };
        return { selection: { ...selection, selectedCardIds: [...selection.selectedCardIds, id] } };
    }
    if (model.primitive !== DECISION_PRIMITIVES.board) {
        return { ignored: true, selection };
    }
    const list = kind === 'player' ? view.playerIds : kind === 'stack' ? view.stackIds : view.cardIds;
    if (!list.includes(id)) {
        return { ignored: true, selection };
    }
    const next = view.stage === 'source'
        ? { ...selection, sourceId: id }
        : { ...selection, path: [...selection.path, { entityId: id, slot: view.slot }] };
    return advance(model, next);
}

/** Chooses a text option (`{ actionId }` or `{ variantKey }`) or a color. */
export function chooseDecisionOption(model, selection, option) {
    if (option?.variantKey) {
        return advance(model, { ...selection, variantKey: option.variantKey });
    }
    const actionId = option?.actionId;
    if (!actionId || !(model?.actions ?? []).some(action => action.id === actionId)) {
        return { ignored: true, selection };
    }
    return { selection, submission: { actionId, decisionId: model.decisionId } };
}

export function chooseDecisionColor(model, selection, color) {
    const entry = model?.color?.colors.find(candidate => candidate.color === color);
    if (!entry?.enabled) {
        return { ignored: true, selection };
    }
    return chooseDecisionOption(model, selection, { actionId: entry.actionId });
}

export function setDecisionNumber(model, selection, value) {
    const view = decisionSelectionView(model, selection);
    const bounds = view?.number;
    if (!bounds) return { ignored: true, selection };
    return { selection: { ...selection, numberValue: clampDecisionNumber(value, bounds) } };
}

export function setDecisionCardName(selection, cardName) {
    return { selection: { ...selection, cardName: String(cardName ?? '').slice(0, 256) } };
}

/** Confirms a multi-step primitive (card selection/order, number, card name). */
export function confirmDecisionSelection(model, selection) {
    const view = decisionSelectionView(model, selection);
    if (!view) return { ignored: true, selection };
    if (model.primitive === DECISION_PRIMITIVES.cardSelection ||
        model.primitive === DECISION_PRIMITIVES.cardOrder) {
        if (!view.confirmable || !model.submitActionId) return { ignored: true, selection };
        const preset = matchingPreset(model, selection.selectedCardIds);
        return {
            selection,
            submission: {
                actionId: preset?.actionId ?? model.submitActionId,
                cardInstanceIds: [...selection.selectedCardIds],
                decisionId: model.decisionId,
            },
        };
    }
    if (model.primitive === DECISION_PRIMITIVES.board && view.stage === 'confirm') {
        return { selection, submission: { actionId: view.actionId, decisionId: model.decisionId } };
    }
    if (view.number) {
        const value = clampDecisionNumber(selection.numberValue ?? view.number.minimum, view.number);
        if (view.number.variantByValue) {
            return advance(model, { ...selection, variantKey: view.number.variantByValue[value] });
        }
        if (view.number.actionByValue) {
            return {
                selection,
                submission: { actionId: view.number.actionByValue[value], decisionId: model.decisionId },
            };
        }
        return {
            selection,
            submission: {
                actionId: view.number.submitActionId,
                decisionId: model.decisionId,
                numberValue: value,
            },
        };
    }
    if (model.primitive === DECISION_PRIMITIVES.cardName && view.confirmable) {
        return {
            selection,
            submission: {
                actionId: model.cardName.submitActionId,
                cardName: selection.cardName.trim(),
                decisionId: model.decisionId,
            },
        };
    }
    return { ignored: true, selection };
}

export function cancelDecisionSelection(model) {
    return { selection: createDecisionSelection(model) };
}

function cardDecisionState(card, highlights) {
    const ids = [card?.id, ...(card?.raw?.groupedInstanceIds ?? [])]
        .filter(Boolean)
        .map(String);
    const selectableId = ids.find(id => highlights.cardIds.has(id)) ?? '';
    const selectedIndex = ids
        .map(id => highlights.selectedCardIds.indexOf(id))
        .find(index => index >= 0) ?? -1;
    return {
        ...card,
        actionable: false,
        decisionCardId: selectableId || (selectedIndex >= 0 ? highlights.selectedCardIds[selectedIndex] : ''),
        selectable: Boolean(selectableId),
        selected: selectedIndex >= 0,
        selectionOrder: highlights.ordered && selectedIndex >= 0 ? selectedIndex + 1 : null,
        targetable: false,
    };
}

/**
 * Projects a selection view onto a host scene: legal cards get `selectable`,
 * chosen cards `selected`, legal players/stack objects `targetable`, and the
 * pending arrows are appended to `scene.combat`. Host interaction flags are
 * cleared so the decision is the single source of highlights.
 */
export function pixiDecisionScene(scene, selectionView) {
    if (!scene || !selectionView) {
        return scene;
    }
    const highlights = {
        cardIds: new Set(selectionView.cardIds),
        ordered: selectionView.ordered,
        selectedCardIds: selectionView.selectedCardIds,
    };
    const playerIds = new Set(selectionView.playerIds);
    const stackIds = new Set(selectionView.stackIds);
    const mapCards = cards => (cards ?? []).map(card => cardDecisionState(card, highlights));
    return {
        ...scene,
        combat: [...(scene.combat ?? []), ...selectionView.links],
        players: (scene.players ?? []).map(player => ({
            ...player,
            battlefield: mapCards(player.battlefield),
            hand: mapCards(player.hand),
            targetable: playerIds.has(String(player.id ?? player.key ?? '')),
            zones: (player.zones ?? []).map(zone => ({ ...zone, cards: mapCards(zone.cards) })),
        })),
        stack: (scene.stack ?? []).map(item => ({
            ...item,
            targetable: stackIds.has(String(item.id)) || stackIds.has(String(item.card?.id ?? '')),
        })),
    };
}
