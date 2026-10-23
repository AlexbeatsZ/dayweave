import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
export function Dialog({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
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
      className={wide ? 'wide-dialog' : ''}
      aria-label={title}
      onCancel={close}
      onClick={(event) => {
        if (event.target === ref.current) close();
      }}
    >
      <header className="dialog-header">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="关闭对话框" onClick={close}>
          <X size={19} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
