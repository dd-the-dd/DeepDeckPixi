const objectValue = value => value && typeof value === 'object' && !Array.isArray(value);
const cloneJson = value => {
    if (Array.isArray(value)) return value.map(cloneJson);
    if (objectValue(value)) {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item)]));
    }
    return value;
};

export function applyReplayMergePatch(target, patch) {
    if (!objectValue(patch)) return cloneJson(patch);
    const result = objectValue(target) ? cloneJson(target) : {};
    Object.entries(patch).forEach(([key, value]) => {
        if (value === null) {
            delete result[key];
        } else {
            result[key] = objectValue(value)
                ? applyReplayMergePatch(result[key], value)
                : cloneJson(value);
        }
    });
    return result;
}

export function isDeltaReplay(trace) {
    return trace?.schemaVersion === 'mtg-pixi-replay/v2'
        || trace?.game?.schemaVersion === 'mtg-pixi-replay/v2'
        || trace?.game?.schemaVersion === '2';
}

export function replayFrames(trace) {
    const frames = [...(isDeltaReplay(trace) ? trace?.frames ?? [] : trace?.decisions ?? [])]
        .sort((left, right) => Number(left.sequenceNumber ?? 0) - Number(right.sequenceNumber ?? 0));
    if (isDeltaReplay(trace) && trace?.terminalObservation) {
        frames.push({
            sequenceNumber: Number(frames.at(-1)?.sequenceNumber ?? 0) + 1,
            seat: Number(frames.at(-1)?.seat ?? trace.perspectiveSeat ?? 0),
            terminalObservation: trace.terminalObservation,
        });
    }
    return frames;
}

export function replayPerspectiveSeatAt(trace, frameIndex) {
    const frames = replayFrames(trace);
    const seat = isDeltaReplay(trace)
        ? frames[frameIndex]?.seat ?? trace?.perspectiveSeat ?? 0
        : trace?.perspectiveSeat ?? frames[frameIndex]?.seat ?? 0;
    return Math.max(
        0,
        Number.parseInt(
            String(seat),
            10,
        ) || 0,
    );
}

export function replayObservationAt(trace, frameIndex) {
    const frames = replayFrames(trace);
    if (!isDeltaReplay(trace)) {
        const frame = frames[frameIndex];
        return frame?.observableState ?? null;
    }
    if (!trace?.initialObservation || frameIndex < 0 || frameIndex >= frames.length) return null;
    if (frames[frameIndex]?.terminalObservation) {
        return cloneJson(frames[frameIndex].terminalObservation);
    }
    const targetSequence = Number(frames[frameIndex]?.sequenceNumber ?? frameIndex + 1);
    const checkpoint = [...(trace.checkpoints ?? [])]
        .filter(item => Number(item.sequenceNumber ?? -1) <= targetSequence)
        .sort((left, right) => Number(right.sequenceNumber) - Number(left.sequenceNumber))[0];
    let observation = cloneJson(checkpoint?.observation ?? trace.initialObservation);
    const startSequence = Number(checkpoint?.sequenceNumber ?? -1);
    for (let index = 0; index <= frameIndex; index += 1) {
        const frame = frames[index];
        if (Number(frame.sequenceNumber ?? index + 1) <= startSequence) continue;
        observation = applyReplayMergePatch(
            observation,
            frame.observationDelta?.patch ?? frame.patch ?? frame.observationDelta ?? {},
        );
    }
    return observation;
}

export function replayStackSignature(observation) {
    const state = observation?.state ?? observation ?? {};
    return (state.stack ?? []).map((item, index) => {
        return item?.id ?? item?.stackId ?? item?.card?.instanceId ?? `stack:${index}`;
    });
}

export function replayPresentationDelayMs(
    trace,
    frameIndex,
    configuredDelayMs,
    minimumStackDwellMs = 500,
) {
    const configured = Math.max(0, Number(configuredDelayMs ?? 0));
    if (frameIndex < 0) {
        return configured;
    }
    const current = replayStackSignature(replayObservationAt(trace, frameIndex));
    if (current.length === 0) {
        return configured;
    }
    const previous = new Set(
        frameIndex > 0
            ? replayStackSignature(replayObservationAt(trace, frameIndex - 1))
            : [],
    );
    const containsNewStackObject = current.some(id => !previous.has(id));
    return containsNewStackObject
        ? Math.max(configured, Math.max(0, Number(minimumStackDwellMs ?? 0)))
        : configured;
}
