export const PIXI_REPLAY_V2_ELEMENT = 'ddl-pixi-replay-v2';

const replayCommands = [
    ['previous-turn', 'Previous turn'],
    ['previous-decision', 'Previous decision'],
    ['slower', 'Slower'],
    ['pause', 'Pause'],
    ['play', 'Play'],
    ['faster', 'Faster'],
    ['next-decision', 'Next decision'],
    ['next-turn', 'Next turn'],
];

function defaultClientUrl() {
    return `${window.location.protocol}//${window.location.hostname}:5173`;
}

export function replayIdentity(trace) {
    return JSON.stringify([
        trace?.game?.id ?? '',
        Number(trace?.perspectiveSeat ?? 0),
    ]);
}

export function replayDeliveryType(deliveredIdentity, trace) {
    return deliveredIdentity === replayIdentity(trace)
        ? 'ddl:update-replay'
        : 'ddl:load-replay';
}

export function replayClientUrl(clientUrl, parentUrl = window.location.href) {
    const parent = new URL(parentUrl);
    const url = new URL(clientUrl, parent);
    url.searchParams.set('mode', 'replay');
    url.searchParams.set('parentOrigin', parent.origin);
    return url.href;
}

export class PixiReplayV2Element extends HTMLElement {
    #clientReady = false;
    #deliveredIdentity = null;
    #frame;
    #trace = null;
    #messageHandler;

    constructor() {
        super();
        const root = this.attachShadow({ mode: 'open' });
        root.innerHTML = `
            <style>
                :host { display: block; position: fixed; inset: 0; z-index: 1000; height: 100dvh; background: #181a1e; }
                .host { display: grid; grid-template-rows: minmax(0, 1fr) auto; height: 100%; background: #181a1e; }
                iframe { display: block; width: 100%; height: 100%; border: 0; }
                .controls { display: flex; justify-content: center; align-items: center; gap: 7px; flex-wrap: wrap; min-height: 48px; padding: 8px 11px; border-top: 1px solid rgb(255 255 255 / 12%); background: #181a1e; }
                .status { min-width: 150px; color: #eee3d0; text-align: center; font: 10px/1.3 system-ui, sans-serif; }
                button { border: 1px solid rgb(255 255 255 / 20%); background: #25282d; color: #eee3d0; padding: 8px 11px; font: inherit; font-size: 9px; cursor: pointer; }
                button:hover { border-color: #eee3d0; }
                .close { position: absolute; top: 10px; right: 12px; z-index: 2; border-color: rgb(255 255 255 / 45%); background: rgb(24 26 30 / 88%); }
            </style>
            <section class="host" aria-label="Pixi V2 game replay">
                <button type="button" class="close" aria-label="Close replay">Close replay</button>
                <iframe title="Pixi V2 game replay" referrerpolicy="origin"></iframe>
                <div class="controls" aria-label="Replay controls"><span class="status" aria-live="polite">Decision 1 · 1×</span></div>
            </section>
        `;
        this.#frame = root.querySelector('iframe');
        root.querySelector('.close').addEventListener('click', () => {
            this.dispatchEvent(new CustomEvent('replay-close'));
        });
        const controls = root.querySelector('.controls');
        for (const [command, label] of replayCommands) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.dataset.command = command;
            button.addEventListener('click', () => this.sendCommand(command));
            controls.append(button);
        }
        this.#frame.addEventListener('load', () => {
            this.#clientReady = false;
            this.#deliveredIdentity = null;
        });
        this.#messageHandler = event => this.#receiveMessage(event);
    }

    connectedCallback() {
        window.addEventListener('message', this.#messageHandler);
        this.#refreshFrameUrl();
    }

    disconnectedCallback() {
        window.removeEventListener('message', this.#messageHandler);
    }

    static get observedAttributes() {
        return ['client-url'];
    }

    attributeChangedCallback(name, previous, current) {
        if (name === 'client-url' && previous !== current && this.isConnected) {
            this.#refreshFrameUrl();
        }
    }

    set trace(value) {
        this.#trace = value ?? null;
        this.sendTrace();
    }

    get trace() {
        return this.#trace;
    }

    set clientUrl(value) {
        if (value) this.setAttribute('client-url', value);
        else this.removeAttribute('client-url');
    }

    get clientUrl() {
        return this.getAttribute('client-url') || defaultClientUrl();
    }

    get clientOrigin() {
        return new URL(this.clientUrl, window.location.href).origin;
    }

    sendTrace() {
        if (!this.#clientReady || !this.#trace || !this.#frame?.contentWindow) return;
        const identity = replayIdentity(this.#trace);
        const deliveryType = replayDeliveryType(this.#deliveredIdentity, this.#trace);
        const isUpdate = deliveryType === 'ddl:update-replay';
        this.#frame.contentWindow.postMessage({
            type: deliveryType,
            payload: this.#trace,
        }, this.clientOrigin);
        this.#deliveredIdentity = identity;
        if (!isUpdate) {
            this.#frame.contentWindow.postMessage({
                type: 'ddl:replay-command',
                payload: { command: 'play' },
            }, this.clientOrigin);
        }
    }

    sendCommand(command) {
        if (!this.#clientReady || !replayCommands.some(([known]) => known === command)) return;
        this.#frame?.contentWindow?.postMessage({
            type: 'ddl:replay-command',
            payload: { command },
        }, this.clientOrigin);
    }

    #refreshFrameUrl() {
        const url = replayClientUrl(this.clientUrl);
        if (this.#frame.src !== url) {
            this.#clientReady = false;
            this.#frame.src = url;
        }
    }

    #receiveMessage(event) {
        if (
            event.origin !== this.clientOrigin
            || event.source !== this.#frame?.contentWindow
        ) return;
        if (event.data?.type === 'ddl:replay-ready') {
            this.#clientReady = true;
            this.sendTrace();
            this.dispatchEvent(new CustomEvent('replay-ready'));
            return;
        }
        if (event.data?.type === 'ddl:replay-state') {
            const { decisionCount = 0, decisionIndex = 0, delayMs = 900 } = event.data.payload ?? {};
            const speed = Math.max(0.1, 900 / Number(delayMs || 900));
            const status = this.shadowRoot.querySelector('.status');
            status.textContent = `Decision ${Math.min(Number(decisionIndex) + 1, Number(decisionCount))} / ${decisionCount} · ${speed.toFixed(1)}×`;
        }
    }
}

export function registerPixiReplayV2Element() {
    if (!customElements.get(PIXI_REPLAY_V2_ELEMENT)) {
        customElements.define(PIXI_REPLAY_V2_ELEMENT, PixiReplayV2Element);
    }
}
