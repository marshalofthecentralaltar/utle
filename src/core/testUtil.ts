/** Recursively freezes a value so a test fails loudly if code under test mutates it. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
  }
  return value
}

export function clone<T>(value: T): T {
  return structuredClone(value)
}
