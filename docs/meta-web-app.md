# Meta Ray-Ban Display — Web Apps integration

> Status: **Developer Preview.** Everything here was verified against official Meta sources on
> 2026-07-11. Where a capability is not officially documented, it is flagged
> **UNVERIFIED** — we do not invent Meta APIs.

## Official sources

- Announcement — https://developers.meta.com/blog/build-for-display-glasses/
- Web Apps overview — https://wearables.developer.meta.com/docs/develop/webapps/
- Setup (Developer Mode) — https://wearables.developer.meta.com/docs/develop/webapps/setup/
- Build (input, capabilities, viewport) — https://wearables.developer.meta.com/docs/develop/webapps/build/
- Test (add to glasses, share) — https://wearables.developer.meta.com/docs/develop/webapps/test/
- FAQ — https://developers.meta.com/wearables/faq/
- Starter kit — https://github.com/facebookincubator/meta-wearables-webapp

## What the platform is

Meta offers two build paths for Ray-Ban Display glasses: the native **Wearables Device Access
Toolkit (DAT)** for iOS/Android, and **Web Apps** — standard HTML/CSS/JavaScript served over HTTPS
and rendered on the glasses' built-in display. CardLens uses the **Web Apps** path.

Web Apps are in **Developer Preview**: you can build and test on your own glasses, but you cannot
yet publish to end users.

## Input model (the important part)

**There is no custom gesture API and no JavaScript SDK.** The glasses OS translates Neural Band
(EMG wristband) and captouch gestures into **standard DOM keyboard events**:

| Physical gesture                    | DOM event                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------- |
| Swipe up / down / left / right      | `keydown` with `key` = `ArrowUp` / `ArrowDown` / `ArrowLeft` / `ArrowRight` |
| Index-finger pinch (select)         | `keydown` with `key` = `Enter`                                              |
| Middle-finger pinch (cancel / back) | `keydown` with `key` = `Escape`                                             |

Consequences we rely on:

- Input is handled with ordinary `window` `keydown` listeners. The navigation model is a **D-pad**:
  move a focus ring, select, cancel.
- **No continuous cursor / pointer.** Do not rely on hover, pointer position, or drag.
- **The middle-finger pinch is partly reserved** by the OS: besides emitting `Escape`, it can
  surface a universal Web App menu (restart / resume / permissions). We treat `Escape` as "back".
- **No `@meta`/`@facebook` npm package exists** for the web runtime. Any tutorial referencing one is
  fabricated. CardLens depends on none.

Because Meta's production input == the desktop arrow-key mapping, the **same** input adapter drives
both glasses and desktop. See `src/integrations/meta/`.

## Capabilities

Officially supported for Web Apps:

- `localStorage` / `sessionStorage` (persist across sessions; ~5 MB).
- `DeviceMotionEvent` / `DeviceOrientationEvent` (accelerometer, gyroscope, compass; may require
  `DeviceOrientationEvent.requestPermission()`).
- `navigator.geolocation` — location comes from the **paired phone**, not the glasses.
- Display: **fixed 600×600 px viewport, no scrolling.** Additive display — a **black background is
  transparent**; use bright, high-contrast foreground colors.

Officially **NOT** supported (design around these):

- **Text input** (no keyboard, no documented dictation).
- Camera, microphone.
- Offline support, notifications, back-navigation affordance, continuous cursor.

**UNVERIFIED** (not in the capability docs — treat as risk, verify on-device):

- Cross-origin `fetch` / XHR / WebSocket to third-party APIs (e.g. `api.pokemontcg.io`).
- The exact Chromium/WebView version and CSS/JS feature level.
- Any Content-Security-Policy the runtime imposes.

CardLens mitigates the networking uncertainty by being cached-first with an explicit network-error
state, and by allowing `VITE_API_BASE_URL` to point at a same-origin proxy in `server/` if direct
calls are blocked on-device.

## Recommended viewport / display setup

```html
<meta name="viewport" content="width=600, height=600, initial-scale=1.0, user-scalable=no" />
```

```css
html,
body {
  width: 600px;
  height: 600px;
  margin: 0;
  overflow: hidden;
  background: #000;
}
```

CardLens applies exactly this (see `index.html` and `src/styles/global.css`). In desktop dev the
600×600 surface is wrapped in a `GlassesFrame` preview; on glasses the app fills the display.

## How CardLens maps to the platform

| Platform fact            | CardLens implementation                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| Keyboard-event input     | `MetaWearableInputAdapter` (window `keydown` → `WearableInputEvent`)                                   |
| No text input            | `TextInputProvider` returns unsupported on glasses; recents/favorites/popular/browse + companion phone |
| 600×600 additive display | black `#000` background, bright tokens, no scroll, in-app paging                                       |
| localStorage             | versioned `storage/` layer                                                                             |
| HTTPS required           | static hosting on Vercel/Netlify/Cloudflare Pages (all HTTPS)                                          |

## Adding the deployed URL to your glasses

Requires Meta AI app **v272+** and glasses software **v125+**.

1. Open the **Meta AI** app → **Settings → App Info** → tap the **App version number 5 times** →
   **Enable Developer Mode**.
2. Back in the Meta AI app: **App Settings → App Connections → Web Apps → Add a Web App**.
3. Enter a name and your **HTTPS** CardLens URL → **Connect**.
4. CardLens appears at the bottom of the glasses app grid; launch it.
5. While running, a **middle-finger pinch** surfaces the universal Web App menu (restart / resume /
   permissions).

(The exact labels can shift during Developer Preview — re-verify against the Setup/Test docs above.)

## Gesture history and rules (moved from CLAUDE.md)

- **`keydown` is all the docs promise.** No key-up, no auto-repeat, no hold gesture. Anything derived from those must degrade gracefully — `SELECT` fires on press until a key-up proves the device sends them, because waiting for one that never comes would make the app unusable.
- 600×600 additive display: black is transparent. Prefer bright glyphs and shape differences over colour alone; every row of chrome costs roughly two card rows of list.
- No on-glasses keyboard. Text entry is the companion phone or the letter picker.

**Anything that behaves differently on the glasses than on desktop should be suspected first.** A triple-pinch gesture worked perfectly on a keyboard and never fired on the hardware, because it lived in the input adapter and reset on any stray event the neural band produced.

### Gestures, and what is actually confirmed on hardware

| Gesture                                  | Status                                             |
| ---------------------------------------- | -------------------------------------------------- |
| Swipes, pinch, middle-pinch              | Documented and working                             |
| **Triple-pinch on one card** (bulk mark) | **Confirmed working on the glasses**               |
| Hold                                     | **Tried and removed — never fired on the glasses** |

`keydown` really is all there is: a hold derived from key-up timing and auto-repeat worked on a desktop keyboard and did nothing on the device. Do not reach for it again.

Three rules came out of getting this wrong:

- **Burst detection belongs on the screen, not the input adapter.** The adapter cannot see what is focused, so it had to reset on every other event to avoid firing during rapid marking — and any stray event from the neural band then killed the gesture silently. Keyed on the focused card it is both stricter and more forgiving.
- **Gesture timings must suit a neural band, not a mouse.** 500ms between pinches was mouse double-click timing and felt broken; 1200ms works.
- **The viewport meta once hardcoded `width=600, height=600`**, so every device reported a 600×600 layout viewport and a phone was indistinguishable from the glasses in both JS and CSS. It is `width=device-width` now; the glasses report 600 naturally and their surface is a fixed 600px in CSS regardless.

## Two interaction models (detail)

`src/app/layoutMode.ts` resolves `glasses | web | preview`; `useIsWeb()` is what screens branch on. Override with `?ui=`.

The screens and all logic are shared — only interaction differs, and it differs completely:

- **Glasses**: focus ring driven by four gestures, fixed 600×600, no pointer. The collect-mode toggle and printing picker exist solely because a pinch needs something to say _which_ printing it means.
- **Web** (phone/browser, **confirmed working**): focus ring OFF — it preventDefaults arrows and Enter, which fights native scrolling. Printing badges are tappable buttons with 44px targets, so collect mode and the picker are hidden as they answer a question a finger never asks.

Detection is by **shape**, not size: the glasses are small AND square, a phone is small and tall.
