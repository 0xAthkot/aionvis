import { useEffect, useState } from "react";

/** Returns `value` after it has been stable for `ms` milliseconds. */
export function useDebouncedValue<T>(value: T, ms = 400): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);

  return debounced;
}
