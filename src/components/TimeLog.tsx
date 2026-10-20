import Workspace from '../timelog/Workspace';
import { useStore } from '../store';
import '../timelog/scoped.css';
export function TimeLog() {
  const { data } = useStore();
  return (
    <div
      className="timelog-module"
      data-theme={
        data.settings.theme === 'system'
          ? document.documentElement.dataset.theme
          : data.settings.theme
      }
    >
      <Workspace />
    </div>
  );
}
