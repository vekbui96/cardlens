import { KeyboardBackedInputAdapter } from "./KeyboardBackedInputAdapter.ts";

/**
 * Production adapter for Meta Ray-Ban Display. The glasses OS delivers Neural Band
 * and captouch gestures as standard DOM keyboard events (Arrow keys / Enter /
 * Escape), so this uses only documented web APIs — no invented Meta SDK. It is
 * intentionally identical to the desktop keyboard mapping.
 */
export class MetaWearableInputAdapter extends KeyboardBackedInputAdapter {}
