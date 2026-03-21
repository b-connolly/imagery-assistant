import { useEffect, useRef } from "react";
import type { ViewType } from "../utils/viewManager";

interface ViewToggleProps {
  currentView: ViewType;
  onToggle: (viewType: ViewType) => void;
}

export default function ViewToggle({ currentView, onToggle }: ViewToggleProps) {
  const controlRef = useRef<HTMLElement | null>(null);
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;

  const currentViewRef = useRef(currentView);
  currentViewRef.current = currentView;

  useEffect(() => {
    const el = controlRef.current;
    if (!el) return;

    const handler = () => {
      const value = (el as any).value as ViewType;
      if (value && value !== currentViewRef.current) {
        onToggleRef.current(value);
      }
    };

    el.addEventListener("calciteSegmentedControlChange", handler);
    return () => el.removeEventListener("calciteSegmentedControlChange", handler);
  }, []);

  return (
    <calcite-segmented-control
      ref={controlRef}
      scale="s"
      width="auto"
    >
      <calcite-segmented-control-item
        value="2d"
        checked={currentView === "2d" ? true : undefined}
      >
        2D
      </calcite-segmented-control-item>
      <calcite-segmented-control-item
        value="3d"
        checked={currentView === "3d" ? true : undefined}
      >
        3D
      </calcite-segmented-control-item>
    </calcite-segmented-control>
  );
}
