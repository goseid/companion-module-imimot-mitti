# Dev Notes — Display Server WIP

> Work-in-progress development notes. This branch (`wip/display-server`) is pushed to
> the personal fork `goseid/companion-module-imimot-mitti`, **not** the upstream
> `bitfocus` repo. Do not open a PR upstream we will maintain our own fork.

## Status as of 2026-05-22

The Mitti companion module was extended with an HTTP + WebSocket **display server** so a
browser canvas (the separate `multiview-hud` project) can show a Mitti playback
countdown. Built across v3.11.0–v3.11.13.

**Verified against real Mitti** — all checklist items below pass as of 2026-05-22.
Testing of item 6 uncovered a crash bug (`EADDRINUSE` took down the whole module
process); fixed in v3.11.3.

This mirrors how `arena-hud` works for Resolume Arena (reference repo:
`arena-hud`, locally at `~\code\local\arena-hud\`).

## What changed

- **v3.11.0** — new `display-server.js` (`MittiDisplayServer`: Node `http` + `ws` on a
  configurable port, default `4666`), `public/mitti-display.js` (`MittiDisplay` browser
  component), `public/index.html` (test page served at `/`). New `displayPort` config
  field + `v3_11_0` upgrade script. State contract: `{ playing, clipName, elapsed,
  duration, remaining }`, all timing values in seconds.
- **v3.11.1** — fixed `playing` staying `true` after a clip stops/cues.
  `_buildDisplayState()` now requires a fresh advancing elapsed timer (`elapsedSec > 0`
  plus `cueTimeElapsed` seen within 1.5s); a `currentCueName` change resets elapsed
  timing; a 1 Hz heartbeat flips `playing` to `false` on a silent stop.
- **v3.11.2** — fixed stale `currentCueName` after a ±1 clip navigation. The module now
  sends `resendOSCFeedback` on every `togglePlay 1` transition (debounced 250 ms) to
  force Mitti to re-broadcast full state.
- **v3.11.3** — fixed an `EADDRINUSE` crash. `ws` re-emits the underlying http server's
  errors onto the `WebSocketServer`; with no `error` listener on it, Node threw an
  unhandled `'error'` event and Companion restarted the module in a loop. Added an
  `error` handler to `this.wss` in `display-server.js` (swallows `EADDRINUSE`, which the
  http server's own handler already logs).
- **v3.11.4** — added a read-only "Display Server URLs" field to the module config. New
  `_getDisplayServerUrls()` helper enumerates loopback + every non-internal IPv4 address
  (`os.networkInterfaces()`) paired with the configured port; `getConfigFields()` renders
  them as clickable links. Links reflect the saved port at the time the dialog opens.
- **v3.11.5** — `/` now serves a full-screen HUD layout (`public/index.html`): a
  time-of-day clock in the top half over the Mitti countdown widget in the bottom half,
  mirroring `arena-hud`'s `clock/index.html`. The old bare test page moved to
  `public/debug.html` (served at `/debug.html`). Added `public/tod-clock.js` (`TODClock`,
  copied from `arena-hud`) and `public/fonts/Lekton-Bold.ttf`. `display-server.js` now
  routes assets through a single `STATIC_ROUTES` table (binary-aware for the font).
- **v3.11.6** — three changes batched (plus in-progress preset edits):
  * All preset resting `bgcolor`s set to a uniform brand color `#003852` via a new
    `PresetBg` constant. State-indicator feedback colors (green for active, the
    red/black countdown flash, etc.) preserved.
  * Fix per-cue path-prefixed actions (`select`, `jump`, audio/fade/loop/etc.) for
    cues with a custom ID. Mitti splits broadcasts across two paths — toggle states
    under `/mitti/<customID>/...`, content under `/mitti/<position>/...` — but
    inbound commands resolve **only** on the custom ID once set. New `_pairedCueID()`
    helper detects the pair by the asymmetric param signature (cueName-only entry
    next to toggles-only entry, adjacent in `cueOrder`). `conformCueID()` substitutes
    a numeric position with its custom-ID alias for inbound; the rename path mirrors
    cueName updates to the alias so `cue_FLAG_cueName` (and the preset referencing
    it) populates correctly. `variables.js` borrows cueName from the paired position
    entry at init time for the same reason.
  * Adjacency heuristic (alias immediately precedes its position entry in `cueOrder`)
    is what we observed with one custom-ID cue. With multiple custom-ID cues, if
    Mitti ever batches all aliases together before all positions, pairing could
    mis-align — easy to revisit when/if that surfaces.
  * NOTE: lint had 4 unresolved errors at the time the v3.11.6 work was committed;
    cleaned up before pushing via prettier auto-fix + dead-`playIcon`-const removal.
- **v3.11.7** — `selectPrevious` / `selectNext` presets now display the cue name that
  would become selected after pressing them. Mitti's top-level `previousCueName` /
  `nextCueName` broadcasts follow the playback cursor (which doesn't shift when you
  arrow through the playlist without playing), so two new variables —
  `prevSelectedCueName` / `nextSelectedCueName` — are computed inside the module from
  `selectedCueID`. New `_positionForCueID()` helper maps either a numeric ID or a
  custom-ID alias to a playlist position number; `_refreshSelectedNavCues()` looks up
  the neighbors via `this.cues[String(pos ± 1)].cueName` and substitutes `"None"` at
  the edges. Triggered on `selectedCueID` change, any `cueName` rename, and at the
  end of `getVariables` (covers init / cue add / cue delete).
- **v3.11.8** — feedback ergonomics, in/out point support, and trim presets:
  * Magic-keyword resolution in `conformCueID`: `"current"` / `"selected"` now resolve
    to the concrete `currentCueID` / `selectedCueID` before lookup, so feedbacks that
    read `this.cues[id].toggleX` (Loop Enabled, Pause At Beginning/End, Fade In/Out,
    Audio Enabled, Transition Enabled, Goto Enabled) work with those keywords —
    previously they only worked via the `$(mitti:currentCueID)` variable workaround.
    Actions are unaffected since Mitti accepts both `/mitti/current/<cmd>` and
    `/mitti/<id>/<cmd>` inbound.
  * `cueToolTip` const introduced in `feedbacks.js` and applied to all 11 cueID
    textinputs. Default cueID value flipped from `""` to `"current"` for the same
    inputs.
  * Toggle-status feedback `defaultStyle.bgcolor` changed `ColorGreen` → `ColorCyan`
    (`#00ffff`); `playingCueID` / `activeCueID` / `selectedCueID` kept their semantic
    colors (green/blue/gray).
  * 7 "toggle" presets under the "Cue Playback Options" sub-group got their
    corresponding cue-state feedbacks wired in with an explicit `style: { bgcolor:
    ColorCyan }` override (Companion `defaultStyle` only applies on manual UI add, not
    on preset-attached feedbacks).
  * Two new state-position feedbacks: `atOutPoint` (cyan bg, black text) fires when
    `cueTimeLeft` reaches `00:00:00:00`; `atInPoint` (same style) fires when
    `cueTimeElapsed` is `00:00:00:00`. Both maintain `this.states.atOutPoint` /
    `atInPoint` and only call `checkFeedbacks` on state change.
  * Two new variables: `cueTimeLeft_hhmmssff` and `cueTimeElapsed_hhmmssff` — show
    significant digits only, minimum SS:FF. Regexes extended to optionally capture
    frames so the variables degrade gracefully if Mitti doesn't broadcast the FF
    segment.
  * New `Cue In/Out` preset category with two rotary-knob trim presets (`cueInTrim` /
    `cueOutTrim`). Each: rotary scrubs the playhead by ±1 frame, press selects the
    current cue (Mitti precondition for `setIn/OutFromPlayhead`), short tap jumps to
    in or out point via `locatePlayhead` (`00:00:00:00` or `99:99:99:99`), 1000 ms
    held-release group invokes `setInFromPlayhead` / `setOutFromPlayhead` with
    `runWhileHeld: true` so the trim point tracks the playhead while held + scrubbed.
    Each preset includes the corresponding `atInPoint` / `atOutPoint` feedback.
  * `Play Cue by ID` / `Select Cue by ID` preset-generation loop now skips Mitti's
    navigation refs (`current` / `previous` / `next` / `0`) — same filter as
    `variables.js` — so we don't generate `playCueID_current` etc.
  * Removed stray `console.log` diagnostics from the preset loop.
  * User-added in this version (preserved as-is): 8 base64 PNG icon constants
    (`panicIcon`, `loopingIcon`, `pauseEndIcon`, `pauseStartIcon`, `fadeInIcon`,
    `fadeOutIcon`, `crossFadeIcon`, `audioIcon`); a new `InactiveGray` resting-bg
    color; `panicIcon` on the existing `panic` preset; and 7 icon-style mirror
    presets under a new "Cue Playback Options - Icons" sub-header (each pairs the
    matching cue-state feedback with `bgcolor: ColorCyan`).
- **v3.11.9** — name-keyed cue caching for "on deck" display, plus two latent-bug
  fixes uncovered while building it.
  * New `this.cueCache` keyed by cueName, holding `{ trtShort, trtFull, trtSec,
    looping, pauseAtEnd }` per cue. Populated when each cue plays (Mitti only
    broadcasts TRT / toggle states for the currently-playing cue, so observation
    during play is the only path). Reset on `init` / `initOSC`. No eviction; name
    collisions silently overwrite — accepted tradeoff per `mitti-hud` hand-off doc.
  * 8 new variables expose the cache to surfaces: `selectedCueTRT` (+`_hhmmss`),
    `selectedCueLoop`, `selectedCuePauseAtEnd`, and the parallel `nextCue*`
    set (renamed in v3.11.10 — see below). Show `'None'` until a cue has played
    at least once.
  * Display state extended with flat `selectedClipName / Duration / Loop /
    PauseAtEnd` and `nextClip*` siblings, so the multiview-hud consumer can
    render "up next" with TRT + state icon.
  * Triggers: cache writes on `currentCueTRT` + `current/toggleLoop` +
    `current/togglePauseAtEnd` arrival; reads on `selectedCueName` /
    `nextCueName` changes via `_refreshOnDeckFromCache`.
  * Bug fix #1 — split-cue `currentCueLoop` / `currentCuePauseAtEnd`. Mitti's
    `/mitti/current/toggleX` broadcast is unreliable for custom-ID cues (doesn't
    fire on transition, or carries the previous cue's stale state). New
    `_refreshCurrentToggleStates` derives from `this.cues[currentCueID].toggleX`
    (with paired-entry fallback) on every `currentCueID` change; the
    `/mitti/current/toggleX` path is now skipped entirely when the current cue
    is split, and per-cue `/mitti/<id>/toggleX` broadcasts for the current cue
    update both the variable and cache.
  * Bug fix #2 — broadcast-order race in cache writes. Mitti's transition burst
    routinely sends `currentCueTRT` and `/mitti/current/toggleX` BEFORE
    `currentCueID` updates, so the original synchronous `_cacheCurrentCueAttributes`
    was resolving the cue name against a stale `currentCueID` and writing the
    new cue's data into the previous cue's cache entry (visible as a
    consistent off-by-one in user testing). Rewrote `_cacheCurrentCueAttributes`
    to stash pending attrs and flush via a 50 ms debounce, by which point the
    transition burst has settled and `_currentCueName()` resolves correctly.
    `destroy()` clears the debounce timer.
  * `_currentCueName()` helper derives the current cueName from
    `this.cues[currentCueID].cueName` (with paired-entry fallback for split
    cues) instead of trusting `states.currentCueName`, which lags behind during
    transitions. Returns `null` rather than guessing when neither source is
    populated.
  * `this.states.nextCueName` is now tracked alongside `selectedCueName` (it
    was previously only set as a variable).
- **v3.11.10** — naming consistency: renamed `selectedCueLooping` →
  `selectedCueLoop` and `nextCueLooping` → `nextCueLoop` to match upstream's
  noun-form convention (`currentCueLoop`, `currentCueAudio`, `currentCueFadeIn`,
  etc.). Same rename applied to the display-state fields (`selectedClipLoop` /
  `nextClipLoop`) and the internal cache field (`cueCache[name].loop`) so the
  whole pipeline uses one name. **Breaking change** for any surface or
  multiview-hud build that referenced the v3.11.9 names — those only shipped
  briefly so impact should be minimal.
  * Audit note: `video_outputs` / `audio_outputs` are snake_case outliers
    among the variableIds but they originate upstream — leaving them as-is to
    stay close to upstream conventions.
- **v3.11.11** — display widget gains an "on deck" line and tightens existing
  spacing.
  * `public/mitti-display.js` restructured: root is now `flex-direction:
    column` with a playback wrapper (clip name + countdown + progress) plus a
    sibling on-deck row. The on-deck row hides/shows independently of play
    state so operators can see what would play next while live OR while idle.
  * New on-deck row reads `selectedClipName / Duration / Loop / PauseAtEnd`
    from the WebSocket state and renders `"on deck: <name> <TRT> <icon>"` in
    green (#0c0, preview convention). Font size 3cqi — slightly smaller than
    the 4cqi current-clip name. Loop icon wins if both flags happen to be
    true; icon hidden if neither.
  * Icons are SVGs at `public/icons/looping.svg` and `public/icons/pause-end.svg`,
    served via new `STATIC_ROUTES` entries in `display-server.js`. Rendered via
    CSS `mask-image` + `background-color: #0c0`, so the source SVG's red fill
    becomes our green at render time (and the same icons could be recoloured
    for other contexts later by changing the background-color).
  * Tighter spacing: root `gap: 1cqi` (between playback and on-deck), playback
    `gap: 0.5cqi` (was 2cqi between clip name / countdown / progress). Font
    sizes unchanged per user request.
- **v3.11.12** — audio state added to the cache pipeline, plus prep data for
  the upcoming currentCue icon work in the display widget.
  * New cache field `cueCache[name].audio` (boolean; `true` = unmuted) and
    Companion variables `selectedCueAudio` / `nextCueAudio` (`"Unmuted"` /
    `"Muted"` / `"None"`, matching upstream's `currentCueAudio` convention).
  * `_refreshCurrentToggleStates` now handles `toggleAudio` too, so the
    split-cue fix from v3.11.9 covers `currentCueAudio` the same way it
    covered Loop and PauseAtEnd. Per-cue `toggleAudio` for the current cue
    keeps both the variable and cache in sync; `/mitti/current/toggleAudio`
    is skipped for split cues.
  * Display state extended: `selectedClipAudio` / `nextClipAudio` for the
    on-deck row, **plus** `currentClipLoop` / `currentClipPauseAtEnd` /
    `currentClipAudio` sourced from `cueCache[currentCueName]` to prep the
    data the widget will need when the matching icons land next to the live
    countdown.
  * Display widget gains an audio span between the TRT and the existing
    loop/pause-end icon slot. Shown when `selectedClipAudio === true`
    (cue is unmuted = "this cue will produce sound"); hidden otherwise.
    New `--audio` CSS modifier with `mask-image: url('/icons/audio.svg')`,
    same green tint via mask + `background-color: #0c0`.
  * `/icons/audio.svg` route added to `display-server.js` static routes.
- **v3.11.13** — currentCue extras land in the display widget: TRT and the
  state icons (audio / loop / pause-at-end) now appear inside the countdown
  area.
  * New `__countdown-area` wrapper sits between the clip name and the
    progress bar (`position: relative`) so the new pieces can overlay the
    centered countdown text without shifting it.
  * `__current-trt` (lower-right of the countdown area, right edge flush
    with the progress bar): `"TRT: m:ss"`, baseline-aligned. Time font
    `6cqi` (1/3 of countdown's `18cqi` per spec); label font `4.8cqi`
    (80% of time per spec). Color `#0af` to match the elapsed-portion of
    the progress bar. Hidden when `data.duration` is `0` / unknown.
  * `__current-icons` (upper-right of the countdown area): audio icon
    (shown when `currentClipAudio === true`) followed by the loop OR
    pause-at-end icon (mutually exclusive; loop wins on race). Icons
    `6cqi` square (2× the on-deck size), color `#f33` to match the
    countdown text. Inter-icon spacing `20px` per user preference.
  * Refactored the icon mask declarations so the `--audio` / `--loop` /
    `--pause-end` modifier classes are shared between on-deck and current
    via grouped selectors. Color still comes from each context's base
    `background-color` (green for on-deck, red for current).

See the README "Display Server" section for the message-shape / embedding contract.

## Test checklist — all PASS as of 2026-05-22

1. ✅ **Display server basics** — `GET /mitti-display.js` and `/` (test page at
   `http://<host>:4666/`) serve correctly; WS connects and pushes initial cached state;
   `{type:"get_state"}` reply works.
2. ✅ **v3.11.1 fix** — `playing` flips cleanly to `false` on manual stop, pause, natural
   end-of-clip, and cue change (no longer stuck `true`).
3. ✅ **v3.11.2 fix** — `currentCueName` is correct immediately after a ±1 clip navigation
   + play (the originally reported bug; ±2 jumps already worked).
4. ✅ **Consumer integration** — `multiview-hud` reliably picks up `playing` after a
   back-1 / forward-1 navigation.
5. ✅ **Known limitation, confirmed tolerable** — ~1 s startup transient where `playing`
   is briefly `false` at play-start (a consequence of the `elapsedSec > 0`
   requirement); the `multiview-hud` auto-swap monitor debounces it.
6. ✅ **Port lifecycle** — `EADDRINUSE` logs an error without breaking OSC; changing
   `displayPort` reloads the server; removing the module instance releases the port.
   Same-port reload (changing a non-port config field) also comes back cleanly.
   ⚠️ Testing this exposed the v3.11.3 crash bug — `EADDRINUSE` originally killed the
   whole module process in a restart loop (see v3.11.3 above). Fixed and re-verified.
7. ✅ **End-to-end** against the `multiview-hud` consumer (separate repo, which also
   received changes).

## Build / tooling note

`yarn` requires Corepack, which can't write to `C:\Program Files\nodejs`, and
`corepack enable --install-directory` did not produce shims on this machine. Simplest
working approach — invoke yarn straight through corepack (no shim needed):

```powershell
$env:COREPACK_HOME = "$env:USERPROFILE\.corepack"
corepack yarn lint
```

`yarn lint` passes with this setup (exit 0, no warnings).
