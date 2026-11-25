import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpCircle,
  Ban,
  Bike,
  Building2,
  Car,
  Check,
  ChevronDown,
  Lock,
  ParkingSquare,
  UserMinus,
  UserPlus,
  Users,
  Warehouse,
  Wrench,
  X,
} from 'lucide-react';
import { t, translateOrderText } from '../i18n/translations';
import type {
  ActiveVehicleSelection,
  CompanyCourier,
  CourierQualification,
  OrderEconomyState,
  OwnedVan,
  VanCondition,
  VanModelId,
  VanTier,
} from '../types/orders';
import type { SupportedLanguage } from '../utils/settingsSystem';
import {
  BICYCLE_PURCHASE_COST,
  BIKE_COURIER_CAPACITY,
  COURIER_INSURANCE_COST,
  HIRED_BIKE_COURIER_SALARY,
  HIRED_VAN_DRIVER_SALARY,
  LOW_DURABILITY_SPEED_THRESHOLD,
  MAX_BICYCLES,
  MAX_EMPLOYEES,
  MAX_PARKING_SPOTS,
  MAX_VANS,
  MAX_WAREHOUSE_TIER,
  PARKING_SPOT_COST,
  REPAIR_AVAILABLE_DURABILITY_THRESHOLD,
  VAN_MODELS,
  VAN_MODEL_IDS_BY_CONDITION,
  WAREHOUSE_TIERS,
  calculateMonthlyCompanyCosts,
  calculateVehicleRepairCost,
  canCourierDriveVehicle,
  countHiredCouriers,
  findCourierAssignedToVehicle,
  formatCurrencyUsd,
  getEmployeeLicenseCost,
  getNextParkingSpotUpgrade,
  getNextWarehouseUpgrade,
  getOwnedFleetVehicles,
  getOwnedVanByIndex,
  getOwnedVans,
  getRepairCourierReadiness,
  getVanModelSpec,
  getVehicleCourierCapacityForSelection,
  getVehicleDurability,
  getWarehouseTierConfig,
  isVehicleRepairPending,
  vehiclesEqual,
} from '../utils/orderEconomy';

type CompanyTabId = 'base' | 'fleet' | 'employees';

function formatMissingFunds(cost: number, balance: number, lang: SupportedLanguage): string {
  const missing = Math.round(Math.max(0, cost - balance) * 100) / 100;
  const hasCents = Math.abs(missing - Math.round(missing)) > 0.001;
  return t(lang, 'company.missingFunds', { amount: formatCurrencyUsd(missing, hasCents) });
}

function getVanConditionLabel(lang: SupportedLanguage, condition: VanCondition): string {
  return condition === 'new'
    ? t(lang, 'company.vanConditionNew')
    : t(lang, 'company.vanConditionUsed');
}

function getVanTierLabel(lang: SupportedLanguage, tier: VanTier): string {
  if (tier === 'lite') return t(lang, 'company.vanTierLite');
  if (tier === 'pro') return t(lang, 'company.vanTierPro');
  return t(lang, 'company.vanTierStandard');
}

function getVanRoofLabel(lang: SupportedLanguage, tier: VanTier): string {
  if (tier === 'lite') return t(lang, 'company.vanRoofLow');
  if (tier === 'pro') return t(lang, 'company.vanRoofHigh');
  return t(lang, 'company.vanRoofMid');
}

function getDurabilityTextClass(durability: number): string {
  if (durability >= 80) return 'text-emerald-300';
  if (durability >= 35) return 'text-amber-300';
  return 'text-rose-300';
}

function getDurabilityBadgeClass(durability: number): string {
  if (durability >= 80) {
    return 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300';
  }
  if (durability >= 35) {
    return 'bg-amber-500/15 border-amber-400/40 text-amber-300';
  }
  return 'bg-rose-500/15 border-rose-400/45 text-rose-300';
}

function formatVehicleDisplayLabel(
  lang: SupportedLanguage,
  economyState: OrderEconomyState,
  vehicle: ActiveVehicleSelection
): string {
  if (vehicle.type === 'bike') {
    return t(lang, 'company.vehicleBike', { index: vehicle.index });
  }
  const ownedVan = getOwnedVanByIndex(economyState, vehicle.index);
  if (!ownedVan) {
    return t(lang, 'company.vehicleVan', { index: vehicle.index });
  }
  return t(lang, 'company.vehicleVanFull', {
    index: vehicle.index,
    condition: getVanConditionLabel(lang, ownedVan.condition),
    tier: getVanTierLabel(lang, ownedVan.tier),
  });
}

interface VanPreviewIllustrationProps {
  condition: VanCondition;
  tier: VanTier;
}

const VanPreviewIllustration: React.FC<VanPreviewIllustrationProps> = ({ condition, tier }) => {
  const isNew = condition === 'new';
  const roofY = tier === 'lite' ? 16 : tier === 'pro' ? 6 : 11;
  const bodyFill = isNew ? '#ffffff' : '#f1efe9';
  const roofTopFill = isNew ? '#f8fafc' : '#e7e4dc';
  const sillFill = isNew ? '#cbd5e1' : '#334155';
  const bumperFill = isNew ? '#f1f5f9' : '#334155';
  const headlightFill = isNew ? '#e0f2fe' : '#fef08a';
  const headlightStroke = isNew ? '#38bdf8' : '#b45309';

  const stripes: ReadonlyArray<readonly [number, number]> =
    tier === 'lite'
      ? [[34, 3.2]]
      : tier === 'pro'
        ? [
            [30, 2.3],
            [33.8, 2.3],
            [37.6, 2.3],
          ]
        : [
            [31.5, 2.8],
            [36.0, 2.8],
          ];

  return (
    <div className="w-full h-14 rounded-md bg-slate-950/85 border border-slate-800/90 flex items-center justify-center px-2 overflow-hidden">
      <svg
        viewBox="0 0 128 58"
        className="w-full max-w-[126px] h-12"
        aria-hidden="true"
        focusable="false"
      >
        {/* Subtle ground shadow */}
        <ellipse cx="64" cy="51.5" rx="49" ry="3.5" fill="rgba(15, 23, 42, 0.85)" />

        {/* Main van side silhouette (adapts roof height for Lite / Standard / Pro) */}
        <path
          d={`M 14 ${roofY + 2} Q 14 ${roofY} 17 ${roofY} L 83 ${roofY} L 97 ${Math.min(25, roofY + 12)} L 112 29 Q 114 30 114 33 L 114 44 L 14 44 Z`}
          fill={bodyFill}
          stroke="#1e293b"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />

        {/* Roof bevel highlight + longitudinal ribs on used vans */}
        <rect
          x="16"
          y={roofY + 1}
          width="66"
          height="3.2"
          rx="1"
          fill={roofTopFill}
          opacity="0.85"
        />
        {!isNew && (
          <g stroke="#94a3b8" strokeWidth="0.9" opacity="0.85">
            <line x1="20" y1={roofY + 2.4} x2="77" y2={roofY + 2.4} />
            <line x1="20" y1={roofY + 4.3} x2="77" y2={roofY + 4.3} />
          </g>
        )}

        {/* Orange roof ID bar near cab edge */}
        <rect x="74" y={roofY + 0.8} width="7.5" height="2.4" rx="0.6" fill="#f97316" />

        {/* Cab windshield & side window */}
        <path
          d={`M 83 ${roofY + 3.2} L 95 ${Math.min(25.5, roofY + 13.2)} L 83 ${Math.min(25.5, roofY + 13.2)} Z`}
          fill={isNew ? '#0ea5e9' : '#38bdf8'}
          stroke="#1e293b"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
        <rect
          x="74.5"
          y={roofY + 3.6}
          width="6.8"
          height={Math.max(6, Math.min(25.5, roofY + 13.2) - (roofY + 3.6))}
          rx="1"
          fill={isNew ? '#0ea5e9' : '#38bdf8'}
          stroke="#1e293b"
          strokeWidth="1"
        />

        {/* Cargo / cab vertical door seam */}
        <line
          x1="72"
          y1={roofY + 1.2}
          x2="72"
          y2="43"
          stroke={isNew ? 'rgba(30,41,59,0.35)' : 'rgba(30,41,59,0.58)'}
          strokeWidth="1"
        />

        {/* Lower sill trim (prominent dark plastic on used vs slim body-colored skirt on new) */}
        <rect
          x="14.8"
          y={isNew ? 41.2 : 39.8}
          width="98.4"
          height={isNew ? 2.6 : 4.2}
          fill={sillFill}
        />

        {/* 1 / 2 / 3 full-length horizontal orange stripes */}
        {stripes.map(([yPos, h], idx) => (
          <rect
            key={idx}
            x="15"
            y={yPos}
            width="98"
            height={h}
            rx="0.4"
            fill="#f97316"
          />
        ))}

        {/* Front bumper & grille/air intake */}
        <rect
          x="108.5"
          y="38.2"
          width="6"
          height="5.8"
          rx="1"
          fill={bumperFill}
          stroke="#1e293b"
          strokeWidth="1"
        />
        {isNew ? (
          <rect x="110.2" y="39.8" width="3.8" height="2.8" rx="0.5" fill="#0f172a" />
        ) : (
          <g stroke="#64748b" strokeWidth="0.7">
            <line x1="110" y1="35" x2="113.4" y2="35" />
            <line x1="110" y1="36.8" x2="113.4" y2="36.8" />
          </g>
        )}

        {/* Headlight (LED cyan on new vs halogen warm on used) */}
        <polygon
          points={isNew ? '107,30.2 113.4,31.4 113.4,34.4 107.6,34.4' : '108.5,31.2 113.4,31.2 113.4,35 108.5,35'}
          fill={headlightFill}
          stroke={headlightStroke}
          strokeWidth="0.9"
        />

        {/* Taillight */}
        <rect x="14.2" y="31.5" width="2.8" height="6.2" rx="0.6" fill="#ef4444" stroke="#1e293b" strokeWidth="0.7" />

        {/* Wheels (Steel rims on used vs black alloys with spokes on new) */}
        {[34, 93].map((cx) => (
          <g key={cx}>
            <circle cx={cx} cy="45.5" r="7.2" fill="#0f172a" stroke="#1e293b" strokeWidth="1.2" />
            {isNew ? (
              <>
                <circle cx={cx} cy="45.5" r="4.2" fill="#0f172a" stroke="#64748b" strokeWidth="1.1" />
                <line x1={cx - 3.1} y1="45.5" x2={cx + 3.1} y2="45.5" stroke="#64748b" strokeWidth="0.9" />
                <line x1={cx} y1="42.4" x2={cx} y2="48.6" stroke="#64748b" strokeWidth="0.9" />
                <circle cx={cx} cy="45.5" r="1.3" fill="#94a3b8" />
              </>
            ) : (
              <>
                <circle cx={cx} cy="45.5" r="4.1" fill="#475569" stroke="#cbd5e1" strokeWidth="1.2" />
                <circle cx={cx} cy="45.5" r="1.4" fill="#1e293b" />
              </>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
};

interface CompanyModalProps {
  isOpen: boolean;
  language: SupportedLanguage;
  economyState: OrderEconomyState;
  isOwnerAtBase: boolean;
  courierAtBaseBySlot?: Readonly<Record<number, boolean>>;
  onClose: () => void;
  onUpgradeWarehouse: () => void;
  onBuyParkingSpot: () => void;
  onBuyBicycle: () => void;
  onBuyVan: (modelId: VanModelId) => void;
  onRequestVehicleRepair: (vehicle: ActiveVehicleSelection) => void;
  onSelectActiveVehicle: (vehicle: ActiveVehicleSelection) => void;
  onBuyEmployeeLicense: () => void;
  onHireCourier: (slotIndex: number, qualification: CourierQualification) => void;
  onPromoteCourier: (slotIndex: number) => void;
  onFireCourier: (slotIndex: number) => void;
  onAssignCourierVehicle: (slotIndex: number, vehicle: ActiveVehicleSelection | null) => void;
}

interface CourierVehicleDropdownProps {
  language: SupportedLanguage;
  economyState: OrderEconomyState;
  courier: CompanyCourier;
  effectiveAssigned: ActiveVehicleSelection | null;
  availableVehicles: readonly ActiveVehicleSelection[];
  disabled: boolean;
  isOpen: boolean;
  openUpward: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (vehicle: ActiveVehicleSelection | null) => void;
}

const CourierVehicleDropdown: React.FC<CourierVehicleDropdownProps> = ({
  language,
  economyState,
  courier,
  effectiveAssigned,
  availableVehicles,
  disabled,
  isOpen,
  openUpward,
  onToggle,
  onClose,
  onSelect,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen, onClose]);

  const triggerLabel = effectiveAssigned
    ? formatVehicleDisplayLabel(language, economyState, effectiveAssigned)
    : t(language, 'company.noVehicle');
  const triggerCapacity = effectiveAssigned
    ? t(language, 'company.pcsShort', {
        count: getVehicleCourierCapacityForSelection(economyState, effectiveAssigned),
      })
    : null;
  const triggerDurability = effectiveAssigned
    ? Math.round(getVehicleDurability(economyState, effectiveAssigned))
    : null;
  const courierAriaName = courier.isOwner
    ? t(language, 'orders.ownerBadge')
    : t(language, 'orders.courierBadge', { slot: courier.slotIndex });

  return (
    <div ref={containerRef} className="relative">
      <button
        id={`courier-vehicle-${courier.slotIndex}`}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={`courier-vehicle-menu-${courier.slotIndex}`}
        onClick={() => {
          if (!disabled) onToggle();
        }}
        className={`w-full rounded-md border px-2.5 py-1.5 text-xs font-mono-nums flex items-center justify-between gap-2 transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
          disabled
            ? 'bg-slate-900 border-slate-800 text-slate-500 cursor-not-allowed'
            : isOpen
              ? 'bg-slate-950 border-amber-400/80 text-slate-100 cursor-pointer'
              : 'bg-slate-950 border-slate-700 text-slate-100 hover:border-slate-500 cursor-pointer'
        }`}
      >
        <span className="flex items-center gap-2 min-w-0 truncate">
          {effectiveAssigned?.type === 'van' ? (
            <Car className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
          ) : effectiveAssigned?.type === 'bike' ? (
            <Bike className="w-3.5 h-3.5 text-sky-400 shrink-0" aria-hidden="true" />
          ) : (
            <Ban className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
          )}
          <span className="font-semibold truncate">{triggerLabel}</span>
          {triggerCapacity && (
            <span className="text-[11px] text-slate-400 shrink-0">({triggerCapacity})</span>
          )}
          {triggerDurability !== null && (
            <span
              className={`text-[11px] font-bold shrink-0 ${getDurabilityTextClass(triggerDurability)}`}
            >
              {triggerDurability}%
            </span>
          )}
        </span>

        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${
            isOpen ? 'rotate-180 text-amber-300' : ''
          }`}
          aria-hidden="true"
        />
      </button>

      {isOpen && !disabled && (
        <ul
          id={`courier-vehicle-menu-${courier.slotIndex}`}
          role="listbox"
          aria-label={t(language, 'company.selectVehicleAria', { name: courierAriaName })}
          className={`absolute left-0 right-0 z-30 rounded-md bg-slate-950 border border-slate-700 shadow-lg py-1 max-h-48 overflow-y-auto overscroll-contain ${
            openUpward ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          {!courier.isOwner && (
            <li role="option" aria-selected={effectiveAssigned === null}>
              <button
                type="button"
                onClick={() => {
                  onSelect(null);
                  onClose();
                }}
                className={`w-full px-2.5 py-1.5 text-left text-xs font-mono-nums flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                  effectiveAssigned === null
                    ? 'bg-amber-500/15 text-amber-200 font-semibold'
                    : 'text-slate-300 hover:bg-slate-900 hover:text-slate-100'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0 truncate">
                  <Ban className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                  <span className="truncate">{t(language, 'company.noVehicle')}</span>
                </span>
                {effectiveAssigned === null && (
                  <Check className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
                )}
              </button>
            </li>
          )}

          {availableVehicles.map((vehicle) => {
            const isSelected = vehiclesEqual(effectiveAssigned, vehicle);
            const isVan = vehicle.type === 'van';
            const label = formatVehicleDisplayLabel(language, economyState, vehicle);
            const capacityLabel = t(language, 'company.pcsShort', {
              count: getVehicleCourierCapacityForSelection(economyState, vehicle),
            });
            const optionDurability = Math.round(getVehicleDurability(economyState, vehicle));

            return (
              <li
                key={`${vehicle.type}:${vehicle.index}`}
                role="option"
                aria-selected={isSelected}
              >
                <button
                  type="button"
                  onClick={() => {
                    onSelect(vehicle);
                    onClose();
                  }}
                  className={`w-full px-2.5 py-1.5 text-left text-xs font-mono-nums flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-amber-500/15 text-amber-200 font-semibold'
                      : 'text-slate-200 hover:bg-slate-900 hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0 truncate">
                    {isVan ? (
                      <Car className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
                    ) : (
                      <Bike className="w-3.5 h-3.5 text-sky-400 shrink-0" aria-hidden="true" />
                    )}
                    <span className="truncate">{label}</span>
                    <span
                      className={`text-[11px] shrink-0 ${
                        isSelected ? 'text-amber-300/90' : 'text-slate-400'
                      }`}
                    >
                      ({capacityLabel})
                    </span>
                    <span
                      className={`text-[11px] font-bold shrink-0 ${getDurabilityTextClass(optionDurability)}`}
                    >
                      {optionDurability}%
                    </span>
                  </span>

                  {isSelected && (
                    <Check className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
                  )}
                </button>
              </li>
            );
          })}

          {availableVehicles.length === 0 && (
            <li className="px-2.5 py-1.5 text-[11px] text-slate-500">
              {t(language, 'company.noFreeVehicles')}
            </li>
          )}
        </ul>
      )}
    </div>
  );
};

export const CompanyModal: React.FC<CompanyModalProps> = ({
  isOpen,
  language,
  economyState,
  isOwnerAtBase,
  courierAtBaseBySlot,
  onClose,
  onUpgradeWarehouse,
  onBuyParkingSpot,
  onBuyBicycle,
  onBuyVan,
  onRequestVehicleRepair,
  onSelectActiveVehicle,
  onBuyEmployeeLicense,
  onHireCourier,
  onPromoteCourier,
  onFireCourier,
  onAssignCourierVehicle,
}) => {
  const [activeTab, setActiveTab] = useState<CompanyTabId>('base');
  const [vanShopCondition, setVanShopCondition] = useState<VanCondition>('used');
  const [openVehicleSlot, setOpenVehicleSlot] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setOpenVehicleSlot(null);
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (openVehicleSlot !== null) {
          setOpenVehicleSlot(null);
        } else {
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, openVehicleSlot, onClose]);

  useEffect(() => {
    setOpenVehicleSlot(null);
  }, [activeTab]);

  const warehouseLevel = economyState.warehouseLevel ?? economyState.warehouseTier;
  const bikesCount = economyState.bikesCount ?? economyState.bicyclesCount;
  const ownedVans: OwnedVan[] = useMemo(() => getOwnedVans(economyState), [economyState]);
  const vansCount = ownedVans.length;
  const activeVehicle: ActiveVehicleSelection = economyState.activeVehicle ?? {
    type: 'bike',
    index: 1,
  };

  const monthlyCosts = useMemo(
    () => calculateMonthlyCompanyCosts(economyState),
    [economyState]
  );

  const warehouseConfig = useMemo(
    () => getWarehouseTierConfig(warehouseLevel),
    [warehouseLevel]
  );

  const nextWarehouseUpgrade = useMemo(
    () => getNextWarehouseUpgrade(economyState),
    [economyState]
  );

  const nextParkingUpgrade = useMemo(
    () => getNextParkingSpotUpgrade(economyState),
    [economyState]
  );

  const costsBreakdownTitle = useMemo(() => {
    const parts: string[] = [
      t(language, 'company.costBase', {
        level: warehouseLevel,
        amount: formatCurrencyUsd(monthlyCosts.baseUpkeepAndTaxCost, false),
      }),
    ];
    if (monthlyCosts.courierInsuranceCost > 0) {
      parts.push(
        t(language, 'company.costBikes', {
          amount: formatCurrencyUsd(monthlyCosts.courierInsuranceCost, false),
        })
      );
    }
    if (monthlyCosts.vanInsuranceCost > 0) {
      parts.push(
        t(language, 'company.costVans', {
          amount: formatCurrencyUsd(monthlyCosts.vanInsuranceCost, false),
        })
      );
    }
    if (monthlyCosts.salariesCost > 0) {
      parts.push(
        t(language, 'company.costSalaries', {
          amount: formatCurrencyUsd(monthlyCosts.salariesCost, false),
        })
      );
    }
    return parts.join(' | ');
  }, [language, monthlyCosts, warehouseLevel]);

  if (!isOpen) return null;

  const perMonth = t(language, 'company.perMonth');
  const canUpgradeWarehouse =
    nextWarehouseUpgrade !== null && economyState.balance >= nextWarehouseUpgrade.cost;
  const canBuyParkingSpot =
    nextParkingUpgrade !== null && economyState.balance >= nextParkingUpgrade.cost;
  const bikesMaxed = bikesCount >= MAX_BICYCLES;
  const canBuyBicycle = !bikesMaxed && economyState.balance >= BICYCLE_PURCHASE_COST;
  const vansMaxed = vansCount >= MAX_VANS;
  const hasFreeParkingForVan = vansCount < economyState.parkingSpots;

  const hiredCouriersCount = countHiredCouriers(economyState);
  const ownedFleet = getOwnedFleetVehicles(economyState);
  const couriers = economyState.couriers;

  const isSlotAtBase = (slotIndex: number): boolean => {
    if (courierAtBaseBySlot && typeof courierAtBaseBySlot[slotIndex] === 'boolean') {
      return courierAtBaseBySlot[slotIndex];
    }
    return slotIndex === 1 ? isOwnerAtBase : true;
  };

  const warehouseFillPercent =
    economyState.warehouseCapacity > 0
      ? Math.min(100, Math.round((economyState.warehousePackages / economyState.warehouseCapacity) * 100))
      : 0;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-2 sm:p-3 [@media(max-height:540px)]:p-1.5 bg-slate-950/80 touch-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="company-modal-heading"
      onClick={onClose}
      onWheel={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      <div
        className="w-[94vw] max-w-4xl max-h-[84vh] [@media(max-height:540px)]:max-h-[95vh] flex flex-col rounded-xl bg-slate-900/95 border border-slate-700/90 shadow-lg overflow-hidden text-slate-100 touch-auto overscroll-contain"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Compact Header & Single-Line Company Summary Bar */}
        <div className="flex items-center justify-between gap-2 px-3 py-2 [@media(max-height:540px)]:px-2.5 [@media(max-height:540px)]:py-1.5 bg-[#182030] border-b border-slate-700/80">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs min-w-0 leading-tight">
            <div className="flex items-center gap-1.5 shrink-0">
              <Building2 className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
              <h2 id="company-modal-heading" className="text-xs sm:text-sm font-bold text-slate-100">
                {t(language, 'company.title')}
              </h2>
            </div>

            <span className="text-slate-600" aria-hidden="true">|</span>

            <span className="whitespace-nowrap">
              <span className="text-slate-400">{t(language, 'company.cash')} </span>
              <span className="font-bold text-emerald-400 font-mono-nums">
                {formatCurrencyUsd(economyState.balance)}
              </span>
            </span>

            <span className="text-slate-600" aria-hidden="true">|</span>

            <span className="whitespace-nowrap">
              <span className="text-slate-400">{t(language, 'company.warehouse')} </span>
              <span className="font-bold text-amber-300 font-mono-nums">
                {economyState.warehousePackages}/{economyState.warehouseCapacity}
              </span>
            </span>

            <span className="text-slate-600" aria-hidden="true">|</span>

            <span className="whitespace-nowrap">
              <span className="text-slate-400">{t(language, 'company.bikes')} </span>
              <span className="font-bold text-sky-300 font-mono-nums">
                {bikesCount}/{MAX_BICYCLES}
              </span>
            </span>

            <span className="text-slate-600" aria-hidden="true">|</span>

            <span className="whitespace-nowrap">
              <span className="text-slate-400">{t(language, 'company.vans')} </span>
              <span className="font-bold text-amber-300 font-mono-nums">
                {vansCount}/{economyState.parkingSpots}
              </span>
            </span>

            <span className="text-slate-600" aria-hidden="true">|</span>

            <span className="whitespace-nowrap">
              <span className="text-slate-400">{t(language, 'company.team')} </span>
              <span className="font-bold text-emerald-300 font-mono-nums">
                {hiredCouriersCount}/{MAX_EMPLOYEES}
              </span>
            </span>

            <span className="text-slate-600" aria-hidden="true">|</span>

            <span className="whitespace-nowrap" title={costsBreakdownTitle}>
              <span className="text-slate-400">{t(language, 'company.fixedCosts')} </span>
              <span className="font-bold text-rose-400 font-mono-nums">
                -{formatCurrencyUsd(monthlyCosts.totalFixedCosts, false)}
                {perMonth}
              </span>
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t(language, 'company.closeAria')}
            className="min-w-[30px] min-h-[30px] p-1 rounded-lg flex items-center justify-center shrink-0 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Compact Navigation Tabs Bar */}
        <div className="px-3 py-1.5 [@media(max-height:540px)]:px-2.5 bg-[#151d2c] border-b border-slate-800">
          <div
            className="flex items-center gap-1.5 overflow-x-auto overscroll-x-contain"
            role="tablist"
            aria-label={t(language, 'company.tabsAria')}
          >
            <button
              id="company-tab-base"
              type="button"
              role="tab"
              aria-selected={activeTab === 'base'}
              aria-controls="company-panel-base"
              onClick={() => setActiveTab('base')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                activeTab === 'base'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700/90 border border-slate-700/80'
              }`}
            >
              <Warehouse className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>{t(language, 'company.tabBase')}</span>
            </button>

            <button
              id="company-tab-fleet"
              type="button"
              role="tab"
              aria-selected={activeTab === 'fleet'}
              aria-controls="company-panel-fleet"
              onClick={() => setActiveTab('fleet')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                activeTab === 'fleet'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700/90 border border-slate-700/80'
              }`}
            >
              <Bike className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>{t(language, 'company.tabFleet')}</span>
            </button>

            <button
              id="company-tab-employees"
              type="button"
              role="tab"
              aria-selected={activeTab === 'employees'}
              aria-controls="company-panel-employees"
              onClick={() => setActiveTab('employees')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                activeTab === 'employees'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700/90 border border-slate-700/80'
              }`}
            >
              <Users className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>{t(language, 'company.tabEmployees')}</span>
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div
          className="flex-1 overflow-y-auto overscroll-contain p-2 sm:p-2.5 [@media(max-height:540px)]:p-1.5"
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          {/* TAB 1: BASE & PARKING */}
          {activeTab === 'base' && (
            <div
              id="company-panel-base"
              role="tabpanel"
              aria-labelledby="company-tab-base"
              className="grid grid-cols-1 md:grid-cols-2 [@media(max-height:540px)]:grid-cols-2 gap-2"
            >
              {/* Card 1: Base Warehouse */}
              <article className="rounded-lg bg-[#182030] border border-slate-700/85 p-2.5 [@media(max-height:540px)]:p-2 flex flex-col justify-between gap-2 [@media(max-height:540px)]:gap-1.5">
                <div className="space-y-1.5 [@media(max-height:540px)]:space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Warehouse className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
                      <h3 className="text-xs sm:text-sm font-bold text-slate-100 truncate">
                        {t(language, 'company.warehouseTitle')}
                      </h3>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-400/40 text-[11px] font-bold text-amber-300 font-mono-nums shrink-0">
                      {t(language, 'company.levelBadge', {
                        level: warehouseLevel,
                        max: MAX_WAREHOUSE_TIER,
                      })}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-tight">
                    {t(language, 'company.warehouseDesc', {
                      tierName: translateOrderText(language, warehouseConfig.name),
                    })}
                  </p>

                  {/* Tier progression strip */}
                  <div className="grid grid-cols-4 gap-1 text-center font-mono-nums">
                    {WAREHOUSE_TIERS.map((tier) => {
                      const isCurrent = tier.tier === warehouseLevel;
                      const isUnlocked = tier.tier <= warehouseLevel;
                      const isNext = nextWarehouseUpgrade?.nextTier === tier.tier;
                      return (
                        <div
                          key={tier.tier}
                          className={`rounded border px-1 py-0.5 text-[10px] leading-tight ${
                            isCurrent
                              ? 'bg-amber-500/20 border-amber-400 text-amber-200 font-bold'
                              : isNext
                                ? 'bg-slate-800/90 border-sky-400/50 text-sky-200 font-semibold'
                                : isUnlocked
                                  ? 'bg-slate-800/60 border-slate-700 text-slate-300'
                                  : 'bg-slate-900/60 border-slate-800 text-slate-500'
                          }`}
                        >
                          <div>{t(language, 'company.tierShort', { tier: tier.tier })}</div>
                          <div>{t(language, 'company.pcsShort', { count: tier.capacity })}</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Current vs next specs */}
                  <div className="rounded-md bg-slate-900/70 border border-slate-800 px-2 py-1 space-y-0.5 text-[11px] font-mono-nums">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">{t(language, 'company.capacityLabel')}</span>
                      <span className="text-slate-100 font-semibold">
                        {nextWarehouseUpgrade
                          ? t(language, 'company.capacityUpgrade', {
                              from: nextWarehouseUpgrade.currentCapacity,
                              to: nextWarehouseUpgrade.nextCapacity,
                            })
                          : t(language, 'company.capacityMax', {
                              count: warehouseConfig.capacity,
                            })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">{t(language, 'company.baseUpkeepLabel')}</span>
                      <span className="text-rose-300 font-semibold">
                        {nextWarehouseUpgrade
                          ? `${formatCurrencyUsd(nextWarehouseUpgrade.currentMonthlyUpkeepCost, false)} → ${formatCurrencyUsd(nextWarehouseUpgrade.nextMonthlyUpkeepCost, false)}${perMonth}`
                          : `${formatCurrencyUsd(warehouseConfig.monthlyUpkeepCost, false)}${perMonth}`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">{t(language, 'company.occupancyLabel')}</span>
                      <span className="text-amber-300 font-semibold">
                        {economyState.warehousePackages}/{economyState.warehouseCapacity} ({warehouseFillPercent}%)
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-1.5 border-t border-slate-800 flex items-center justify-between gap-2">
                  <div className="min-w-0 leading-tight">
                    <span className="block text-[11px] text-slate-400 font-mono-nums">
                      {nextWarehouseUpgrade
                        ? t(language, 'company.costLabel', {
                            amount: formatCurrencyUsd(nextWarehouseUpgrade.cost, false),
                          })
                        : t(language, 'company.maxLevelReached')}
                    </span>
                    {nextWarehouseUpgrade && !canUpgradeWarehouse && (
                      <span className="block text-[11px] font-semibold text-rose-300 font-mono-nums">
                        {formatMissingFunds(
                          nextWarehouseUpgrade.cost,
                          economyState.balance,
                          language
                        )}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={!canUpgradeWarehouse}
                    onClick={onUpgradeWarehouse}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold font-mono-nums shrink-0 transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                      canUpgradeWarehouse
                        ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer'
                        : 'bg-slate-800 text-slate-400 border border-slate-700/80 cursor-not-allowed'
                    }`}
                  >
                    {nextWarehouseUpgrade
                      ? t(language, 'company.upgradeBtn', {
                          amount: formatCurrencyUsd(nextWarehouseUpgrade.cost, false),
                        })
                      : t(language, 'company.maxLevelBtn')}
                  </button>
                </div>
              </article>

              {/* Card 2: Parking Spots */}
              <article className="rounded-lg bg-[#182030] border border-slate-700/85 p-2.5 [@media(max-height:540px)]:p-2 flex flex-col justify-between gap-2 [@media(max-height:540px)]:gap-1.5">
                <div className="space-y-1.5 [@media(max-height:540px)]:space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <ParkingSquare className="w-4 h-4 text-sky-400 shrink-0" aria-hidden="true" />
                      <h3 className="text-xs sm:text-sm font-bold text-slate-100 truncate">
                        {t(language, 'company.parkingTitle')}
                      </h3>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-sky-500/15 border border-sky-400/40 text-[11px] font-bold text-sky-300 font-mono-nums shrink-0">
                      {economyState.parkingSpots} / {MAX_PARKING_SPOTS}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-tight">
                    {t(language, 'company.parkingDesc')}
                  </p>

                  {/* 8-slot visual grid */}
                  <div
                    className="grid grid-cols-4 gap-1"
                    aria-label={t(language, 'company.parkingGridAria', {
                      current: economyState.parkingSpots,
                      max: MAX_PARKING_SPOTS,
                    })}
                  >
                    {Array.from({ length: MAX_PARKING_SPOTS }, (_, idx) => {
                      const unlocked = idx < economyState.parkingSpots;
                      return (
                        <div
                          key={idx}
                          className={`rounded border px-1 py-0.5 text-center text-[10px] font-mono-nums leading-tight ${
                            unlocked
                              ? 'bg-sky-500/20 border-sky-400/70 text-sky-200 font-bold'
                              : 'bg-slate-900/60 border-slate-800 text-slate-500'
                          }`}
                        >
                          P{idx + 1}
                        </div>
                      );
                    })}
                  </div>

                  <div className="rounded-md bg-slate-900/70 border border-slate-800 px-2 py-1 space-y-0.5 text-[11px] font-mono-nums">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">
                        {t(language, 'company.parkingSpotsLabel')}
                      </span>
                      <span className="text-slate-100 font-semibold">
                        {t(language, 'company.parkingSpotsValue', {
                          current: economyState.parkingSpots,
                          max: MAX_PARKING_SPOTS,
                        })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">
                        {t(language, 'company.parkingPriceLabel')}
                      </span>
                      <span className="text-emerald-300 font-semibold">
                        {formatCurrencyUsd(PARKING_SPOT_COST, false)} {t(language, 'company.oneTime')}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">
                        {t(language, 'company.monthlyCostLabel')}
                      </span>
                      <span className="text-slate-300 font-semibold">$0{perMonth}</span>
                    </div>
                  </div>
                </div>

                <div className="pt-1.5 border-t border-slate-800 flex items-center justify-between gap-2">
                  <div className="min-w-0 leading-tight">
                    <span className="block text-[11px] text-slate-400">
                      {nextParkingUpgrade
                        ? t(language, 'company.parkingNextHint', {
                            spot: nextParkingUpgrade.nextSpotNumber,
                          })
                        : t(language, 'company.parkingAllBought')}
                    </span>
                    {nextParkingUpgrade && !canBuyParkingSpot && (
                      <span className="block text-[11px] font-semibold text-rose-300 font-mono-nums">
                        {formatMissingFunds(
                          nextParkingUpgrade.cost,
                          economyState.balance,
                          language
                        )}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={!canBuyParkingSpot}
                    onClick={onBuyParkingSpot}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold font-mono-nums shrink-0 transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                      canBuyParkingSpot
                        ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer'
                        : 'bg-slate-800 text-slate-400 border border-slate-700/80 cursor-not-allowed'
                    }`}
                  >
                    {nextParkingUpgrade
                      ? t(language, 'company.buySpotBtn', {
                          amount: formatCurrencyUsd(nextParkingUpgrade.cost, false),
                        })
                      : t(language, 'company.maxSpotsBtn')}
                  </button>
                </div>
              </article>
            </div>
          )}

          {/* TAB 2: FLEET */}
          {activeTab === 'fleet' && (
            <div
              id="company-panel-fleet"
              role="tabpanel"
              aria-labelledby="company-tab-fleet"
              className="space-y-2.5"
            >
              {/* Delivery Vans 6-Model Dealership Panel */}
              <section className="rounded-lg bg-[#182030] border border-slate-700/85 p-2.5 [@media(max-height:540px)]:p-2 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Car className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
                    <h3 className="text-xs sm:text-sm font-bold text-slate-100">
                      {t(language, 'company.vansCatalogTitle')}
                    </h3>
                    <span
                      title={t(language, 'company.vansCountTitle')}
                      className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-400/40 text-[11px] font-bold text-amber-300 font-mono-nums shrink-0"
                    >
                      {vansCount} / {economyState.parkingSpots}
                    </span>
                    <span className="hidden sm:inline text-[11px] text-slate-400">
                      {vanShopCondition === 'used'
                        ? t(language, 'company.vanUsedTrait')
                        : t(language, 'company.vanNewTrait')}
                    </span>
                  </div>

                  {/* Used / New Category Switcher */}
                  <div
                    role="group"
                    aria-label={t(language, 'company.vansCategoryAria')}
                    className="inline-flex items-center rounded-lg bg-slate-950 border border-slate-700/90 p-0.5 shrink-0"
                  >
                    <button
                      type="button"
                      aria-pressed={vanShopCondition === 'used'}
                      onClick={() => setVanShopCondition('used')}
                      className={`px-3 py-1 rounded-md text-xs font-bold transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-400 ${
                        vanShopCondition === 'used'
                          ? 'bg-amber-500 text-slate-950'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      {t(language, 'company.vansCategoryUsed')}
                    </button>
                    <button
                      type="button"
                      aria-pressed={vanShopCondition === 'new'}
                      onClick={() => setVanShopCondition('new')}
                      className={`px-3 py-1 rounded-md text-xs font-bold transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-400 ${
                        vanShopCondition === 'new'
                          ? 'bg-sky-400 text-slate-950'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      {t(language, 'company.vansCategoryNew')}
                    </button>
                  </div>
                </div>

                {/* 3 Van Tier Cards (Lite / Standard / Pro) */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {VAN_MODEL_IDS_BY_CONDITION[vanShopCondition].map((modelId) => {
                    const spec = VAN_MODELS[modelId];
                    const canAfford = economyState.balance >= spec.purchasePrice;
                    const canPurchase = !vansMaxed && hasFreeParkingForVan && canAfford;
                    const condLabel = getVanConditionLabel(language, spec.condition);
                    const tierLabel = getVanTierLabel(language, spec.tier);
                    const roofLabel = getVanRoofLabel(language, spec.tier);

                    return (
                      <article
                        key={modelId}
                        className="rounded-lg bg-slate-900/75 border border-slate-700/80 p-2 flex flex-col justify-between gap-2"
                      >
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-1.5">
                            <h4 className="text-xs font-bold text-slate-100 truncate">
                              {condLabel} {tierLabel}
                            </h4>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[11px] font-bold font-mono-nums shrink-0 border ${
                                spec.condition === 'new'
                                  ? 'bg-sky-500/15 border-sky-400/45 text-sky-300'
                                  : 'bg-amber-500/15 border-amber-400/45 text-amber-300'
                              }`}
                            >
                              {t(language, 'company.packagesCount', { count: spec.capacity })}
                            </span>
                          </div>

                          <VanPreviewIllustration condition={spec.condition} tier={spec.tier} />

                          <div className="rounded-md bg-slate-950/75 border border-slate-800 px-2 py-1 space-y-0.5 text-[11px] font-mono-nums">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-400">
                                {t(language, 'company.payloadLabel')}
                              </span>
                              <span className="text-slate-100 font-semibold">
                                {t(language, 'company.packagesCount', { count: spec.capacity })}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-400">
                                {t(language, 'company.vanInsuranceShort')}
                              </span>
                              <span className="text-rose-300 font-semibold">
                                +{formatCurrencyUsd(spec.monthlyInsurance, false)}
                                {perMonth}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 pt-0.5 border-t border-slate-800/80">
                              {roofLabel}
                            </div>
                          </div>
                        </div>

                        <div className="space-y-1">
                          {!vansMaxed && !canPurchase && (
                            <div className="space-y-0.5 text-[11px] font-semibold leading-tight">
                              {!hasFreeParkingForVan && (
                                <p className="text-amber-300">
                                  {t(language, 'company.requiresFreeParking')}
                                </p>
                              )}
                              {!canAfford && (
                                <p className="text-rose-300 font-mono-nums">
                                  {formatMissingFunds(
                                    spec.purchasePrice,
                                    economyState.balance,
                                    language
                                  )}
                                </p>
                              )}
                            </div>
                          )}
                          <button
                            type="button"
                            disabled={!canPurchase}
                            onClick={() => onBuyVan(modelId)}
                            className={`w-full px-2.5 py-1.5 rounded-lg text-xs font-bold font-mono-nums transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                              canPurchase
                                ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer'
                                : 'bg-slate-800 text-slate-400 border border-slate-700/80 cursor-not-allowed'
                            }`}
                          >
                            {vansMaxed
                              ? t(language, 'company.buyVanLimitReached', {
                                  current: MAX_VANS,
                                  max: MAX_VANS,
                                })
                              : t(language, 'company.buyModelBtn', {
                                  amount: formatCurrencyUsd(spec.purchasePrice, false),
                                })}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>

              {/* Bottom Row: Courier Bikes & Owned Fleet List */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {/* Card: Courier Bikes */}
                <article className="rounded-lg bg-[#182030] border border-slate-700/85 p-2.5 [@media(max-height:540px)]:p-2 flex flex-col justify-between gap-2 [@media(max-height:540px)]:gap-1.5">
                  <div className="space-y-1.5 [@media(max-height:540px)]:space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Bike className="w-4 h-4 text-sky-400 shrink-0" aria-hidden="true" />
                        <h3 className="text-xs sm:text-sm font-bold text-slate-100 truncate">
                          {t(language, 'company.bikesTitle')}
                        </h3>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-sky-500/15 border border-sky-400/40 text-[11px] font-bold text-sky-300 font-mono-nums shrink-0">
                        {bikesCount} / {MAX_BICYCLES}
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-400 leading-tight">
                      {t(language, 'company.bikesDesc')}
                    </p>

                    <div className="rounded-md bg-slate-900/70 border border-slate-800 px-2 py-1 space-y-0.5 text-[11px] font-mono-nums">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-400">
                          {t(language, 'company.payloadLabel')}
                        </span>
                        <span className="text-slate-100 font-semibold">
                          {t(language, 'company.packagesCount', { count: BIKE_COURIER_CAPACITY })}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-400">
                          {t(language, 'company.bikeInsuranceLabel')}
                        </span>
                        <span className="text-rose-300 font-semibold">
                          +{formatCurrencyUsd(COURIER_INSURANCE_COST, false)}
                          {perMonth}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-400">
                          {t(language, 'company.currentInsuranceLabel')}
                        </span>
                        <span className="text-slate-200 font-semibold">
                          +{formatCurrencyUsd(monthlyCosts.courierInsuranceCost, false)}
                          {perMonth}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-1.5 border-t border-slate-800 space-y-1">
                    {!bikesMaxed && !canBuyBicycle && (
                      <p className="text-[11px] font-semibold text-rose-300 font-mono-nums leading-tight">
                        {formatMissingFunds(BICYCLE_PURCHASE_COST, economyState.balance, language)}
                      </p>
                    )}
                    <button
                      type="button"
                      disabled={!canBuyBicycle}
                      onClick={onBuyBicycle}
                      className={`w-full px-2.5 py-1.5 rounded-lg text-xs font-bold font-mono-nums transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                        canBuyBicycle
                          ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer'
                          : 'bg-slate-800 text-slate-400 border border-slate-700/80 cursor-not-allowed'
                      }`}
                    >
                      {bikesMaxed
                        ? t(language, 'company.limitReached', {
                            current: MAX_BICYCLES,
                            max: MAX_BICYCLES,
                          })
                        : t(language, 'company.buyBikeBtn', {
                            amount: formatCurrencyUsd(BICYCLE_PURCHASE_COST, false),
                          })}
                    </button>
                  </div>
                </article>

                {/* Card: Owned Fleet Roster */}
                <article className="rounded-lg bg-[#182030] border border-slate-700/85 p-2.5 [@media(max-height:540px)]:p-2 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs sm:text-sm font-bold text-slate-100">
                      {t(language, 'company.ownedFleetTitle', {
                        count: ownedFleet.length,
                      })}
                    </h3>
                    <span className="text-[11px] font-mono-nums text-rose-300 font-semibold">
                      {t(language, 'company.currentInsuranceLabel')}{' '}
                      +{formatCurrencyUsd(monthlyCosts.vanInsuranceCost + monthlyCosts.courierInsuranceCost, false)}
                      {perMonth}
                    </span>
                  </div>

                  <div className="space-y-1.5 max-h-52 overflow-y-auto overscroll-contain pr-0.5">
                    {ownedVans.map((van) => {
                      const vehicleSel: ActiveVehicleSelection = { type: 'van', index: van.index };
                      const spec = getVanModelSpec(van.modelId);
                      const driver = findCourierAssignedToVehicle(couriers, vehicleSel);
                      const driverName = driver
                        ? driver.isOwner
                          ? t(language, 'orders.ownerBadge')
                          : t(language, 'orders.courierBadge', { slot: driver.slotIndex })
                        : null;
                      const durability = getVehicleDurability(economyState, vehicleSel);
                      const roundedDurability = Math.round(durability);
                      const isSlowed = durability <= LOW_DURABILITY_SPEED_THRESHOLD;
                      const repairPending = isVehicleRepairPending(economyState, vehicleSel);
                      const repairEligible =
                        !repairPending && durability < REPAIR_AVAILABLE_DURABILITY_THRESHOLD;
                      const repairCost = calculateVehicleRepairCost('van', durability, van.modelId);
                      const canAffordRepair = economyState.balance >= repairCost;
                      const repairReadiness = repairPending
                        ? getRepairCourierReadiness(economyState, vehicleSel)
                        : null;

                      return (
                        <div
                          key={van.id}
                          className="rounded-md bg-slate-900/75 border border-slate-800 px-2 py-1.5 flex flex-col gap-1 text-[11px] font-mono-nums"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <Car className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
                              <span className="font-semibold text-slate-100 truncate">
                                {t(language, 'company.vehicleVanFull', {
                                  index: van.index,
                                  condition: getVanConditionLabel(language, van.condition),
                                  tier: getVanTierLabel(language, van.tier),
                                })}
                              </span>
                              <span className="text-slate-400 shrink-0">
                                ({t(language, 'company.packagesCount', { count: spec.capacity })})
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span
                                title={
                                  isSlowed
                                    ? t(language, 'company.durabilitySlowHint')
                                    : t(language, 'company.durabilityLabel', {
                                        percent: roundedDurability,
                                      })
                                }
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${getDurabilityBadgeClass(durability)}`}
                              >
                                {roundedDurability}%{isSlowed ? ' (-20%)' : ''}
                              </span>
                              <span className="text-rose-300 hidden sm:inline">
                                -{formatCurrencyUsd(spec.monthlyInsurance, false)}
                                {perMonth}
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-sans font-semibold border ${
                                  driverName
                                    ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300'
                                    : 'bg-slate-800 border-slate-700 text-slate-400'
                                }`}
                              >
                                {driverName
                                  ? t(language, 'company.assignedToLabel', { name: driverName })
                                  : t(language, 'company.unassignedBadge')}
                              </span>
                            </div>
                          </div>

                          {(repairPending || repairEligible) && (
                            <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1 border-t border-slate-800/80">
                              {repairPending ? (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-sans font-semibold border bg-amber-500/15 border-amber-400/45 text-amber-300">
                                    <Wrench className="w-3 h-3 shrink-0" aria-hidden="true" />
                                    <span>{t(language, 'company.repairQueuedBadge')}</span>
                                  </span>
                                  {repairReadiness && !repairReadiness.ready && (
                                    <span className="text-[10px] font-sans text-amber-300/90">
                                      {repairReadiness.reason === 'no_van_license'
                                        ? t(language, 'company.repairNeedsVanLicense')
                                        : t(language, 'company.repairNeedsCourier')}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <>
                                  {!canAffordRepair ? (
                                    <span className="text-[10px] text-rose-300 font-semibold">
                                      {formatMissingFunds(repairCost, economyState.balance, language)}
                                    </span>
                                  ) : (
                                    <span className="text-[10px] font-sans text-slate-400">
                                      {isSlowed
                                        ? t(language, 'company.durabilitySlowHint')
                                        : t(language, 'company.repairReadyHint')}
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    disabled={!canAffordRepair}
                                    onClick={() => onRequestVehicleRepair(vehicleSel)}
                                    title={
                                      !canAffordRepair
                                        ? formatMissingFunds(repairCost, economyState.balance, language)
                                        : undefined
                                    }
                                    className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold font-mono-nums transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                                      canAffordRepair
                                        ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 cursor-pointer'
                                        : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                                    }`}
                                  >
                                    <Wrench className="w-3 h-3 shrink-0" aria-hidden="true" />
                                    <span>
                                      {t(language, 'company.sendToMechanicBtn', {
                                        amount: formatCurrencyUsd(repairCost, false),
                                      })}
                                    </span>
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {Array.from({ length: bikesCount }, (_, i) => {
                      const bikeIndex = i + 1;
                      const vehicleSel: ActiveVehicleSelection = { type: 'bike', index: bikeIndex };
                      const driver = findCourierAssignedToVehicle(couriers, vehicleSel);
                      const driverName = driver
                        ? driver.isOwner
                          ? t(language, 'orders.ownerBadge')
                          : t(language, 'orders.courierBadge', { slot: driver.slotIndex })
                        : null;
                      const durability = getVehicleDurability(economyState, vehicleSel);
                      const roundedDurability = Math.round(durability);
                      const isSlowed = durability <= LOW_DURABILITY_SPEED_THRESHOLD;
                      const repairPending = isVehicleRepairPending(economyState, vehicleSel);
                      const repairEligible =
                        !repairPending && durability < REPAIR_AVAILABLE_DURABILITY_THRESHOLD;
                      const repairCost = calculateVehicleRepairCost('bike', durability);
                      const canAffordRepair = economyState.balance >= repairCost;
                      const repairReadiness = repairPending
                        ? getRepairCourierReadiness(economyState, vehicleSel)
                        : null;

                      return (
                        <div
                          key={`bike-${bikeIndex}`}
                          className="rounded-md bg-slate-900/60 border border-slate-800/80 px-2 py-1.5 flex flex-col gap-1 text-[11px] font-mono-nums"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <Bike className="w-3.5 h-3.5 text-sky-400 shrink-0" aria-hidden="true" />
                              <span className="font-semibold text-slate-200 truncate">
                                {t(language, 'company.vehicleBike', { index: bikeIndex })}
                              </span>
                              <span className="text-slate-400 shrink-0">
                                ({t(language, 'company.packagesCount', { count: BIKE_COURIER_CAPACITY })})
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span
                                title={
                                  isSlowed
                                    ? t(language, 'company.durabilitySlowHint')
                                    : t(language, 'company.durabilityLabel', {
                                        percent: roundedDurability,
                                      })
                                }
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${getDurabilityBadgeClass(durability)}`}
                              >
                                {roundedDurability}%{isSlowed ? ' (-20%)' : ''}
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-sans font-semibold border shrink-0 ${
                                  driverName
                                    ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300'
                                    : 'bg-slate-800 border-slate-700 text-slate-400'
                                }`}
                              >
                                {driverName
                                  ? t(language, 'company.assignedToLabel', { name: driverName })
                                  : t(language, 'company.unassignedBadge')}
                              </span>
                            </div>
                          </div>

                          {(repairPending || repairEligible) && (
                            <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1 border-t border-slate-800/80">
                              {repairPending ? (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-sans font-semibold border bg-amber-500/15 border-amber-400/45 text-amber-300">
                                    <Wrench className="w-3 h-3 shrink-0" aria-hidden="true" />
                                    <span>{t(language, 'company.repairQueuedBadge')}</span>
                                  </span>
                                  {repairReadiness && !repairReadiness.ready && (
                                    <span className="text-[10px] font-sans text-amber-300/90">
                                      {t(language, 'company.repairNeedsCourier')}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <>
                                  {!canAffordRepair ? (
                                    <span className="text-[10px] text-rose-300 font-semibold">
                                      {formatMissingFunds(repairCost, economyState.balance, language)}
                                    </span>
                                  ) : (
                                    <span className="text-[10px] font-sans text-slate-400">
                                      {isSlowed
                                        ? t(language, 'company.durabilitySlowHint')
                                        : t(language, 'company.repairReadyHint')}
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    disabled={!canAffordRepair}
                                    onClick={() => onRequestVehicleRepair(vehicleSel)}
                                    title={
                                      !canAffordRepair
                                        ? formatMissingFunds(repairCost, economyState.balance, language)
                                        : undefined
                                    }
                                    className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold font-mono-nums transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                                      canAffordRepair
                                        ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 cursor-pointer'
                                        : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                                    }`}
                                  >
                                    <Wrench className="w-3 h-3 shrink-0" aria-hidden="true" />
                                    <span>
                                      {t(language, 'company.sendToMechanicBtn', {
                                        amount: formatCurrencyUsd(repairCost, false),
                                      })}
                                    </span>
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {ownedVans.length === 0 && (
                      <p className="text-[11px] text-slate-400 pt-1 leading-snug">
                        {t(language, 'company.ownedFleetEmptyVans')}
                      </p>
                    )}
                  </div>
                </article>
              </div>
            </div>
          )}

          {/* TAB 3: STAFF */}
          {activeTab === 'employees' && (
            <div
              id="company-panel-employees"
              role="tabpanel"
              aria-labelledby="company-tab-employees"
              className="space-y-2.5"
            >
              {/* Compact Team Overview Header */}
              <div className="rounded-lg bg-[#182030] border border-slate-700/85 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <Users className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
                  <h3 className="text-xs sm:text-sm font-bold text-slate-100">
                    {t(language, 'company.teamHeader', {
                      hired: hiredCouriersCount,
                      max: MAX_EMPLOYEES,
                    })}
                  </h3>
                  <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[11px] font-mono-nums text-slate-300">
                    {t(language, 'company.licensesBadge', {
                      current: economyState.maxEmployees,
                      max: MAX_EMPLOYEES,
                    })}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono-nums">
                  <span className="text-slate-400">
                    {t(language, 'company.salariesLabel')}{' '}
                    <span className="font-bold text-rose-300">
                      {formatCurrencyUsd(monthlyCosts.salariesCost, false)}
                      {perMonth}
                    </span>
                  </span>
                  <span className="text-slate-600" aria-hidden="true">•</span>
                  <span className="text-slate-400">
                    {t(language, 'company.qualBike')}:{' '}
                    {formatCurrencyUsd(HIRED_BIKE_COURIER_SALARY, false)} |{' '}
                    {t(language, 'company.qualBikeAndVan')}:{' '}
                    {formatCurrencyUsd(HIRED_VAN_DRIVER_SALARY, false)}
                  </span>
                </div>
              </div>

              {/* 6-Slot Staff Roster Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {couriers.map((courier) => {
                  const slotAtBase = isSlotAtBase(courier.slotIndex);
                  const effectiveAssigned = courier.isOwner
                    ? courier.assignedVehicle ?? activeVehicle
                    : courier.assignedVehicle;

                  // 1. Unlocked & Hired Slot
                  if (courier.unlocked && courier.hired) {
                    const roleHeading = courier.isOwner
                      ? t(language, 'company.ownerRoleHeading')
                      : t(language, 'company.courierRoleHeading', { slot: courier.slotIndex });
                    const hasVanQualification =
                      courier.isOwner || courier.qualification === 'bike_and_van';
                    const qualificationLabel = hasVanQualification
                      ? t(language, 'company.qualBikeAndVan')
                      : t(language, 'company.qualBike');

                    const availableVehicles = ownedFleet.filter(
                      (vehicle) =>
                        canCourierDriveVehicle(courier, vehicle.type) &&
                        findCourierAssignedToVehicle(couriers, vehicle, courier.slotIndex) === null
                    );

                    return (
                      <article
                        key={courier.id}
                        className="rounded-lg bg-[#182030] border border-slate-700/85 p-2.5 flex flex-col justify-between gap-2 text-xs"
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                              {effectiveAssigned?.type === 'van' ? (
                                <Car className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
                              ) : effectiveAssigned?.type === 'bike' ? (
                                <Bike className="w-4 h-4 text-sky-400 shrink-0" aria-hidden="true" />
                              ) : (
                                <Users className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                              )}
                              <h4 className="font-bold text-slate-100 truncate">{roleHeading}</h4>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border shrink-0 ${
                                  slotAtBase
                                    ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300'
                                    : 'bg-amber-500/15 border-amber-400/40 text-amber-300'
                                }`}
                              >
                                {slotAtBase
                                  ? t(language, 'company.statusAvailable')
                                  : t(language, 'company.statusOnRoute')}
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border shrink-0 ${
                                  hasVanQualification
                                    ? 'bg-amber-500/15 border-amber-400/40 text-amber-300'
                                    : 'bg-sky-500/15 border-sky-400/40 text-sky-300'
                                }`}
                              >
                                {qualificationLabel}
                              </span>
                            </div>

                            <span
                              className={`px-2 py-0.5 rounded text-[11px] font-bold font-mono-nums border shrink-0 ${
                                courier.isOwner
                                  ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300'
                                  : 'bg-rose-500/15 border-rose-400/40 text-rose-300'
                              }`}
                            >
                              {formatCurrencyUsd(courier.monthlySalary, false)}
                              {perMonth}
                            </span>
                          </div>

                          {/* Custom filtered dark vehicle selector */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <label
                                htmlFor={`courier-vehicle-${courier.slotIndex}`}
                                className="text-[11px] text-slate-400"
                              >
                                {t(language, 'company.assignedVehicleLabel')}
                              </label>
                              {!slotAtBase && (
                                <span className="text-[10px] text-amber-300/90">
                                  {t(language, 'company.changeAtBaseHint')}
                                </span>
                              )}
                            </div>

                            <CourierVehicleDropdown
                              language={language}
                              economyState={economyState}
                              courier={courier}
                              effectiveAssigned={effectiveAssigned}
                              availableVehicles={availableVehicles}
                              disabled={!slotAtBase}
                              isOpen={openVehicleSlot === courier.slotIndex}
                              openUpward={courier.slotIndex >= 5}
                              onToggle={() =>
                                setOpenVehicleSlot((prev) =>
                                  prev === courier.slotIndex ? null : courier.slotIndex
                                )
                              }
                              onClose={() =>
                                setOpenVehicleSlot((prev) =>
                                  prev === courier.slotIndex ? null : prev
                                )
                              }
                              onSelect={(selectedVehicle) => {
                                if (courier.isOwner && selectedVehicle) {
                                  onSelectActiveVehicle(selectedVehicle);
                                } else {
                                  onAssignCourierVehicle(courier.slotIndex, selectedVehicle);
                                }
                              }}
                            />
                          </div>
                        </div>

                        <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-1.5">
                          <span className="text-[11px] text-slate-400 font-mono-nums">
                            {courier.isOwner
                              ? `${t(language, 'company.ownerFooterDesc')} • ${t(
                                  language,
                                  'company.courierPayload',
                                  {
                                    count: getVehicleCourierCapacityForSelection(
                                      economyState,
                                      effectiveAssigned
                                    ),
                                  }
                                )}`
                              : effectiveAssigned
                                ? t(language, 'company.courierPayload', {
                                    count: getVehicleCourierCapacityForSelection(
                                      economyState,
                                      effectiveAssigned
                                    ),
                                  })
                                : hasVanQualification
                                  ? t(language, 'company.assignBikeOrVan')
                                  : t(language, 'company.assignBikeOrPromote')}
                          </span>

                          {!courier.isOwner && (
                            <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                              {!hasVanQualification && (
                                <button
                                  type="button"
                                  title={t(language, 'company.promoteTitle', {
                                    salary: formatCurrencyUsd(HIRED_VAN_DRIVER_SALARY, false),
                                  })}
                                  onClick={() => onPromoteCourier(courier.slotIndex)}
                                  className="px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 border bg-amber-500/15 hover:bg-amber-500/25 border-amber-400/45 text-amber-300 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
                                >
                                  <ArrowUpCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                  <span>{t(language, 'company.promoteBtn')}</span>
                                </button>
                              )}

                              <button
                                type="button"
                                disabled={!slotAtBase}
                                onClick={() => onFireCourier(courier.slotIndex)}
                                className={`px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 border transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                                  slotAtBase
                                    ? 'bg-rose-500/15 hover:bg-rose-500/25 border-rose-400/45 text-rose-300 cursor-pointer'
                                    : 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed'
                                }`}
                              >
                                <UserMinus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                <span>{t(language, 'company.fireBtn')}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  }

                  // 2. Unlocked but Vacant Slot
                  if (courier.unlocked && !courier.hired) {
                    return (
                      <article
                        key={courier.id}
                        className="rounded-lg bg-[#182030] border border-sky-500/40 p-2.5 flex flex-col justify-between gap-2 text-xs"
                      >
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <UserPlus className="w-4 h-4 text-sky-400 shrink-0" aria-hidden="true" />
                              <h4 className="font-bold text-slate-100 truncate">
                                {t(language, 'company.courierRoleHeading', {
                                  slot: courier.slotIndex,
                                })}
                              </h4>
                            </div>
                            <span className="px-2 py-0.5 rounded bg-sky-500/15 border border-sky-400/40 text-sky-300 text-[10px] font-semibold shrink-0">
                              {t(language, 'company.vacantBadge')}
                            </span>
                          </div>

                          <p className="text-[11px] text-slate-400 leading-snug">
                            {t(language, 'company.vacantDesc')}
                          </p>
                        </div>

                        <div className="pt-2 border-t border-slate-800 flex flex-col gap-1.5">
                          <button
                            type="button"
                            onClick={() => onHireCourier(courier.slotIndex, 'bike_only')}
                            className="w-full px-2.5 py-1.5 rounded-lg text-xs font-bold font-mono-nums flex items-center justify-center gap-1.5 bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/50 text-sky-200 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
                          >
                            <Bike className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            <span>
                              {t(language, 'company.hireBikeBtn', {
                                salary: formatCurrencyUsd(HIRED_BIKE_COURIER_SALARY, false),
                              })}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => onHireCourier(courier.slotIndex, 'bike_and_van')}
                            className="w-full px-2.5 py-1.5 rounded-lg text-xs font-bold font-mono-nums flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
                          >
                            <Car className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            <span>
                              {t(language, 'company.hireVanBtn', {
                                salary: formatCurrencyUsd(HIRED_VAN_DRIVER_SALARY, false),
                              })}
                            </span>
                          </button>
                        </div>
                      </article>
                    );
                  }

                  // 3. Locked Slot
                  const licenseCost = getEmployeeLicenseCost(courier.slotIndex) ?? 0;
                  const isNextToUnlock = courier.slotIndex === economyState.maxEmployees + 1;
                  const canBuyLicense = isNextToUnlock && economyState.balance >= licenseCost;

                  return (
                    <article
                      key={courier.id}
                      className={`rounded-lg bg-[#151d2b] border p-2.5 flex flex-col justify-between gap-2 text-xs ${
                        isNextToUnlock
                          ? 'border-amber-400/45'
                          : 'border-slate-800 opacity-75'
                      }`}
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                            <h4 className="font-bold text-slate-200 truncate">
                              {t(language, 'company.lockedSlotHeading', {
                                slot: courier.slotIndex,
                              })}
                            </h4>
                          </div>
                          <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 text-[10px] font-semibold shrink-0">
                            {t(language, 'company.lockedBadge')}
                          </span>
                        </div>

                        <p className="text-[11px] text-slate-400 leading-snug">
                          {isNextToUnlock
                            ? t(language, 'company.lockedNextDesc', { slot: courier.slotIndex })
                            : t(language, 'company.lockedPrevDesc', {
                                prevSlot: courier.slotIndex - 1,
                              })}
                        </p>
                      </div>

                      <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
                        <div className="min-w-0 leading-tight">
                          {!canBuyLicense && (
                            <span
                              className={`block text-[11px] font-semibold font-mono-nums ${
                                !isNextToUnlock ? 'text-amber-300' : 'text-rose-300'
                              }`}
                            >
                              {!isNextToUnlock
                                ? t(language, 'company.requiresPrevLicense', {
                                    prevSlot: courier.slotIndex - 1,
                                  })
                                : formatMissingFunds(licenseCost, economyState.balance, language)}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={!canBuyLicense}
                          onClick={onBuyEmployeeLicense}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono-nums shrink-0 transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                            canBuyLicense
                              ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer'
                              : 'bg-slate-800 text-slate-400 border border-slate-700/80 cursor-not-allowed'
                          }`}
                        >
                          {t(language, 'company.buyLicenseBtn', {
                            amount: formatCurrencyUsd(licenseCost, false),
                          })}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
