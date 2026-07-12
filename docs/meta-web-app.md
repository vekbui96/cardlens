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
