// A renderer owns its textures. Keep visible cards pinned and a bounded LRU of
// recently seen art for replay seeks; never share GPU resources across apps.
export class CardTextureCache {
    constructor(load, { maxIdle = 128, retryDelayMs = 5_000, now = Date.now } = {}) {
        this.load = load;
        this.maxIdle = maxIdle;
        this.retryDelayMs = retryDelayMs;
        this.now = now;
        this.ready = new Map();
        this.pending = new Map();
        this.failed = new Map();
        this.pinned = new Set();
        this.disposed = false;
    }

    peek(url) {
        const texture = this.ready.get(url);
        if (texture?.destroyed || texture?.baseTexture?.destroyed) {
            this.ready.delete(url);
            return null;
        }
        if (texture) {
            this.ready.delete(url);
            this.ready.set(url, texture);
        }
        return texture ?? null;
    }

    get(url) {
        if (!url || this.disposed) return Promise.resolve(null);
        const ready = this.peek(url);
        if (ready) return Promise.resolve(ready);
        if (this.pending.has(url)) return this.pending.get(url);
        if (this.now() < (this.failed.get(url) ?? 0)) return Promise.resolve(null);
        const promise = Promise.resolve().then(() => this.disposed ? null : this.load(url))
            .catch(() => null)
            .then(texture => {
                this.pending.delete(url);
                if (this.disposed) {
                    texture?.destroy(true);
                    return null;
                }
                if (texture) {
                    this.failed.delete(url);
                    this.ready.set(url, texture);
                } else {
                    this.failed.set(url, this.now() + this.retryDelayMs);
                }
                this.prune();
                return texture;
            });
        this.pending.set(url, promise);
        return promise;
    }

    canRetry(url) {
        return !this.disposed && !this.pending.has(url) &&
            this.now() >= (this.failed.get(url) ?? 0);
    }

    retain(urls) {
        this.pinned = new Set(urls);
        this.prune();
    }

    prune() {
        const idle = [...this.ready.keys()].filter(url => !this.pinned.has(url));
        for (const url of idle.slice(0, Math.max(0, idle.length - this.maxIdle))) {
            const texture = this.ready.get(url);
            this.ready.delete(url);
            texture.destroy(true);
        }
        // Failed historical URLs must not accumulate through long replays either.
        for (const url of this.failed.keys()) {
            if (!this.pinned.has(url)) this.failed.delete(url);
        }
    }

    destroy() {
        this.disposed = true;
        for (const texture of this.ready.values()) texture.destroy(true);
        this.ready.clear();
        this.failed.clear();
        this.pinned.clear();
        // Pending completions dispose their own texture, without repopulating.
        this.pending.clear();
    }
}
