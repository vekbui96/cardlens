import { KeyboardBackedInputAdapter } from "./KeyboardBackedInputAdapter.ts";

/**
 * Desktop development adapter. Maps arrow keys / Enter / Escape to wearable
 * events so the entire app is controllable from a Windows keyboard. Shares the
 * same implementation as the Meta adapter (the glasses emit keyboard events).
 */
export class KeyboardInputAdapter extends KeyboardBackedInputAdapter {}
