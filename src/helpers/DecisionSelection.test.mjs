import { describe, expect, test } from 'vitest';

import { gameSessionDecisionModel } from './DecisionPrimitives.mjs';
import {
    cancelDecisionSelection,
    chooseDecisionColor,
    chooseDecisionOption,
    confirmDecisionSelection,
    createDecisionSelection,
    decisionSelectionView,
    pixiDecisionScene,
    selectDecisionEntity,
    setDecisionCardName,
    setDecisionNumber,
} from './DecisionSelection.mjs';
import { decisionView } from './DecisionFixtures.test-data.mjs';

function setup(fixture) {
    const model = gameSessionDecisionModel(decisionView(fixture));
    return { model, selection: createDecisionSelection(model) };
}

const card = id => ({ id, kind: 'card' });

describe('board selection (priority)', () => {
    test('outlines only cards with legal actions; pass stays a text option', () => {
        const { model, selection } = setup('priority');
        const view = decisionSelectionView(model, selection);
        expect(view.stage).toBe('source');
        expect(view.cardIds.sort()).toEqual(['p1-c1', 'p1-c3', 'p1-c4', 'p1-c5', 'p1-c8']);
        expect(view.cardIds).not.toContain('p1-c2');
        expect(view.playerIds).toEqual([]);
        expect(view.textOptions).toEqual([{ actionId: 'pass:p1:40', label: 'Pass priority' }]);
        // Castable graveyard card is not drawn on the board: it goes to the tray.
        expect(view.trayCardIds).toEqual(['p1-c5']);
    });

    test('ignores clicks on cards and players that are not legal', () => {
        const { model, selection } = setup('priority');
        expect(selectDecisionEntity(model, selection, card('p1-c2')).ignored).toBe(true);
        expect(selectDecisionEntity(model, selection, { id: 'p2', kind: 'player' }).ignored).toBe(true);
    });

    test('a targeted spell outlines its legal targets, including life totals', () => {
        const { model, selection } = setup('priority');
        const picked = selectDecisionEntity(model, selection, card('p1-c3'));
        expect(picked.submission).toBeUndefined();
        const view = decisionSelectionView(model, picked.selection);
        expect(view.stage).toBe('target');
        expect(view.playerIds).toEqual(['p2', 'p1']);
        expect(view.cardIds).toEqual(['p2-c1', 'p1-c1']);
        expect(view.selectedCardIds).toEqual(['p1-c3']);
        const submitted = selectDecisionEntity(model, picked.selection, { id: 'p2', kind: 'player' });
        expect(submitted.submission).toEqual({ actionId: 'cast:hand:p1-c3:0:0', decisionId: 'priority:3:0:4' });
    });

    test('several actions on one card are offered as text', () => {
        const { model, selection } = setup('priority');
        const picked = selectDecisionEntity(model, selection, card('p1-c1'));
        const view = decisionSelectionView(model, picked.selection);
        expect(view.stage).toBe('menu');
        expect(view.textOptions.map(option => option.label))
            .toEqual(['Grizzly Bears: Pump', 'Grizzly Bears: Sacrifice']);
        const chosen = chooseDecisionOption(model, picked.selection, view.textOptions[1]);
        expect(chosen.submission.actionId).toBe('activate:p1-c1:1');
    });

    test('X variants of a spell are chosen with the numeric picker', () => {
        const { model, selection } = setup('priority');
        const picked = selectDecisionEntity(model, selection, card('p1-c8'));
        const view = decisionSelectionView(model, picked.selection);
        expect(view.stage).toBe('number');
        expect(view.number).toMatchObject({ maximum: 2, minimum: 0, values: [0, 1, 2] });
        const numbered = setDecisionNumber(model, picked.selection, 9);
        expect(numbered.selection.numberValue).toBe(2);
        expect(confirmDecisionSelection(model, numbered.selection).submission.actionId)
            .toBe('cast:hand:p1-c8:0:x2');
    });

    test('a fight links both chosen creatures and waits for confirmation', () => {
        const { model, selection } = setup('priority');
        let result = selectDecisionEntity(model, selection, card('p1-c4'));
        let view = decisionSelectionView(model, result.selection);
        expect(view.cardIds).toEqual(['p1-c1']);
        result = selectDecisionEntity(model, result.selection, card('p1-c1'));
        view = decisionSelectionView(model, result.selection);
        expect(view.slot).toBe('otherCreature');
        expect(view.cardIds).toEqual(['p2-c1']);
        result = selectDecisionEntity(model, result.selection, card('p2-c1'));
        expect(result.submission).toBeUndefined();
        view = decisionSelectionView(model, result.selection);
        expect(view.stage).toBe('confirm');
        expect(view.confirmable).toBe(true);
        expect(view.links).toEqual([expect.objectContaining({
            kind: 'fight',
            sourceCardId: 'p1-c1',
            targetCardId: 'p2-c1',
        })]);
        expect(confirmDecisionSelection(model, result.selection).submission.actionId)
            .toBe('cast:hand:p1-c4:0:0');
        expect(decisionSelectionView(model, cancelDecisionSelection(model).selection).stage)
            .toBe('source');
    });
});

describe('combat selection', () => {
    test('attacker first, then a player or planeswalker, with a pending arrow', () => {
        const { model, selection } = setup('attackers');
        let view = decisionSelectionView(model, selection);
        expect(view.cardIds).toEqual(['p1-c1']);
        expect(view.textOptions.map(option => option.actionId)).toEqual(['finish-attackers']);
        const picked = selectDecisionEntity(model, selection, card('p1-c1'));
        view = decisionSelectionView(model, picked.selection);
        expect(view.playerIds).toEqual(['p2']);
        expect(view.cardIds).toEqual(['p2-c2']);
        const submitted = selectDecisionEntity(model, picked.selection, card('p2-c2'));
        expect(submitted.submission.actionId).toBe('attack:p1-c1:p2-c2');
    });

    test('blocker first, then the attacker it blocks', () => {
        const { model, selection } = setup('blockers');
        const view = decisionSelectionView(model, selection);
        expect(view.cardIds).toEqual(['p2-c1']);
        const picked = selectDecisionEntity(model, selection, card('p2-c1'));
        expect(decisionSelectionView(model, picked.selection).cardIds).toEqual(['p1-c1']);
        expect(selectDecisionEntity(model, picked.selection, card('p1-c1')).submission.actionId)
            .toBe('block:p2-c1:p1-c1');
    });

    test('combat damage shows the recipient and an arrow from the attacker', () => {
        const { model, selection } = setup('combatDamage');
        const view = decisionSelectionView(model, selection);
        expect(view.selectedCardIds).toEqual(['p2-c1']);
        expect(view.links).toEqual([expect.objectContaining({ sourceCardId: 'p1-c1', targetCardId: 'p2-c1' })]);
        const numbered = setDecisionNumber(model, selection, 1);
        expect(confirmDecisionSelection(model, numbered.selection).submission)
            .toEqual({ actionId: 'damage:1', decisionId: 'combatDamage:3:p1-c1:0' });
    });
});

describe('multi-select', () => {
    test('accumulates up to the maximum, only along Engine-enumerated subsets', () => {
        const { model, selection } = setup('cardSelection');
        let view = decisionSelectionView(model, selection);
        expect(view.confirmable).toBe(false);
        expect(view.trayCardIds).toEqual(['p1-c6', 'p1-c7']);
        let result = selectDecisionEntity(model, selection, card('p1-c6'));
        view = decisionSelectionView(model, result.selection);
        expect(view.confirmable).toBe(true);
        // p1-c1 is never enumerated together with p1-c6: it is no longer legal.
        expect(view.cardIds).toEqual(['p1-c7']);
        expect(selectDecisionEntity(model, result.selection, card('p1-c1')).ignored).toBe(true);
        result = selectDecisionEntity(model, result.selection, card('p1-c7'));
        view = decisionSelectionView(model, result.selection);
        expect(view.cardIds).toEqual([]);
        expect(confirmDecisionSelection(model, result.selection).submission).toEqual({
            actionId: 'search:3',
            cardInstanceIds: ['p1-c6', 'p1-c7'],
            decisionId: 'resolution:stack-2:search',
        });
        // Clicking a selected card removes it.
        result = selectDecisionEntity(model, result.selection, card('p1-c6'));
        expect(result.selection.selectedCardIds).toEqual(['p1-c7']);
    });

    test('a truncated Engine enumeration does not restrict the free selection', () => {
        const view = decisionView('cardSelection');
        const ids = Array.from({ length: 12 }, (_, index) => `p1-c${index + 1}`);
        view.decision = {
            ...view.decision,
            choice: { ...view.decision.choice, candidateCardInstanceIds: ids, maximum: 4 },
        };
        const model = gameSessionDecisionModel(view);
        expect(model.presetsComplete).toBe(false);
        const picked = selectDecisionEntity(model, createDecisionSelection(model), card('p1-c6'));
        expect(decisionSelectionView(model, picked.selection).cardIds).toHaveLength(11);
        expect(confirmDecisionSelection(model, picked.selection).submission).toMatchObject({
            actionId: 'search:0',
            cardInstanceIds: ['p1-c6'],
        });
    });

    test('cannot confirm below the minimum', () => {
        const { model, selection } = setup('cardSelection');
        expect(confirmDecisionSelection(model, selection).ignored).toBe(true);
    });

    test('card order numbers each click and confirms only a complete order', () => {
        const { model, selection } = setup('cardOrder');
        let result = selectDecisionEntity(model, selection, card('p1-c7'));
        let view = decisionSelectionView(model, result.selection);
        expect(view.ordered).toBe(true);
        expect(view.confirmable).toBe(false);
        result = selectDecisionEntity(model, result.selection, card('p1-c6'));
        view = decisionSelectionView(model, result.selection);
        expect(view.selectedCardIds).toEqual(['p1-c7', 'p1-c6']);
        expect(confirmDecisionSelection(model, result.selection).submission).toMatchObject({
            actionId: 'order:b',
            cardInstanceIds: ['p1-c7', 'p1-c6'],
        });
        // Removing an earlier card also removes the cards ordered after it.
        expect(selectDecisionEntity(model, result.selection, card('p1-c7')).selection.selectedCardIds)
            .toEqual([]);
    });
});

describe('other primitives', () => {
    test('player choice outlines life totals only', () => {
        const { model, selection } = setup('playerChoice');
        const view = decisionSelectionView(model, selection);
        expect(view.playerIds).toEqual(['p1', 'p2']);
        expect(view.cardIds).toEqual([]);
        expect(selectDecisionEntity(model, selection, { id: 'p2', kind: 'player' }).submission.actionId)
            .toBe('choose:who:p2');
    });

    test('a resolution target keeps its "no target" option as text', () => {
        const { model, selection } = setup('resolutionTarget');
        const view = decisionSelectionView(model, selection);
        expect(view.cardIds).toEqual(['p2-c1']);
        expect(view.textOptions).toEqual([{ actionId: 'target:none', label: 'Choose no target' }]);
    });

    test('a disabled color cannot be chosen', () => {
        const { model, selection } = setup('replacementColor');
        expect(chooseDecisionColor(model, selection, 'B').ignored).toBe(true);
        expect(chooseDecisionColor(model, selection, 'U').submission.actionId).toBe('choose:color:u');
    });

    test('number selection submits numberValue within bounds', () => {
        const { model, selection } = setup('numberSelection');
        expect(selection.numberValue).toBe(1);
        const result = setDecisionNumber(model, selection, 0);
        expect(result.selection.numberValue).toBe(1);
        expect(confirmDecisionSelection(model, setDecisionNumber(model, selection, 4).selection).submission)
            .toEqual({ actionId: 'choose-number:amount', decisionId: 'resolution:stack-7:amount', numberValue: 4 });
    });

    test('card name requires text and submits it with the Engine action', () => {
        const { model, selection } = setup('cardName');
        expect(confirmDecisionSelection(model, selection).ignored).toBe(true);
        const named = setDecisionCardName(selection, '  Serra Angel ').selection;
        expect(confirmDecisionSelection(model, named).submission).toEqual({
            actionId: 'choose-name:named',
            cardName: 'Serra Angel',
            decisionId: 'resolution:stack-9:named',
        });
    });

    test('text options reject ids the Engine did not offer', () => {
        const { model, selection } = setup('mulligan');
        expect(chooseDecisionOption(model, selection, { actionId: 'forged' }).ignored).toBe(true);
        expect(chooseDecisionOption(model, selection, { actionId: 'keep' }).submission.actionId).toBe('keep');
    });
});

describe('scene projection', () => {
    test('marks legal cards selectable, chosen ones selected, and adds pending arrows', () => {
        const { model, selection } = setup('attackers');
        const picked = selectDecisionEntity(model, selection, card('p1-c1')).selection;
        const scene = {
            combat: [],
            players: [
                {
                    battlefield: [{ actionable: true, id: 'p1-c1' }, { id: 'p1-c2', targetable: true }],
                    hand: [],
                    id: 'p1',
                    zones: [],
                },
                {
                    battlefield: [{ id: 'p2-c1' }, { id: 'p2-c2' }],
                    hand: [],
                    id: 'p2',
                    zones: [],
                },
            ],
            stack: [],
        };
        const projected = pixiDecisionScene(scene, decisionSelectionView(model, picked));
        const [local, opponent] = projected.players;
        expect(local.battlefield[0]).toMatchObject({ actionable: false, selected: true, selectable: false });
        expect(local.battlefield[1]).toMatchObject({ selectable: false, targetable: false });
        expect(opponent.battlefield[1]).toMatchObject({ decisionCardId: 'p2-c2', selectable: true });
        expect(opponent.targetable).toBe(true);
        expect(local.targetable).toBe(false);
    });

    test('a grouped token stack resolves to its legal instance', () => {
        const { model, selection } = setup('blockers');
        const scene = {
            players: [{
                battlefield: [{ id: 'p2-c0', raw: { groupedInstanceIds: ['p2-c0', 'p2-c1'] } }],
                id: 'p2',
            }],
        };
        const projected = pixiDecisionScene(scene, decisionSelectionView(model, selection));
        expect(projected.players[0].battlefield[0]).toMatchObject({ decisionCardId: 'p2-c1', selectable: true });
    });
});
