# companion-module-imimot-mitti

This module will allow you to control Mitti, a modern, feature-packed but easy-to-use pro video playback solution for live events and exhibitions.

## Getting Started

See [HELP.md](./companion/HELP.md) and [LICENSE](./LICENSE)

## Display Server

In addition to controlling Mitti, this module runs a small HTTP + WebSocket server that exposes the current Mitti playback state to browser-based displays (e.g. [multiview-hud](https://github.com/)).

- **Port:** configurable via the `Display Server Port` field in the module config. Default `4666`. The module config also lists the reachable URLs as clickable links.
- **HUD page:** `http://<companion-host>:<displayPort>/` serves a full-screen HUD — a time-of-day clock above the Mitti playback countdown.
- **Debug page:** `http://<companion-host>:<displayPort>/debug.html` serves a bare test page (the `MittiDisplay` widget plus the raw WebSocket JSON) for verifying the feed.
- **Assets:** `/mitti-display.js` (the self-contained `MittiDisplay` component), `/tod-clock.js` (the `TODClock` component) and `/fonts/Lekton-Bold.ttf` are all served over HTTP.
- **WebSocket:** connect to `ws://<companion-host>:<displayPort>/`. On connection the server immediately sends the cached state; thereafter it pushes a new message whenever the state changes.

### Message shape

All messages are JSON of the form `{ "type": ..., "data": ... }`.

**Outbound (server → client):**

```json
{
  "type": "state",
  "data": {
    "playing": true,
    "hasCue": true,
    "clipName": "Opening Reel",
    "elapsed": 12,
    "duration": 90,
    "remaining": 78
  }
}
```

- `playing` (boolean) — `true` only when Mitti is actively playing a clip with a fresh advancing timer. Transitions from `true` to `false` exactly once on stop/pause, so downstream consumers can use it as a clean edge to detect playback start/stop.
- `hasCue` (boolean, since v3.11.2) — `true` whenever a cue is loaded on Mitti's output, including pause-at-end and mid-clip pause. Use this (rather than `playing`) when deciding whether to show clip info vs an idle placeholder.
- `clipName` (string | null) — name of the loaded clip, or `null` when `hasCue` is `false`.
- `elapsed`, `duration`, `remaining` (numbers, seconds) — playback timing for the loaded clip. All `0` when `hasCue` is `false`.

**Inbound (client → server):**

```json
{ "type": "get_state" }
```

The server replies with the latest cached state to only that client.

### Embedding the display

```html
<div id="mitti-slot" style="width:480px;height:270px"></div>
<script src="http://companion-host:4666/mitti-display.js"></script>
<script>
  const display = new MittiDisplay('#mitti-slot', { wsUrl: 'ws://companion-host:4666' })
</script>
```

`MittiDisplay` is dual-exported (CommonJS `module.exports.MittiDisplay` and browser `window.MittiDisplay`). It container-queries to fill its parent, references `font-family: 'Lekton-Bold'`, auto-reconnects after 2 seconds on WS close, and exposes `destroy()` to clean up. When embedding outside the bundled HUD page, the parent page is expected to provide the `Lekton-Bold` face (the server hosts it at `/fonts/Lekton-Bold.ttf`); the bundled HUD page loads it via `tod-clock.js`.

## Changelog

### v3.11.1

This branch adds the display server and HUD widget on top of v3.11.0. The features from v3.11.0 (cue caching, custom-ID routing fixes, in/out trim presets, etc.) are all included.

- New
  - HTTP + WebSocket display server (default port 4666, configurable via `Display Server Port`). Serves a self-contained browser display component (`mitti-display.js`) and pushes live playback state to subscribers. Useful for embedding the Mitti countdown / "on deck" info in browser-based multiview dashboards.
  - HUD page at `/`: full-screen layout with a time-of-day clock above the Mitti countdown widget. Bare debug/test page at `/debug.html`.
  - Display widget renders:
    - Currently-playing clip name + countdown + progress bar
    - Current cue TRT (lower-right) in the same blue as the elapsed-portion of the progress bar
    - Current cue state icons (audio / loop / pause-at-end) in the upper-right, in the same red as the countdown
    - "On deck" line below the playback area with the selected cue's name, TRT, audio icon, and loop/pause-at-end icon (all in green to follow the broadcast preview convention). Visible during both playing and idle states.
  - Server also hosts `/tod-clock.js` (clock component) and `/fonts/Lekton-Bold.ttf` (font for the digital clock and countdown).
  - Module config shows a "Display Server URLs" field with clickable links for every reachable network address of the host.
- Fix
  - `EADDRINUSE` on the display server port no longer crashes the module; the conflict is logged and OSC control continues unaffected.
  - Display widget no longer shows "idle" when a clip is paused at its out point. New `hasCue` field in the WebSocket state controls the widget's playback-vs-idle gate based on whether a cue is loaded on Mitti's output, separate from the `playing` field's "actively playing with fresh timer" semantic.
  - Display widget no longer flashes "idle" for a frame at loop boundaries. Removed the `elapsedSec > 0` gate from the `playing` calculation — the `elapsedFresh` check still catches stale-after-stop cases.
  - Progress bar computes against `(duration - 1)` so it reaches full at the 1-second-remaining mark and stays full through `0:00`. Previously the bar could either fall short at `0:00` (sub-second / frame-level time the integer-second `elapsed` / `duration` can't see) or lunge the last second's worth all at once.
- Layout
  - Countdown is prefixed with `-` to read as time remaining (e.g. `-1:23`).
  - Current cue's `TRT: m:ss` moved up alongside the clip name, sharing its font size and color so the top row reads as one line.
  - Current cue state icons (audio + loop/pause-at-end) stack vertically in the upper-right (audio above) with a 20 px top offset from the countdown area.
  - On-deck row's `on deck:` label dimmed to `#777` so the cue name reads as the primary content.

### v3.11.0

- New
  - Name-keyed cue cache populates as cues play, so the selected and next cues can display their TRT, loop, pause-at-end, and audio state on buttons even when not currently playing.
  - 16 new variables: `selectedCueTRT` (+ `_hhmmss`), `selectedCueLoop`, `selectedCuePauseAtEnd`, `selectedCueAudio` and the parallel `nextCue*` set; `prevSelectedCueName` / `nextSelectedCueName` (cues either side of the selection cursor); `cueTimeLeft_hhmmssff` and `cueTimeElapsed_hhmmssff` (significant-digits time with frame precision, minimum `SS:FF`).
  - Two new feedbacks: `Playhead at In Point` and `Playhead at Out Point`. Default style: cyan background, black text. Fires when the playhead is precisely at the cue's in or out point.
  - New "Cue In/Out" preset category with two rotary-knob trim presets: rotate to scrub the playhead by 1 frame, tap to jump to the cue in/out point, hold for 1 s+ to set the in/out point from the playhead (continues while held so you can scrub-while-trimming).
  - Toggle presets under "Cue Playback Options" now ship with their matching cue-state feedback pre-wired (cyan default style), so they reflect the current cue's state visually.
  - Icon-style mirror presets for the cue toggles under a new "Cue Playback Options - Icons" sub-header (PNG button icons + inactive-state gray bg).
  - Select Previous / Select Next presets now display the cue name that would become selected if pressed, instead of static labels.
  - Cue-state feedbacks (Loop / Pause At Begin/End / Fade In/Out / Audio / Transition / Goto) accept `"current"`, `"selected"`, `"previous"`, `"next"`, `"all"` magic-keyword shortcuts in their `cueID` option (matching the actions). Default cueID changed from empty to `"current"`. Tooltip on the cueID inputs lists the magic keywords.
  - All preset resting backgrounds set to a uniform brand color (`#003852`). State-indicator feedback colors (active green, countdown red/black flash, etc.) preserved.
- Fix
  - `currentCueLoop` / `currentCuePauseAtEnd` / `currentCueAudio` variables now reflect the correct state for cues with a custom ID. Mitti routes those toggle broadcasts under the custom-ID path, not the current-cue path, so the previous logic went stale on every transition to/from a custom-ID cue.
  - Per-cue path-prefixed actions (Select Cue, Jump To Cue, audio/fade/loop/etc.) now work for cues with a custom ID. Passing a position number (e.g. `4` for a cue whose custom ID is `FLAG`) used to silently no-op; the module now detects the position↔custom-ID pair from broadcast feedback and substitutes the custom ID before sending.
  - `cue_<customID>_cueName` variables (e.g. `cue_FLAG_cueName`) now populate correctly. Mitti broadcasts `cueName` only under the position-number path; the module mirrors it to the alias variable.
  - Cue cache writes no longer corrupt a sibling cue's entry during transitions. Mitti's broadcast burst on a cue change frequently delivers the new cue's data before the new `currentCueID` arrives; cache writes are debounced ~50 ms so the cue identity is settled by the time we write.
  - `Play Cue by ID` / `Select Cue by ID` preset generation no longer includes spurious entries for Mitti's navigation refs (`current` / `previous` / `next`).
  - Resync request (`resendOSCFeedback`) fires on every play-start (debounced 250 ms) so the current cue's name updates reliably after ±1 cue navigations.

### v3.10.2

- Fix
  - Possible issues with auto discovery creating multiple instances when more than one network interface is present
  - Remove duplicate variables for current, previous, and next cue types
  - Prevent "0" cue variable from accidentally showing on import
  - Variables no longer provide value until real data is received to avoid confusion

### v3.10.1

- Fix
  - Ensure "current", "next", and "previous" cue values return feedback correctly

### v3.10.0

- New
  - Action: Adjust Current Cue Playback Speed
  - Action: Locate Playhead with Timecode
  - Variable: Current Cue Playback Speed

### v3.9.2

- Fix
  - Ensure variable values are parsed appropriately in the Scrub Playhead with Timecode action

### v3.9.1

- Fix
  - Prevent non-Mitti OSC endpoints from being suggested in the module configuration dropdown

### v3.9.0

- New
  - Action: Play cue at index action
  - Action: Toggle Audio Outputs
  - Action: Audio Outputs On
  - Action: Audio Outputs Off
  - Action: Adjust Current Cue Volume
  - Action: Scrub Playhead with Timecode
  - Feedback: Set In / Out from Playhead Available
  - Variable: audio_outputs
  - Variable: currentCueVolume
  - Feedback: Audio Outputs Active
  - Option to use Force Cut (uses an instant cut, regardless of whether a transition is enabled) is now available for the following actions:
    - Play Selected Cue
    - Play Cue with name
    - Play cue with number / ID
    - Play cue at index

### v3.8.1

- Fixes
  - Default to localhost when no Bonjour connections are found
  - Prevent crash when feedback port is undefined

### v3.8.0

- New
  - Ability to discover Mitti instances on the network via Bonjour in Companion configuration panel
  - Announce the Companion Mitti Module via Bonjour for easy feedback configuration in the Mitti preferences
  - Action: Set In from Playhead
  - Action: Set Out from Playhead

### v3.7.2

- New
  - Update default port to new Mitti default for feedback, `51001`. This default will only apply to new installations.

### v3.7.1

- Fix
  - Cleanup development logging

### v3.7.0

- New
  - Feedback: Cue ID - Audio Enabled
  - Feedback: Cue ID - Pause at Beginning Enabled
  - Feedback: Cue ID - Pause at End Enabled
  - Feedback: Cue ID - Fade In Enabled
  - Feedback: Cue ID - Fade Out Enabled
  - Feedback: Cue ID - Loop Enabled
- Feedback: Cue ID - Transition Enabled
  - Feedback: Cue ID - Goto Enabled
  - Variable: cueTimeElapsed
  - Variable: cueTimeElapsed_hhmmss
  - Variable: cueTimeElapsed_h
  - Variable: cueTimeElapsed_m
  - Variable: cueTimeElapsed_s

### v3.6.0

- New
  - Ability to select "all" in Cue ID-based actions to apply action to all cues
  - Feedback: Cue ID - Audio Status
  - Action: Toggle Video Output
  - Action: Video Outputs On
  - Action: Video Outputs Off
  - Variable: cueTimeLeft_hhmmss
  - Variable: currentCueTRT_hhmmss
  - Variable: currentCueTRT_h
  - Variable: currentCueTRT_m
  - Variable: currentCueTRT_s

### v3.5.0

- New
  - Action: Set Cue Playback Speed
  - Action: Toggle Video Output
  - Action: Video Outputs On
  - Action: Video Outputs Off

### v3.4.1

- Fix
  - Prevent error if timecode doesn't match expected format
  - Cue time variables showing as undefined

### v3.4.0

- New
  - Action: Adjust Playhead

### v3.3.2

- Fix
  - Feedbacks not updating when variables change

### v3.3.1

- Fix
  - Variables in feedbacks not working

### v3.3.0

- New
  - Variable: currentCueAudio
  - Variable: currentCuePauseAtBeginning
  - Variable: currentCuePauseAtEnd
  - Variable: currentCueFadeIn
  - Variable: currentCueFadeOut
  - Variable: currentCueLoop
  - Variable: currentCueTransition
  - Variable: currentCueGoto

### v3.2.0

- New
  - Ability to set different values for horizontal and vertical scale in Cue Scale action

### v3.1.0

- New
  - Action: Toggle Goto Cue after End
  - Action: Goto after End On
  - Action: Goto after End Off
  - Action: Set Goto after End Cue

### v3.0.0

- New
  - Rewrite module for Companion v3

### Versions Before v3.0.0

Versions of the module before v3.0.0 are no longer supported.
