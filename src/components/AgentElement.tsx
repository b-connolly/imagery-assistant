import { useRef, useEffect } from "react";
import type { AgentRegistration } from "@arcgis/ai-components/utils/index.js";

/**
 * Wrapper for <arcgis-assistant-agent> that sets the `agent` property
 * imperatively. Required because React 18 passes custom element props
 * as attributes (stringified), not properties. React 19+ handles this
 * natively, so this wrapper can be removed after upgrading.
 */
export default function AgentElement({ agent }: { agent: AgentRegistration }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (ref.current) {
      (ref.current as any).agent = agent;
    }
  }, [agent]);

  return <arcgis-assistant-agent ref={ref} />;
}
