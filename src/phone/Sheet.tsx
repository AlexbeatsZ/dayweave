import type { ReactNode } from 'react';
import { Modal } from '../components/Modal';
export function Sheet({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  return (
    <Modal title={title} close={close} sheet>
      {children}
    </Modal>
  );
}
