"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Traps Tab focus inside a drawer while it is presented as an overlay (the
// supplied media query matches), moves focus into the drawer on open, and
// restores focus to the previously focused element on close. On wide layouts
// where the same element renders as a static panel, focus is left alone.
export function useDrawerFocus(
  open: boolean,
  drawerRef: RefObject<HTMLElement | null>,
  overlayMediaQuery: string,
): void {
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    if (!window.matchMedia(overlayMediaQuery).matches) return;
    const drawer = drawerRef.current;
    if (!drawer) return;

    restoreTo.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const focusables = () =>
      [...drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        (element) => element.getClientRects().length > 0,
      );
    // The drawer opens with a transition; wait a frame so elements are visible.
    const focusFrame = window.requestAnimationFrame(() => focusables()[0]?.focus());

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab" || !drawer) return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && drawer.contains(active);
      if (event.shiftKey && (active === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown, true);
      restoreTo.current?.focus();
    };
  }, [open, drawerRef, overlayMediaQuery]);
}
