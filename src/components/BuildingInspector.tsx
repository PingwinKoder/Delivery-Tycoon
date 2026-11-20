import React from 'react';
import {
  Bike,
  Building2,
  Bus,
  Home,
  Layers,
  MapPin,
  PackageCheck,
  ShoppingBag,
  Store,
  Truck,
  X,
} from 'lucide-react';
import {
  BUILDING_TYPE_META,
  type Building,
  formatBuildingAddress,
} from '../types/building';
import { getBuildingPalette } from '../utils/buildings';

interface BuildingInspectorProps {
  building: Building;
  onClose: () => void;
  onDispatchCourier?: (building: Building) => void;
}

export const BuildingInspector: React.FC<BuildingInspectorProps> = ({
  building,
  onClose,
  onDispatchCourier,
}) => {
  const meta = BUILDING_TYPE_META[building.typ];
  const palette = getBuildingPalette(building.typ, building.colorVariant);
  const fullAddress = formatBuildingAddress(building);

  const canDeliver =
    building.typ !== 'baza' &&
    building.dostepnyDlaDostaw !== false &&
    Boolean(building.deliveryStopPoint && building.roadApproachPoint);

  const stopSurfaceLabel =
    building.deliveryStopPoint?.surface === 'delivery_zone'
      ? 'Dedykowana strefa dostaw (osobny wjazd)'
      : building.deliveryStopPoint?.surface === 'gate'
        ? 'Postój przy furtce (wejście na podwórko)'
        : building.deliveryStopPoint?.surface === 'parking'
          ? 'Postój na przyległym parkingu'
          : building.deliveryStopPoint?.surface === 'sidewalk'
            ? 'Postój na chodniku przy wejściu'
            : 'Postój na placu przed wejściem';

  const renderIcon = () => {
    switch (building.typ) {
      case 'baza':
        return <Truck className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />;
      case 'dworzec':
        return <Bus className="w-4 h-4 text-teal-400 shrink-0" aria-hidden="true" />;
      case 'sklep':
        return <Store className="w-4 h-4 text-sky-400 shrink-0" aria-hidden="true" />;
      case 'kiosk':
        return <ShoppingBag className="w-4 h-4 text-teal-300 shrink-0" aria-hidden="true" />;
      case 'dom':
        return <Home className="w-4 h-4 text-orange-300 shrink-0" aria-hidden="true" />;
      default:
        return <Building2 className="w-4 h-4 text-slate-200 shrink-0" aria-hidden="true" />;
    }
  };

  const isResidential =
    building.typ === 'blok_maly' ||
    building.typ === 'blok_sredni' ||
    building.typ === 'blok_wysoki' ||
    building.typ === 'dom';

  return (
    <aside
      data-testid="building-inspector"
      role="region"
      aria-label="Inspektor budynku"
      className="pointer-events-auto fixed bottom-16 left-3 sm:left-4 z-20 w-[min(328px,calc(100vw-5.5rem))] sm:w-80 rounded-xl border border-white/15 shadow-2xl overflow-hidden text-slate-100"
      style={{ backgroundColor: 'rgba(15, 23, 42, 0.92)' }}
    >
      {/* Top architectural color accent strip */}
      <div className="h-1 w-full" style={{ backgroundColor: palette.roof }} />

      <div className="p-3.5">
        {/* Header: Type + Full Address & Close */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {renderIcon()}
              <span>{meta.label}</span>
            </div>
            <h2 className="mt-1 text-sm font-bold text-white leading-snug">
              {meta.label} — {fullAddress}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij kartę budynku"
            className="min-w-[32px] min-h-[32px] -mt-1 -mr-1 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Parameters Grid */}
        {isResidential ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-slate-800/80 border border-white/8 px-3 py-2">
              <div className="text-[11px] text-slate-400 flex items-center gap-1">
                <Layers className="w-3 h-3 text-slate-400" aria-hidden="true" />
                <span>Piętra</span>
              </div>
              <div className="mt-0.5 text-base font-bold text-white font-mono-nums">
                {building.pietra}
              </div>
            </div>

            <div className="rounded-lg bg-slate-800/80 border border-white/8 px-3 py-2">
              <div className="text-[11px] text-slate-400">Mieszkania</div>
              <div className="mt-0.5 text-base font-bold text-amber-300 font-mono-nums">
                {building.mieszkania}
              </div>
            </div>
          </div>
        ) : building.typ === 'dworzec' ? (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-slate-800/80 border border-white/8 px-3 py-2">
                <div className="text-[11px] text-slate-400 flex items-center gap-1">
                  <Layers className="w-3 h-3 text-slate-400" aria-hidden="true" />
                  <span>Kondygnacje</span>
                </div>
                <div className="mt-0.5 text-sm font-bold text-white">
                  {building.pietra} (dworzec)
                </div>
              </div>

              <div className="rounded-lg bg-slate-800/80 border border-white/8 px-3 py-2">
                <div className="text-[11px] text-slate-400">Stanowiska autobusowe</div>
                <div className="mt-0.5 text-sm font-bold text-teal-300 font-mono-nums">
                  {building.stanowiskaAutobusowe ?? 6}
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-teal-950/50 border border-teal-500/25 px-3 py-2 flex items-center gap-2 text-xs text-teal-200">
              <PackageCheck className="w-4 h-4 text-teal-400 shrink-0" aria-hidden="true" />
              <span>Obiekt publiczny · Punkt dostaw kurierskich</span>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              {meta.description}
            </p>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-slate-800/80 border border-white/8 px-3 py-2">
                <div className="text-[11px] text-slate-400 flex items-center gap-1">
                  <Layers className="w-3 h-3 text-slate-400" aria-hidden="true" />
                  <span>Kondygnacje</span>
                </div>
                <div className="mt-0.5 text-sm font-bold text-white">
                  {building.typ === 'baza'
                    ? '1 (garaż)'
                    : building.typ === 'kiosk'
                      ? '1 (pawilon)'
                      : '1 (parterowy)'}
                </div>
              </div>

              <div className="rounded-lg bg-slate-800/80 border border-white/8 px-3 py-2">
                <div className="text-[11px] text-slate-400">Przeznaczenie</div>
                <div className="mt-0.5 text-sm font-bold text-sky-300">
                  {building.typ === 'baza'
                    ? 'Logistyka'
                    : building.typ === 'kiosk'
                      ? 'Usługi / Kiosk'
                      : 'Handel'}
                </div>
              </div>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              {meta.description}
            </p>
          </div>
        )}

        {/* Primary Delivery Dispatch CTA for every deliverable building */}
        {canDeliver && onDispatchCourier && (
          <div className="mt-3 space-y-1.5">
            <button
              type="button"
              onClick={() => onDispatchCourier(building)}
              className="w-full min-h-[38px] px-3 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 active:bg-orange-600 text-slate-950 font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
            >
              <Bike className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Wyślij kuriera pod ten adres</span>
            </button>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <MapPin className="w-3 h-3 text-orange-400 shrink-0" aria-hidden="true" />
              <span>{stopSurfaceLabel}</span>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-3 pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-slate-400">
          <span>Adres: {fullAddress}</span>
          <span className="font-mono-nums text-slate-500">{building.id}</span>
        </div>
      </div>
    </aside>
  );
};
