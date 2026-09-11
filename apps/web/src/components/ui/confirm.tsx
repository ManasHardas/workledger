import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { Button } from "./button.js";

/**
 * Arm-then-confirm, as one latch (#138).
 *
 * #134 made every destructive *button* two-step, and left `x` discarding a backlog item in one
 * keystroke — so the keyboard was the unsafe path. The fix is not a second two-step implementation
 * for shortcuts: it is this latch, which a view can hold above its rows so a keystroke arms the
 * very control a pointer would have armed. One armed control at a time, one place that knows which
 * one it is, one Escape that disarms it.
 */

/** Which control is armed, and where focus goes when it is disarmed. */
interface ArmLatch {
  key: string | null;
  /** The control a disarm asked focus back for — Escape must not drop it on `<body>`. */
  restore: string | null;
}

export interface Arm {
  /** The armed control's key, or `null`. */
  armed: string | null;
  isArmed: (key: string) => boolean;
  arm: (key: string) => void;
  /** `restoreFocus` puts focus back on the control that was armed, rather than losing it. */
  disarm: (options?: { restoreFocus?: boolean }) => void;
  /** Asked by the control that has just taken the focus back, so it is handed back only once. */
  restoreTaken: (key: string) => void;
  restoring: string | null;
}

/**
 * The latch. A view that wires a shortcut to a row's confirming control holds one of these and
 * hands it to every {@link ConfirmAction} in the list; a control with no view above it makes its
 * own, which is the uncontrolled two-step of #134 unchanged.
 */
export function useArm(): Arm {
  const [latch, setLatch] = useState<ArmLatch>({ key: null, restore: null });

  const arm = useCallback((key: string) => setLatch({ key, restore: null }), []);
  const disarm = useCallback(
    (options?: { restoreFocus?: boolean }) =>
      setLatch((prior) =>
        // Identity-stable when there is nothing to disarm: `j`/`k` clear the latch on every press,
        // and a fresh object each time would re-render the whole list for nothing.
        prior.key === null && prior.restore === null
          ? prior
          : { key: null, restore: options?.restoreFocus === true ? prior.key : null },
      ),
    [],
  );
  const restoreTaken = useCallback(
    (key: string) =>
      setLatch((prior) => (prior.restore === key ? { ...prior, restore: null } : prior)),
    [],
  );

  return useMemo(
    () => ({
      armed: latch.key,
      restoring: latch.restore,
      isArmed: (key: string) => latch.key === key,
      arm,
      disarm,
      restoreTaken,
    }),
    [latch, arm, disarm, restoreTaken],
  );
}

/**
 * A destructive action as the direction wants it (#134): a quiet control in the list, and the
 * destructive colour only on the step that actually confirms it.
 *
 * Two steps, never a `window.confirm`: the first arms the control and the second runs it. Arming
 * changes the accessible name to the confirming sentence *and* says so in a live region, so the
 * announcement and the paint agree. Escape, a click on `Keep`, and moving focus out of the pair
 * all disarm it, and Escape hands focus back to the control that was armed (#138) rather than
 * dropping the keyboard operator at the top of the page.
 *
 * `arm` and `armKey` are how a view gives a keyboard shortcut the same latch: pass both, and
 * `arm.arm(armKey)` from a `keydown` arms this exact button.
 */
export function ConfirmAction({
  label,
  confirmLabel,
  cancelLabel = "Keep",
  onConfirm,
  disabled,
  size = "xs",
  arm,
  armKey,
}: {
  label: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  disabled?: boolean;
  size?: "xs" | "sm";
  /** The view's latch, when a shortcut has to arm this control too. */
  arm?: Arm;
  armKey?: string;
}) {
  // Hooks are unconditional; which latch is *used* is not. A control with no view above it gets
  // its own, so the uncontrolled two-step keeps working exactly as it did.
  const own = useArm();
  const fallbackKey = useId();
  const latch = arm ?? own;
  const key = armKey ?? fallbackKey;
  const armed = latch.isArmed(key);

  const trigger = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  // Focus lands on the confirming control, so Enter (or the shortcut again) is the whole gesture.
  useEffect(() => {
    if (armed) confirm.current?.focus();
  }, [armed]);

  // …and comes back here when Escape disarms it.
  useEffect(() => {
    if (latch.restoring !== key) return;
    trigger.current?.focus();
    latch.restoreTaken(key);
  }, [latch, key]);

  useEffect(() => {
    if (disabled === true && armed) latch.disarm();
  }, [disabled, armed, latch]);

  if (!armed) {
    return (
      <Button
        ref={trigger}
        type="button"
        variant="quiet"
        size={size}
        disabled={disabled}
        onClick={() => latch.arm(key)}
      >
        {label}
      </Button>
    );
  }

  return (
    <div
      ref={wrap}
      className="flex shrink-0 items-center gap-1"
      onBlur={(event) => {
        if (!wrap.current?.contains(event.relatedTarget as Node | null)) latch.disarm();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          latch.disarm({ restoreFocus: true });
        }
      }}
    >
      {/*
        The paint says "this is armed" with colour; this says it to a screen reader. The confirming
        button's name changes too, but a person who armed it from the keyboard may not have moved
        focus here yet, and an armed destructive control is not something to leave unannounced.
      */}
      <span role="status" className="sr-only">
        {`${label} armed. ${confirmLabel}, or Escape to keep it.`}
      </span>
      <Button
        ref={confirm}
        type="button"
        variant="danger"
        size={size}
        disabled={disabled}
        onClick={() => {
          latch.disarm();
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
      <Button
        type="button"
        variant="quiet"
        size={size}
        onClick={() => latch.disarm({ restoreFocus: true })}
      >
        {cancelLabel}
      </Button>
    </div>
  );
}
