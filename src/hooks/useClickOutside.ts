import { useEffect, type RefObject } from "react";

/** Close a menu/popover when clicking or focusing outside the container. */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onOutside: () => void
) {
  useEffect(() => {
    if (!active) return;

    const onPointerDown = (event: PointerEvent) => {
      const node = ref.current;
      if (!node) return;
      const target = event.target;
      if (target instanceof Node && node.contains(target)) return;
      onOutside();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOutside();
    };

    // Capture so it still runs if a child stops propagation.
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [active, onOutside, ref]);
}
