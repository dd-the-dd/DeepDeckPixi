import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import PixiGamePrototype from './PixiGamePrototype.vue';

function liveScene(controls = {}) {
    return {
        controls: {
            advanceLabel: 'Choose an action',
            autoPassActive: true,
            canAdvance: false,
            canPassPriority: true,
            canPassStack: false,
            passStackActive: false,
            showPassPriority: true,
            showPassStack: false,
            ...controls,
        },
        phase: 'upkeep',
        players: [],
        stack: [],
        status: 'Upkeep priority',
    };
}

describe('Pixi game controls', () => {
    test('opens a graveyard or exile from its table pile and toggles it closed', async () => {
        const scene = liveScene();
        scene.players = [{
            battlefield: [],
            hand: [],
            id: 'player-1',
            life: 20,
            local: true,
            name: 'Etienne',
            zones: [
                {
                    cards: [
                        { id: 'grave-1', imageUrl: '/one.jpg', name: 'First card' },
                        { id: 'grave-2', imageUrl: '/two.jpg', name: 'Second card' },
                    ],
                    count: 2,
                    id: 'graveyard',
                },
                {
                    cards: [{
                        id: 'exile-1',
                        imageUrl: '/three.jpg',
                        linkedTo: 'source-enchantment',
                        name: 'Linked card',
                    }],
                    count: 1,
                    id: 'exile',
                },
            ],
        }];
        const wrapper = mount(PixiGamePrototype, { props: { scene } });

        expect(wrapper.find('.pixi-public-zone-dock').exists()).toBe(false);
        await wrapper.vm.openKnownZone(scene.players[0], scene.players[0].zones[0]);
        expect(wrapper.get('.pixi-zone-inspector').attributes('role')).toBe('dialog');
        expect(wrapper.get('.pixi-zone-inspector').classes()).toContain('pixi-zone-inspector-local');
        expect(wrapper.findAll('.pixi-zone-inspector-grid > button')).toHaveLength(2);
        expect(wrapper.get('.pixi-zone-inspector').text()).toContain('First card');
        await wrapper.vm.openKnownZone(scene.players[0], scene.players[0].zones[0]);
        expect(wrapper.find('.pixi-zone-inspector').exists()).toBe(false);

        await wrapper.vm.openKnownZone(scene.players[0], scene.players[0].zones[1]);
        expect(wrapper.get('.pixi-zone-inspector').text()).toContain('Exil lié');
        await wrapper.get('.pixi-zone-inspector-grid > button').trigger('click');
        expect(wrapper.emitted('card-click')[0][0]).toEqual(expect.objectContaining({
            zone: 'exile',
        }));
        wrapper.unmount();
    });

    test('shows two readable players and compact summaries on a four-player phone', async () => {
        const previousWidth = window.innerWidth;
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
        const players = Array.from({ length: 4 }, (_, index) => ({
            active: index === 1,
            battlefield: Array.from({ length: index + 1 }, (__, permanentIndex) => ({
                id: `p${index + 1}:permanent:${permanentIndex}`,
            })),
            hand: [],
            id: `player-${index + 1}`,
            life: 40 - index,
            local: index === 0,
            name: `Player ${index + 1}`,
            zones: [],
        }));
        const wrapper = mount(PixiGamePrototype, {
            props: { scene: { ...liveScene(), players } },
        });
        await wrapper.vm.$nextTick();

        expect(wrapper.classes()).toContain('pixi-game-mobile-focus');
        expect(wrapper.findAll('.pixi-player-hud')).toHaveLength(2);
        expect(wrapper.findAll('.pixi-mobile-player-summaries button')).toHaveLength(2);
        expect(wrapper.text()).toContain('Player 2');
        expect(wrapper.text()).toContain('4 perm.');
        await wrapper.get('[aria-label="Joueur suivant"]').trigger('click');
        expect(wrapper.text()).toContain('Player 3');
        expect(wrapper.text()).toContain('2 perm.');

        wrapper.unmount();
        Object.defineProperty(window, 'innerWidth', {
            configurable: true,
            value: previousWidth,
        });
    });

    test('uses neutral branding by default and accepts host branding.', () => {
        const wrapper = mount(PixiGamePrototype, {
            props: { scene: liveScene() },
        });

        expect(wrapper.get('.pixi-game-brand-name').text()).toBe('DeepDeck Pixi');
        wrapper.unmount();

        const branded = mount(PixiGamePrototype, {
            props: {
                brandLogoUrl: '/host-logo.png',
                brandName: 'Host application',
                scene: liveScene(),
            },
        });
        const logo = branded.get('.pixi-game-brand-logo');
        expect(logo.attributes('src')).toContain('/host-logo.png');
        expect(logo.attributes('alt')).toBe('Host application');
        branded.unmount();
    });

    test('shows separate auto-pass and pass-priority controls.', async () => {
        const wrapper = mount(PixiGamePrototype, {
            props: { scene: liveScene() },
        });

        expect(wrapper.get('.pixi-auto-pass').text()).toBe('Auto-pass: ON');
        expect(wrapper.get('.pixi-auto-pass').attributes('aria-pressed')).toBe('true');
        expect(wrapper.get('.pixi-pass-priority').text()).toBe('Pass priority');
        expect(wrapper.find('.pixi-pass-priority').attributes('disabled')).toBeUndefined();

        await wrapper.get('.pixi-auto-pass').trigger('click');
        await wrapper.get('.pixi-pass-priority').trigger('click');

        expect(wrapper.emitted('toggle-priority')).toHaveLength(1);
        expect(wrapper.emitted('pass-priority')).toHaveLength(1);
        wrapper.unmount();
    });

    test('keeps pass priority visible but disabled when Rust omits the action.', () => {
        const wrapper = mount(PixiGamePrototype, {
            props: {
                scene: liveScene({ canPassPriority: false }),
            },
        });

        expect(wrapper.get('.pixi-pass-priority').attributes('disabled')).toBeDefined();
        wrapper.unmount();
    });

    test('renders an official replay as read-only instead of exposing live actions.', () => {
        const scene = { ...liveScene(), replay: true };
        scene.players = [{
            id: 'player-1',
            life: 20,
            local: true,
            name: 'Replay player',
            targetable: true,
        }];
        const wrapper = mount(PixiGamePrototype, {
            props: { mode: 'replay', scene },
        });

        expect(wrapper.attributes('data-mode')).toBe('replay');
        expect(wrapper.get('.pixi-replay-label').text()).toBe('Official replay');
        expect(wrapper.find('.pixi-pass-priority').exists()).toBe(false);
        expect(wrapper.find('.pixi-auto-pass').exists()).toBe(false);
        wrapper.get('.pixi-player-hud').trigger('click');
        expect(wrapper.emitted('player-click')).toBeUndefined();
        wrapper.unmount();
    });

    test('labels a running trace as a live spectator board.', () => {
        const wrapper = mount(PixiGamePrototype, {
            props: { mode: 'replay', scene: { ...liveScene(), replay: true, spectator: true } },
        });

        expect(wrapper.get('.pixi-replay-label').text()).toBe('Live spectator');
        wrapper.unmount();
    });

    test('gives the winner a short shoutout when the terminal state arrives.', () => {
        const wrapper = mount(PixiGamePrototype, {
            props: {
                scene: {
                    ...liveScene(),
                    outcome: { draw: false, reason: 'commanderDamage', winnerName: 'Etienne' },
                },
            },
        });

        expect(wrapper.get('.pixi-game-outcome').text()).toContain('GG, Etienne!');
        expect(wrapper.get('.pixi-game-outcome').text()).toContain('21 commander damage');
        expect(wrapper.get('.pixi-game-outcome').attributes('role')).toBe('status');
        wrapper.unmount();
    });

    test('shows commander names and uses the owning player color for damage.', () => {
        const scene = liveScene();
        scene.players = [
            {
                accent: '#123456',
                commanderDamage: [],
                id: 'owner',
                life: 40,
                local: true,
                name: 'Owner',
            },
            {
                commanderDamage: [{
                    amount: 8,
                    commanderId: 'commander:1',
                    commanderName: 'Omnath, Locus of All',
                    ownerId: 'owner',
                }],
                id: 'defender',
                life: 32,
                local: false,
                name: 'Defender',
            },
        ];
        const wrapper = mount(PixiGamePrototype, { props: { scene } });

        const damage = wrapper.get('.pixi-commander-damage');
        expect(damage.text()).toBe('Omnath, Locus of All : 8');
        expect(damage.attributes('style')).toContain('color: #123456');
        expect(wrapper.text()).not.toContain('8 commandant');
        wrapper.unmount();
    });
});
