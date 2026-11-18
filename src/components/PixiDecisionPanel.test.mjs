import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, test, vi } from 'vitest';

import PixiDecisionPanel from './PixiDecisionPanel.vue';
import PixiGamePrototype from './PixiGamePrototype.vue';
import { gameSessionDecisionModel } from '../helpers/DecisionPrimitives.mjs';
import { createDecisionSelection, decisionSelectionView } from '../helpers/DecisionSelection.mjs';
import { decisionView } from '../helpers/DecisionFixtures.test-data.mjs';

function panel(fixture) {
    const model = gameSessionDecisionModel(decisionView(fixture));
    const selection = createDecisionSelection(model);
    return mount(PixiDecisionPanel, {
        props: { model, selection, view: decisionSelectionView(model, selection) },
    });
}

function liveScene() {
    return {
        combat: [],
        controls: { showPassPriority: true, canPassPriority: true },
        phase: 'main',
        players: [
            { battlefield: [{ id: 'p1-c1', kind: 'creature', name: 'Grizzly Bears' }], hand: [], id: 'p1', life: 20, local: true, name: 'Pilot', zones: [] },
            { battlefield: [{ id: 'p2-c2', kind: 'other', name: 'Jace' }], hand: [], id: 'p2', life: 20, name: 'Opponent', zones: [] },
        ],
        stack: [],
        status: 'Declare attackers',
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('decision panel primitives', () => {
    test('color wheel shows the five WUBRG symbols and enables only legal colors', async () => {
        const wrapper = panel('replacementColor');
        const pips = wrapper.findAll('.pixi-color-pip');
        expect(pips.map(pip => pip.find('.ms').classes().find(name => name.startsWith('ms-') && name !== 'ms-cost')))
            .toEqual(['ms-w', 'ms-u', 'ms-b', 'ms-r', 'ms-g']);
        expect(pips.map(pip => pip.attributes('disabled') === undefined)).toEqual([true, true, false, false, false]);
        await pips[1].trigger('click');
        expect(wrapper.emitted('color')).toEqual([['U']]);
    });

    test('colorless mana stays available as a text option beside the wheel', () => {
        const wrapper = panel('manaColor');
        expect(wrapper.findAll('.pixi-color-pip')).toHaveLength(5);
        expect(wrapper.find('.pixi-decision-options').text()).toBe('Add {C}');
    });

    test('numeric picker is bounded by the Engine request and needs confirmation', async () => {
        const wrapper = panel('numberSelection');
        const input = wrapper.get('.pixi-number-input');
        expect(input.attributes()).toMatchObject({ max: '5', min: '1' });
        await input.setValue('42');
        expect(wrapper.emitted('number')).toEqual([[5]]);
        await wrapper.get('footer .primary').trigger('click');
        expect(wrapper.emitted('confirm')).toHaveLength(1);
    });

    test('action and mode choices are listed as text', async () => {
        const wrapper = panel('mulligan');
        const buttons = wrapper.findAll('.pixi-decision-options button');
        expect(buttons.map(button => button.text())).toEqual(['Keep hand', 'Take a mulligan']);
        await buttons[0].trigger('click');
        expect(wrapper.emitted('option')).toEqual([[{ actionId: 'keep', label: 'Keep hand' }]]);
    });

    test('cards outside the table appear in a tray with a selection counter', () => {
        const wrapper = panel('cardSelection');
        expect(wrapper.findAll('.pixi-decision-tray-card.selectable').map(item => item.text()))
            .toEqual(['Forest', 'Island']);
        expect(wrapper.get('header small').text()).toBe('0 / 1–2');
        expect(wrapper.get('footer .primary').attributes('disabled')).toBeDefined();
    });

    test('an unknown decision kind is still answerable as text', () => {
        const wrapper = panel('unknownKind');
        expect(wrapper.text()).toContain('kind:councilVote');
        expect(wrapper.find('.pixi-decision-options').text()).toContain('Vote for Grizzly Bears');
    });
});

describe('PixiGame decision interaction', () => {
    test('outlines the legal attacker, then the defender life total, and submits the pair', async () => {
        const model = gameSessionDecisionModel(decisionView('attackers'));
        const wrapper = mount(PixiGamePrototype, { props: { decision: model, scene: liveScene() } });
        expect(wrapper.vm.renderScene.players[0].battlefield[0]).toMatchObject({ selectable: true });
        expect(wrapper.vm.sceneCardModel(wrapper.vm.renderScene.players[0].battlefield[0]).selectable)
            .toBe(true);
        expect(wrapper.vm.renderScene.players[1].targetable).toBe(false);
        expect(wrapper.vm.selectDecisionTableCard(wrapper.vm.renderScene.players[0].battlefield[0])).toBe(true);
        await wrapper.vm.$nextTick();
        expect(wrapper.vm.renderScene.players[1].targetable).toBe(true);
        expect(wrapper.vm.renderScene.players[1].battlefield[0].selectable).toBe(true);
        const opponentHud = wrapper.findAll('.pixi-player-hud')[1];
        expect(opponentHud.classes()).toContain('pixi-player-hud-targetable');
        await opponentHud.trigger('click');
        expect(wrapper.emitted('decision-submit')).toEqual([[{
            actionId: 'attack:p1-c1:p2',
            decisionId: 'attackers:3',
        }]]);
        expect(wrapper.emitted('player-click')).toBeUndefined();
        wrapper.unmount();
    });

    test('logs and reports a decision without a dedicated primitive', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const model = gameSessionDecisionModel(decisionView('unknownKind'));
        const wrapper = mount(PixiGamePrototype, { props: { decision: model, scene: liveScene() } });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('councilVote'));
        expect(wrapper.emitted('decision-unsupported')).toHaveLength(1);
        expect(wrapper.find('.pixi-decision-panel').exists()).toBe(true);
        wrapper.unmount();
    });

    test('replays never show the decision panel', () => {
        const model = gameSessionDecisionModel(decisionView('mulligan'));
        const wrapper = mount(PixiGamePrototype, {
            props: { decision: model, mode: 'replay', scene: liveScene() },
        });
        expect(wrapper.find('.pixi-decision-panel').exists()).toBe(false);
        wrapper.unmount();
    });
});
