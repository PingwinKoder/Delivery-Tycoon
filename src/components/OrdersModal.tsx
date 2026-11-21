import React, { useEffect } from 'react';
import { Files, X } from 'lucide-react';

interface OrdersModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const OrdersModal: React.FC<OrdersModalProps> = ({ isOpen, onClose }) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-6 bg-slate-950/65 backdrop-blur-[2px] touch-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="orders-modal-title"
      onClick={onClose}
      onWheel={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      <div
        className="w-full max-w-3xl h-[min(78vh,620px)] flex flex-col rounded-2xl border border-white/15 shadow-2xl overflow-hidden text-slate-100 touch-auto overscroll-contain"
        style={{ backgroundColor: 'rgba(15, 23, 42, 0.96)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with single active tab "Zlecenia" and close button */}
        <div className="flex items-center justify-between gap-2 px-3 sm:px-5 py-2.5 sm:py-3 border-b border-white/10 bg-slate-900/80">
          <div className="flex items-center gap-1.5" role="tablist" aria-label="Zakładki panelu zleceń">
            <button
              id="orders-modal-title"
              type="button"
              role="tab"
              aria-selected={true}
              className="min-h-[40px] px-3.5 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 bg-amber-500 text-slate-950 shadow-sm cursor-default touch-manipulation"
            >
              <Files className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Zlecenia</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij okno Zlecenia"
            className="min-w-[40px] min-h-[40px] p-2 rounded-lg flex items-center justify-center text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700 border border-white/10 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Empty workspace area prepared for future order offers and weekly calendar */}
        <div
          role="tabpanel"
          aria-labelledby="orders-modal-title"
          className="flex-1 p-4 sm:p-6 overflow-y-auto overscroll-contain"
        >
          <div className="w-full h-full rounded-xl border border-dashed border-white/10 bg-slate-950/35" />
        </div>
      </div>
    </div>
  );
};
