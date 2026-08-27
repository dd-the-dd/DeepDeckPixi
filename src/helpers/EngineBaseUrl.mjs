export function defaultEngineBaseUrl(configuredUrl = import.meta.env.VITE_MTG_ENGINE_URL) {
    if (configuredUrl) {
        return String(configuredUrl).replace(/\/$/u, '');
    }
    const location = globalThis.location;
    if (location?.hostname && ['http:', 'https:'].includes(location.protocol)) {
        if (!['localhost', '127.0.0.1', '::1'].includes(location.hostname)) {
            return location.origin;
        }
        return `${location.protocol}//${location.hostname}:8787`;
    }
    return 'http://127.0.0.1:8787';
}
