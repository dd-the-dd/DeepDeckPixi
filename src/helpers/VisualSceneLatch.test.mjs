import { expect, test } from 'vitest';
import { VisualSceneLatch } from './VisualSceneLatch.mjs';

test('only emits the displayed scene after actual movement ends, once', () => {
    const latch = new VisualSceneLatch();
    const first = { revision: 1 }, second = { revision: 2 };
    latch.queue(first);
    expect(latch.settle(true)).toBeNull();
    latch.queue(second);
    expect(latch.settle(true)).toBeNull();
    expect(latch.settle(false)).toBe(second);
    expect(latch.settle(false)).toBeNull();
});
test('unmount/seek can cancel pending audio without a delayed timer', () => {
    const latch = new VisualSceneLatch();
    latch.queue({revision: 1});
    latch.cancel();
    expect(latch.settle(false)).toBeNull();
});
