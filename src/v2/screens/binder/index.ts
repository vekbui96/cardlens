/**
 * The binder builder.
 *
 * `BinderScreen` is what the router mounts. `BinderSpread` is deliberately part
 * of the public surface: the public share pages (spec 07) render the identical
 * geometry from it, so the owner laying a binder out sees exactly what the
 * recipient will see, with no separate preview to drift out of step.
 */
export { BinderScreen } from "./BinderScreen.tsx";
export { BinderSpread, type BinderSpreadProps } from "./BinderSpread.tsx";
