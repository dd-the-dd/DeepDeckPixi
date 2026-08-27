import { defaultEngineBaseUrl } from './EngineBaseUrl.mjs';

const gameSessionSchemaVersion = 'mtg-game-session/v1';

function selectedCardData(card) {
    return card?.selectedOption ?? card ?? {};
}

function playableCardData(card) {
    const selected = selectedCardData(card);
    const primaryFace = ['flip', 'prepare', 'transform'].includes(selected.layout)
        ? selected.faces?.[0]
        : null;
    return primaryFace
        ? { ...selected, ...primaryFace, id: selected.id }
        : selected;
}

function playableCanonicalRules(card) {
    const selected = selectedCardData(card);
    const rules = card?.canonicalRules ?? selected.canonicalRules ?? [];
    if (selected.layout !== 'prepare') {
        return rules;
    }
    return rules.filter(rule => rule?.kind !== 'spellAbility');
}

function cardColorIdentity(card) {
    const selected = selectedCardData(card);
    const faces = selected.faces?.length ? selected.faces : [{ ...card, ...selected }];
    const colors = new Set();
    const collectManaSymbols = text => {
        for (const symbol of String(text ?? '').matchAll(/\{([^}]+)\}/gu)) {
            for (const color of symbol[1].toUpperCase().match(/[WUBRG]/gu) ?? []) {
                colors.add(color);
            }
        }
    };
    const collectLandTypes = typeLine => {
        const normalized = String(typeLine ?? '').toLowerCase();
        if (!/(?:^|\W)land(?:\W|$)/u.test(normalized)) {
            return;
        }
        for (const [landType, color] of [
            ['plains', 'W'],
            ['island', 'U'],
            ['swamp', 'B'],
            ['mountain', 'R'],
            ['forest', 'G'],
        ]) {
            if (new RegExp(`(?:^|\\W)${landType}(?:\\W|$)`, 'u').test(normalized)) {
                colors.add(color);
            }
        }
    };
    for (const face of faces) {
        collectManaSymbols(face.manaCost);
        collectManaSymbols(String(face.oracleText ?? '').replace(/\([^)]*\)/gu, ''));
        collectLandTypes(face.typeLine);
    }
    return ['W', 'U', 'B', 'R', 'G'].filter(color => colors.has(color));
}

function positiveQuantity(card) {
    const quantity = Number(card?.quantity ?? 1);
    return Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : 1;
}

function cardDefinitionId(card, playerIndex, cardIndex) {
    const selected = selectedCardData(card);
    return String(
        selected.id ??
        selected.oracleId ??
        card?.id ??
        card?.oracleId ??
        `player-${playerIndex + 1}:definition-${cardIndex + 1}`,
    );
}

function cardDefinition(card, playerIndex, cardIndex) {
    const selected = selectedCardData(card);
    const playable = playableCardData(card);
    const usesPrimaryFace = ['flip', 'prepare', 'transform'].includes(selected.layout);
    const section = String(card?.section ?? selected?.section ?? '').trim().toLowerCase();
    const isCommander = Boolean(
        card?.isCommander ||
        selected?.isCommander ||
        section === 'commander' ||
        section === 'commanders',
    );
    const rules = playableCanonicalRules(card);
    const relatedTokenOracle = Array.isArray(selected.relatedTokens)
        ? selected.relatedTokens.filter(token => token?.name && token?.typeLine)
        : [];
    const rulesWithIdentity = [
        ...rules,
        ...(relatedTokenOracle.length > 0
            ? [{
                kind: 'rulesMarker',
                relatedTokenOracle,
                text: 'Source-linked token definitions',
            }]
            : []),
        {
            colorIdentity: cardColorIdentity(card),
            kind: 'rulesMarker',
            text: 'Color identity',
        },
    ];
    return {
        id: cardDefinitionId(card, playerIndex, cardIndex),
        isCommander,
        isGamePiece: Boolean(card?.isGamePiece || selected.isGamePiece),
        isSideboard: Boolean(card?.isSideboard || selected.isSideboard),
        isToken: Boolean(card?.isToken || selected.isToken),
        manaCost: playable.manaCost ?? card?.manaCost ?? '',
        name: usesPrimaryFace
            ? playable.name ?? card?.name ?? `Card ${cardIndex + 1}`
            : card?.name ?? playable.name ?? `Card ${cardIndex + 1}`,
        power: playable.power ?? card?.power ?? null,
        rules: isCommander
            ? [...rulesWithIdentity, { kind: 'rulesMarker', source: { kind: 'self' }, text: 'Commander' }]
            : rulesWithIdentity,
        toughness: playable.toughness ?? card?.toughness ?? null,
        typeLine: playable.typeLine ?? card?.typeLine ?? '',
    };
}

function cardCatalogMetadata(card) {
    const selected = selectedCardData(card);
    return {
        ...card,
        ...selected,
        canonicalRules: card?.canonicalRules ?? selected.canonicalRules ?? [],
        imageUrl: selected.imageUrl ??
            selected.urlFront ??
            card?.imageUrl ??
            card?.urlFront ??
            '',
    };
}

function cardPresentationKey(name) {
    const normalized = String(name ?? '')
        .normalize('NFKC')
        .trim()
        .toLocaleLowerCase('en-US')
        .replace(/\s+/gu, ' ');
    return normalized ? `card-art:${normalized}` : '';
}

function registerCardPresentation(catalog, metadata, ...names) {
    for (const name of names) {
        const key = cardPresentationKey(name);
        if (key) {
            catalog[key] ??= metadata;
        }
    }
}

function normalizedTokenName(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+token$/u, '')
        .replace(/\s+/gu, ' ');
}

function normalizedTokenTypeLine(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/\btoken\b/gu, '')
        .replace(/[\u2013\u2014-]+/gu, ' ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .replace(/\s+/gu, ' ');
}

function tokenPresentationKeys(card) {
    const name = normalizedTokenName(card?.name);
    if (!name) {
        return [];
    }

    const typeLine = normalizedTokenTypeLine(card?.typeLine);
    const power = card?.power ?? '';
    const toughness = card?.toughness ?? '';
    const stats = power !== '' || toughness !== '' ? `${power}/${toughness}` : '';
    return [
        typeLine && stats ? `token-art:${name}:${typeLine}:${stats}` : '',
        stats ? `token-art:${name}:${stats}` : '',
        typeLine ? `token-art:${name}:${typeLine}` : '',
        `token-art:${name}`,
    ].filter((key, index, keys) => key && keys.indexOf(key) === index);
}

function isTokenMetadata(card) {
    return Boolean(card?.isToken || /^\s*token\b/iu.test(card?.typeLine ?? ''));
}

function registerTokenPresentation(catalog, metadata, playerId = '') {
    if (
        !isTokenMetadata(metadata) ||
        !(metadata.imageUrl || metadata.urlFront)
    ) {
        return;
    }

    for (const identity of [metadata.scryfallId, metadata.printingId, metadata.id]) {
        if (identity) {
            catalog[String(identity)] ??= metadata;
        }
    }

    for (const key of tokenPresentationKeys(metadata)) {
        if (playerId) {
            catalog[`${playerId}:${key}`] ??= metadata;
        }
        catalog[key] ??= metadata;
    }
}

export function expandedDeckDefinitions(cards, playerIndex) {
    return cards.flatMap((card, cardIndex) => {
        const definition = cardDefinition(card, playerIndex, cardIndex);
        return Array.from({ length: positiveQuantity(card) }, () => ({ ...definition }));
    });
}

function defaultBaseUrl() {
    return defaultEngineBaseUrl();
}

async function responseError(response) {
    try {
        const body = await response.json();
        return body.error ?? `Rust game engine returned HTTP ${response.status}.`;
    } catch {
        return `Rust game engine returned HTTP ${response.status}.`;
    }
}

function validateSessionView(view) {
    if (view?.schemaVersion !== gameSessionSchemaVersion) {
        throw new Error(
            `Unsupported Rust game session schema: ${view?.schemaVersion ?? 'missing'}.`,
        );
    }
    return view;
}

function validateNetworkLobby(lobby) {
    if (lobby?.schemaVersion !== 'mtg-network-lobby/v1') {
        throw new Error(`Unsupported network lobby: ${lobby?.schemaVersion ?? 'missing'}.`);
    }
    return lobby;
}

function sessionPath(baseUrl, sessionId, suffix = '') {
    const normalizedId = String(sessionId ?? '');
    if (!normalizedId || normalizedId.includes('/')) {
        throw new Error('Invalid Rust game session ID.');
    }
    return `${baseUrl}/game/sessions/${normalizedId}${suffix}`;
}

export function gameSessionRequestFromDeckSelections(selections, options = {}) {
    const roles = (options.playerRoles ?? []).map(role => {
        if (role === 'ai') {
            return 'ai-random';
        }
        if (role === 'ia-ground-truth') {
            return 'ia-gt-0';
        }
        return role;
    });
    const players = selections.map((selection, playerIndex) => ({
        cards: expandedDeckDefinitions(selection.cards ?? [], playerIndex),
        id: `player-${playerIndex + 1}`,
        name: selection.name || `Player ${playerIndex + 1}`,
        startingLife: Number(options.startingLife ?? 20),
    }));
    const humanPlayerIds = players
        .filter((_, playerIndex) => (roles[playerIndex] ?? 'human') === 'human')
        .map(player => player.id);
    const aiControllerByPlayerId = Object.fromEntries(players.flatMap((player, playerIndex) => {
        const role = roles[playerIndex];
        return role?.startsWith('ia-')
            ? [[player.id, role]]
            : [];
    }));
    const analyticsPilotByPlayerId = Object.fromEntries(players.map((player, playerIndex) => {
        const role = roles[playerIndex] ?? 'human';
        const pilotId = role === 'human'
            ? options.humanPilotId ?? 'human'
            : role === 'ia-in-training' ? 'ia-v6-in-training' : role;
        return [player.id, pilotId];
    }));

    return {
        aiControllerByPlayerId,
        analyticsContextId: options.analyticsContextId ?? 'player-match',
        analyticsPilotByPlayerId,
        freeMulligans: Number(options.freeMulligans ?? 0),
        gameMode: options.gameMode ?? 'free',
        holdPriorityPlayerIds: options.holdPriority ? humanPlayerIds : [],
        humanPlayerIds,
        maxTurns: Number(options.maxTurns ?? 200),
        mulliganEnabled: Boolean(options.mulliganEnabled),
        seed: Number(options.seed ?? 1),
        setup: {
            openingHandSize: Number(options.openingHandSize ?? 7),
            players,
            startingPlayer: Number(options.startingPlayer ?? 0),
        },
    };
}

export function gameSessionRequestFromLocalDecks(selections, options = {}) {
    const roles = (options.playerRoles ?? []).map(role => {
        if (role === 'ai') {
            return 'ai-random';
        }
        if (role === 'ia-ground-truth') {
            return 'ia-gt-0';
        }
        return role;
    });
    const players = selections.map((selection, playerIndex) => ({
        deckSessionId: String(selection.id ?? ''),
        id: `player-${playerIndex + 1}`,
        name: selection.name || `Player ${playerIndex + 1}`,
        startingLife: Number(options.startingLife ?? 20),
    }));
    const humanPlayerIds = players
        .filter((_, playerIndex) => (roles[playerIndex] ?? 'human') === 'human')
        .map(player => player.id);
    const aiControllerByPlayerId = Object.fromEntries(players.flatMap((player, playerIndex) => {
        const role = roles[playerIndex];
        return role?.startsWith('ia-')
            ? [[player.id, role]]
            : [];
    }));
    const analyticsPilotByPlayerId = Object.fromEntries(players.map((player, playerIndex) => {
        const role = roles[playerIndex] ?? 'human';
        const pilotId = role === 'human'
            ? options.humanPilotId ?? 'human'
            : role === 'ia-in-training' ? 'ia-v8-in-training' : role;
        return [player.id, pilotId];
    }));
    return {
        aiControllerByPlayerId,
        analyticsContextId: options.analyticsContextId ?? 'player-match',
        analyticsPilotByPlayerId,
        freeMulligans: Number(options.freeMulligans ?? 0),
        gameMode: options.gameMode ?? 'free',
        holdPriorityPlayerIds: options.holdPriority ? humanPlayerIds : [],
        humanPlayerIds,
        maxMulligans: options.maxMulligans == null
            ? null
            : Number(options.maxMulligans),
        maxTurns: Number(options.maxTurns ?? 200),
        mulliganEnabled: Boolean(options.mulliganEnabled),
        networkMultiplayer: Boolean(options.networkMultiplayer),
        hostPlayerId: options.hostPlayerId ?? null,
        hostUsername: options.hostUsername ?? null,
        openingHandSize: Number(options.openingHandSize ?? 7),
        players,
        seed: Number(options.seed ?? 1),
        startingPlayer: Number(options.startingPlayer ?? 0),
    };
}

export function gameSessionCardCatalogFromDeckSelections(selections, gamePieces = []) {
    const catalog = {};
    selections.forEach((selection, playerIndex) => {
        (selection.cards ?? []).forEach((card, cardIndex) => {
            const id = cardDefinitionId(card, playerIndex, cardIndex);
            const metadata = cardCatalogMetadata(card);
            catalog[id] = metadata;
            registerCardPresentation(
                catalog,
                metadata,
                card?.name,
                selectedCardData(card)?.name,
                selectedCardData(card)?.flavorName,
                metadata.name,
                metadata.flavorName,
            );
            for (const face of selectedCardData(card).faces ?? []) {
                if (!face.id) {
                    continue;
                }
                catalog[face.id] = {
                    ...metadata,
                    ...face,
                    imageUrl: face.imageUrl ??
                        face.urlFront ??
                        metadata.imageUrl ??
                        metadata.urlFront ??
                        '',
                };
                registerCardPresentation(
                    catalog,
                    catalog[face.id],
                    face.name,
                    face.flavorName,
                );
            }
            registerTokenPresentation(catalog, metadata, `player-${playerIndex + 1}`);
            for (const relatedToken of selectedCardData(card).relatedTokens ?? []) {
                registerTokenPresentation(
                    catalog,
                    cardCatalogMetadata({
                        ...relatedToken,
                        isGamePiece: true,
                        isToken: true,
                    }),
                    `player-${playerIndex + 1}`,
                );
            }
        });
    });
    gamePieces.forEach(gamePiece => {
        registerTokenPresentation(catalog, cardCatalogMetadata(gamePiece));
    });
    return catalog;
}

export function createGameSessionClient(options = {}) {
    const baseUrl = (options.baseUrl ?? defaultBaseUrl()).replace(/\/$/u, '');
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    let seatAccess = options.seatAccess ?? null;

    if (typeof fetchImpl !== 'function') {
        throw new Error('Fetch is unavailable for the Rust game engine client.');
    }

    const request = async (url, requestOptions = {}) => {
        const response = await fetchImpl(url, {
            ...requestOptions,
            headers: {
                ...(requestOptions.headers ?? {}),
                ...(seatAccess ? {
                    'X-MTG-Player-ID': seatAccess.playerId,
                    'X-MTG-Seat-Token': seatAccess.seatToken,
                } : {}),
            },
        });
        if (!response.ok) {
            throw new Error(await responseError(response));
        }
        return validateSessionView(await response.json());
    };

    return {
        seatAccess() {
            return seatAccess ? { ...seatAccess } : null;
        },
        setSeatAccess(access) {
            seatAccess = access ? { ...access } : null;
        },
        async listAiControllers() {
            const response = await fetchImpl(`${baseUrl}/ai/controllers`);
            if (!response.ok) {
                throw new Error(await responseError(response));
            }
            const catalog = await response.json();
            if (catalog?.schemaVersion !== 'ai-controller-catalog/v1') {
                throw new Error(
                    `Unsupported AI controller catalog: ${catalog?.schemaVersion ?? 'missing'}.`,
                );
            }
            return catalog.controllers ?? [];
        },
        async listGameFormats() {
            const response = await fetchImpl(`${baseUrl}/game/formats`);
            if (!response.ok) {
                throw new Error(await responseError(response));
            }
            const catalog = await response.json();
            if (catalog?.schemaVersion !== 'mtg-game-format-catalog/v1') {
                throw new Error(
                    `Unsupported game format catalog: ${catalog?.schemaVersion ?? 'missing'}.`,
                );
            }
            return catalog;
        },
        async listLegalDecks(request) {
            const response = await fetchImpl(`${baseUrl}/game/decks/legal`, {
                body: JSON.stringify(request),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            });
            if (!response.ok) {
                throw new Error(await responseError(response));
            }
            const catalog = await response.json();
            if (catalog?.schemaVersion !== 'mtg-legal-deck-catalog/v1') {
                throw new Error(
                    `Unsupported legal deck catalog: ${catalog?.schemaVersion ?? 'missing'}.`,
                );
            }
            return catalog;
        },
        async findPlayMatch(request) {
            const response = await fetchImpl(`${baseUrl}/game/matchmaking`, {
                body: JSON.stringify(request),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            });
            if (!response.ok) {
                throw new Error(await responseError(response));
            }
            const match = await response.json();
            if (match?.schemaVersion !== 'mtg-play-matchmaking/v1') {
                throw new Error(
                    `Unsupported play matchmaking response: ${match?.schemaVersion ?? 'missing'}.`,
                );
            }
            return match;
        },
        async close(sessionId) {
            const response = await fetchImpl(sessionPath(baseUrl, sessionId), {
                ...(seatAccess ? {
                    headers: {
                        'X-MTG-Player-ID': seatAccess.playerId,
                        'X-MTG-Seat-Token': seatAccess.seatToken,
                    },
                } : {}),
                method: 'DELETE',
            });
            if (!response.ok) {
                throw new Error(await responseError(response));
            }
            return response.json();
        },
        async leaveNetworkGame(sessionId) {
            const response = await fetchImpl(sessionPath(baseUrl, sessionId, '/leave'), {
                headers: seatAccess ? {
                    'X-MTG-Player-ID': seatAccess.playerId,
                    'X-MTG-Seat-Token': seatAccess.seatToken,
                } : {},
                method: 'POST',
            });
            if (!response.ok) {
                throw new Error(await responseError(response));
            }
            seatAccess = null;
            return response.json();
        },
        create(createRequest) {
            return request(`${baseUrl}/game/sessions`, {
                body: JSON.stringify(createRequest),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            });
        },
        async createFromLocalDecks(createRequest) {
            const response = await fetchImpl(`${baseUrl}/game/sessions/from-local-decks`, {
                body: JSON.stringify(createRequest),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            });
            if (!response.ok) {
                throw new Error(await responseError(response));
            }
            const bootstrap = await response.json();
            if (bootstrap?.schemaVersion !== 'mtg-game-bootstrap/v1') {
                throw new Error(
                    `Unsupported Rust game bootstrap: ${bootstrap?.schemaVersion ?? 'missing'}.`,
                );
            }
            if (bootstrap.networkAccess) {
                seatAccess = { ...bootstrap.networkAccess };
            }
            return {
                cardCatalog: bootstrap.cardCatalog ?? {},
                networkAccess: bootstrap.networkAccess ?? null,
                session: validateSessionView(bootstrap.session),
            };
        },
        async joinNetworkGame(inviteCode, playerId = null, seatToken = null, username = null) {
            const response = await fetchImpl(`${baseUrl}/game/sessions/join`, {
                body: JSON.stringify({
                    inviteCode: String(inviteCode ?? '').trim().toUpperCase(),
                    playerId: playerId || null,
                    seatToken: seatToken || null,
                    username: username || null,
                }),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            });
            if (!response.ok) {
                throw new Error(await responseError(response));
            }
            const bootstrap = await response.json();
            if (bootstrap?.schemaVersion !== 'mtg-game-bootstrap/v1') {
                throw new Error(
                    `Unsupported Rust game bootstrap: ${bootstrap?.schemaVersion ?? 'missing'}.`,
                );
            }
            seatAccess = bootstrap.networkAccess ? { ...bootstrap.networkAccess } : null;
            return {
                cardCatalog: bootstrap.cardCatalog ?? {},
                networkAccess: seatAccess ? { ...seatAccess } : null,
                session: validateSessionView(bootstrap.session),
            };
        },
        async createNetworkLobby(createRequest) {
            const response = await fetchImpl(`${baseUrl}/game/lobbies`, {
                body: JSON.stringify(createRequest),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            });
            if (!response.ok) throw new Error(await responseError(response));
            const lobby = validateNetworkLobby(await response.json());
            seatAccess = { ...lobby.access };
            return lobby;
        },
        async joinNetworkLobby(inviteCode, username, playerId = null, seatToken = null) {
            const response = await fetchImpl(`${baseUrl}/game/lobbies/join`, {
                body: JSON.stringify({ inviteCode, playerId, seatToken, username }),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            });
            if (!response.ok) throw new Error(await responseError(response));
            const lobby = validateNetworkLobby(await response.json());
            seatAccess = { ...lobby.access };
            return lobby;
        },
        async readNetworkLobby(inviteCode) {
            const response = await fetchImpl(`${baseUrl}/game/lobbies/${inviteCode}`, {
                headers: seatAccess ? {
                    'X-MTG-Player-ID': seatAccess.playerId,
                    'X-MTG-Seat-Token': seatAccess.seatToken,
                } : {},
            });
            if (!response.ok) throw new Error(await responseError(response));
            return validateNetworkLobby(await response.json());
        },
        async updateNetworkLobbySeat(inviteCode, update) {
            const response = await fetchImpl(`${baseUrl}/game/lobbies/${inviteCode}/seat`, {
                body: JSON.stringify(update),
                headers: {
                    'Content-Type': 'application/json',
                    'X-MTG-Player-ID': seatAccess?.playerId ?? '',
                    'X-MTG-Seat-Token': seatAccess?.seatToken ?? '',
                },
                method: 'PUT',
            });
            if (!response.ok) throw new Error(await responseError(response));
            return validateNetworkLobby(await response.json());
        },
        async updateNetworkLobbyDeck(inviteCode, deckSessionId, playerId = null) {
            return this.updateNetworkLobbySeat(inviteCode, { deckSessionId, playerId });
        },
        async leaveNetworkLobby(inviteCode) {
            const response = await fetchImpl(`${baseUrl}/game/lobbies/${inviteCode}/leave`, {
                headers: {
                    'X-MTG-Player-ID': seatAccess?.playerId ?? '',
                    'X-MTG-Seat-Token': seatAccess?.seatToken ?? '',
                },
                method: 'POST',
            });
            if (!response.ok) throw new Error(await responseError(response));
            seatAccess = null;
            return response.json();
        },
        async startNetworkLobby(inviteCode) {
            const response = await fetchImpl(`${baseUrl}/game/lobbies/${inviteCode}/start`, {
                headers: {
                    'X-MTG-Player-ID': seatAccess?.playerId ?? '',
                    'X-MTG-Seat-Token': seatAccess?.seatToken ?? '',
                },
                method: 'POST',
            });
            if (!response.ok) throw new Error(await responseError(response));
            const bootstrap = await response.json();
            if (bootstrap?.schemaVersion !== 'mtg-game-bootstrap/v1') {
                throw new Error(
                    `Unsupported Rust game bootstrap: ${bootstrap?.schemaVersion ?? 'missing'}.`,
                );
            }
            seatAccess = { ...bootstrap.networkAccess };
            return { ...bootstrap, session: validateSessionView(bootstrap.session) };
        },
        async validateSetup(validationRequest) {
            const response = await fetchImpl(`${baseUrl}/game/setups/validate`, {
                body: JSON.stringify(validationRequest),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            });
            if (!response.ok) {
                throw new Error(await responseError(response));
            }
            const result = await response.json();
            if (typeof result?.valid !== 'boolean') {
                throw new Error('Invalid game setup validation response from Rust.');
            }
            return result;
        },
        read(sessionId) {
            return request(sessionPath(baseUrl, sessionId), {
                method: 'GET',
            });
        },
        submitAction(view, actionId) {
            const decision = view?.decision;
            if (!decision) {
                return Promise.reject(new Error('The Rust game session is not awaiting a decision.'));
            }
            if (!(decision.options ?? []).some(action => action.id === actionId)) {
                return Promise.reject(
                    new Error(`Action ${actionId} is not offered by the Rust engine.`),
                );
            }

            return request(sessionPath(baseUrl, view.sessionId, '/actions'), {
                body: JSON.stringify({
                    actionId,
                    decisionId: decision.id,
                    revision: view.revision,
                }),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            });
        },
        submitCardSelection(view, cardInstanceIds) {
            const decision = view?.decision;
            const choice = decision?.choice;
            if (
                !['resolutionChoice', 'sideboarding'].includes(decision?.kind) ||
                !['cardSelection', 'cardOrder'].includes(choice?.kind)
            ) {
                return Promise.reject(
                    new Error('The Rust game session is not awaiting a card selection.'),
                );
            }
            const selected = [...(cardInstanceIds ?? [])].map(String);
            const candidates = choice.kind === 'cardOrder'
                ? choice.cardInstanceIds ?? []
                : choice.candidateCardInstanceIds ?? [];
            const minimum = choice.kind === 'cardOrder'
                ? candidates.length
                : Number(choice.minimum ?? 0);
            const maximum = choice.kind === 'cardOrder'
                ? candidates.length
                : Number(choice.maximum ?? 0);
            if (
                selected.length < minimum ||
                selected.length > maximum ||
                new Set(selected).size !== selected.length ||
                selected.some(instanceId => !candidates.includes(instanceId))
            ) {
                return Promise.reject(
                    new Error(`Invalid card selection for ${decision.id}.`),
                );
            }
            const action = decision.options?.[0];
            if (!action) {
                return Promise.reject(new Error('The card selection has no engine action.'));
            }
            return request(sessionPath(baseUrl, view.sessionId, '/actions'), {
                body: JSON.stringify({
                    actionId: action.id,
                    cardInstanceIds: selected,
                    decisionId: decision.id,
                    revision: view.revision,
                }),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            });
        },
        submitNumber(view, numberValue) {
            const decision = view?.decision;
            const choice = decision?.choice;
            if (choice?.kind !== 'numberSelection') {
                return Promise.reject(new Error('The Rust game session is not awaiting a number.'));
            }
            const minimum = Number(choice.minimum);
            const maximum = Number(choice.maximum);
            const selected = Number(numberValue);
            if (!Number.isInteger(selected) || selected < minimum || selected > maximum) {
                return Promise.reject(
                    new Error(`Number ${numberValue} is outside ${minimum}..${maximum}.`),
                );
            }
            const action = decision.options?.[0];
            if (!action) {
                return Promise.reject(new Error('The number decision has no engine action.'));
            }
            return request(sessionPath(baseUrl, view.sessionId, '/actions'), {
                body: JSON.stringify({
                    actionId: action.id,
                    decisionId: decision.id,
                    numberValue: selected,
                    revision: view.revision,
                }),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            });
        },
        updateSettings(sessionId, settings) {
            return request(sessionPath(baseUrl, sessionId, '/settings'), {
                body: JSON.stringify(settings),
                headers: { 'Content-Type': 'application/json' },
                method: 'PUT',
            });
        },
    };
}

function engineTargetKeysForActions(actions) {
    const keys = [];
    const seen = new Set();
    const append = key => {
        if (key && !seen.has(key)) {
            seen.add(key);
            keys.push(key);
        }
    };
    for (const action of actions) {
        for (const key of action.targetOrder ?? []) {
            append(key);
        }
    }
    for (const action of actions) {
        for (const key of Object.keys(action.targets ?? {})) {
            append(key);
        }
    }
    return keys;
}

function engineDeclarationSignature(action, targetKeys) {
    const targetKeySet = new Set(targetKeys);
    const decisions = Object.entries(action.decisions ?? {})
        .filter(([key]) => !targetKeySet.has(key))
        .sort(([left], [right]) => left.localeCompare(right));
    return JSON.stringify({
        attackerId: targetKeySet.has('attacker') ? null : action.attackerId ?? null,
        blockerId: action.blockerId ?? null,
        cardInstanceId: action.cardInstanceId ?? null,
        decisions,
        kind: action.kind,
        paymentSources: [...(action.paymentSources ?? [])].sort(),
        playerId: action.playerId ?? null,
    });
}

export function gameSessionActionPresentations(actions = []) {
    const targetKeys = engineTargetKeysForActions(actions);
    if (targetKeys.length === 0) {
        return actions;
    }

    const groups = new Map();
    for (const action of actions) {
        const signature = engineDeclarationSignature(action, targetKeys);
        const group = groups.get(signature) ?? [];
        group.push(action);
        groups.set(signature, group);
    }

    return [...groups.values()].map(exactActions => {
        const engineTargetKeys = engineTargetKeysForActions(exactActions);
        if (engineTargetKeys.length === 0) {
            return exactActions[0];
        }
        const representative = exactActions.find(action => {
            return Object.keys(action.targets ?? {}).length > 0;
        }) ?? exactActions[0];
        return {
            ...representative,
            engineTargetActions: exactActions,
            engineTargetKeys,
            targets: {},
        };
    });
}

export function gameSessionActionCardId(action = {}) {
    return action.cardInstanceId ??
        action.card_instance_id ??
        action.blockerId ??
        action.blocker_id ??
        action.attackerId ??
        action.attacker_id ??
        action.sourceCardInstanceId ??
        action.source_card_instance_id ??
        '';
}

function displayCard(instance, cardCatalog, actions, sourceZone = '', calculatedStats = {}) {
    const definition = instance.definition ?? {};
    const isCommander = Boolean(definition.isCommander) || (definition.rules ?? []).some(rule => {
        return rule?.kind === 'rulesMarker' && rule?.text === 'Commander';
    });
    const tokenKeys = definition.isToken ? tokenPresentationKeys(definition) : [];
    const playerScopes = [...new Set([instance.owner, instance.controller].filter(Boolean))];
    const scopedTokenMetadata = playerScopes
        .flatMap(playerId => tokenKeys.map(key => `${playerId}:${key}`))
        .map(key => cardCatalog[key])
        .find(Boolean);
    const globalTokenMetadata = tokenKeys
        .map(key => cardCatalog[key])
        .find(Boolean);
    const metadata = cardCatalog[definition.id] ??
        scopedTokenMetadata ??
        cardCatalog[cardPresentationKey(definition.name)] ??
        globalTokenMetadata ??
        {};
    const showingBackFace = Boolean(instance.flags?.transformed);
    const cardActions = actions.filter(action => {
        return gameSessionActionCardId(action) === instance.instanceId;
    });
    const presentationActions = gameSessionActionPresentations(cardActions);
    const counterModifier = Number(instance.counters?.['+1/+1'] ?? 0);
    const effectiveStats = calculatedStats[instance.instanceId] ?? null;
    const currentStat = (base, modifier) => {
        if (base === null || base === undefined) {
            return null;
        }
        const numericBase = Number(base);
        return (Number.isFinite(numericBase) ? numericBase : 0) +
            counterModifier +
            Number(modifier ?? 0);
    };
    return {
        ...metadata,
        canonicalRules: definition.rules ?? [],
        currentPower: effectiveStats?.currentPower ??
            currentStat(definition.power, instance.powerModifier),
        currentToughness: effectiveStats?.currentToughness ??
            currentStat(definition.toughness, instance.toughnessModifier),
        id: instance.instanceId,
        isCommander,
        imageUrl: showingBackFace
            ? metadata.urlBack ?? metadata.imageUrl ?? metadata.urlFront ?? ''
            : metadata.imageUrl ?? metadata.urlFront ?? '',
        manaCost: definition.manaCost ?? '',
        name: definition.name ?? metadata.name ?? 'Unknown card',
        power: definition.power ?? null,
        quantity: 1,
        ...(sourceZone && sourceZone !== 'hand' ? { sourceZone } : {}),
        state: {
            attachedTo: instance.attachedTo ?? null,
            attacking: Boolean(instance.flags?.attacking),
            blocking: Boolean(instance.flags?.blocking),
            counters: instance.counters ?? {},
            damageMarked: Number(instance.damageMarked ?? 0),
            powerModifier: Number(instance.powerModifier ?? 0),
            summoningSick: Boolean(instance.summoningSick),
            tapped: Boolean(instance.tapped),
            transformed: showingBackFace,
            toughnessModifier: Number(instance.toughnessModifier ?? 0),
        },
        toughness: definition.toughness ?? null,
        typeLine: definition.typeLine ?? '',
        actionState: {
            actionable: presentationActions.length > 0,
            actions: presentationActions.map(action => action.label),
            options: presentationActions,
        },
    };
}

function zoneView(instances, cardCatalog, actions, sourceZone) {
    const cards = instances.map(instance => {
        return displayCard(instance, cardCatalog, actions, sourceZone);
    });
    return {
        actionable: cards.some(card => card.actionState.actionable),
        cards,
        count: cards.length,
        top: cards.at(-1) ?? null,
    };
}

function battlefieldView(instances, cardCatalog, actions, calculatedStats = {}) {
    const cards = instances.map(instance => {
        return displayCard(instance, cardCatalog, actions, '', calculatedStats);
    });
    return {
        creatures: cards.filter(card => /\bcreature\b/iu.test(card.typeLine)),
        lands: cards.filter(card => {
            return /\bland\b/iu.test(card.typeLine) && !/\bcreature\b/iu.test(card.typeLine);
        }),
        nonCreaturePermanents: cards.filter(card => {
            return !/\bcreature\b/iu.test(card.typeLine) && !/\bland\b/iu.test(card.typeLine);
        }),
    };
}

function manaPoolView(manaPool = []) {
    return manaPool.reduce((symbols, mana) => {
        const symbol = String(mana?.symbol ?? '').toUpperCase();
        if (symbol) {
            symbols[symbol] = Number(symbols[symbol] ?? 0) + 1;
        }
        return symbols;
    }, {});
}

function stateCardInstance(state, instanceId) {
    for (const player of state.players ?? []) {
        for (const zone of [
            player.library,
            player.hand,
            player.battlefield,
            player.graveyard,
            player.exile,
            player.sideboard,
            player.commandZone,
        ]) {
            const card = (zone ?? []).find(candidate => candidate?.instanceId === instanceId);
            if (card) {
                return card;
            }
        }
    }
    return (state.stack ?? [])
        .map(stackObject => stackObject.card)
        .find(card => card?.instanceId === instanceId) ?? null;
}

function resolutionCardChoice(state, decision, cardCatalog) {
    const choice = decision?.choice;
    if (
        !['resolutionChoice', 'sideboarding'].includes(decision?.kind) ||
        !['cardOrder', 'cardSelection'].includes(choice?.kind)
    ) {
        return null;
    }

    const cardInstanceIds = choice.kind === 'cardOrder'
        ? choice.cardInstanceIds ?? []
        : choice.candidateCardInstanceIds ?? [];
    const isSideboarding = decision.kind === 'sideboarding';
    const sideboardCardInstanceIds = new Set(
        (state.players ?? []).flatMap(player => {
            return (player.sideboard ?? []).map(card => card.instanceId);
        }),
    );
    const cards = cardInstanceIds.flatMap(instanceId => {
        const instance = stateCardInstance(state, instanceId);
        const sourceZone = isSideboarding
            ? sideboardCardInstanceIds.has(instanceId) ? 'sideboard' : 'mainDeck'
            : '';
        return instance
            ? [displayCard(instance, cardCatalog, [], sourceZone)]
            : [];
    });
    const options = (decision.options ?? []).flatMap(action => {
        const cardInstanceIds = action.decisions?.[choice.decisionId];
        return action.kind === 'chooseResolution' && Array.isArray(cardInstanceIds)
            ? [{
                actionId: action.id,
                cardInstanceIds: [...cardInstanceIds],
            }]
            : [];
    });

    return {
        cards,
        decisionId: choice.decisionId,
        ...(isSideboarding
            ? {
                initialSelectedCardIds: cardInstanceIds.filter(instanceId => {
                    return !sideboardCardInstanceIds.has(instanceId);
                }),
                isSideboarding: true,
            }
            : {}),
        kind: choice.kind,
        maximum: choice.kind === 'cardOrder'
            ? cardInstanceIds.length
            : Number(choice.maximum ?? 0),
        minimum: choice.kind === 'cardOrder'
            ? cardInstanceIds.length
            : Number(choice.minimum ?? 0),
        options,
        prompt: choice.prompt ?? (
            choice.kind === 'cardOrder'
                ? 'Order the cards for this effect.'
                : 'Choose cards for this effect.'
        ),
    };
}

function resolutionBoardTargetChoice(state, decision) {
    const choice = decision?.choice;
    if (decision?.kind !== 'resolutionChoice' || choice?.kind !== 'optionSelection') {
        return null;
    }

    const targetKey = 'resolutionBoardTarget';
    const playerIds = new Set((state.players ?? []).map(player => player.id));
    const permanentIds = new Set(
        (state.players ?? []).flatMap(player => {
            return (player.battlefield ?? []).map(card => card.instanceId);
        }),
    );
    const actions = (decision.options ?? []).flatMap(action => {
        const selected = action.decisions?.[choice.decisionId];
        if (action.kind !== 'chooseResolution' || !Array.isArray(selected) || selected.length !== 1) {
            return [];
        }
        const selectedId = selected[0];
        const target = playerIds.has(selectedId)
            ? { player: { playerId: selectedId } }
            : permanentIds.has(selectedId)
                ? { permanent: { instanceId: selectedId } }
                : null;
        return target
            ? [{ ...action, targetOrder: [targetKey], targets: { [targetKey]: target } }]
            : [];
    });
    if (actions.length === 0 || actions.length !== (decision.options ?? []).length) {
        return null;
    }
    return {
        actions,
        prompt: choice.prompt ?? 'Choose a player or permanent.',
        targetKey,
    };
}

function phaseFromEngineStep(step, decisionKind) {
    if (decisionKind === 'mulligan' || decisionKind === 'mulliganBottom') {
        return 'mulligan';
    }
    if (step === 'cleanup') {
        return decisionKind === 'discard' ? 'discard' : 'end';
    }
    return {
        combatDamage: 'combat',
        declareAttackers: 'attack',
        declareBlockers: 'blockers',
        draw: 'draw',
        endStep: 'end',
        postcombatMain: 'secondMain',
        precombatMain: 'main',
        untap: 'untap',
        upkeep: 'upkeep',
    }[step] ?? step;
}

export function projectGameSessionView(view, options = {}) {
    validateSessionView(view);
    const state = view.state ?? {};
    const decision = view.decision ?? null;
    const actions = decision?.options ?? [];
    const cardCatalog = options.cardCatalog ?? {};
    const roles = options.playerRoles ?? [];
    const roleByPlayerId = options.playerRoleById ?? {};
    const revealedHandPlayerIds = new Set(
        (state.ruleModifiers ?? [])
            .filter(modifier => {
                return modifier?.kind === 'revealedHand' &&
                    Number(modifier.expiresAfterTurn ?? state.turnNumber) >=
                        Number(state.turnNumber ?? 0);
            })
            .map(modifier => modifier.playerId)
            .filter(Boolean),
    );
    const linkedExileSourceByCardId = new Map(
        (state.ruleModifiers ?? []).flatMap(modifier => {
            if (
                !['exiledWith', 'exiledWithSource'].includes(modifier?.kind) ||
                !modifier.cardInstanceId ||
                !modifier.sourceCardInstanceId
            ) {
                return [];
            }
            return [[modifier.cardInstanceId, modifier.sourceCardInstanceId]];
        }),
    );
    const players = (state.players ?? []).map((player, playerIndex) => {
        const hand = (player.hand ?? []).map(instance => {
            return displayCard(instance, cardCatalog, actions, 'hand');
        });
        const exile = zoneView(player.exile ?? [], cardCatalog, actions, 'exile');
        exile.cards = exile.cards.map(card => {
            const linkedTo = linkedExileSourceByCardId.get(card.id);
            return linkedTo
                ? {
                    ...card,
                    state: {
                        ...card.state,
                        linkedExileSourceId: linkedTo,
                    },
                }
                : card;
        });
        exile.top = exile.cards.at(-1) ?? null;
        const graveyard = zoneView(player.graveyard ?? [], cardCatalog, actions, 'graveyard');
        const commandZone = zoneView(
            player.commandZone ?? [],
            cardCatalog,
            actions,
            'commandZone',
        );
        const permissionCards = [...graveyard.cards, ...exile.cards].filter(card => {
            return card.actionState.actionable;
        });
        return {
            hasLost: Boolean(player.hasLost),
            key: player.id,
            life: Number(player.life ?? 0),
            commanderDamage: (player.commanderDamage ?? []).map(damage => ({
                amount: Number(damage.amount ?? 0),
                commanderId: damage.commanderId,
                commanderName: damage.commanderName,
                controllerId: damage.controllerId,
                ownerId: damage.ownerId,
            })),
            name: player.name,
            role: roleByPlayerId[player.id] ?? roles[playerIndex] ?? 'ai',
            zones: {
                battlefield: battlefieldView(
                    player.battlefield ?? [],
                    cardCatalog,
                    actions,
                    view.calculatedStats ?? {},
                ),
                commandZone,
                exile,
                graveyard,
                hand,
                handCount: hand.length,
                handRevealed: revealedHandPlayerIds.has(player.id),
                landPlaysAvailable: Number(player.landPlaysRemaining ?? 0),
                libraryCount: player.library?.length ?? 0,
                manaPool: manaPoolView(player.manaPool),
                maxHandSize: Number(player.maxHandSize ?? 7),
                playableHand: [...commandZone.cards, ...hand, ...permissionCards],
                sideboard: zoneView(player.sideboard ?? [], cardCatalog, actions, 'sideboard'),
            },
        };
    });
    const activePlayer = players[state.activePlayer] ?? null;
    const decisionPlayer = decision
        ? players.find(player => player.key === decision.playerId) ?? null
        : null;
    const stepPlayer = ['mulligan', 'mulliganBottom'].includes(decision?.kind)
        ? decisionPlayer
        : activePlayer;
    const priorityPlayer = Number.isInteger(state.priorityPlayer)
        ? players[state.priorityPlayer] ?? null
        : null;
    const stack = (state.stack ?? []).map(item => ({
        card: displayCard(item.card, cardCatalog, []),
        controllerKey: item.controller,
        id: item.id,
        label: item.abilityKind
            ? `${item.card?.definition?.name ?? 'Ability'} - ${item.abilityKind}`
            : item.card?.definition?.name ?? 'Spell',
        type: item.abilityKind ?? 'spell',
    }));
    const phase = phaseFromEngineStep(state.step, decision?.kind);
    const resolutionChoice = resolutionCardChoice(state, decision, cardCatalog);
    const resolutionTargetChoice = resolutionBoardTargetChoice(state, decision);
    const numberChoice = decision?.choice?.kind === 'numberSelection'
        ? {
            decisionId: decision.choice.decisionId,
            maximum: Number(decision.choice.maximum),
            minimum: Number(decision.choice.minimum),
            prompt: decision.choice.prompt ?? 'Choose a number.',
        }
        : null;
    const decisionSourceInstance = decision?.sourceCard ??
        stateCardInstance(state, decision?.sourceCardInstanceId);
    const decisionSourceCard = decisionSourceInstance
        ? displayCard(decisionSourceInstance, cardCatalog, [])
        : null;

    return {
        actions,
        combat: state.combat ?? { attackers: [], blockers: [] },
        decision,
        decisionSourceCard,
        directActions: actions.filter(action => !gameSessionActionCardId(action)),
        numberChoice,
        passAction: actions.find(action => action.kind === 'passPriority') ?? null,
        players,
        priorityPlayer,
        resolutionCardChoice: resolutionChoice,
        resolutionTargetChoice,
        stack,
        state,
        step: stepPlayer
            ? {
                actionContext: {
                    availableMana: null,
                },
                phase,
                playerKey: stepPlayer.key,
                playerName: stepPlayer.name,
                players,
                turn: Number(state.turnNumber ?? 1),
            }
            : null,
    };
}
