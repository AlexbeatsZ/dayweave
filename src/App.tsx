import { useApplicationTheme, useCountdownCompletion } from './runtime';
import { MobileApp } from './phone/MobileApp';
import { useFudanRefresh } from './useFudanRefresh';

/** A single navigation and interaction owner; layout responds without remounting. */
export function App() {
  useApplicationTheme();
  useCountdownCompletion();
  useFudanRefresh();
  return <MobileApp />;
}
