import { useQuery } from '@tanstack/react-query';
import { loadBirdLabels, type BirdLabel } from '@/lib/birdnet/labels';

export function useBirdLabels() {
  return useQuery<BirdLabel[]>({
    queryKey: ['birdnet-labels'],
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: loadBirdLabels,
  });
}
