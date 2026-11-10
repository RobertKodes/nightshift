import { useEffect, useState } from "react";

/** True while the visitor asks for less motion; follows the setting if it changes. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)"), update = () => setReduced(query.matches);
    query.addEventListener("change", update); return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}
