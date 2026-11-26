import React, { useEffect } from 'react';
import { Calendar, CheckCircle2, Frown, Meh, Smile, TrendingDown, TrendingUp, X } from 'lucide-react';
import { getMonthName, t } from '../i18n/translations';
import type { MonthlySettlementRecord } from '../types/orders';
import { formatCurrencyUsd } from '../utils/orderEconomy';
import type { SupportedLanguage } from '../utils/settingsSystem';

interface MonthlyReportModalProps {
  record: MonthlySettlementRecord | null;
  language: SupportedLanguage;
  onClose: () => void;
}

export const MonthlyReportModal: React.FC<MonthlyReportModalProps> = ({
  record,
  language,
  onClose,
}) => {
  useEffect(() => {
    if (!record) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [record, onClose]);

  if (!record) return null;

  const prevMonthIndex = (record.monthIndex + 11) % 12;
  const prevMonthYear = record.monthIndex === 0 ? record.year - 1 : record.year;
  const periodTitle = `${getMonthName(language, prevMonthIndex, false)} ${t(language, 'hud.yearFull', { year: prevMonthYear })}`;

  const totalRevenue =
    typeof record.totalRevenue === 'number'
      ? record.totalRevenue
      : (record.shortTermRevenue ?? 0) + record.longTermContractPayout;
  const totalExpenses =
    typeof record.totalExpenses === 'number'
      ? record.totalExpenses
      : record.totalFixedCosts +
        (record.fuelExpenses ?? 0) +
        (record.repairExpenses ?? 0) +
        (record.penaltyExpenses ?? 0);
  const netResult = totalRevenue - totalExpenses;
  const completedOrders = record.completedOrdersCount ?? 0;
  const avgSat = Math.round(
    Math.max(0, Math.min(100, record.averageSatisfaction ?? 80))
  );
  const satColorClass =
    avgSat >= 80 ? 'text-emerald-400' : avgSat >= 60 ? 'text-amber-400' : 'text-rose-400';
  const SatIcon = avgSat >= 80 ? Smile : avgSat >= 60 ? Meh : Frown;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 touch-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="monthly-report-heading"
      onWheel={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      <div className="w-[92vw] max-w-md rounded-xl bg-slate-900/95 border border-slate-700 shadow-2xl overflow-hidden text-slate-100 touch-auto">
        {/* Header with prominent X close button */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 bg-[#182030] border-b border-slate-700/85">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-400/45 text-amber-300 flex items-center justify-center shrink-0">
              <Calendar className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2
                id="monthly-report-heading"
                className="text-sm sm:text-base font-extrabold text-slate-100 leading-tight truncate"
              >
                {t(language, 'monthlyReport.title')}
              </h2>
              <p className="text-xs text-amber-300 font-semibold leading-tight truncate">
                {periodTitle}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t(language, 'monthlyReport.closeAria')}
            className="min-w-[34px] min-h-[34px] p-1.5 rounded-lg flex items-center justify-center shrink-0 text-slate-200 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-600 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Symbolic KPI Summary */}
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-2.5 font-mono-nums">
            <div className="rounded-lg bg-slate-950/80 border border-slate-800 p-3">
              <div className="text-[11px] font-sans text-slate-400 mb-0.5">
                {t(language, 'monthlyReport.earned')}
              </div>
              <div className="text-base sm:text-lg font-extrabold text-emerald-400">
                {formatCurrencyUsd(totalRevenue, false)}
              </div>
            </div>

            <div className="rounded-lg bg-slate-950/80 border border-slate-800 p-3">
              <div className="text-[11px] font-sans text-slate-400 mb-0.5">
                {t(language, 'monthlyReport.spent')}
              </div>
              <div className="text-base sm:text-lg font-extrabold text-rose-400">
                {formatCurrencyUsd(totalExpenses, false)}
              </div>
            </div>
          </div>

          {/* Net Monthly Result */}
          <div
            className={`rounded-lg border p-3.5 flex items-center justify-between gap-2 ${
              netResult >= 0
                ? 'bg-emerald-500/10 border-emerald-400/40'
                : 'bg-rose-500/10 border-rose-400/40'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {netResult >= 0 ? (
                <TrendingUp className="w-5 h-5 text-emerald-400 shrink-0" aria-hidden="true" />
              ) : (
                <TrendingDown className="w-5 h-5 text-rose-400 shrink-0" aria-hidden="true" />
              )}
              <span className="text-xs sm:text-sm font-bold text-slate-200 truncate">
                {t(language, 'monthlyReport.netResult')}
              </span>
            </div>
            <span
              className={`text-lg sm:text-xl font-extrabold font-mono-nums shrink-0 ${
                netResult >= 0 ? 'text-emerald-300' : 'text-rose-300'
              }`}
            >
              {netResult >= 0 ? '+' : '-'}
              {formatCurrencyUsd(Math.abs(netResult), false)}
            </span>
          </div>

          {/* Operational Metrics Row */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-lg bg-slate-950/75 border border-slate-800 px-3 py-2.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0" aria-hidden="true" />
                <span className="text-[11px] text-slate-400 truncate">
                  {t(language, 'monthlyReport.completedOrders')}
                </span>
              </div>
              <span className="text-sm sm:text-base font-extrabold font-mono-nums text-slate-100 shrink-0">
                {completedOrders}
              </span>
            </div>

            <div className="rounded-lg bg-slate-950/75 border border-slate-800 px-3 py-2.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <SatIcon className={`w-4 h-4 shrink-0 ${satColorClass}`} aria-hidden="true" />
                <span className="text-[11px] text-slate-400 truncate">
                  {t(language, 'monthlyReport.avgSatisfaction')}
                </span>
              </div>
              <span className={`text-sm sm:text-base font-extrabold font-mono-nums shrink-0 ${satColorClass}`}>
                {avgSat}%
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
