import { describe, expect, test, vi } from 'vitest';

import {
    createGameSessionClient,
    gameSessionActionCardId,
    gameSessionCardCatalogFromDeckSelections,
    gameSessionRequestFromDeckSelections,
    gameSessionRequestFromLocalDecks,
    projectGameSessionView,
} from './GameSessionClient.mjs';

test('UI action identity tolerates combat and transport-compatible source fields', () => {
    expect(gameSessionActionCardId({ cardInstanceId: 'spell' })).toBe('spell');
    expect(gameSessionActionCardId({ attackerId: 'attacker' })).toBe('attacker');
    expect(gameSessionActionCardId({ blocker_id: 'blocker' })).toBe('blocker');
    expect(gameSessionActionCardId({
        attackerId: 'attacker',
        blockerId: 'blocker',
    })).toBe('blocker');
    expect(gameSessionActionCardId({ source_card_instance_id: 'source' })).toBe('source');
});

function sessionView(overrides = {}) {
    return {
        decision: {
            id: 'priority:1:0:0',
            kind: 'priority',
            options: [
                {
                    cardInstanceId: 'player-1:card:0',
                    id: 'cast:hand:player-1:card:0:0',
                    kind: 'castSpell',
                    label: 'Cast Opt from hand',
                    playerId: 'player-1',
                },
                {
                    id: 'pass:player-1:0',
                    kind: 'passPriority',
                    label: 'Pass priority',
                    playerId: 'player-1',
                },
            ],
            playerId: 'player-1',
        },
        revision: 3,
        schemaVersion: 'mtg-game-session/v1',
        sessionId: 'game-session:1',
        state: {
            activePlayer: 0,
            events: [],
            outcome: null,
            players: [
                {
                    battlefield: [],
                    exile: [],
                    graveyard: [],
                    hand: [
                        {
                            controller: 'player-1',
                            definition: {
                                id: 'opt',
                                manaCost: '{U}',
                                name: 'Opt',
                                rules: [{ effects: [{ kind: 'drawCards' }], kind: 'spellAbility' }],
                                typeLine: 'Instant',
                            },
                            instanceId: 'player-1:card:0',
                            owner: 'player-1',
                            tapped: false,
                        },
                    ],
                    hasLost: false,
                    id: 'player-1',
                    landPlaysRemaining: 1,
                    library: [],
                    life: 20,
                    maxHandSize: 7,
                    name: 'You',
                    sideboard: [],
                },
            ],
            priorityPlayer: 0,
            schemaVersion: 'mtg-game/v1',
            stack: [],
            status: 'inProgress',
            step: 'precombatMain',
            turnNumber: 1,
            unsupportedRules: [],
        },
        ...overrides,
    };
}

describe('GameSessionClient', () => {
    test('Feature: Linked exile stays associated with its generic Rust source', () => {
        const base = sessionView();
        const source = {
            ...base.state.players[0].hand[0],
            definition: {
                ...base.state.players[0].hand[0].definition,
                name: 'Temporary Lockdown',
                typeLine: 'Enchantment',
            },
            instanceId: 'source-enchantment',
        };
        const exiled = {
            ...base.state.players[0].hand[0],
            definition: {
                ...base.state.players[0].hand[0].definition,
                name: 'Exiled permanent',
            },
            instanceId: 'exiled-permanent',
        };
        const projected = projectGameSessionView(sessionView({
            state: {
                ...base.state,
                players: [{
                    ...base.state.players[0],
                    battlefield: [source],
                    exile: [exiled],
                }],
                ruleModifiers: [{
                    cardInstanceId: exiled.instanceId,
                    kind: 'exiledWithSource',
                    returnWhenSourceLeaves: true,
                    sourceCardInstanceId: source.instanceId,
                }],
            },
        }));

        expect(projected.players[0].zones.exile.cards[0].state.linkedExileSourceId)
            .toBe(source.instanceId);
        expect(projected.players[0].zones.exile.top.state.linkedExileSourceId)
            .toBe(source.instanceId);
    });

    test('Bug: Replay projection tolerates hidden library placeholders.', () => {
        const base = sessionView();
        const view = sessionView({
            decision: {
                ...base.decision,
                sourceCardInstanceId: 'hidden-or-missing-source',
            },
            state: {
                ...base.state,
                players: [{
                    ...base.state.players[0],
                    library: [null, null],
                }],
            },
        });

        expect(() => projectGameSessionView(view)).not.toThrow();
        expect(projectGameSessionView(view).decisionSourceCard).toBeNull();
    });

    test('Feature: Network player roles follow player IDs after seat order is randomized.', () => {
        const base = sessionView();
        const projected = projectGameSessionView(sessionView({
            state: {
                ...base.state,
                players: [
                    {
                        ...base.state.players[0],
                        id: 'player-2',
                        name: 'Guest',
                    },
                    {
                        ...base.state.players[0],
                        id: 'player-1',
                        name: 'Host',
                    },
                ],
            },
        }), {
            playerRoleById: {
                'player-1': 'network-human',
                'player-2': 'human',
            },
            playerRoles: ['human', 'human'],
        });

        expect(projected.players.map(player => [player.key, player.role])).toEqual([
            ['player-2', 'human'],
            ['player-1', 'network-human'],
        ]);
    });

    test('Bug: A temporary Rust hand reveal is exposed to the play UI.', () => {
        const base = sessionView();
        const opponentCard = {
            ...base.state.players[0].hand[0],
            controller: 'player-2',
            instanceId: 'player-2:card:0',
            owner: 'player-2',
        };
        const projected = projectGameSessionView(sessionView({
            state: {
                ...base.state,
                players: [
                    base.state.players[0],
                    {
                        ...base.state.players[0],
                        hand: [opponentCard],
                        id: 'player-2',
                        name: 'Opponent',
                    },
                ],
                ruleModifiers: [{
                    expiresAfterTurn: 1,
                    kind: 'revealedHand',
                    playerId: 'player-2',
                    sourceCardInstanceId: 'targeted-hand-source',
                }],
            },
        }), {
            playerRoles: ['human', 'ai-random'],
        });

        expect(projected.players[0].zones.handRevealed).toBe(false);
        expect(projected.players[1].zones.handRevealed).toBe(true);
        expect(projected.players[1].zones.hand[0].id).toBe('player-2:card:0');
    });

    test('Feature: individually known opponent hand cards remain marked for the viewer.', () => {
        const base = sessionView();
        const knownCard = {
            ...base.state.players[0].hand[0],
            controller: 'player-2',
            instanceId: 'player-2:known-card',
            owner: 'player-2',
        };
        const unknownCard = {
            ...base.state.players[0].hand[0],
            controller: 'player-2',
            instanceId: 'hidden:hand:player-2:1',
            owner: 'player-2',
            definition: {
                id: 'hidden-card',
                manaCost: '',
                name: 'Hidden card',
                rules: [],
                typeLine: '',
            },
        };
        const projected = projectGameSessionView(sessionView({
            state: {
                ...base.state,
                players: [
                    base.state.players[0],
                    {
                        ...base.state.players[0],
                        hand: [knownCard, unknownCard],
                        id: 'player-2',
                        name: 'Opponent',
                    },
                ],
                ruleModifiers: [{
                    cardInstanceIds: ['player-2:known-card'],
                    kind: 'knownHandCards',
                    playerId: 'player-2',
                }],
            },
        }), {
            playerRoles: ['human', 'ai-random'],
        });

        expect(projected.players[1].zones.hand[0].knownToViewer).toBe(true);
        expect(projected.players[1].zones.hand[1].knownToViewer).toBe(false);
        expect(projected.players[1].zones.handRevealed).toBe(false);
    });

    test('Feature: Rust option choices that name board objects become visual targets.', () => {
        const base = sessionView();
        const permanent = {
            controller: 'player-2',
            definition: {
                id: 'target-creature',
                manaCost: '',
                name: 'Target Creature',
                rules: [],
                typeLine: 'Creature',
            },
            instanceId: 'player-2:target-creature',
            owner: 'player-2',
            tapped: false,
        };
        const decisionId = 'chooseOption:stack:bowmasters:0';
        const action = (id, selectedId) => ({
            decisions: { [decisionId]: [selectedId] },
            id,
            kind: 'chooseResolution',
            label: `Choose ${selectedId}`,
            playerId: 'player-1',
        });
        const projected = projectGameSessionView(sessionView({
            decision: {
                choice: {
                    decisionId,
                    kind: 'optionSelection',
                    options: ['player-2', permanent.instanceId],
                    prompt: 'Choose any target.',
                },
                id: `resolution:stack:bowmasters:${decisionId}`,
                kind: 'resolutionChoice',
                options: [
                    action('resolve:bowmasters:player', 'player-2'),
                    action('resolve:bowmasters:permanent', permanent.instanceId),
                ],
                playerId: 'player-1',
            },
            state: {
                ...base.state,
                players: [
                    base.state.players[0],
                    {
                        ...base.state.players[0],
                        battlefield: [permanent],
                        hand: [],
                        id: 'player-2',
                        name: 'Opponent',
                    },
                ],
            },
        }));

        expect(projected.resolutionTargetChoice.prompt).toBe('Choose any target.');
        expect(projected.resolutionTargetChoice.actions).toEqual([
            expect.objectContaining({
                id: 'resolve:bowmasters:player',
                targets: {
                    resolutionBoardTarget: { player: { playerId: 'player-2' } },
                },
            }),
            expect.objectContaining({
                id: 'resolve:bowmasters:permanent',
                targets: {
                    resolutionBoardTarget: {
                        permanent: { instanceId: permanent.instanceId },
                    },
                },
            }),
        ]);
    });

    test('Bug: Normal cards keep their canonical name instead of the printing label.', () => {
        const request = gameSessionRequestFromDeckSelections([
            {
                cards: [{
                    canonicalRules: [{ kind: 'manaAbility' }],
                    name: 'command tower',
                    selectedOption: {
                        name: 'Commander 2011 (269)',
                        typeLine: 'Land',
                    },
                }],
                name: 'You',
            },
            { cards: [], name: 'Opponent' },
        ]);

        expect(request.setup.players[0].cards[0].name).toBe('command tower');
    });

    test('Feature: Play sends the selected printings related token Oracle to Rust.', () => {
        const blood = {
            manaCost: '',
            name: 'blood',
            oracleText: '{1}, {T}, Discard a card, Sacrifice this token: Draw a card.',
            typeLine: 'Token Artifact - Blood',
        };
        const request = gameSessionRequestFromDeckSelections([
            {
                cards: [{
                    canonicalRules: [{
                        effects: [{
                            kind: 'createTokens',
                            quantity: { kind: 'integer', value: 1 },
                            token: { kind: 'namedToken', name: 'Blood' },
                        }],
                        kind: 'spellAbility',
                    }],
                    name: 'blood maker',
                    selectedOption: {
                        id: 'blood-maker',
                        manaCost: '{1}{B}',
                        relatedTokens: [blood],
                        typeLine: 'Sorcery',
                    },
                }],
                name: 'You',
            },
            { cards: [], name: 'Opponent' },
        ]);

        expect(request.setup.players[0].cards[0].rules).toContainEqual({
            kind: 'rulesMarker',
            relatedTokenOracle: [blood],
            text: 'Source-linked token definitions',
        });
    });

    test('Feature: Commander deck metadata reaches the authoritative Rust definition.', () => {
        const request = gameSessionRequestFromDeckSelections([
            {
                cards: [{
                    canonicalRules: [],
                    isCommander: true,
                    name: 'zurgo stormrender',
                    selectedOption: {
                        id: 'zurgo',
                        manaCost: '{R}{W}{B}',
                        typeLine: 'Legendary Creature - Orc Warrior',
                    },
                }],
                name: 'You',
            },
            { cards: [], name: 'Opponent' },
        ]);

        expect(request.setup.players[0].cards[0].rules).toContainEqual({
            kind: 'rulesMarker',
            source: { kind: 'self' },
            text: 'Commander',
        });
        expect(request.setup.players[0].cards[0].rules).toContainEqual({
            colorIdentity: ['W', 'B', 'R'],
            kind: 'rulesMarker',
            text: 'Color identity',
        });
        expect(request.setup.players[0].cards[0].isCommander).toBe(true);
    });

    test('Bug: Commander color identity includes mana symbols from every card face.', () => {
        const request = gameSessionRequestFromDeckSelections([
            {
                cards: [{
                    canonicalRules: [],
                    isCommander: true,
                    name: 'avatar aang',
                    selectedOption: {
                        faces: [
                            {
                                manaCost: '{R}{G}{W}{U}',
                                name: 'Avatar Aang',
                                oracleText: 'Flying',
                                typeLine: 'Legendary Creature - Human Avatar',
                            },
                            {
                                manaCost: '',
                                name: 'Aang, Master of Elements',
                                oracleText: 'Spells you cast cost {W}{U}{B}{R}{G} less to cast.',
                                typeLine: 'Legendary Creature - Avatar',
                            },
                        ],
                        layout: 'transform',
                    },
                }],
                name: 'You',
            },
            { cards: [], name: 'Opponent' },
        ]);

        expect(request.setup.players[0].cards[0].rules).toContainEqual({
            colorIdentity: ['W', 'U', 'B', 'R', 'G'],
            kind: 'rulesMarker',
            text: 'Color identity',
        });
    });

    test('Feature: Play expands deck quantities into an authoritative Rust GameSetup.', () => {
        const request = gameSessionRequestFromDeckSelections([
            {
                cards: [
                    {
                        id: 'mountain',
                        name: 'mountain',
                        quantity: 2,
                        selectedOption: {
                            manaCost: '',
                            oracleText: '({T}: Add {R}.)',
                            typeLine: 'Basic Land - Mountain',
                        },
                        canonicalRules: [{ kind: 'manaAbility' }],
                    },
                    {
                        isSideboard: true,
                        name: 'abrade',
                        quantity: 1,
                        selectedOption: {
                            id: 'abrade',
                            manaCost: '{1}{R}',
                            typeLine: 'Instant',
                        },
                    },
                    {
                        name: 'treasure',
                        quantity: 1,
                        selectedOption: {
                            id: 'treasure',
                            isGamePiece: true,
                            isToken: true,
                            typeLine: 'Token Artifact - Treasure',
                        },
                    },
                ],
                id: 'deck-one',
                name: 'You',
            },
            {
                cards: Array.from({ length: 7 }, (_, index) => ({
                    id: `forest-${index}`,
                    name: 'forest',
                    selectedOption: { typeLine: 'Basic Land - Forest' },
                })),
                id: 'deck-two',
                name: 'Opponent',
            },
        ], {
            freeMulligans: 1,
            gameMode: 'commander',
            holdPriority: true,
            mulliganEnabled: true,
            playerRoles: ['human', 'ai'],
            seed: 42,
        });

        expect(request).toEqual(expect.objectContaining({
            aiControllerByPlayerId: {},
            freeMulligans: 1,
            gameMode: 'commander',
            holdPriorityPlayerIds: ['player-1'],
            humanPlayerIds: ['player-1'],
            maxTurns: 200,
            mulliganEnabled: true,
            seed: 42,
            setup: expect.objectContaining({
                openingHandSize: 7,
                players: [
                    expect.objectContaining({
                        cards: [
                            expect.objectContaining({
                                id: 'mountain',
                                rules: expect.arrayContaining([
                                    expect.objectContaining({ kind: 'manaAbility' }),
                                ]),
                            }),
                            expect.objectContaining({ id: 'mountain' }),
                            expect.objectContaining({
                                id: 'abrade',
                                isSideboard: true,
                            }),
                            expect.objectContaining({
                                id: 'treasure',
                                isGamePiece: true,
                                isToken: true,
                            }),
                        ],
                        id: 'player-1',
                    }),
                    expect.objectContaining({ id: 'player-2' }),
                ],
                startingPlayer: 0,
            }),
        }));
    });

    test('Feature: Play routes versioned and training AI seats explicitly.', () => {
        const request = gameSessionRequestFromDeckSelections(
            [
                { cards: [], name: 'Ground truth' },
                { cards: [], name: 'Training' },
                { cards: [], name: 'V9 Training' },
                { cards: [], name: 'Random' },
            ],
            {
                playerRoles: ['ia-gt-3', 'ia-in-training', 'ia-v9-in-training', 'ai-random'],
            },
        );

        expect(request).toEqual(expect.objectContaining({
            aiControllerByPlayerId: {
                'player-1': 'ia-gt-3',
                'player-2': 'ia-in-training',
                'player-3': 'ia-v9-in-training',
            },
            analyticsPilotByPlayerId: {
                'player-1': 'ia-gt-3',
                'player-2': 'ia-v6-in-training',
                'player-3': 'ia-v9-in-training',
                'player-4': 'ai-random',
            },
            humanPlayerIds: [],
        }));
    });

    test('Feature: Preparation cards submit only their permanent face as the deck card.', () => {
        const canonicalRules = [
            {
                effects: [{ keyword: 'flying', kind: 'keyword' }],
                kind: 'staticAbility',
            },
            {
                kind: 'prepareSpell',
                spell: {
                    id: 'emeritus:face:2',
                    manaCost: '{U}',
                    name: 'Ancestral Recall',
                    rules: [{
                        kind: 'spellAbility',
                        target: { kind: 'player' },
                    }],
                    typeLine: 'Instant',
                },
            },
            {
                declaration: {
                    decisions: [{
                        candidates: { kind: 'players' },
                        id: 'targetPlayer',
                        kind: 'chooseTargets',
                        maximum: 1,
                        minimum: 1,
                    }],
                    kind: 'castingDeclaration',
                },
                effects: [{ kind: 'drawCards' }],
                kind: 'spellAbility',
                source: { kind: 'self' },
            },
        ];
        const permanentRules = canonicalRules.filter(rule => rule.kind !== 'spellAbility');
        const card = {
            canonicalRules,
            name: 'emeritus of ideation // ancestral recall',
            quantity: 1,
            selectedOption: {
                faces: [
                    {
                        id: 'emeritus:face:1',
                        manaCost: '{3}{U}{U}',
                        name: 'Emeritus of Ideation',
                        oracleText: 'Flying, ward {2}',
                        power: '5',
                        toughness: '5',
                        typeLine: 'Creature - Human Wizard',
                    },
                    {
                        id: 'emeritus:face:2',
                        manaCost: '{U}',
                        name: 'Ancestral Recall',
                        oracleText: 'Target player draws three cards.',
                        typeLine: 'Instant',
                    },
                ],
                id: 'emeritus',
                layout: 'prepare',
                manaCost: '{3}{U}{U} // {U}',
                power: '5',
                toughness: '5',
                typeLine: 'Creature - Human Wizard // Instant',
                urlFront: 'https://cards.test/emeritus.jpg',
            },
        };

        const request = gameSessionRequestFromDeckSelections([
            { cards: [card], name: 'You' },
            { cards: [], name: 'Opponent' },
        ]);
        const definition = request.setup.players[0].cards[0];
        const catalog = gameSessionCardCatalogFromDeckSelections([
            { cards: [card], name: 'You' },
        ]);

        expect(definition).toEqual(expect.objectContaining({
            id: 'emeritus',
            manaCost: '{3}{U}{U}',
            name: 'Emeritus of Ideation',
            power: '5',
            rules: expect.arrayContaining(permanentRules),
            toughness: '5',
            typeLine: 'Creature - Human Wizard',
        }));
        expect(definition.rules).not.toContainEqual(
            expect.objectContaining({ kind: 'spellAbility' }),
        );
        expect(definition.rules).toContainEqual(
            expect.objectContaining({ kind: 'prepareSpell' }),
        );
        expect(catalog['emeritus:face:2']).toEqual(expect.objectContaining({
            imageUrl: 'https://cards.test/emeritus.jpg',
            manaCost: '{U}',
            name: 'Ancestral Recall',
            typeLine: 'Instant',
        }));
    });

    test('Feature: Transform cards use their front definition and display their back image after transforming.', () => {
        const card = {
            canonicalRules: [
                {
                    activeFaceIndex: 0,
                    kind: 'triggeredAbility',
                },
                {
                    activeFaceIndex: 1,
                    ability: { kind: 'flying' },
                    kind: 'keywordAbility',
                },
                {
                    kind: 'rulesMarker',
                    text: 'Transformable card faces.',
                    transformFaces: [],
                },
            ],
            name: 'sephiroth, fabled soldier',
            selectedOption: {
                faces: [
                    {
                        id: 'sephiroth:front',
                        manaCost: '{2}{B}',
                        name: 'Sephiroth, Fabled SOLDIER',
                        oracleText: 'Whenever another creature dies, transform Sephiroth.',
                        power: '3',
                        toughness: '3',
                        typeLine: 'Legendary Creature - Human Soldier',
                    },
                    {
                        id: 'sephiroth:back',
                        manaCost: '',
                        name: 'Sephiroth, One-Winged Angel',
                        oracleText: 'Flying',
                        power: '5',
                        toughness: '5',
                        typeLine: 'Legendary Creature - Angel Nightmare',
                    },
                ],
                id: 'sephiroth',
                layout: 'transform',
                urlBack: 'sephiroth-back.jpg',
                urlFront: 'sephiroth-front.jpg',
            },
        };
        const request = gameSessionRequestFromDeckSelections([
            { cards: [card], name: 'You' },
            { cards: [], name: 'Opponent' },
        ]);
        const definition = request.setup.players[0].cards[0];
        expect(definition).toEqual(expect.objectContaining({
            manaCost: '{2}{B}',
            name: 'Sephiroth, Fabled SOLDIER',
            power: '3',
            toughness: '3',
            typeLine: 'Legendary Creature - Human Soldier',
        }));

        const view = sessionView();
        view.state.players[0].hand = [];
        view.state.players[0].battlefield = [{
            controller: 'player-1',
            definition: {
                ...definition,
                manaCost: '',
                name: 'Sephiroth, One-Winged Angel',
                power: '5',
                toughness: '5',
                typeLine: 'Legendary Creature - Angel Nightmare',
            },
            flags: { transformed: true },
            instanceId: 'sephiroth-instance',
            owner: 'player-1',
            tapped: false,
        }];
        const catalog = gameSessionCardCatalogFromDeckSelections([
            { cards: [card], name: 'You' },
        ]);
        const projected = projectGameSessionView(view, { cardCatalog: catalog });
        const transformed = projected.players[0].zones.battlefield.creatures[0];
        expect(transformed.imageUrl).toBe('sephiroth-back.jpg');
        expect(transformed.name).toBe('Sephiroth, One-Winged Angel');
        expect(transformed.state.transformed).toBe(true);
    });

    test('Feature: A current-turn graveyard permission remains actionable in the end step.', () => {
        const view = sessionView();
        const milledCard = {
            ...view.state.players[0].hand[0],
            instanceId: 'player-1:milled-card',
        };
        view.state.players[0].hand = [];
        view.state.players[0].graveyard = [milledCard];
        view.state.step = 'endStep';
        view.decision.options[0] = {
            cardInstanceId: milledCard.instanceId,
            decisions: { castSourceZone: 'graveyard' },
            id: `cast:graveyard:${milledCard.instanceId}:0`,
            kind: 'castSpell',
            label: 'Cast Opt from graveyard',
            playerId: 'player-1',
        };

        const projected = projectGameSessionView(view);
        const graveyard = projected.players[0].zones.graveyard;
        const card = graveyard.cards[0];

        expect(projected.step.phase).toBe('end');
        expect(graveyard.actionable).toBe(true);
        expect(card).toEqual(expect.objectContaining({
            id: milledCard.instanceId,
            sourceZone: 'graveyard',
            actionState: expect.objectContaining({
                actionable: true,
                actions: ['Cast Opt from graveyard'],
            }),
        }));
        expect(projected.players[0].zones.playableHand).toContainEqual(
            expect.objectContaining({
                id: milledCard.instanceId,
                sourceZone: 'graveyard',
            }),
        );
    });

    test('Feature: The browser submits only an action offered by the current Rust decision.', async () => {
        const initial = sessionView();
        const next = sessionView({
            decision: null,
            revision: 4,
        });
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce({
                json: async () => initial,
                ok: true,
            })
            .mockResolvedValueOnce({
                json: async () => next,
                ok: true,
            });
        const client = createGameSessionClient({
            baseUrl: 'http://engine.test',
            fetchImpl,
        });

        const created = await client.create({ setup: { players: [] } });
        const resumed = await client.submitAction(
            created,
            'cast:hand:player-1:card:0:0',
        );

        expect(resumed).toBe(next);
        expect(fetchImpl).toHaveBeenNthCalledWith(
            2,
            'http://engine.test/game/sessions/game-session:1/actions',
            {
                body: JSON.stringify({
                    actionId: 'cast:hand:player-1:card:0:0',
                    decisionId: 'priority:1:0:0',
                    revision: 3,
                }),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            },
        );
        await expect(
            client.submitAction(created, 'client-invented-action'),
        ).rejects.toThrow('is not offered by the Rust engine');
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    test('Feature: The browser submits a bounded number without expanding Rust actions.', async () => {
        const initial = sessionView({
            decision: {
                choice: {
                    decisionId: 'loopIterations',
                    kind: 'numberSelection',
                    maximum: 5,
                    minimum: 0,
                    prompt: 'Choose a finite loop count',
                },
                id: 'loop-iterations:1',
                kind: 'resolutionChoice',
                options: [{
                    id: 'choose-number:loopIterations',
                    kind: 'chooseResolution',
                    label: 'Choose a finite loop count',
                    playerId: 'player-1',
                }],
                playerId: 'player-1',
            },
        });
        const next = sessionView({ decision: null, revision: 4 });
        const fetchImpl = vi.fn().mockResolvedValue({
            json: async () => next,
            ok: true,
        });
        const client = createGameSessionClient({
            baseUrl: 'http://engine.test',
            fetchImpl,
        });

        await client.submitNumber(initial, 4);

        expect(fetchImpl).toHaveBeenCalledWith(
            'http://engine.test/game/sessions/game-session:1/actions',
            {
                body: JSON.stringify({
                    actionId: 'choose-number:loopIterations',
                    decisionId: 'loop-iterations:1',
                    numberValue: 4,
                    revision: 3,
                }),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            },
        );
        await expect(client.submitNumber(initial, 6)).rejects.toThrow('outside 0..5');
        expect(projectGameSessionView(initial).numberChoice).toEqual({
            decisionId: 'loopIterations',
            maximum: 5,
            minimum: 0,
            prompt: 'Choose a finite loop count',
        });
    });

    test('Feature: The browser submits selected card ids outside precomputed combinations.', async () => {
        const initial = sessionView({
            decision: {
                choice: {
                    candidateCardInstanceIds: ['land-a', 'land-b', 'land-c'],
                    decisionId: 'landsToFind',
                    kind: 'cardSelection',
                    maximum: 2,
                    minimum: 2,
                    prompt: 'Choose two lands.',
                },
                id: 'resolution:landsToFind',
                kind: 'resolutionChoice',
                options: [{
                    decisions: { landsToFind: ['land-a', 'land-b'] },
                    id: 'resolve:landsToFind:0',
                    kind: 'chooseResolution',
                    label: 'Choose land-a, land-b',
                    playerId: 'player-1',
                }],
                playerId: 'player-1',
            },
        });
        const next = sessionView({ decision: null, revision: 4 });
        const fetchImpl = vi.fn().mockResolvedValue({
            json: async () => next,
            ok: true,
        });
        const client = createGameSessionClient({
            baseUrl: 'http://engine.test',
            fetchImpl,
        });

        await client.submitCardSelection(initial, ['land-b', 'land-c']);

        expect(fetchImpl).toHaveBeenCalledWith(
            'http://engine.test/game/sessions/game-session:1/actions',
            {
                body: JSON.stringify({
                    actionId: 'resolve:landsToFind:0',
                    cardInstanceIds: ['land-b', 'land-c'],
                    decisionId: 'resolution:landsToFind',
                    revision: 3,
                }),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            },
        );
    });

    test('Feature: The browser discovers versioned AI controller labels from Rust.', async () => {
        const catalog = {
            schemaVersion: 'ai-controller-catalog/v1',
            controllers: [
                { available: true, id: 'ai-random', label: 'IA aléatoire' },
                { available: true, id: 'ia-gt-0', label: 'ia-gt-0 (étape 0)' },
                { available: true, id: 'ia-gt-1', label: 'ia-gt-1 (étape 1200)' },
                { available: true, id: 'ia-in-training', label: 'ia-in-training' },
            ],
        };
        const fetchImpl = vi.fn().mockResolvedValue({
            json: async () => catalog,
            ok: true,
        });
        const client = createGameSessionClient({
            baseUrl: 'http://engine.test',
            fetchImpl,
        });

        await expect(client.listAiControllers()).resolves.toEqual(catalog.controllers);
        expect(fetchImpl).toHaveBeenCalledWith('http://engine.test/ai/controllers');
    });

    test('Feature: Play attributes a named human pilot in local-deck analytics.', () => {
        const request = gameSessionRequestFromLocalDecks(
            [
                { id: 'deck-human', name: 'Ada' },
                { id: 'deck-ai', name: 'Opponent' },
            ],
            {
                humanPilotId: 'human:Ada',
                playerRoles: ['human', 'ia-v12-in-training'],
            },
        );

        expect(request.analyticsPilotByPlayerId).toEqual({
            'player-1': 'human:Ada',
            'player-2': 'ia-v12-in-training',
        });
        expect(request.humanPlayerIds).toEqual(['player-1']);
    });

    test('Feature: Random Play decks come from the Rust format legality catalog.', async () => {
        const catalog = {
            decks: [{ deckName: 'Legacy Delver', deckSessionId: 'legacy-delver' }],
            gameMode: 'legacy',
            schemaVersion: 'mtg-legal-deck-catalog/v1',
        };
        const fetchImpl = vi.fn().mockResolvedValue({
            json: async () => catalog,
            ok: true,
        });
        const client = createGameSessionClient({
            baseUrl: 'http://engine.test',
            fetchImpl,
        });
        const request = { gameMode: 'legacy', openingHandSize: 7 };

        await expect(client.listLegalDecks(request)).resolves.toEqual(catalog);
        expect(fetchImpl).toHaveBeenCalledWith(
            'http://engine.test/game/decks/legal',
            {
                body: JSON.stringify(request),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            },
        );
    });

    test('Feature: Play matchmaking is selected by Rust from ratings and legal decks.', async () => {
        const match = {
            gameMode: 'legacy',
            human: { plackettLuceOrdinal: 12 },
            opponent: {
                controllerId: 'ai-v12-in-training',
                deckSessionId: 'legacy-delver',
                ratingDistance: 0.5,
            },
            schemaVersion: 'mtg-play-matchmaking/v1',
        };
        const fetchImpl = vi.fn().mockResolvedValue({
            json: async () => match,
            ok: true,
        });
        const client = createGameSessionClient({
            baseUrl: 'http://engine.test',
            fetchImpl,
        });
        const request = {
            gameMode: 'legacy',
            humanDeckSessionId: 'legacy-doomsday',
            humanPilotId: 'human',
        };

        await expect(client.findPlayMatch(request)).resolves.toEqual(match);
        expect(fetchImpl).toHaveBeenCalledWith(
            'http://engine.test/game/matchmaking',
            {
                body: JSON.stringify(request),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            },
        );
    });

    test('Feature: The browser asks Rust to validate a Commander setup before creating it.', async () => {
        const validation = {
            gameMode: 'commander',
            startingLife: 40,
            valid: true,
        };
        const fetchImpl = vi.fn().mockResolvedValue({
            json: async () => validation,
            ok: true,
        });
        const client = createGameSessionClient({
            baseUrl: 'http://engine.test',
            fetchImpl,
        });
        const setup = { players: [] };

        await expect(client.validateSetup({ gameMode: 'commander', setup }))
            .resolves.toEqual(validation);
        expect(fetchImpl).toHaveBeenCalledWith(
            'http://engine.test/game/setups/validate',
            {
                body: JSON.stringify({ gameMode: 'commander', setup }),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            },
        );
    });

    test('Feature: Hold priority changes a Rust session setting rather than client timing.', async () => {
        const view = sessionView();
        const fetchImpl = vi.fn().mockResolvedValue({
            json: async () => view,
            ok: true,
        });
        const client = createGameSessionClient({
            baseUrl: 'http://engine.test',
            fetchImpl,
        });

        await client.updateSettings('game-session:1', {
            holdPriorityPlayerIds: ['player-1'],
        });

        expect(fetchImpl).toHaveBeenCalledWith(
            'http://engine.test/game/sessions/game-session:1/settings',
            {
                body: JSON.stringify({
                    holdPriorityPlayerIds: ['player-1'],
                }),
                headers: { 'Content-Type': 'application/json' },
                method: 'PUT',
            },
        );
    });

    test('Feature: Leaving Play closes the authoritative Rust session.', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({
            json: async () => ({ ok: true }),
            ok: true,
        });
        const client = createGameSessionClient({
            baseUrl: 'http://engine.test',
            fetchImpl,
        });

        await expect(client.close('game-session:1')).resolves.toEqual({ ok: true });
        expect(fetchImpl).toHaveBeenCalledWith(
            'http://engine.test/game/sessions/game-session:1',
            { method: 'DELETE' },
        );
    });

    test('Feature: Rust legal actions annotate rendering without client-side legality inference.', () => {
        const projected = projectGameSessionView(sessionView(), {
            cardCatalog: {
                opt: { imageUrl: 'opt.jpg' },
            },
            playerRoles: ['human'],
        });

        expect(projected.players[0]).toEqual(expect.objectContaining({
            key: 'player-1',
            life: 20,
            role: 'human',
            zones: expect.objectContaining({
                handCount: 1,
                libraryCount: 0,
            }),
        }));
        expect(projected.players[0].zones.playableHand[0]).toEqual(expect.objectContaining({
            actionState: {
                actionable: true,
                actions: ['Cast Opt from hand'],
                options: [
                    expect.objectContaining({
                        id: 'cast:hand:player-1:card:0:0',
                        kind: 'castSpell',
                    }),
                ],
            },
            id: 'player-1:card:0',
            imageUrl: 'opt.jpg',
            state: expect.objectContaining({ tapped: false }),
        }));
        expect(projected.passAction).toEqual(expect.objectContaining({
            id: 'pass:player-1:0',
        }));
        expect(projected.step).toEqual(expect.objectContaining({
            phase: 'main',
            playerKey: 'player-1',
            turn: 1,
        }));
    });

    test('Feature: Commanders project publicly with cast actions and damage metadata.', () => {
        const view = sessionView();
        const commander = {
            controller: 'player-1',
            definition: {
                id: 'commander',
                manaCost: '{2}{R}',
                name: 'Test Commander',
                rules: [{ kind: 'rulesMarker', text: 'Commander' }],
                typeLine: 'Legendary Creature - Human',
            },
            instanceId: 'player-1:commander:0',
            owner: 'player-1',
            tapped: false,
        };
        view.state.players[0].commandZone = [commander];
        view.state.players[0].commanderDamage = [{
            amount: 7,
            commanderId: 'opponent:commander:0',
            commanderName: 'Other Commander',
            controllerId: 'player-2',
            ownerId: 'player-2',
        }];
        view.decision.options.unshift({
            cardInstanceId: commander.instanceId,
            decisions: { castSourceZone: 'commandZone' },
            id: `cast:commandZone:${commander.instanceId}:0`,
            kind: 'castSpell',
            label: 'Cast Test Commander from commandZone',
            playerId: 'player-1',
        });

        const projected = projectGameSessionView(view, {
            cardCatalog: { commander: { imageUrl: 'commander.jpg' } },
            playerRoles: ['human'],
        });

        expect(projected.players[0].zones.handCount).toBe(1);
        expect(projected.players[0].zones.commandZone.count).toBe(1);
        expect(projected.players[0].zones.commandZone.cards[0]).toEqual(expect.objectContaining({
            isCommander: true,
            sourceZone: 'commandZone',
        }));
        expect(projected.players[0].zones.playableHand[0]).toEqual(expect.objectContaining({
            actionState: expect.objectContaining({ actionable: true }),
            imageUrl: 'commander.jpg',
            isCommander: true,
            sourceZone: 'commandZone',
        }));
        expect(projected.players[0].commanderDamage).toEqual([expect.objectContaining({
            amount: 7,
            commanderName: 'Other Commander',
        })]);
    });

    test('Bug: Commander and mulligan art survive Rust definition-id changes.', () => {
        const catalog = gameSessionCardCatalogFromDeckSelections([{
            cards: [{
                isCommander: true,
                name: 'test commander',
                selectedOption: {
                    name: 'Test Commander',
                    urlFront: 'commander.jpg',
                },
            }, {
                name: 'replacement card',
                selectedOption: {
                    name: 'Replacement Card',
                    urlFront: 'replacement.jpg',
                },
            }],
        }]);
        const view = sessionView();
        view.state.players[0].commandZone = [{
            controller: 'player-1',
            definition: {
                id: 'rust:commander:remapped',
                name: 'Test Commander',
                rules: [{ kind: 'rulesMarker', text: 'Commander' }],
                typeLine: 'Legendary Creature - Human',
            },
            instanceId: 'player-1:commander:remapped',
            owner: 'player-1',
        }];
        view.state.players[0].hand = [{
            controller: 'player-1',
            definition: {
                id: 'rust:mulligan:replacement',
                name: 'Replacement Card',
                rules: [],
                typeLine: 'Instant',
            },
            instanceId: 'player-1:mulligan:replacement',
            owner: 'player-1',
        }];

        const projected = projectGameSessionView(view, { cardCatalog: catalog });

        expect(projected.players[0].zones.commandZone.cards[0].imageUrl)
            .toBe('commander.jpg');
        expect(projected.players[0].zones.hand[0].imageUrl)
            .toBe('replacement.jpg');
    });

    test('Bug: Universes Beyond flavor names resolve to the selected printing art.', () => {
        const catalog = gameSessionCardCatalogFromDeckSelections([{
            cards: [{
                name: 'Dark Depths',
                selectedOption: {
                    flavorName: 'Alternate Display Name',
                    name: 'Dark Depths',
                    urlFront: 'alternate-printing.jpg',
                },
            }],
        }]);

        expect(catalog['card-art:dark depths'].imageUrl)
            .toBe('alternate-printing.jpg');
        expect(catalog['card-art:alternate display name'].imageUrl)
            .toBe('alternate-printing.jpg');
    });

    test('Feature: Exact nonland-permanent targets project as one authoritative presentation.', () => {
        const base = sessionView();
        const source = {
            controller: 'player-1',
            definition: {
                id: 'inevitable-defeat',
                manaCost: '{1}{R}{W}{B}',
                name: 'Inevitable Defeat',
                rules: [],
                typeLine: 'Instant',
            },
            instanceId: 'player-1:inevitable-defeat',
            owner: 'player-1',
            tapped: false,
        };
        const permanent = (instanceId, name, typeLine) => ({
            controller: 'player-2',
            definition: {
                id: instanceId,
                manaCost: '',
                name,
                rules: [],
                typeLine,
            },
            instanceId,
            owner: 'player-2',
            tapped: false,
        });
        const artifact = permanent('player-2:artifact', 'Target Artifact', 'Artifact');
        const creature = permanent(
            'player-2:creature',
            'Target Creature',
            'Creature - Test',
        );
        const land = permanent('player-2:land', 'Excluded Land', 'Land');
        const targetAction = (id, target) => ({
            cardInstanceId: source.instanceId,
            decisions: {
                castSourceZone: 'hand',
                targetPermanent: [target],
            },
            id,
            kind: 'castSpell',
            label: 'Cast Inevitable Defeat from hand',
            paymentSources: ['player-1:mana-source'],
            playerId: 'player-1',
            targetOrder: ['targetPermanent'],
            targets: {
                targetPermanent: target,
            },
        });
        const actions = [
            targetAction('cast:inevitable:artifact', {
                permanent: { instanceId: artifact.instanceId },
            }),
            targetAction('cast:inevitable:creature', {
                permanent: { instanceId: creature.instanceId },
            }),
        ];
        const projected = projectGameSessionView(sessionView({
            decision: {
                ...base.decision,
                options: actions,
            },
            state: {
                ...base.state,
                players: [
                    {
                        ...base.state.players[0],
                        hand: [source],
                    },
                    {
                        ...base.state.players[0],
                        battlefield: [artifact, creature, land],
                        hand: [],
                        id: 'player-2',
                        name: 'Opponent',
                    },
                ],
            },
        }), {
            playerRoles: ['human', 'ai'],
        });
        const sourceCard = projected.players[0].zones.playableHand[0];

        expect(projected.actions).toHaveLength(2);
        expect(sourceCard.actionState.options).toHaveLength(1);
        expect(sourceCard.actionState.options[0]).toEqual(expect.objectContaining({
            engineTargetActions: actions,
            engineTargetKeys: ['targetPermanent'],
            targets: {},
        }));
    });

    test('Feature: Blocker choices group exact attackers and project Rust combat assignments.', () => {
        const base = sessionView();
        const creature = (instanceId, name, controller, flags = {}) => ({
            controller,
            definition: {
                id: instanceId,
                manaCost: '',
                name,
                power: '2',
                rules: [],
                toughness: '2',
                typeLine: 'Creature - Test',
            },
            flags,
            instanceId,
            owner: controller,
            tapped: false,
        });
        const attackerA = creature(
            'player-1:attacker-a',
            'Attacker A',
            'player-1',
            { attacking: true },
        );
        const attackerB = creature(
            'player-1:attacker-b',
            'Attacker B',
            'player-1',
            { attacking: true },
        );
        const blocker = creature(
            'player-2:blocker',
            'Ready Blocker',
            'player-2',
            { blocking: true },
        );
        const blockAction = attacker => ({
            attackerId: attacker.instanceId,
            blockerId: blocker.instanceId,
            cardInstanceId: blocker.instanceId,
            id: `block:${blocker.instanceId}:${attacker.instanceId}`,
            kind: 'declareBlocker',
            label: `Block ${attacker.definition.name} with Ready Blocker`,
            playerId: 'player-2',
            targetOrder: ['attacker'],
            targets: {
                attacker: {
                    permanent: { instanceId: attacker.instanceId },
                },
            },
        });
        const actions = [blockAction(attackerA), blockAction(attackerB)];
        const projected = projectGameSessionView(sessionView({
            decision: {
                id: 'blockers:1:player-2',
                kind: 'blockers',
                options: actions,
                playerId: 'player-2',
            },
            state: {
                ...base.state,
                combat: {
                    attackers: [{
                        attackerId: attackerA.instanceId,
                        defender: { player: { playerId: 'player-2' } },
                        defendingPlayerId: 'player-2',
                    }],
                    blockers: [{
                        attackerId: attackerA.instanceId,
                        blockerId: blocker.instanceId,
                    }],
                },
                players: [
                    {
                        ...base.state.players[0],
                        battlefield: [attackerA, attackerB],
                        hand: [],
                    },
                    {
                        ...base.state.players[0],
                        battlefield: [blocker],
                        hand: [],
                        id: 'player-2',
                        name: 'Opponent',
                    },
                ],
                step: 'declareBlockers',
            },
        }), {
            playerRoles: ['human', 'human'],
        });
        const projectedBlocker = projected.players[1].zones.battlefield.creatures[0];

        expect(projectedBlocker.state.blocking).toBe(true);
        expect(projectedBlocker.actionState.options).toHaveLength(1);
        expect(projectedBlocker.actionState.options[0]).toEqual(expect.objectContaining({
            engineTargetActions: actions,
            engineTargetKeys: ['attacker'],
            targets: {},
        }));
        expect(projected.combat).toEqual(expect.objectContaining({
            attackers: [expect.objectContaining({ attackerId: attackerA.instanceId })],
            blockers: [expect.objectContaining({ blockerId: blocker.instanceId })],
        }));
    });

    test('Feature: Engine-created opponent tokens resolve public token artwork.', () => {
        const selectedToken = (id, imageUrl) => ({
            name: 'monk',
            selectedOption: {
                id,
                imageUrl,
                isGamePiece: true,
                isToken: true,
                power: '1',
                toughness: '1',
                typeLine: 'Token Creature - Monk',
            },
        });
        const catalog = gameSessionCardCatalogFromDeckSelections([
            { cards: [selectedToken('player-one-monk', 'player-one-monk.jpg')] },
            { cards: [selectedToken('player-two-monk', 'player-two-monk.jpg')] },
        ], [
            {
                imageUrl: 'treasure-token.jpg',
                isGamePiece: true,
                isToken: true,
                name: 'treasure',
                typeLine: 'Token Artifact - Treasure',
            },
        ]);
        const base = sessionView();
        const token = (name, typeLine, power = null, toughness = null) => ({
            controller: 'player-2',
            definition: {
                id: `token:${name.toLowerCase()}`,
                isGamePiece: true,
                isToken: true,
                manaCost: '',
                name,
                power,
                rules: [],
                toughness,
                typeLine,
            },
            instanceId: `player-2:token:${name.toLowerCase()}`,
            owner: 'player-2',
            tapped: false,
        });
        const projected = projectGameSessionView(sessionView({
            state: {
                ...base.state,
                players: [
                    {
                        ...base.state.players[0],
                        hand: [],
                    },
                    {
                        ...base.state.players[0],
                        battlefield: [
                            token('Monk Token', 'Creature - Monk', '1', '1'),
                            token('Treasure', 'Artifact - Treasure'),
                        ],
                        hand: [],
                        id: 'player-2',
                        name: 'Opponent',
                    },
                ],
            },
        }), {
            cardCatalog: catalog,
            playerRoles: ['human', 'ai'],
        });

        expect(projected.players[1].zones.battlefield.creatures[0].imageUrl)
            .toBe('player-two-monk.jpg');
        expect(projected.players[1].zones.battlefield.nonCreaturePermanents[0].imageUrl)
            .toBe('treasure-token.jpg');
    });

    test('Feature: Exact related-token identities distinguish equal Cat names and stats.', () => {
        const relatedToken = (scryfallId, oracleText, imageUrl) => ({
            imageUrl,
            isGamePiece: true,
            isToken: true,
            name: 'Cat',
            oracleText,
            power: '1',
            scryfallId,
            toughness: '1',
            typeLine: 'Token Creature - Cat',
        });
        const regularCat = relatedToken('cat-regular', '', 'cat-regular.jpg');
        const lifelinkCat = relatedToken('cat-lifelink', 'Lifelink', 'cat-lifelink.jpg');
        const catalog = gameSessionCardCatalogFromDeckSelections([{
            cards: [{
                name: 'Cat makers',
                selectedOption: {
                    id: 'cat-makers',
                    relatedTokens: [regularCat, lifelinkCat],
                    typeLine: 'Sorcery',
                },
            }],
        }]);
        const base = sessionView();
        const projected = projectGameSessionView(sessionView({
            state: {
                ...base.state,
                players: [{
                    ...base.state.players[0],
                    battlefield: [{
                        controller: 'player-1',
                        definition: {
                            id: 'cat-lifelink',
                            isGamePiece: true,
                            isToken: true,
                            manaCost: '',
                            name: 'Cat',
                            power: '1',
                            rules: [],
                            toughness: '1',
                            typeLine: 'Token Creature - Cat',
                        },
                        instanceId: 'player-1:token:cat-lifelink',
                        owner: 'player-1',
                        tapped: false,
                    }],
                    hand: [],
                }],
            },
        }), { cardCatalog: catalog, playerRoles: ['human'] });

        expect(catalog['cat-regular'].imageUrl).toBe('cat-regular.jpg');
        expect(catalog['cat-lifelink'].imageUrl).toBe('cat-lifelink.jpg');
        expect(projected.players[0].zones.battlefield.creatures[0].imageUrl)
            .toBe('cat-lifelink.jpg');
    });

    test('Feature: An animated land stays one permanent and exposes its current power/toughness.', () => {
        const base = sessionView();
        const hall = {
            controller: 'player-1',
            counters: { '+1/+1': 1 },
            definition: {
                id: 'great-hall',
                manaCost: '',
                name: 'Great Hall of the Biblioplex',
                power: '2',
                rules: [],
                toughness: '4',
                typeLine: 'Land Creature - Wizard',
            },
            instanceId: 'player-1:great-hall',
            owner: 'player-1',
            powerModifier: 1,
            tapped: false,
            toughnessModifier: 0,
        };
        const projected = projectGameSessionView(sessionView({
            state: {
                ...base.state,
                players: [{
                    ...base.state.players[0],
                    battlefield: [hall],
                    hand: [],
                }],
            },
        }));
        const battlefield = projected.players[0].zones.battlefield;

        expect(battlefield.lands).toHaveLength(0);
        expect(battlefield.creatures).toHaveLength(1);
        expect(battlefield.nonCreaturePermanents).toHaveLength(0);
        expect(battlefield.creatures[0]).toEqual(expect.objectContaining({
            currentPower: 4,
            currentToughness: 5,
            id: 'player-1:great-hall',
            power: '2',
            toughness: '4',
        }));
    });

    test('Feature: Planeswalkers are projected with other noncreature permanents.', () => {
        const base = sessionView();
        const planeswalker = {
            controller: 'player-1',
            definition: {
                id: 'jace-the-mind-sculptor',
                name: 'Jace, the Mind Sculptor',
                manaCost: '{2}{U}{U}',
                rules: [],
                typeLine: 'Legendary Planeswalker — Jace',
            },
            instanceId: 'player-1:jace-the-mind-sculptor',
            owner: 'player-1',
            tapped: false,
        };
        const projected = projectGameSessionView(sessionView({
            state: {
                ...base.state,
                players: [{
                    ...base.state.players[0],
                    battlefield: [planeswalker],
                    hand: [],
                }],
            },
        }));
        const battlefield = projected.players[0].zones.battlefield;

        expect(battlefield.creatures).toHaveLength(0);
        expect(battlefield.lands).toHaveLength(0);
        expect(battlefield.nonCreaturePermanents).toHaveLength(1);
        expect(battlefield.nonCreaturePermanents[0].name).toBe('Jace, the Mind Sculptor');
    });

    test('Feature: A joined network seat authenticates every subsequent session request.', async () => {
        const access = {
            inviteCode: 'ABCDEFGH',
            isHost: false,
            playerId: 'player-2',
            seatToken: 'seat-token-2',
        };
        const bootstrap = {
            cardCatalog: {},
            networkAccess: access,
            schemaVersion: 'mtg-game-bootstrap/v1',
            session: sessionView({ decision: undefined }),
        };
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce({ json: async () => bootstrap, ok: true })
            .mockResolvedValueOnce({ json: async () => bootstrap.session, ok: true })
            .mockResolvedValueOnce({ json: async () => ({ ok: true }), ok: true });
        const client = createGameSessionClient({
            baseUrl: 'http://engine.test',
            fetchImpl,
        });

        await expect(client.joinNetworkGame('abcdefgh')).resolves.toEqual(expect.objectContaining({
            networkAccess: access,
        }));
        await client.read('game-session:1');
        await client.leaveNetworkGame('game-session:1');

        expect(fetchImpl).toHaveBeenNthCalledWith(
            1,
            'http://engine.test/game/sessions/join',
            expect.objectContaining({
                body: JSON.stringify({
                    inviteCode: 'ABCDEFGH',
                    playerId: null,
                    seatToken: null,
                    username: null,
                }),
            }),
        );
        expect(fetchImpl).toHaveBeenNthCalledWith(
            2,
            'http://engine.test/game/sessions/game-session:1',
            {
                headers: {
                    'X-MTG-Player-ID': 'player-2',
                    'X-MTG-Seat-Token': 'seat-token-2',
                },
                method: 'GET',
            },
        );
        expect(fetchImpl).toHaveBeenNthCalledWith(
            3,
            'http://engine.test/game/sessions/game-session:1/leave',
            {
                headers: {
                    'X-MTG-Player-ID': 'player-2',
                    'X-MTG-Seat-Token': 'seat-token-2',
                },
                method: 'POST',
            },
        );
        expect(client.seatAccess()).toBeNull();
    });

    test('Feature: A network host receives and retains its seat credentials at creation.', async () => {
        const access = {
            inviteCode: 'HOSTCODE',
            isHost: true,
            playerId: 'player-1',
            seatToken: 'host-token',
        };
        const fetchImpl = vi.fn().mockResolvedValue({
            json: async () => ({
                cardCatalog: {},
                networkAccess: access,
                schemaVersion: 'mtg-game-bootstrap/v1',
                session: sessionView(),
            }),
            ok: true,
        });
        const client = createGameSessionClient({ baseUrl: 'http://engine.test', fetchImpl });

        const result = await client.createFromLocalDecks({ networkMultiplayer: true });

        expect(result.networkAccess).toEqual(access);
        expect(client.seatAccess()).toEqual(access);
    });

    test('Feature: Rust-calculated continuous bonuses override the printed battlefield stats.', () => {
        const base = sessionView();
        const lecturer = {
            controller: 'player-1',
            counters: {},
            definition: {
                id: 'topiary-lecturer',
                manaCost: '{2}{G}',
                name: 'Topiary Lecturer',
                power: '1',
                rules: [],
                toughness: '2',
                typeLine: 'Creature — Elf Druid',
            },
            instanceId: 'player-1:topiary-lecturer',
            owner: 'player-1',
            tapped: false,
        };
        const projected = projectGameSessionView(sessionView({
            calculatedStats: {
                'player-1:topiary-lecturer': {
                    currentPower: 2,
                    currentToughness: 3,
                },
            },
            state: {
                ...base.state,
                players: [{
                    ...base.state.players[0],
                    battlefield: [lecturer],
                    hand: [],
                }],
            },
        }));
        const card = projected.players[0].zones.battlefield.creatures[0];

        expect(card.currentPower).toBe(2);
        expect(card.currentToughness).toBe(3);
    });

    test('Feature: Alexios counters accumulate in the projected stats and remain available to the UI.', () => {
        const base = sessionView();
        const alexios = {
            controller: 'player-2',
            counters: { '+1/+1': 3 },
            definition: {
                id: 'alexios',
                manaCost: '{3}{R}',
                name: 'Alexios, Deimos of Kosmos',
                power: '4',
                rules: [],
                toughness: '4',
                typeLine: 'Legendary Creature — Human Berserker',
            },
            instanceId: 'player-1:alexios',
            owner: 'player-1',
            tapped: false,
        };
        const projected = projectGameSessionView(sessionView({
            state: {
                ...base.state,
                players: [
                    {
                        ...base.state.players[0],
                        battlefield: [],
                        hand: [],
                    },
                    {
                        ...base.state.players[0],
                        battlefield: [alexios],
                        hand: [],
                        id: 'player-2',
                        name: 'Opponent',
                    },
                ],
            },
        }));
        const card = projected.players[1].zones.battlefield.creatures[0];

        expect(card.currentPower).toBe(7);
        expect(card.currentToughness).toBe(7);
        expect(card.state.counters).toEqual({ '+1/+1': 3 });
    });

    test('Feature: Rust card-selection decisions project the exact offered card combinations.', () => {
        const base = sessionView();
        const libraryCard = (id, name) => ({
            controller: 'player-1',
            definition: {
                id,
                manaCost: '',
                name,
                rules: [],
                typeLine: 'Instant',
            },
            instanceId: `player-1:${id}`,
            owner: 'player-1',
            tapped: false,
        });
        const projected = projectGameSessionView(sessionView({
            decision: {
                choice: {
                    candidateCardInstanceIds: [
                        'player-1:charted-one',
                        'player-1:charted-two',
                    ],
                    decisionId: 'cardsForHand',
                    kind: 'cardSelection',
                    maximum: 1,
                    minimum: 1,
                },
                id: 'resolution:stack:1:cardsForHand',
                kind: 'resolutionChoice',
                options: [
                    {
                        cardInstanceId: 'player-1:consult',
                        decisions: { cardsForHand: ['player-1:charted-one'] },
                        id: 'resolve:stack:1:cardsForHand:0',
                        kind: 'chooseResolution',
                        label: 'Choose Charted One',
                        playerId: 'player-1',
                    },
                    {
                        cardInstanceId: 'player-1:consult',
                        decisions: { cardsForHand: ['player-1:charted-two'] },
                        id: 'resolve:stack:1:cardsForHand:1',
                        kind: 'chooseResolution',
                        label: 'Choose Charted Two',
                        playerId: 'player-1',
                    },
                ],
                playerId: 'player-1',
                sourceCardInstanceId: 'player-1:consult',
            },
            state: {
                ...base.state,
                players: [{
                    ...base.state.players[0],
                    hand: [],
                    library: [
                        libraryCard('charted-one', 'Charted One'),
                        libraryCard('charted-two', 'Charted Two'),
                    ],
                }],
            },
        }), {
            cardCatalog: {
                'charted-one': { imageUrl: 'charted-one.jpg' },
                'charted-two': { imageUrl: 'charted-two.jpg' },
            },
            playerRoles: ['human'],
        });

        expect(projected.resolutionCardChoice).toEqual({
            cards: [
                expect.objectContaining({
                    id: 'player-1:charted-one',
                    imageUrl: 'charted-one.jpg',
                    name: 'Charted One',
                }),
                expect.objectContaining({
                    id: 'player-1:charted-two',
                    imageUrl: 'charted-two.jpg',
                    name: 'Charted Two',
                }),
            ],
            decisionId: 'cardsForHand',
            kind: 'cardSelection',
            maximum: 1,
            minimum: 1,
            options: [
                {
                    actionId: 'resolve:stack:1:cardsForHand:0',
                    cardInstanceIds: ['player-1:charted-one'],
                },
                {
                    actionId: 'resolve:stack:1:cardsForHand:1',
                    cardInstanceIds: ['player-1:charted-two'],
                },
            ],
            prompt: 'Choose cards for this effect.',
        });
    });

    test('Feature: Sideboarding projects the current main deck as the initial selection.', () => {
        const base = sessionView();
        const card = (id, name) => ({
            controller: 'player-1',
            definition: {
                id,
                manaCost: '{1}',
                name,
                rules: [],
                typeLine: 'Artifact',
            },
            instanceId: `player-1:${id}`,
            owner: 'player-1',
            tapped: false,
        });
        const mainOne = card('main-one', 'Repeated Card');
        const mainTwo = card('main-two', 'Repeated Card');
        const side = card('side-one', 'Sideboard Answer');
        const projected = projectGameSessionView(sessionView({
            decision: {
                choice: {
                    candidateCardInstanceIds: [
                        mainOne.instanceId,
                        mainTwo.instanceId,
                        side.instanceId,
                    ],
                    decisionId: 'sideboard:cards',
                    kind: 'cardSelection',
                    maximum: 3,
                    minimum: 2,
                    prompt: 'Compose the final main deck.',
                },
                id: 'sideboard:1:player-1:configure',
                kind: 'sideboarding',
                options: [{
                    decisions: { 'sideboard:cards': [] },
                    id: 'sideboard:1:player-1:configure:confirm',
                    kind: 'chooseResolution',
                    label: 'Confirm sideboard',
                    playerId: 'player-1',
                }],
                playerId: 'player-1',
            },
            state: {
                ...base.state,
                players: [{
                    ...base.state.players[0],
                    library: [mainOne, mainTwo],
                    sideboard: [side],
                }],
            },
        }), {
            cardCatalog: {
                'main-one': { imageUrl: 'repeated.jpg' },
                'main-two': { imageUrl: 'repeated.jpg' },
                'side-one': { imageUrl: 'side.jpg' },
            },
            playerRoles: ['human'],
        });

        expect(projected.resolutionCardChoice).toEqual(expect.objectContaining({
            initialSelectedCardIds: [mainOne.instanceId, mainTwo.instanceId],
            isSideboarding: true,
            maximum: 3,
            minimum: 2,
        }));
        expect(projected.resolutionCardChoice.cards).toEqual([
            expect.objectContaining({ id: mainOne.instanceId, sourceZone: 'mainDeck' }),
            expect.objectContaining({ id: mainTwo.instanceId, sourceZone: 'mainDeck' }),
            expect.objectContaining({ id: side.instanceId, sourceZone: 'sideboard' }),
        ]);
    });

    test('Feature: Rust card-order decisions preserve source context and exact sequence.', () => {
        const base = sessionView();
        const libraryCard = (id, name) => ({
            controller: 'player-1',
            definition: {
                id,
                manaCost: '',
                name,
                rules: [],
                typeLine: 'Instant',
            },
            instanceId: `player-1:${id}`,
            owner: 'player-1',
            tapped: false,
        });
        const sourceCard = libraryCard('stock-up', 'Stock Up');
        const projected = projectGameSessionView(sessionView({
            decision: {
                choice: {
                    cardInstanceIds: [
                        'player-1:first',
                        'player-1:second',
                        'player-1:third',
                    ],
                    decisionId: 'bottomOrder',
                    kind: 'cardOrder',
                    prompt: 'Order the remaining cards for the bottom of the library, bottommost first.',
                },
                id: 'resolution:stack:1:bottomOrder',
                kind: 'resolutionChoice',
                options: [{
                    cardInstanceId: sourceCard.instanceId,
                    decisions: {
                        bottomOrder: [
                            'player-1:second',
                            'player-1:first',
                            'player-1:third',
                        ],
                    },
                    id: 'resolve:stack:1:bottomOrder:0',
                    kind: 'chooseResolution',
                    label: 'Order cards: Second, First, Third',
                    playerId: 'player-1',
                }],
                playerId: 'player-1',
                sourceCard,
                sourceCardInstanceId: sourceCard.instanceId,
            },
            state: {
                ...base.state,
                players: [{
                    ...base.state.players[0],
                    hand: [],
                    library: [
                        libraryCard('first', 'First'),
                        libraryCard('second', 'Second'),
                        libraryCard('third', 'Third'),
                    ],
                }],
                stack: [],
            },
        }), {
            cardCatalog: {
                first: { imageUrl: 'first.jpg' },
                second: { imageUrl: 'second.jpg' },
                'stock-up': { imageUrl: 'stock-up.jpg' },
                third: { imageUrl: 'third.jpg' },
            },
            playerRoles: ['human'],
        });

        expect(projected.decisionSourceCard).toEqual(expect.objectContaining({
            id: 'player-1:stock-up',
            imageUrl: 'stock-up.jpg',
            name: 'Stock Up',
        }));
        expect(projected.resolutionCardChoice).toEqual({
            cards: [
                expect.objectContaining({ id: 'player-1:first', name: 'First' }),
                expect.objectContaining({ id: 'player-1:second', name: 'Second' }),
                expect.objectContaining({ id: 'player-1:third', name: 'Third' }),
            ],
            decisionId: 'bottomOrder',
            kind: 'cardOrder',
            maximum: 3,
            minimum: 3,
            options: [{
                actionId: 'resolve:stack:1:bottomOrder:0',
                cardInstanceIds: [
                    'player-1:second',
                    'player-1:first',
                    'player-1:third',
                ],
            }],
            prompt: 'Order the remaining cards for the bottom of the library, bottommost first.',
        });
    });
});
