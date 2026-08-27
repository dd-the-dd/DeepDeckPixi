if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
}

if (typeof globalThis.localStorage !== 'undefined'
    && typeof globalThis.localStorage.getItem !== 'function') {
    const values = new Map();
    globalThis.localStorage = {
        clear: () => values.clear(),
        getItem: key => values.get(key) ?? null,
        key: index => [...values.keys()][index] ?? null,
        get length() { return values.size; },
        removeItem: key => values.delete(key),
        setItem: (key, value) => values.set(key, String(value)),
    };
}
