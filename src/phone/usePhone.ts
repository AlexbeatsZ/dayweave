import { useSyncExternalStore } from 'react';

const media = () => window.matchMedia('(max-width: 700px)');
export function usePhone() {
  return useSyncExternalStore(
    (notify) => {
      const query = media();
      query.addEventListener('change', notify);
      return () => query.removeEventListener('change', notify);
    },
    () => media().matches,
  );
}
