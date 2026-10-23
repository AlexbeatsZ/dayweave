import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** Shared native dialog lifecycle, focus restoration and Android back priority. */
export function Modal({
  title,
  close,
  children,
  sheet = false,
  wide = false,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  sheet?: boolean;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const dialog = ref.current!,
      previous = document.activeElement as HTMLElement;
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
      className={sheet ? 'phone-sheet' : wide ? 'wide-dialog' : ''}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target !== ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        if (
          event.clientY < rect.top ||
          event.clientY > rect.bottom ||
          event.clientX < rect.left ||
          event.clientX > rect.right
        )
          close();
      }}
    >
      {sheet && <span className="sheet-handle" aria-hidden />}
      <header className={sheet ? 'phone-sheet-header' : 'dialog-header'}>
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label={sheet ? `关闭${title}` : '关闭对话框'}
          onClick={close}
        >
          <X size={21} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
