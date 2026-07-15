import { useCallback, useRef, useState } from "react";

/**
 * Small undo/redo state container.
 * - `set(next)` records a new history entry (push to past, clear future).
 * - `replace(next)` swaps the current value WITHOUT recording (use for initial load
 *   or when applying an undo/redo replay from outside).
 * - `undo()` / `redo()` walk the stack. `reset(v)` clears history entirely.
 */
export function useHistoryState<T>(initial: T, limit = 100) {
  const [state, setState] = useState<T>(initial);
  const pastRef = useRef<T[]>([]);
  const futureRef = useRef<T[]>([]);
  const [, force] = useState(0);
  const bump = () => force((n) => n + 1);

  const set = useCallback((next: T | ((prev: T) => T)) => {
    setState((prev) => {
      const value = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      if (Object.is(value, prev)) return prev;
      pastRef.current.push(prev);
      if (pastRef.current.length > limit) pastRef.current.shift();
      futureRef.current = [];
      bump();
      return value;
    });
  }, [limit]);

  const replace = useCallback((next: T) => {
    setState(next);
  }, []);

  const reset = useCallback((next: T) => {
    pastRef.current = [];
    futureRef.current = [];
    setState(next);
    bump();
  }, []);

  const undo = useCallback(() => {
    setState((prev) => {
      const past = pastRef.current;
      if (past.length === 0) return prev;
      const previous = past.pop() as T;
      futureRef.current.push(prev);
      bump();
      return previous;
    });
  }, []);

  const redo = useCallback(() => {
    setState((prev) => {
      const future = futureRef.current;
      if (future.length === 0) return prev;
      const next = future.pop() as T;
      pastRef.current.push(prev);
      bump();
      return next;
    });
  }, []);

  return {
    state,
    set,
    replace,
    reset,
    undo,
    redo,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
    pastCount: pastRef.current.length,
    futureCount: futureRef.current.length,
  };
}
