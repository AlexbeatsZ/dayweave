import { useApplicationTheme, useCountdownCompletion } from './runtime';
import { MobileApp } from './phone/MobileApp';

/** A single navigation and interaction owner; layout responds without remounting. */
export function App() {
  useApplicationTheme();
  useCountdownCompletion();
  return <MobileApp />;
}
