import { expect, test } from 'vitest';

import {
    PIXI_CARD_OUTLINE_COLORS,
    pixiCardOutlineColor,
    pixiCombatLinks,
    pixiHandCards,
    pixiPrivateZonePosition,
} from './PixiGameLayout.mjs';

test('Pixi card outlines reflect cast permissions and their source zone', () => {
    expect(
        pixiCardOutlineColor({ actionable: true, sceneZone: 'graveyard' }),
    ).toBe(PIXI_CARD_OUTLINE_COLORS.graveyard);
    expect(
        pixiCardOutlineColor({ actionable: true, sceneZone: 'exile' }),
    ).toBe(PIXI_CARD_OUTLINE_COLORS.exile);
    expect(
        pixiCardOutlineColor({ actionable: true, commander: true, sceneZone: 'commandZone' }),
    ).toBe(PIXI_CARD_OUTLINE_COLORS.actionable);
});

test('Pixi only gives an idle commander a yellow outline in the command zone', () => {
    expect(
        pixiCardOutlineColor({ commander: true, sceneZone: 'commandZone' }),
    ).toBe(PIXI_CARD_OUTLINE_COLORS.commandZone);
    expect(
        pixiCardOutlineColor({ commander: true, sceneZone: 'battlefield' }),
    ).toBeNull();
});

test('target selection takes precedence over every zone outline', () => {
    expect(
        pixiCardOutlineColor({
            actionable: true,
            commander: true,
            sceneZone: 'commandZone',
            targetable: true,
        }),
    ).toBe(PIXI_CARD_OUTLINE_COLORS.targetable);
});

test('private zones stay close to their owner and move toward the outside edge', () => {
    const leftOpponent = pixiPrivateZonePosition({
        anchorX: 360,
        anchorY: 160,
        local: false,
        regionWidth: 390,
        width: 1440,
    });
    const rightOpponent = pixiPrivateZonePosition({
        anchorX: 1080,
        anchorY: 160,
        local: false,
        regionWidth: 390,
        width: 1440,
    });
    const local = pixiPrivateZonePosition({
        anchorX: 720,
        anchorY: 650,
        local: true,
        regionWidth: 390,
        width: 1440,
    });

    expect(leftOpponent.x).toBeLessThan(360);
    expect(rightOpponent.x).toBeGreaterThan(1080);
    expect(leftOpponent.y).toBeLessThan(160);
    expect(rightOpponent.y).toBeLessThan(160);
    expect(local.y).toBeGreaterThan(650);
});

test('Pixi reads the projected hand array without mixing in other playable zones', () => {
    const hand = [{ id: 'hand-card' }];
    const playableHand = [
        ...hand,
        { id: 'graveyard-card', sourceZone: 'graveyard' },
        { id: 'exile-card', sourceZone: 'exile' },
    ];

    expect(pixiHandCards({ hand, playableHand })).toEqual(hand);
    expect(pixiHandCards({ playableHand })).toEqual(hand);
    expect(pixiHandCards({ hand: { cards: hand }, playableHand })).toEqual(hand);
});

test('Pixi normalizes current and compatible combat payloads into visible links', () => {
    expect(pixiCombatLinks({
        attackers: [{
            attackerId: 'attacker',
            defender: { player: { playerId: 'defender' } },
            defendingPlayerId: 'defender',
        }],
        blockers: [{ attackerId: 'attacker', blockerId: 'blocker' }],
    })).toEqual([
        {
            key: 'attack:attacker:defender',
            kind: 'attack',
            sourceCardId: 'attacker',
            targetCardId: '',
            targetPlayerId: 'defender',
        },
        {
            key: 'block:blocker:attacker',
            kind: 'block',
            sourceCardId: 'blocker',
            targetCardId: 'attacker',
            targetPlayerId: '',
        },
    ]);
    expect(pixiCombatLinks({
        attackers: [{
            attacker_id: 'attacker',
            defender: { permanent_id: 'planeswalker' },
            defending_player_id: 'defender',
        }],
    })[0]).toEqual(expect.objectContaining({
        sourceCardId: 'attacker',
        targetCardId: 'planeswalker',
        targetPlayerId: '',
    }));
});
