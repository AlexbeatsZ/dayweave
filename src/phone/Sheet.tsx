import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Sheet({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement;
    dialog.showModal();
    const back = (event: Event) => {
      if ([...document.querySelectorAll('dialog[open]')].at(-1) !== dialog) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeRef.current();
    };
    document.addEventListener('clearlist:back', back, true);
    return () => {
      dialog.close();
      document.removeEventListener('clearlist:back', back, true);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="phone-sheet"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === ref.current) {
          const rect = ref.current.getBoundingClientRect();
          if (event.clientY < rect.top || event.clientX < rect.left || event.clientX > rect.right)
            close();
        }
      }}
    >
      <span className="sheet-handle" aria-hidden />
      <header className="phone-sheet-header">
        <h2>{title}</h2>
        <button className="icon-button" aria-label={`关闭${title}`} onClick={close}>
          <X size={21} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
