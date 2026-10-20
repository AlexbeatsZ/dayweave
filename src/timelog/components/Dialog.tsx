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
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
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
