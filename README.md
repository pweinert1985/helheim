# ᚺ Helheim — An Endless Viking Saga ᚺ

A turn-based, hex-grid tactics roguelike, inspired by the movement-as-combat design of games like *Hoplite* — reimagined with a Norse theme and **no final floor**. Descend forever into the underworld; every depth spawns more (and deadlier) restless dead.

**Zero dependencies.** Plain HTML/CSS/JavaScript with procedural canvas art and WebAudio synth sound. No build step, no trackers. MIT licensed.

**One codebase, two ways to play:**

1. **Browser** — open `index.html` or host it anywhere static.
2. **Native iOS app** — `ios/Helheim.xcodeproj` wraps the *same* `index.html` + `css/` + `js/` in a WKWebView with native haptics. The game logic is shared by folder reference, never copied — a change to `js/game.js` is picked up by web and iOS alike.

## Play locally

Just open `index.html` in a browser — everything runs from the file system. Or serve it:

```sh
python3 -m http.server 8080
# then visit http://localhost:8080
```

## Publish to the web

It's a static site. Any of these work as-is:

- **GitHub Pages** — push the folder to a repo, enable Pages on the main branch.
- **Netlify / Vercel / Cloudflare Pages** — drag-and-drop the folder or connect the repo. No build command; publish directory is the root.
- **itch.io** — zip the folder, upload as an HTML game with `index.html` as the entry.

When you change any file, bump the `?v=N` query tags in `index.html` **and** `GAME_VERSION` in `js/data.js` (shown in the footer) so browsers pick up the new build instead of a cached one.

## iOS app

Requirements: a Mac with [Xcode](https://apps.apple.com/us/app/xcode/id497799835) (free). Then:

1. Open `ios/Helheim.xcodeproj` in Xcode.
2. Select the *Helheim* target → *Signing & Capabilities* → pick your team (a free Apple ID works for running on your own device).
3. Choose a simulator or your plugged-in iPhone and press **Run**.

That's it — there is no dependency install or build script. The project references `../index.html`, `../css`, `../js`, and `../icons` directly, so the native app always ships whatever the web version currently is. The Swift shell (2 small files) adds:

- Full-screen WKWebView themed to the game's night palette, safe-area aware.
- **Haptics**: kills tap lightly, taking damage thumps, blessings and death use notification haptics (the game calls `window.webkit.messageHandlers.haptic` when it exists; on the web this is a silent no-op).
- Portrait orientation, dark status bar, launch screen in the game's background color.

To ship to the App Store: set your own `PRODUCT_BUNDLE_IDENTIFIER`, bump `MARKETING_VERSION`, and archive as usual.

## How to play

You are a viking raider descending through Helheim. Movement **is** combat:

- **Stab** — any foe adjacent to you both *before and after* your move is killed.
- **Lunge** — move in a straight line toward a foe to skewer it (requires your spear in hand).
- **Leap (L)** — jump 2 tiles (costs 50 vigor). Ending your turn beside foes restores 10 vigor, and vigor refills at each new depth.
- **Throw (T)** — hurl your spear at any tile in range; walk onto it to reclaim it.
- **Shield Bash (B)** — knock an adjacent foe (or ember-bomb) back a tile and stun it. Fire rifts and the board edge kill instantly.
- **Hold (W / Space)** — pass the turn.

Each depth holds one **runestone**: stand beside it and tap it to choose one blessing. Two gifts are always offered — **+1 max heart** (until capped at 8) and a **full heal** — plus three random upgrades (vigor, throw range, sweeping bash, leap upgrades, spear recall, and more).

**Glory** is your score: +1 per kill, **+10 for descending without touching the runestone**, and — for pacifist runs — **+1 per living foe when you descend with none dead** on that floor (any death counts, even a surtling's stray ember). Your top 10 runs are kept in a local leaderboard on the title screen — no accounts, no servers, just `localStorage`.

### The dead of Helheim

| Foe | Behavior |
| --- | --- |
| **Draugr** | Strikes any adjacent tile. |
| **Bone Archer** | Shoots along straight lines, 2–5 tiles; can't fire point-blank. |
| **Surtling** | Lobs embers up to 3 tiles; they burst one turn later, scorching all adjacent tiles. Bash them away! |
| **Völva** | Sears a straight line up to 5 tiles, every other turn — watch her staff glow. |
| **Ancients** | Gold-ringed elites of any type; take two blows. Appear from depth 6. |

Red dashed tiles are threatened. Turn order: you act → embers burst → foes attack → foes move.

## Project layout

```
index.html            — page shell, HUD, modals
css/style.css         — Norse-themed UI
js/hex.js             — axial hex-grid math
js/data.js            — blessings, foe stats, flavor text
js/level.js           — floor generation (connectivity-checked)
js/render.js          — procedural canvas renderer + effects
js/game.js            — turn engine, player actions, foe AI, sound, haptics hook
js/ui.js              — HUD, modals, input wiring
icons/                — app icons (canvas-generated)
js/dev.js             — dev mode: turn recorder, replay bar, bug reports
ios/                  — native iOS shell (Xcode project, 2 Swift files)
```

## Dev mode (turn replay & bug reports)

Every turn is silently recorded (a ~2 KB snapshot; history resets each floor). Press `` ` `` (backtick) or add `?dev=1` to the URL to open the dev bar:

- **◀ ▶** (or `[` / `]`) — page through the floor's turns; the board renders each historical state read-only with a REPLAY badge.
- **live** — jump back to the present.
- **resume here** — rewind the game to the viewed turn and keep playing from there.
- **copy bug report** — copies a JSON snapshot window (±3 turns) to the clipboard. To reproduce a report: open the console and run `HelheimDev.load(<paste the JSON string>)`.

Foe turn order is strictly phased so play is predictable: all attacks are declared from the board as it stands when your move ends, then they land, then non-attackers move. A foe stepping aside can never open a line of fire for another foe in the same round — the red threat markers are a promise.

## License

MIT — see [LICENSE](LICENSE).
