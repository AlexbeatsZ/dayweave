import { LoadingIndicator as ExpressiveLoadingIndicator } from '@kyralabs/m3e-react';
import '@kyralabs/m3e-css/loading-indicator.css';

/** Compose's seven-shape sequence and spring choreography, ported by M3 Expressive Web. */
export function LoadingIndicator({ label = '正在加载' }: { label?: string }) {
  return <ExpressiveLoadingIndicator contained aria-label={label} />;
}
