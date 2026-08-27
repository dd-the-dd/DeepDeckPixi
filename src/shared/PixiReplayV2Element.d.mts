export const PIXI_REPLAY_V2_ELEMENT: 'ddl-pixi-replay-v2';
export function replayClientUrl(clientUrl: string, parentUrl?: string): string;

export class PixiReplayV2Element extends HTMLElement {
    trace: unknown;
    clientUrl: string;
    readonly clientOrigin: string;
    sendTrace(): void;
    sendCommand(command: string): void;
}

export function registerPixiReplayV2Element(): void;
