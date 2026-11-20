import React from 'react';
import { Crosshair, Minus, Plus } from 'lucide-react';
import { MAX_ZOOM, MIN_ZOOM } from '../utils/camera';

interface ZoomControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onCenterBase: () => void;
}

export const ZoomControls: React.FC<ZoomControlsProps> = ({
  zoom,
  onZoomIn,
  onZoomOut,
  onCenterBase,
}) => {
  const atMax = zoom >= MAX_ZOOM - 0.01;
  const atMin = zoom <= MIN_ZOOM + 0.01;

  return (
    <div
      className="pointer-events-auto fixed bottom-4 right-4 z-20 flex flex-col items-center gap-1.5 p-1.5 rounded-xl border border-white/15 shadow-lg"
      style={{ backgroundColor: 'rgba(15, 23, 42, 0.88)' }}
      aria-label="Kontrolki kamery"
    >
      <button
        type="button"
        onClick={(e) => {
          e.currentTarget.blur();
          onZoomIn();
        }}
        disabled={atMax}
        aria-label="Przybliż mapę"
        title="Przybliż (+)"
        className="w-11 h-11 rounded-lg flex items-center justify-center bg-slate-800 text-slate-100 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
      >
        <Plus className="w-5 h-5" aria-hidden="true" />
      </button>

      <div
        className="text-xs font-semibold text-amber-300 font-mono-nums py-0.5 select-none"
        aria-live="polite"
      >
        {zoom.toFixed(1)}x
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.currentTarget.blur();
          onZoomOut();
        }}
        disabled={atMin}
        aria-label="Oddal mapę"
        title="Oddal (-)"
        className="w-11 h-11 rounded-lg flex items-center justify-center bg-slate-800 text-slate-100 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
      >
        <Minus className="w-5 h-5" aria-hidden="true" />
      </button>

      <div className="w-7 h-px bg-white/15 my-0.5" aria-hidden="true" />

      <button
        type="button"
        onClick={(e) => {
          e.currentTarget.blur();
          onCenterBase();
        }}
        aria-label="Centruj na Bazę"
        title="Centruj na Bazę"
        className="w-11 h-11 rounded-lg flex items-center justify-center bg-slate-800 text-amber-400 hover:bg-slate-700 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
      >
        <Crosshair className="w-5 h-5" aria-hidden="true" />
      </button>
    </div>
  );
};
