// Fixtures shaped like DeepDeckEngine `mtg-game-session/v1` payloads
// (camelCase LegalAction / EngineDecisionRequest / externally tagged TargetRef).

function card(instanceId, name, typeLine, extra = {}) {
    return {
        controller: instanceId.split('-')[0],
        definition: { id: `def:${name}`, name, rules: extra.rules ?? [], typeLine },
        flags: extra.flags ?? {},
        instanceId,
        owner: instanceId.split('-')[0],
        tapped: false,
    };
}

export function decisionState(overrides = {}) {
    return {
        activePlayer: 0,
        combat: { attackers: [], blockers: [] },
        events: [],
        players: [
            {
                battlefield: [
                    card('p1-c1', 'Grizzly Bears', 'Creature — Bear'),
                    card('p1-c2', 'Forest', 'Basic Land — Forest'),
                ],
                exile: [],
                graveyard: [card('p1-c5', 'Llanowar Elves', 'Creature — Elf Druid')],
                hand: [
                    card('p1-c3', 'Lightning Bolt', 'Instant'),
                    card('p1-c4', 'Prey Upon', 'Sorcery', {
                        rules: [{ effect: { kind: 'fightPermanents' }, kind: 'spellAbility' }],
                    }),
                    card('p1-c8', 'Fireball', 'Sorcery'),
                ],
                id: 'p1',
                library: [
                    card('p1-c6', 'Forest', 'Basic Land — Forest'),
                    card('p1-c7', 'Island', 'Basic Land — Island'),
                ],
                life: 20,
                name: 'Pilot',
            },
            {
                battlefield: [
                    card('p2-c1', 'Serra Angel', 'Creature — Angel'),
                    card('p2-c2', 'Jace Beleren', 'Legendary Planeswalker — Jace'),
                ],
                exile: [],
                graveyard: [],
                hand: [card('p2-c3', 'Counterspell', 'Instant')],
                id: 'p2',
                library: [],
                life: 20,
                name: 'Opponent',
            },
        ],
        stack: [],
        step: 'precombatMain',
        turnNumber: 3,
        ...overrides,
    };
}

function action(id, kind, label, extra = {}) {
    return { decisions: {}, id, kind, label, playerId: 'p1', ...extra };
}

const player = playerId => ({ player: { playerId } });
const permanent = instanceId => ({ permanent: { instanceId } });

export const fixtureDecisions = {
    attackers: {
        id: 'attackers:3',
        kind: 'attackers',
        options: [
            action('attack:p1-c1:p2', 'declareAttacker', 'Attack Opponent with Grizzly Bears', {
                attackerId: 'p1-c1',
                targetOrder: ['defender'],
                targets: { defender: player('p2') },
            }),
            action('attack:p1-c1:p2-c2', 'declareAttacker', 'Attack Jace Beleren with Grizzly Bears', {
                attackerId: 'p1-c1',
                targetOrder: ['defender'],
                targets: { defender: permanent('p2-c2') },
            }),
            action('finish-attackers', 'finishAttackers', 'Finish declaring attackers'),
        ],
        playerId: 'p1',
    },
    blockers: {
        id: 'blockers:3:p2',
        kind: 'blockers',
        options: [
            action('block:p2-c1:p1-c1', 'declareBlocker', 'Block Grizzly Bears with Serra Angel', {
                attackerId: 'p1-c1',
                blockerId: 'p2-c1',
                cardInstanceId: 'p2-c1',
                playerId: 'p2',
                targetOrder: ['attacker'],
                targets: { attacker: permanent('p1-c1') },
            }),
            action('finish-blockers', 'finishBlockers', 'Finish declaring blockers', { playerId: 'p2' }),
        ],
        playerId: 'p2',
    },
    cardName: {
        choice: {
            decisionId: 'named',
            kind: 'cardNameSelection',
            prompt: 'Choose a card name.',
            suggestions: ['Lightning Bolt', 'Serra Angel'],
        },
        id: 'resolution:stack-9:named',
        kind: 'resolutionChoice',
        options: [action('choose-name:named', 'chooseResolution', 'Choose a card name')],
        playerId: 'p1',
    },
    cardOrder: {
        choice: {
            cardInstanceIds: ['p1-c6', 'p1-c7'],
            decisionId: 'order',
            kind: 'cardOrder',
            prompt: 'Order the cards for the top of the library, topmost first.',
        },
        id: 'resolution:stack-3:order',
        kind: 'resolutionChoice',
        options: [
            action('order:a', 'chooseResolution', 'Order Forest, Island', {
                decisions: { order: ['p1-c6', 'p1-c7'] },
            }),
            action('order:b', 'chooseResolution', 'Order Island, Forest', {
                decisions: { order: ['p1-c7', 'p1-c6'] },
            }),
        ],
        playerId: 'p1',
    },
    cardSelection: {
        choice: {
            candidateCardInstanceIds: ['p1-c6', 'p1-c7', 'p1-c1'],
            decisionId: 'search',
            kind: 'cardSelection',
            maximum: 2,
            minimum: 1,
            prompt: 'Choose cards to put into hand.',
        },
        id: 'resolution:stack-2:search',
        kind: 'resolutionChoice',
        options: [
            ['p1-c6'], ['p1-c7'], ['p1-c1'], ['p1-c6', 'p1-c7'],
        ].map((ids, index) => action(`search:${index}`, 'chooseResolution', `Choose ${ids.join(', ')}`, {
            decisions: { search: ids },
        })),
        playerId: 'p1',
    },
    colorChoice: {
        choice: {
            decisionId: 'color',
            kind: 'optionSelection',
            options: ['W', 'U', 'B', 'R', 'G'],
            prompt: 'Choose a color.',
        },
        id: 'chooseOption:stack-4:12',
        kind: 'resolutionChoice',
        options: ['W', 'U', 'B', 'R', 'G'].map(color => action(
            `choose:color:${color}`,
            'chooseResolution',
            `Choose ${color}`,
            { decisions: { color: [color] } },
        )),
        playerId: 'p1',
    },
    combatDamage: {
        id: 'combatDamage:3:p1-c1:0',
        kind: 'combatDamage',
        options: [0, 1, 2].map(amount => action(
            `damage:${amount}`,
            'assignCombatDamage',
            `Assign ${amount} damage to Serra Angel`,
            {
                attackerId: 'p1-c1',
                decisions: { combatDamageAmount: amount, combatDamageRecipient: 'p2-c1' },
            },
        )),
        playerId: 'p1',
    },
    creatureType: {
        choice: {
            decisionId: 'type',
            kind: 'optionSelection',
            options: ['Elf', 'Goblin'],
            prompt: 'Choose a creature type.',
        },
        id: 'chooseOption:stack-5:20',
        kind: 'resolutionChoice',
        options: ['Elf', 'Goblin'].map(type => action(
            `choose:type:${type}`,
            'chooseResolution',
            `Choose ${type}`,
            { decisions: { type: [type] } },
        )),
        playerId: 'p1',
    },
    discard: {
        id: 'cleanupDiscard:3:8',
        kind: 'discard',
        options: ['p1-c3', 'p1-c4'].map(id => action(`discard:${id}`, 'discard', `Discard ${id}`, {
            cardInstanceId: id,
        })),
        playerId: 'p1',
    },
    manaColor: {
        id: 'resolution:stack-6:mana',
        kind: 'resolutionChoice',
        options: [
            action('mana:g', 'chooseResolution', 'Add {G}', { decisions: { manaChoice: ['G'] } }),
            action('mana:r', 'chooseResolution', 'Add {R}', { decisions: { manaChoice: ['R'] } }),
            action('mana:c', 'chooseResolution', 'Add {C}', { decisions: { manaChoice: ['C'] } }),
        ],
        playerId: 'p1',
        sourceCardInstanceId: 'p1-c2',
    },
    mulligan: {
        id: 'mulligan:p1:0',
        kind: 'mulligan',
        options: [
            action('keep', 'keepHand', 'Keep hand'),
            action('mulligan', 'takeMulligan', 'Take a mulligan'),
        ],
        playerId: 'p1',
    },
    mulliganBottom: {
        id: 'mulliganBottom:p1:0',
        kind: 'mulliganBottom',
        options: ['p1-c3', 'p1-c8'].map(id => action(`bottom:${id}`, 'bottomCard', `Bottom ${id}`, {
            cardInstanceId: id,
        })),
        playerId: 'p1',
    },
    numberSelection: {
        choice: {
            decisionId: 'amount',
            kind: 'numberSelection',
            maximum: 5,
            minimum: 1,
            prompt: 'Choose an amount.',
        },
        id: 'resolution:stack-7:amount',
        kind: 'resolutionChoice',
        options: [action('choose-number:amount', 'chooseResolution', 'Choose a number')],
        playerId: 'p1',
    },
    openingHandSelection: {
        id: 'openingHandSelection:p1:0',
        kind: 'openingHandSelection',
        options: ['p1-c90', 'p1-c91'].map(id => action(
            `opening:${id}`,
            'chooseOpeningHandCard',
            `Choose ${id}`,
            {
                cardInstanceId: id,
                decisions: { openingHandCandidate: card(id, `Candidate ${id}`, 'Instant') },
            },
        )),
        playerId: 'p1',
    },
    playerChoice: {
        choice: {
            decisionId: 'who',
            kind: 'optionSelection',
            options: ['p1', 'p2'],
            prompt: 'Choose a player.',
        },
        id: 'chooseOption:stack-8:30',
        kind: 'resolutionChoice',
        options: ['p1', 'p2'].map(id => action(`choose:who:${id}`, 'chooseResolution', `Choose ${id}`, {
            decisions: { who: [id] },
        })),
        playerId: 'p1',
    },
    priority: {
        id: 'priority:3:0:4',
        kind: 'priority',
        options: [
            action('pass:p1:40', 'passPriority', 'Pass priority'),
            ...[player('p2'), player('p1'), permanent('p2-c1'), permanent('p1-c1')].map((target, index) => {
                return action(`cast:hand:p1-c3:0:${index}`, 'castSpell', 'Cast Lightning Bolt', {
                    cardInstanceId: 'p1-c3',
                    paymentSources: ['p1-c2'],
                    targetOrder: ['target'],
                    targets: { target },
                });
            }),
            action('cast:hand:p1-c4:0:0', 'castSpell', 'Cast Prey Upon', {
                cardInstanceId: 'p1-c4',
                targetOrder: ['ownCreature', 'otherCreature'],
                targets: { otherCreature: permanent('p2-c1'), ownCreature: permanent('p1-c1') },
            }),
            ...[0, 1, 2].map(xValue => action(
                `cast:hand:p1-c8:0:x${xValue}`,
                'castSpell',
                `Cast Fireball (X = ${xValue})`,
                { cardInstanceId: 'p1-c8', decisions: { xValue } },
            )),
            action('activate:p1-c1:0', 'activateAbility', 'Grizzly Bears: Pump', { cardInstanceId: 'p1-c1' }),
            action('activate:p1-c1:1', 'activateAbility', 'Grizzly Bears: Sacrifice', {
                cardInstanceId: 'p1-c1',
            }),
            action('cast:graveyard:p1-c5:0', 'castSpell', 'Cast Llanowar Elves from graveyard', {
                cardInstanceId: 'p1-c5',
            }),
        ],
        playerId: 'p1',
    },
    replacementColor: {
        id: 'replacement:p1-c2:color',
        kind: 'replacementChoice',
        options: ['W', 'U'].map(color => action(
            `choose:color:${color.toLowerCase()}`,
            'chooseResolution',
            `Choose ${color}`,
            { cardInstanceId: 'p1-c2', decisions: { color } },
        )),
        playerId: 'p1',
        sourceCardInstanceId: 'p1-c2',
    },
    resolutionTarget: {
        id: 'resolution:stack-1:target',
        kind: 'resolutionChoice',
        options: [
            action('target:p2-c1', 'chooseResolution', 'Choose Serra Angel', {
                targetOrder: ['target'],
                targets: { target: permanent('p2-c1') },
            }),
            action('target:none', 'chooseResolution', 'Choose no target'),
        ],
        playerId: 'p1',
    },
    unknownKind: {
        id: 'vote:1',
        kind: 'councilVote',
        options: [action('vote:a', 'chooseResolution', 'Vote for Grizzly Bears')],
        playerId: 'p1',
    },
};

export function decisionView(name, stateOverrides = {}) {
    return {
        decision: fixtureDecisions[name],
        revision: 7,
        schemaVersion: 'mtg-game-session/v1',
        sessionId: 'session-1',
        state: decisionState(stateOverrides),
    };
}
