import { describe, expect, test } from 'vitest';
import {
    applyReplayMergePatch,
    replayFrames,
    replayObservationAt,
    replayPerspectiveSeatAt,
    replayPresentationDelayMs,
} from './ReplayDelta.mjs';

describe('Pixi replay V2 deltas', () => {
    test('applies merge-patch deletion and nested changes without mutating the source', () => {
        const source = { state: { turnNumber: 1, obsolete: true }, catalog: ['a'] };
        const result = applyReplayMergePatch(source, { state: { turnNumber: 2, obsolete: null } });
        expect(result).toEqual({ state: { turnNumber: 2 }, catalog: ['a'] });
        expect(source.state.turnNumber).toBe(1);
    });

    test('reconstructs a V2 observation from its initial state and ordered deltas', () => {
        const trace = {
            schemaVersion: 'mtg-pixi-replay/v2',
            initialObservation: { state: { turnNumber: 1, players: [{ life: 20 }] } },
            frames: [
                { sequenceNumber: 2, observationDelta: { patch: { state: { turnNumber: 2 } } } },
                { sequenceNumber: 1, observationDelta: { patch: { state: { players: [{ life: 17 }] } } } },
            ],
        };
        expect(replayObservationAt(trace, 1)).toEqual({ state: { turnNumber: 2, players: [{ life: 17 }] } });
    });

    test('adds the terminal state after the final decision so lethal damage is visible', () => {
        const trace = {
            schemaVersion: 'mtg-pixi-replay/v2',
            initialObservation: { turnNumber: 4, players: [{ life: 3 }, { life: 20 }] },
            frames: [{ sequenceNumber: 9, observationDelta: { patch: {} } }],
            terminalObservation: {
                turnNumber: 4,
                players: [{ life: 0 }, { life: 20 }],
                outcome: { winner: 'player-2', losers: ['player-1'], reason: 'lifeTotal' },
            },
        };

        const frames = replayFrames(trace);
        expect(frames).toHaveLength(2);
        expect(replayObservationAt(trace, 1)).toEqual(trace.terminalObservation);
    });

    test('switches to the continuation observer after the original player is eliminated', () => {
        const trace = {
            schemaVersion: 'mtg-pixi-replay/v2',
            perspectiveSeat: 0,
            initialObservation: { state: { turnNumber: 3, players: [{ life: 0 }, { life: 40 }] } },
            frames: [
                { sequenceNumber: 10, seat: 0, observationDelta: { patch: {} } },
                { sequenceNumber: 12, seat: 1, observationDelta: { patch: {} } },
            ],
            checkpoints: [{
                sequenceNumber: 12,
                observation: { state: { turnNumber: 4, players: [{ life: 0 }, { life: 35 }] } },
            }],
            terminalObservation: {
                state: { turnNumber: 5, players: [{ life: 0 }, { life: 35 }] },
                outcome: { winner: 'player-2' },
            },
        };

        expect(replayObservationAt(trace, 1)).toEqual(trace.checkpoints[0].observation);
        expect(replayPerspectiveSeatAt(trace, 0)).toBe(0);
        expect(replayPerspectiveSeatAt(trace, 1)).toBe(1);
        expect(replayPerspectiveSeatAt(trace, 2)).toBe(1);
    });

    test('keeps each newly added stack object visible for at least 500 ms', () => {
        const trace = {
            decisions: [
                { sequenceNumber: 1, observableState: { state: { stack: [] } } },
                {
                    sequenceNumber: 2,
                    observableState: { state: { stack: [{ id: 'spell:1' }] } },
                },
                {
                    sequenceNumber: 3,
                    observableState: {
                        state: { stack: [{ id: 'spell:1' }, { id: 'ability:2' }] },
                    },
                },
            ],
        };

        expect(replayPresentationDelayMs(trace, 1, 150)).toBe(500);
        expect(replayPresentationDelayMs(trace, 2, 150)).toBe(500);
        expect(replayPresentationDelayMs(trace, 2, 900)).toBe(900);
    });

    test('keeps the selected speed when no new object entered the stack', () => {
        const trace = {
            decisions: [
                {
                    sequenceNumber: 1,
                    observableState: { state: { stack: [{ id: 'spell:1' }] } },
                },
                {
                    sequenceNumber: 2,
                    observableState: { state: { stack: [{ id: 'spell:1' }] } },
                },
                { sequenceNumber: 3, observableState: { state: { stack: [] } } },
            ],
        };

        expect(replayPresentationDelayMs(trace, 1, 150)).toBe(150);
        expect(replayPresentationDelayMs(trace, 2, 150)).toBe(150);
    });
});
