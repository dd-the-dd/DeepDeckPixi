import type { DefineComponent } from 'vue';

export const PixiGame: DefineComponent<{
    brandLogoUrl?: string;
    brandName?: string;
    cardBackUrl?: string;
    decision?: Record<string, unknown> | null;
    mode?: 'play' | 'replay';
    scene?: Record<string, unknown> | null;
}>;

export * from './shared/PixiReplayV2Element.mjs';
