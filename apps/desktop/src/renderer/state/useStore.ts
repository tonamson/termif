import { useSyncExternalStore } from 'react'

export interface Observable<T> {
  get(): T
  set(next: T | ((current: T) => T)): void
  subscribe(listener: () => void): () => void
}

/**
 * The whole state layer. `useSyncExternalStore` is React's own primitive for
 * subscribing to external state, so a state library would add a dependency and
 * a concept without adding a capability.
 */
export function createStore<T>(initial: T): Observable<T> {
  let value = initial
  const listeners = new Set<() => void>()

  return {
    get: () => value,

    set(next) {
      const resolved =
        typeof next === 'function' ? (next as (current: T) => T)(value) : next
      if (resolved === value) return
      value = resolved
      for (const listener of listeners) listener()
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export function useStore<T>(store: Observable<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

/** Reads one derived slice, so a component re-renders only when that changes. */
export function useSelector<T, S>(store: Observable<T>, select: (value: T) => S): S {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.get()),
    () => select(store.get()),
  )
}
