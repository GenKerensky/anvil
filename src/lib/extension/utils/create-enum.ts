/**
 * Turns an array into an immutable enum-like object.
 * Leaf module — no imports — safe for constants/tree (avoids utils cycles).
 */
export function createEnum<T extends string>(anArray: T[]): { [K in T]: K } {
  const enumObj = {} as { [K in T]: K };
  for (const val of anArray) {
    enumObj[val] = val;
  }
  return Object.freeze(enumObj);
}
