import { useEffect, useState } from 'react';

/**
 * Returns `value` once it has stopped changing for `delay` ms. Used to keep
 * typeahead inputs from firing a relay query on every keystroke.
 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
