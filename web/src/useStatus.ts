import { useCallback, useEffect, useState } from 'react';
import { fetchStatus, UnauthorizedError } from './api.js';
import type { StatusResponse } from './types.js';

type State =
  | { phase: 'loading' }
  | { phase: 'unauthenticated' }
  | { phase: 'ready'; data: StatusResponse }
  | { phase: 'error'; message: string };

export function useStatus(slug?: string) {
  const [state, setState] = useState<State>({ phase: 'loading' });

  const load = useCallback(async () => {
    setState({ phase: 'loading' });
    try {
      const data = await fetchStatus(slug);
      setState({ phase: 'ready', data });
    } catch (err) {
      if (err instanceof UnauthorizedError) setState({ phase: 'unauthenticated' });
      else setState({ phase: 'error', message: (err as Error).message });
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  // Directly replace status data after a student-ID submission (no refetch).
  const setData = useCallback((data: StatusResponse) => setState({ phase: 'ready', data }), []);

  return { state, reload: load, setData };
}
