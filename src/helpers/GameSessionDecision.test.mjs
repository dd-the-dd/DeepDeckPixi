import { describe, expect, test, vi } from 'vitest';

import { createGameSessionClient, projectGameSessionView } from './GameSessionClient.mjs';
import { decisionView } from './DecisionFixtures.test-data.mjs';

function client(view) {
    const fetchImpl = vi.fn(async () => ({ json: async () => view, ok: true }));
    return { client: createGameSessionClient({ baseUrl: 'http://engine.test', fetchImpl }), fetchImpl };
}

function postedBody(fetchImpl) {
    return JSON.parse(fetchImpl.mock.calls.at(-1)[1].body);
}

describe('session projection of decision primitives', () => {
    test('projects the decision model with catalog metadata for cards outside the table', () => {
        const projection = projectGameSessionView(decisionView('cardSelection'), {
            cardCatalog: { 'def:Island': { imageUrl: 'island.jpg', name: 'Island' } },
        });
        expect(projection.decisionModel.primitive).toBe('cardSelection');
        expect(projection.decisionModel.describeCard('p1-c7')).toMatchObject({
            imageUrl: 'island.jpg',
            name: 'Island',
        });
        expect(projectGameSessionView({ ...decisionView('mulligan'), decision: null }).decisionModel)
            .toBeNull();
    });

    test('keeps declared combat and adds fights from this step', () => {
        const view = decisionView('priority', {
            combat: { attackers: [{ attackerId: 'p1-c1', defendingPlayerId: 'p2' }], blockers: [] },
            events: [
                { cardInstanceId: 'p2-c1', detail: { combat: false, source: 'p1-c1' }, kind: 'damageDealt', step: 'precombatMain', turnNumber: 3 },
                { cardInstanceId: 'p1-c1', detail: { combat: false, source: 'p2-c1' }, kind: 'damageDealt', step: 'precombatMain', turnNumber: 3 },
            ],
        });
        expect(projectGameSessionView(view).combat).toEqual({
            attackers: [{ attackerId: 'p1-c1', defendingPlayerId: 'p2' }],
            blockers: [],
            fights: [{ firstId: 'p1-c1', secondId: 'p2-c1' }],
        });
    });
});

describe('submitDecision', () => {
    test('posts a board selection as the exact Engine action', async () => {
        const view = decisionView('attackers');
        const { client: engine, fetchImpl } = client(view);
        await engine.submitDecision(view, { actionId: 'attack:p1-c1:p2', decisionId: 'attackers:3' });
        expect(postedBody(fetchImpl)).toEqual({
            actionId: 'attack:p1-c1:p2',
            decisionId: 'attackers:3',
            revision: 7,
        });
    });

    test('adds numberValue, cardInstanceIds or cardName only for their typed choices', async () => {
        const number = decisionView('numberSelection');
        const numberClient = client(number);
        await numberClient.client.submitDecision(number, { actionId: 'choose-number:amount', numberValue: 3 });
        expect(postedBody(numberClient.fetchImpl).numberValue).toBe(3);
        await expect(numberClient.client.submitDecision(number, {
            actionId: 'choose-number:amount',
            numberValue: 6,
        })).rejects.toThrow('outside 1..5');

        const order = decisionView('cardOrder');
        const orderClient = client(order);
        await orderClient.client.submitDecision(order, {
            actionId: 'order:b',
            cardInstanceIds: ['p1-c7', 'p1-c6'],
        });
        expect(postedBody(orderClient.fetchImpl).cardInstanceIds).toEqual(['p1-c7', 'p1-c6']);

        const named = decisionView('cardName');
        const nameClient = client(named);
        await nameClient.client.submitDecision(named, { actionId: 'choose-name:named', cardName: ' Bolt ' });
        expect(postedBody(nameClient.fetchImpl).cardName).toBe('Bolt');
        await expect(nameClient.client.submitDecision(named, { actionId: 'choose-name:named' }))
            .rejects.toThrow('card name');
    });

    test('rejects stale decisions, unknown actions and misplaced card ids', async () => {
        const view = decisionView('mulligan');
        const { client: engine, fetchImpl } = client(view);
        await expect(engine.submitDecision(view, { actionId: 'keep', decisionId: 'old' }))
            .rejects.toThrow('no longer pending');
        await expect(engine.submitDecision(view, { actionId: 'forged' })).rejects.toThrow('not offered');
        await expect(engine.submitDecision(view, { actionId: 'keep', cardInstanceIds: [] }))
            .rejects.toThrow('card selection');
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
