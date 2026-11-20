import React from 'react';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  GitBranch,
  Layers,
  Move,
  Pencil,
  PlusCircle,
  Signpost,
  Trash2,
} from 'lucide-react';
import type { EditorTool } from '../types/roadGraph';

interface ToolbarProps {
  editMode: boolean;
  showGrid: boolean;
  footprintOnly: boolean;
  showStreetNames: boolean;
  activeTool: EditorTool;
  copied: boolean;
  nodeCount: number;
  edgeCount: number;
  buildingCount: number;
  onToggleEditMode: () => void;
  onToggleGrid: () => void;
  onToggleFootprintOnly: () => void;
  onToggleStreetNames: () => void;
  onSelectTool: (tool: EditorTool) => void;
  onCopyJson: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  editMode,
  showGrid,
  footprintOnly,
  showStreetNames,
  activeTool,
  copied,
  nodeCount,
  edgeCount,
  buildingCount,
  onToggleEditMode,
  onToggleGrid,
  onToggleFootprintOnly,
  onToggleStreetNames,
  onSelectTool,
  onCopyJson,
}) => {
  const toolButtonClass = (tool: EditorTool) =>
    `min-h-[40px] sm:min-h-[38px] px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
      activeTool === tool
        ? tool === 'delete'
          ? 'bg-red-600 text-white'
          : 'bg-amber-500 text-slate-950'
        : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700'
    }`;

  return (
    <div className="pointer-events-none fixed top-0 left-0 right-0 z-20 p-2 sm:p-3 flex flex-col items-start gap-1.5 sm:gap-2">
      <div
        className="pointer-events-auto w-full flex items-center justify-between gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl border border-white/15 shadow-lg overflow-x-auto"
        style={{ backgroundColor: 'rgba(15, 23, 42, 0.88)' }}
      >
        {/* Left: Brand & Core Mode Toggles */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <span className="text-sm sm:text-base font-bold tracking-tight text-amber-400 whitespace-nowrap shrink-0 pr-0.5 sm:pr-1">
            Delivery Tycoon
          </span>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleEditMode();
            }}
            aria-pressed={editMode}
            className={`min-h-[40px] px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
              editMode
                ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                : 'bg-slate-800 text-slate-100 hover:bg-slate-700 border border-white/10'
            }`}
          >
            <Pencil className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Tryb Edycji</span>
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleFootprintOnly();
            }}
            aria-pressed={footprintOnly}
            aria-label="Podstawy budynków"
            className={`min-h-[40px] px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
              footprintOnly
                ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                : 'bg-slate-800 text-slate-100 hover:bg-slate-700 border border-white/10'
            }`}
          >
            <Layers className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span className="sm:hidden">Podstawy</span>
            <span className="hidden sm:inline">Podstawy budynków</span>
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleStreetNames();
            }}
            aria-pressed={showStreetNames}
            aria-label="Nazwy ulic"
            className={`min-h-[40px] px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
              showStreetNames
                ? 'bg-sky-500/25 text-sky-200 border border-sky-400/50 hover:bg-sky-500/35'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-white/10'
            }`}
          >
            <Signpost className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Nazwy ulic</span>
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleGrid();
            }}
            aria-pressed={showGrid}
            aria-label={showGrid ? 'Ukryj siatkę dróg' : 'Pokaż siatkę dróg'}
            className="min-h-[40px] px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 bg-slate-800 text-slate-100 hover:bg-slate-700 border border-white/10 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
          >
            {showGrid ? (
              <>
                <EyeOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span className="sm:hidden">Ukryj siatkę</span>
                <span className="hidden sm:inline">Ukryj siatkę dróg</span>
              </>
            ) : (
              <>
                <Eye className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span className="sm:hidden">Pokaż siatkę</span>
                <span className="hidden sm:inline">Pokaż siatkę dróg</span>
              </>
            )}
          </button>
        </div>

        {/* Right: Map stats (desktop) & Copy JSON in Edit Mode */}
        <div className="flex items-center gap-3 ml-auto shrink-0">
          <div className="hidden lg:flex items-center gap-1.5 text-xs text-slate-300 font-mono-nums whitespace-nowrap">
            <span>{buildingCount} budynków</span>
            <span aria-hidden="true">·</span>
            <span>{nodeCount} węzłów</span>
            <span aria-hidden="true">·</span>
            <span>{edgeCount} połączeń</span>
          </div>

          {editMode && (
            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                onCopyJson();
              }}
              className={`hidden sm:flex min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-semibold items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 ${
                copied
                  ? 'bg-emerald-500 text-slate-950'
                  : 'bg-sky-500 text-slate-950 hover:bg-sky-400'
              }`}
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Skopiowano JSON</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Kopiuj JSON</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Edit Mode Tool Sub-bar (single compact scrollable row on mobile) */}
      {editMode && (
        <div
          className="pointer-events-auto max-w-full flex items-center gap-1.5 px-2 py-1.5 rounded-xl border border-white/15 shadow-lg overflow-x-auto"
          style={{ backgroundColor: 'rgba(15, 23, 42, 0.88)' }}
          role="toolbar"
          aria-label="Narzędzia edycji grafu dróg"
        >
          <button
            type="button"
            onClick={() => onSelectTool('move')}
            aria-pressed={activeTool === 'move'}
            className={toolButtonClass('move')}
          >
            <Move className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Przesuń</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectTool('add')}
            aria-pressed={activeTool === 'add'}
            className={toolButtonClass('add')}
          >
            <PlusCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Dodaj węzeł</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectTool('connect')}
            aria-pressed={activeTool === 'connect'}
            className={toolButtonClass('connect')}
          >
            <GitBranch className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Połącz / Rozłącz</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectTool('delete')}
            aria-pressed={activeTool === 'delete'}
            className={toolButtonClass('delete')}
          >
            <Trash2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Usuń węzeł</span>
          </button>

          {/* Copy JSON inside mobile toolbar row */}
          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onCopyJson();
            }}
            className={`sm:hidden min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 ${
              copied
                ? 'bg-emerald-500 text-slate-950'
                : 'bg-sky-500 text-slate-950 hover:bg-sky-400'
            }`}
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Skopiowano</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Kopiuj JSON</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};
