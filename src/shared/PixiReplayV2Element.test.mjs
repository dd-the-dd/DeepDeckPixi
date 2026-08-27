import { beforeAll, describe, expect, it } from 'vitest';
import {
    PIXI_REPLAY_V2_ELEMENT,
    replayDeliveryType,
    replayIdentity,
    replayClientUrl,
    registerPixiReplayV2Element,
} from './PixiReplayV2Element.mjs';

describe('PixiReplayV2Element', () => {
    beforeAll(registerPixiReplayV2Element);

    it('registers one reusable component with the complete replay controls', () => {
        registerPixiReplayV2Element();
        const element = document.createElement(PIXI_REPLAY_V2_ELEMENT);
        element.trace = { schemaVersion: 'mtg-pixi-replay/v2', frames: [] };

        expect(customElements.get(PIXI_REPLAY_V2_ELEMENT)).toBe(element.constructor);
        expect(element.trace.schemaVersion).toBe('mtg-pixi-replay/v2');
        expect(element.shadowRoot.querySelectorAll('button')).toHaveLength(9);
        expect(element.shadowRoot.querySelector('iframe')).not.toBeNull();
    });

    it('passes the parent origin explicitly to the replay client', () => {
        const frameUrl = new URL(replayClientUrl(
            'http://localhost:5173',
            'http://localhost:5174/matches?game=official-game',
        ));
        expect(frameUrl.searchParams.get('mode')).toBe('replay');
        expect(frameUrl.searchParams.get('parentOrigin')).toBe('http://localhost:5174');
    });

    it('keeps the embedded Pixi client mounted when a live trace is refreshed', () => {
        const element = document.createElement(PIXI_REPLAY_V2_ELEMENT);
        const frame = element.shadowRoot.querySelector('iframe');

        element.trace = { game: { status: 'running' }, spectator: true, frames: [{ sequenceNumber: 1 }] };
        element.trace = { game: { status: 'running' }, spectator: true, frames: [{ sequenceNumber: 2 }] };

        expect(element.shadowRoot.querySelector('iframe')).toBe(frame);
        expect(element.trace.frames[0].sequenceNumber).toBe(2);
    });

    it('loads one replay identity once and classifies later live traces as updates', () => {
        const initial = {
            game: { id: 'live-game', status: 'running' },
            perspectiveSeat: 0,
            spectator: true,
            frames: [{ sequenceNumber: 1 }],
        };
        const update = {
            game: { id: 'live-game', status: 'running' },
            perspectiveSeat: 0,
            spectator: true,
            frames: [{ sequenceNumber: 1 }, { sequenceNumber: 2 }],
        };

        expect(replayDeliveryType(null, initial)).toBe('ddl:load-replay');
        expect(replayDeliveryType(replayIdentity(initial), update)).toBe('ddl:update-replay');
        expect(replayDeliveryType(replayIdentity(initial), {
            ...update,
            game: { id: 'another-game', status: 'running' },
        })).toBe('ddl:load-replay');
        expect(replayDeliveryType(replayIdentity(initial), {
            ...update,
            perspectiveSeat: 1,
        })).toBe('ddl:load-replay');
    });

    it('emits one close request without replaying the trace', () => {
        const element = document.createElement(PIXI_REPLAY_V2_ELEMENT);
        element.trace = {
            schemaVersion: 'mtg-pixi-replay/v2',
            frames: [{ sequenceNumber: 1 }],
        };
        let closeRequests = 0;
        element.addEventListener('replay-close', () => {
            closeRequests += 1;
        });

        element.shadowRoot.querySelector('.close').click();

        expect(closeRequests).toBe(1);
        expect(element.trace.frames).toHaveLength(1);
    });
});
