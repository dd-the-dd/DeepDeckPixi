import { mount } from '@vue/test-utils';
import { describe, expect, test, vi } from 'vitest';

// Keep these renderer reconciliation tests independent of a GPU/canvas driver.
vi.mock('pixi.js', () => {
    const point = () => ({ x: 1, y: 1, set(x, y = x) { this.x = x; this.y = y; } });
    class Container {
        constructor() {
            this.children = [];
            this.position = point();
            this.scale = point();
            this.anchor = point();
            this.visible = true;
        }
        addChild(...children) {
            for (const child of children) {
                child.parent?.removeChild(child);
                child.parent = this;
                this.children.push(child);
            }
            return children[0];
        }
        removeChild(child) {
            this.children = this.children.filter(candidate => candidate !== child);
            child.parent = null;
        }
        on() { return this; }
        destroy(options = {}) {
            this.destroyed = true;
            if (options.children) for (const child of this.children) child.destroy(options);
        }
    }
    class Graphics extends Container {
        beginFill() { return this; }
        lineStyle() { return this; }
        drawRoundedRect() { return this; }
        drawRect() { return this; }
        drawCircle() { return this; }
        drawEllipse() { return this; }
        endFill() { return this; }
    }
    class Sprite extends Container {
        constructor(texture) { super(); this.texture = texture; }
    }
    class Text extends Container {
        constructor(text) { super(); this.text = text; this.width = String(text).length * 5; }
    }
    return { Application: class {}, Container, Graphics, Sprite, Text,
        TextStyle: class {}, Rectangle: class {}, Texture: { WHITE: {} } };
});

import PixiGamePrototype from './PixiGamePrototype.vue';

const art = () => ({ destroy: vi.fn() });
const card = (overrides = {}) => ({ id: 'same-instance', name: 'Known card',
    imageUrl: '/card.jpg', kind: 'hand', ...overrides });

describe('live hand reconciliation', () => {
    test('keeps unchanged containers and warm sprites through interaction updates without placeholders', () => {
        const wrapper = mount(PixiGamePrototype, { props: { scene: { players: [] } } });
        const vm = wrapper.vm;
        vm.imageTextureCache.ready.set('/card.jpg', art());
        const player = { id: 'owner', local: true };
        let view = vm.createLiveCardView(card(), player, 'hand', new Map());
        const sprite = view.cardSprite;
        for (let update = 0; update < 100; update += 1) {
            const previous = view;
            const indexed = new Map([[view.cardId, view]]);
            view = vm.createLiveCardView(card(), { ...player }, 'hand', indexed);
            expect(view).toBe(previous);
            expect(indexed.size).toBe(0);
        }
        const stale = new Map([[view.cardId, view]]);
        view = vm.createLiveCardView(card({ actionable: true }), player, 'hand', stale);
        vm.destroyStaleLiveViews(stale);
        expect(view.cardSprite).toBe(sprite);
        expect(sprite.destroyed).not.toBe(true);
        expect(sprite.visible).toBe(true);
        expect(sprite.imageLoadState).toBe('ready');
        expect(view.children[0].visible).toBe(false);
        view.destroy({ children: true });
        wrapper.unmount();
    });

    test('never retains a visible face across redaction or changed identity, and destroys removed views', () => {
        const wrapper = mount(PixiGamePrototype, { props: { scene: { players: [] } } });
        const vm = wrapper.vm;
        const back = vm.magicCardBackUrl;
        vm.imageTextureCache.ready.set('/card.jpg', art());
        vm.imageTextureCache.ready.set(back, art());
        const owner = { id: 'owner', local: true };
        const known = vm.createLiveCardView(card(), owner, 'hand', new Map());
        const stale = new Map([[known.cardId, known]]);
        const hidden = vm.createLiveCardView(card({ faceDown: true, imageUrl: '', name: 'Hidden card' }),
            { ...owner, local: false }, 'hand', stale);
        vm.destroyStaleLiveViews(stale);
        expect(known.destroyed).toBe(true);
        expect(known.cardSprite.destroyed).toBe(true);
        expect(hidden.cardSprite).not.toBe(known.cardSprite);
        expect(hidden.cardSprite.loadedImageUrl).toBe(back);
        expect(hidden.cardSprite.imageLoadState).toBe('ready');
        expect(hidden.children).toHaveLength(1);
        vm.destroyStaleLiveViews(new Map([[hidden.cardId, hidden]]));
        expect(hidden.destroyed).toBe(true);
        // A seek back is a new view with synchronous cached art.
        const restored = vm.createLiveCardView(card(), owner, 'hand', new Map());
        expect(restored.cardSprite.imageLoadState).toBe('ready');
        expect(restored.children[0].visible).toBe(false);
        restored.destroy({ children: true });
        wrapper.unmount();
    });
});
