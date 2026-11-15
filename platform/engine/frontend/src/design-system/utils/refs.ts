import { ReactElement, Ref } from "react";

export const assignRef = <T>(ref: Ref<T> | undefined, value: T | null) => {
  if (typeof ref === "function") ref(value);
  else if (ref && typeof ref === "object") Reflect.set(ref, "current", value);
};

// The ref a caller put on an element that a primitive clones, so both can hold the node.
export const elementRef = <T>(element: ReactElement) =>
  (element as ReactElement & { ref?: Ref<T> }).ref;
