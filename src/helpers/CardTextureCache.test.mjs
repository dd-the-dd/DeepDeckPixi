import { describe, expect, test, vi } from 'vitest';
import { CardTextureCache } from './CardTextureCache.mjs';

const texture = () => ({ destroy: vi.fn(), destroyed: false, baseTexture: {} });

describe('renderer card texture cache', () => {
    test('deduplicates in-flight requests and exposes decoded art synchronously across updates and seeks', async () => {
        let finish;
        const art = texture();
        const load = vi.fn(() => new Promise(resolve => { finish = resolve; }));
        const cache = new CardTextureCache(load);
        cache.retain(['/one']);
        const first = cache.get('/one');
        expect(cache.get('/one')).toBe(first);
        await Promise.resolve();
        finish(art);
        expect(await first).toBe(art);
        for (let update = 0; update < 100; update += 1) {
            expect(cache.peek('/one')).toBe(art);
            expect(await cache.get('/one')).toBe(art);
        }
        cache.retain([]); // seek away / round boundary
        cache.retain(['/one']); // seek back
        expect(cache.peek('/one')).toBe(art);
        expect(load).toHaveBeenCalledTimes(1);
        cache.destroy();
        expect(art.destroy).toHaveBeenCalledExactlyOnceWith(true);
    });

    test('bounds idle GPU textures while pinning all visible cards and evicting oldest art', async () => {
        const cache = new CardTextureCache(async () => texture(), { maxIdle: 2 });
        cache.retain(['visible']);
        const visible = await cache.get('visible');
        const oldest = await cache.get('oldest');
        const recent = await cache.get('recent');
        await cache.get('newest');
        expect(cache.ready.size).toBe(3);
        expect(oldest.destroy).toHaveBeenCalledExactlyOnceWith(true);
        expect(visible.destroy).not.toHaveBeenCalled();
        expect(recent.destroy).not.toHaveBeenCalled();
        cache.retain([]);
        expect(cache.ready.size).toBe(2);
        expect(visible.destroy).toHaveBeenCalledExactlyOnceWith(true);
        cache.destroy();
    });

    test('recovers destroyed resources and retries failures with a cooldown', async () => {
        let now = 0;
        const art = texture();
        const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(art);
        const cache = new CardTextureCache(load, { now: () => now, retryDelayMs: 10 });
        cache.retain(['one']);
        expect(await cache.get('one')).toBeNull();
        expect(cache.canRetry('one')).toBe(false);
        expect(await cache.get('one')).toBeNull();
        expect(load).toHaveBeenCalledTimes(1);
        now = 11;
        expect(cache.canRetry('one')).toBe(true);
        expect(await cache.get('one')).toBe(art);
        art.destroyed = true;
        expect(cache.peek('one')).toBeNull();
        await cache.get('one');
        expect(load).toHaveBeenCalledTimes(3);
        cache.destroy();
    });

    test('disposes in-flight completions without reviving the renderer cache', async () => {
        let finish;
        const art = texture();
        const load = vi.fn(() => new Promise(resolve => { finish = resolve; }));
        const cache = new CardTextureCache(load);
        const pending = cache.get('one');
        await Promise.resolve();
        cache.destroy();
        finish(art);
        expect(await pending).toBeNull();
        expect(art.destroy).toHaveBeenCalledExactlyOnceWith(true);
        expect(cache.ready.size).toBe(0);
        expect(await cache.get('two')).toBeNull();
        expect(load).toHaveBeenCalledTimes(1);
    });
});
