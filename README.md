# DeepDeckPixi

DeepDeckPixi is the independent public rendering package for DeepDeckEngine.
It contains the PixiJS game table, the pure session-to-scene projection, live
replay merging, and the `ddl-pixi-replay-v2` Web Component used by non-Vue
hosts.

Deep Deck League navigation, accounts, matchmaking and statistics are not part
of this repository. Game rules and state mutation remain authoritative in the
Rust [`DeepDeckEngine`](https://github.com/dd-the-dd/DeepDeckEngine) repository.

## Develop

Use Node.js 22 or newer:

```powershell
npm ci
npm test
npm run lint
npm run build
```

## Use from Vue

```js
import { PixiGame, projectGameSessionView } from '@deepdeck/pixi';
import '@deepdeck/pixi/style.css';
```

`PixiGame` accepts a versioned scene and emits action identifiers; it does not
decide whether an action is legal. Hosts may inject `brandName` and
`brandLogoUrl`, which keeps DeepDeck Local visually distinct from Deep Deck
League without forking the renderer.

## Use the replay host

```js
import {
  registerPixiReplayV2Element,
} from '@deepdeck/pixi/replay-element';

registerPixiReplayV2Element();
```

Set the element's `clientUrl` and `trace` properties. Live updates preserve the
iframe when the game identity is unchanged, while `replay-close` only asks the
host to close it.

See [compatibility.json](compatibility.json) before updating either public
repository. Consumers must pin a release or commit SHA rather than `main`.
