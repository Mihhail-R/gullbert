import type { ReadonlyValue } from "./presentation.js";

/** Detach observations before freezing, so readers cannot reach owned records. */
export function observe<T>(value: T): ReadonlyValue<T> {
  return freeze(structuredClone(value));
}

function freeze<T>(value: T): ReadonlyValue<T> {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) {
      freeze(child);
    }

    Object.freeze(value);
  }

  return value as ReadonlyValue<T>;
}
