import { describe, expect, test } from 'vitest';

import {
    DECISION_KIND_PRIMITIVES,
    clampDecisionNumber,
    decisionColorChoice,
    decisionPrimitiveOf,
    decisionTargetEntity,
    gameSessionDecisionModel,
    pixiFightPairs,
    stepDecisionNumber,
} from './DecisionPrimitives.mjs';
import { decisionView, fixtureDecisions } from './DecisionFixtures.test-data.mjs';
import { pixiCombatLinks } from './PixiGameLayout.mjs';

describe('decision kind -> UI primitive', () => {
    test.each([
        ['priority', 'board'],
        ['attackers', 'board'],
        ['blockers', 'board'],
        ['discard', 'board'],
        ['mulliganBottom', 'board'],
        ['openingHandSelection', 'board'],
        ['resolutionTarget', 'board'],
        ['playerChoice', 'board'],
        ['mulligan', 'options'],
        ['creatureType', 'options'],
        ['unknownKind', 'options'],
        ['cardSelection', 'cardSelection'],
        ['cardOrder', 'cardOrder'],
        ['numberSelection', 'number'],
        ['combatDamage', 'number'],
        ['colorChoice', 'color'],
        ['replacementColor', 'color'],
        ['manaColor', 'color'],
        ['cardName', 'cardName'],
    ])('%s is presented as %s', (fixture, primitive) => {
        expect(decisionPrimitiveOf(decisionView(fixture))).toBe(primitive);
    });

    test('every Engine DecisionKind has a default primitive', () => {
        expect(Object.keys(DECISION_KIND_PRIMITIVES).sort()).toEqual([
            'attackers', 'blockers', 'combatDamage', 'discard', 'mulligan', 'mulliganBottom',
            'openingHandSelection', 'priority', 'replacementChoice', 'resolutionChoice',
            'sideboarding',
        ]);
    });

    test('an unknown kind keeps every Engine option as text and reports why', () => {
        const model = gameSessionDecisionModel(decisionView('unknownKind'));
        expect(model.unsupported).toBe('kind:councilVote');
        expect(model.textOptions).toEqual([{ actionId: 'vote:a', label: 'Vote for Grizzly Bears' }]);
    });

    test('combat flows select the attacker or blocker first and link to the defender', () => {
        const attackers = gameSessionDecisionModel(decisionView('attackers'));
        expect(attackers.board).toMatchObject({ linkKind: 'attack', sourceMode: 'attacker' });
        const blockers = gameSessionDecisionModel(decisionView('blockers'));
        expect(blockers.board).toMatchObject({ linkKind: 'block', sourceMode: 'blocker' });
    });

    test('player option values become life-total targets', () => {
        const model = gameSessionDecisionModel(decisionView('playerChoice'));
        expect(model.board.actions.map(action => action.targets)).toEqual([
            { who: { player: { playerId: 'p1' } } },
            { who: { player: { playerId: 'p2' } } },
        ]);
    });

    test('a non-board card on a decision is described from the opening-hand candidate', () => {
        const model = gameSessionDecisionModel(decisionView('openingHandSelection'));
        expect(model.visibleOnBoard('p1-c90')).toBe(false);
        expect(model.describeCard('p1-c90').name).toBe('Candidate p1-c90');
        expect(model.cardZone('p1-c90')).toBe('openingHand');
        expect(model.cardZone('p1-c6')).toBe('library');
    });

    test('fight sources are recognized from the fightPermanents rule primitive', () => {
        const model = gameSessionDecisionModel(decisionView('priority'));
        expect(model.describeCard('p1-c4').fights).toBe(true);
        expect(model.describeCard('p1-c3').fights).toBe(false);
    });
});

describe('TargetRef normalization', () => {
    test.each([
        [{ player: { playerId: 'p2' } }, { id: 'p2', kind: 'player' }],
        [{ permanent: { instanceId: 'x' } }, { id: 'x', kind: 'card' }],
        [{ card: { instance_id: 'y' } }, { id: 'y', kind: 'card' }],
        [{ stackObject: { stackId: 's1' } }, { id: 's1', kind: 'stack' }],
        [{}, null],
        [null, null],
    ])('%j', (target, expected) => {
        expect(decisionTargetEntity(target)).toEqual(expected);
    });
});

describe('color wheel legality', () => {
    test('only colors offered by the Engine are enabled, in WUBRG wheel order', () => {
        const model = gameSessionDecisionModel(decisionView('replacementColor'));
        expect(model.color.colors.map(entry => [entry.color, entry.enabled, entry.actionId])).toEqual([
            ['W', true, 'choose:color:w'],
            ['U', true, 'choose:color:u'],
            ['B', false, null],
            ['R', false, null],
            ['G', false, null],
        ]);
        expect(model.color.extras).toEqual([]);
    });

    test('colorless or multicolor mana options stay as a text fallback', () => {
        const model = gameSessionDecisionModel(decisionView('manaColor'));
        expect(model.color.colors.filter(entry => entry.enabled).map(entry => entry.color))
            .toEqual(['R', 'G']);
        expect(model.color.extras).toEqual([{ actionId: 'mana:c', label: 'Add {C}' }]);
    });

    test('a single color, duplicated colors or plain words are not a color wheel', () => {
        expect(decisionColorChoice([{ decisions: { c: 'W' }, id: 'a', label: 'Choose W' }], 'c')).toBeNull();
        expect(decisionColorChoice(fixtureDecisions.creatureType.options, 'type')).toBeNull();
        const twoWhite = decisionColorChoice([
            { decisions: { c: 'white' }, id: 'a' },
            { decisions: { c: 'W' }, id: 'b' },
            { decisions: { c: 'blue' }, id: 'c' },
        ], 'c');
        expect(twoWhite.colors.filter(entry => entry.enabled)).toHaveLength(2);
        expect(twoWhite.extras.map(extra => extra.actionId)).toEqual(['b']);
    });
});

describe('numeric bounds', () => {
    test('number selection uses the Engine bounds and submits the single dummy action', () => {
        const model = gameSessionDecisionModel(decisionView('numberSelection'));
        expect(model.number).toEqual({
            maximum: 5,
            minimum: 1,
            step: 1,
            submitActionId: 'choose-number:amount',
        });
    });

    test('combat damage amounts map each value to its exact Engine action', () => {
        const model = gameSessionDecisionModel(decisionView('combatDamage'));
        expect(model.number).toMatchObject({
            actionByValue: { 0: 'damage:0', 1: 'damage:1', 2: 'damage:2' },
            attackerId: 'p1-c1',
            maximum: 2,
            minimum: 0,
            recipientId: 'p2-c1',
        });
    });

    test.each([
        [9, { maximum: 5, minimum: 1 }, 5],
        [-3, { maximum: 5, minimum: 1 }, 1],
        ['abc', { maximum: 5, minimum: 1 }, 1],
        [2.6, { maximum: 5, minimum: 1 }, 3],
        [4, { values: [0, 2, 7] }, 2],
        [Infinity, { values: [0, 2, 7] }, 7],
    ])('clamps %s within %j to %s', (value, bounds, expected) => {
        expect(clampDecisionNumber(value, bounds)).toBe(expected);
    });

    test('steps to the next allowed value and stops at the bounds', () => {
        expect(stepDecisionNumber(5, 1, { maximum: 5, minimum: 1 })).toBe(5);
        expect(stepDecisionNumber(1, -1, { maximum: 5, minimum: 1 })).toBe(1);
        expect(stepDecisionNumber(2, 1, { values: [0, 2, 7] })).toBe(7);
        expect(stepDecisionNumber(0, -1, { values: [0, 2, 7] })).toBe(0);
    });
});

describe('arrow model', () => {
    const damage = (sequence, source, recipient, extra = {}) => ({
        cardInstanceId: recipient,
        detail: { amount: 2, combat: false, source, ...extra },
        kind: 'damageDealt',
        sequence,
        step: 'precombatMain',
        turnNumber: 3,
    });

    test('pairs swapped non-combat damage into one fight per resolution', () => {
        const events = [
            damage(1, 'p1-c1', 'p2-c1'),
            damage(2, 'p2-c1', 'p1-c1'),
            damage(3, 'p1-c3', 'p2-c1'),
            damage(4, 'p1-c1', 'p2-c1', { combat: true }),
            damage(5, 'p2-c1', 'p1-c1', { combat: true }),
        ];
        expect(pixiFightPairs(events, { step: 'precombatMain', turnNumber: 3 }))
            .toEqual([{ firstId: 'p1-c1', secondId: 'p2-c1' }]);
        expect(pixiFightPairs(events, { turnNumber: 4 })).toEqual([]);
    });

    test('combat state and fights become typed arrows', () => {
        expect(pixiCombatLinks({
            attackers: [{ attackerId: 'p1-c1', defender: { permanent: { instanceId: 'p2-c2' } } }],
            blockers: [{ attackerId: 'p1-c1', blockerId: 'p2-c1' }],
            fights: [{ firstId: 'p1-c1', secondId: 'p2-c1' }],
        }).map(link => [link.kind, link.sourceCardId, link.targetCardId || link.targetPlayerId])).toEqual([
            ['attack', 'p1-c1', 'p2-c2'],
            ['block', 'p2-c1', 'p1-c1'],
            ['fight', 'p1-c1', 'p2-c1'],
        ]);
    });
});
