import { useEffect, useState } from 'react';
import type { Round } from '../../shared/types/api';

export function useRounds(): {
  rounds: Round[];
  loading: boolean;
  error: string | null;
  currentRound: Round | null;
} {
  const [rounds, setRounds] = useState<Round[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch('/api/round');
        const data = await res.json().catch(() => ({}));
        console.log('[useRounds] /api/round status:', res.status, 'response:', data);

        if (!res.ok) {
          console.log('[useRounds] Error response body:', data);
          throw new Error('Failed to load round');
        }

        const roundData = data.round ?? null;
        if (roundData == null) {
          if (data.debug) console.log('[useRounds] No round. Debug:', data.debug);
          if (!cancelled) setRounds([]);
          return;
        }

        const round: Round = {
          id: roundData.id,
          imageUrl: roundData.imageUrl,
          answer: roundData.answer,
          celebrityName: roundData.celebrityName,
          used: roundData.used ?? true,
        };
        if (!cancelled) setRounds([round]);
      } catch (e) {
        console.log('[useRounds] Error:', e);
        if (!cancelled) setError(e instanceof Error ? e.message : 'Unknown error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const currentRound: Round | null = rounds.length > 0 ? (rounds[0] ?? null) : null;

  return { rounds, loading, error, currentRound };
}
