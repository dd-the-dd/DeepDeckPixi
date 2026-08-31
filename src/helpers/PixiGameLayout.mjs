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

export function pixiHandScale({ cardCount = 0, local = false, width = 1280 }) {
    const roomyScale = local
        ? width >= 1200 ? 1.22 : width >= 900 ? 1.14 : width >= 700 ? 1.04 : 0.92
        : width >= 1200 ? 0.62 : width >= 900 ? 0.56 : 0.48;
    const densityPenalty = cardCount <= 7
        ? 0
        : cardCount <= 10
            ? local ? 0.08 : 0.05
            : cardCount <= 14
                ? local ? 0.18 : 0.1
                : local ? 0.3 : 0.16;
    return Math.max(local ? 0.82 : 0.4, roomyScale - densityPenalty);
}

export function pixiPermanentScale({ largestGroup = 0, playerCount = 2, width = 1280 }) {
    const roomyScale = playerCount <= 2
        ? width >= 1200 ? 1.08 : width >= 900 ? 0.98 : width >= 700 ? 0.88 : 0.76
        : width >= 1200 ? 0.92 : width >= 900 ? 0.84 : width >= 700 ? 0.76 : 0.68;
    const densityPenalty = largestGroup <= 4
        ? 0
        : largestGroup <= 6
            ? 0.1
            : largestGroup <= 9
                ? 0.22
                : 0.34;
    return Math.max(playerCount <= 2 ? 0.58 : 0.52, roomyScale - densityPenalty);
}

export function pixiToggledZoneKey(current, playerId, zoneId) {
    const next = { playerId: String(playerId), zoneId: String(zoneId) };
    return current?.playerId === next.playerId && current?.zoneId === next.zoneId
        ? null
        : next;
}
