// A superseded scene is cancelled. Completion is tied to the actual Pixi ticker.
export class VisualSceneLatch {
    pending = null;
    queue(scene) { this.pending = scene; }
    cancel() { this.pending = null; }
    settle(moving) {
        if (moving || !this.pending) return null;
        const scene = this.pending;
        this.pending = null;
        return scene;
    }
}
