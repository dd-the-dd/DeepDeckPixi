export const PIXI_CARD_OUTLINE_COLORS = Object.freeze({
    actionable: 0x2563eb,
    commandZone: 0xd4a72c,
    exile: 0xf97316,
    graveyard: 0x9333ea,
    targetable: 0xdc2626,
});

export function pixiCardOutlineColor(card = {}) {
    if (card.targetable) {
        return PIXI_CARD_OUTLINE_COLORS.targetable;
    }
    if (card.actionable && card.sceneZone === 'graveyard') {
        return PIXI_CARD_OUTLINE_COLORS.graveyard;
    }
    if (card.actionable && card.sceneZone === 'exile') {
        return PIXI_CARD_OUTLINE_COLORS.exile;
    }
    if (card.actionable) {
        return PIXI_CARD_OUTLINE_COLORS.actionable;
    }
    if (card.commander && card.sceneZone === 'commandZone') {
        return PIXI_CARD_OUTLINE_COLORS.commandZone;
    }
    return null;
}

export function pixiHandCards(zones = {}) {
    if (Array.isArray(zones.hand)) {
        return zones.hand;
    }
    if (Array.isArray(zones.hand?.cards)) {
        return zones.hand.cards;
    }
    return (zones.playableHand ?? []).filter(card => {
        return !card?.sourceZone || card.sourceZone === 'hand';
    });
}

function transportValue(object, camelKey, snakeKey) {
    return object?.[camelKey] ?? object?.[snakeKey] ?? '';
}

export function pixiCombatLinks(combat = {}) {
    const attackLinks = (combat?.attackers ?? []).flatMap(assignment => {
        const attackerId = transportValue(assignment, 'attackerId', 'attacker_id');
        const defender = assignment?.defender ?? {};
        const targetCardId =
            transportValue(defender.permanent, 'instanceId', 'instance_id') ||
            transportValue(defender, 'permanentId', 'permanent_id');
        const targetPlayerId = targetCardId
            ? ''
            : transportValue(defender.player, 'playerId', 'player_id') ||
                transportValue(defender, 'playerId', 'player_id') ||
                transportValue(assignment, 'defendingPlayerId', 'defending_player_id');
        if (!attackerId || (!targetPlayerId && !targetCardId)) {
            return [];
        }
        return [{
            key: `attack:${attackerId}:${targetPlayerId || targetCardId}`,
            kind: 'attack',
            sourceCardId: attackerId,
            targetCardId,
            targetPlayerId,
        }];
    });
    const blockLinks = (combat?.blockers ?? []).flatMap(assignment => {
        const attackerId = transportValue(assignment, 'attackerId', 'attacker_id');
        const blockerId = transportValue(assignment, 'blockerId', 'blocker_id');
        if (!attackerId || !blockerId) {
            return [];
        }
        return [{
            key: `block:${blockerId}:${attackerId}`,
            kind: 'block',
            sourceCardId: blockerId,
            targetCardId: attackerId,
            targetPlayerId: '',
        }];
    });
    return [...attackLinks, ...blockLinks];
}

export function pixiPrivateZonePosition({
    anchorX,
    anchorY,
    local,
    regionWidth,
    width,
}) {
    const horizontalDirection = anchorX < width * 0.45 ? -1 : 1;
    const horizontalOffset = Math.min(regionWidth * 0.38, 150);
    return {
        x: Math.max(82, Math.min(width - 82, anchorX + horizontalDirection * horizontalOffset)),
        y: anchorY + (local ? 1 : -1) * 104,
    };
}
