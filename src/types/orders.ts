import type { BuildingType, DeliveryStopPoint, RoadApproachPoint } from './building';

export type ReputationLevel = 1 | 2 | 3 | 4;

export type LongTermDurationMonths = 3 | 6 | 12;

export type OrderKind = 'short_term' | 'long_term';

export type OrderStatus = 'pending' | 'active' | 'completed' | 'terminated' | 'expired';

export interface ReputationTierConfig {
  level: ReputationLevel;
  name: string;
  /** Minimum completed orders required for this tier */
  minCompletedOrders: number;
  /** Inclusive upper display bound (null for highest tier) */
  maxCompletedOrders: number | null;
  /** Minimum annual company satisfaction % required (null = no requirement) */
  minAnnualSatisfaction: number | null;
  /** Minimum payout rate in USD per delivered package */
  ratePerPackageMin: number;
  /** Maximum payout rate in USD per delivered package */
  ratePerPackageMax: number;
  /** Maximum short-term order duration in days */
  maxShortTermDays: number;
  /** Allowed long-term contract durations in months */
  allowedLongTermMonths: readonly LongTermDurationMonths[];
}

export interface OrderLocation {
  buildingId: string;
  buildingType: BuildingType;
  address: string;
  streetName: string;
  buildingNumber: number;
  deliveryStopPoint: DeliveryStopPoint;
  roadApproachPoint?: RoadApproachPoint;
}

export interface OrderDeliveryStop {
  id: string;
  location: OrderLocation;
  packageCount: number;
  deliveredCount: number;
}

export interface OrderOfferBase {
  id: string;
  kind: OrderKind;
  clientName: string;
  title: string;
  description: string;
  reputationTierAtCreation: ReputationLevel;
  pickupLocation: OrderLocation;
  /** USD earned per delivered package (rounded to cents) */
  ratePerPackage: number;
  /** 1-based gameplay day when offer appeared */
  createdAtGameDay: number;
  createdAtMinutes: number;
  /** 1-based gameplay day when unused offer expires (createdAtGameDay + 4) */
  expiresAtGameDay: number;
  expiresAtMinutes: number;
  /** False for newly generated offers until the player views the "Nowe oferty" tab */
  isSeen: boolean;
}

export interface ShortTermOrderOffer extends OrderOfferBase {
  kind: 'short_term';
  /** Duration in days: 1–3 days (5–8 pkgs) or 7–14 days (12–22 pkgs) */
  durationDays: number;
  /** Total packages to deliver across the order */
  totalPackages: number;
  /** One-time lump sum paid immediately upon delivering the final package */
  totalExpectedPayout: number;
  /** Concrete destination addresses on the map */
  deliveryStops: OrderDeliveryStop[];
}

export interface LongTermOrderOffer extends OrderOfferBase {
  kind: 'long_term';
  /** Contract length in calendar months (3, 6, or 12) */
  durationMonths: LongTermDurationMonths;
  /** Weekly package quota (10–16 for Level 2; 20–36 for Levels 3–4) */
  packagesPerWeek: number;
  /** Weekly pickup cadence (1 day/week for Level 2; 2 days/week for Levels 3–4) */
  pickupDaysPerWeek: 1 | 2;
  /** 0-based weekday indices (0 = Poniedziałek .. 6 = Niedziela) scheduled for pickups */
  pickupWeekdays: readonly number[];
  /** Estimated monthly payout settled on the 1st of each following month */
  estimatedMonthlyPayout: number;
  /** Estimated total contract value across the full contract duration */
  totalContractValue: number;
  /** Real destination addresses used for initial/sample weekly delivery stops */
  sampleDeliveryStops: OrderDeliveryStop[];
}

export type OrderOffer = ShortTermOrderOffer | LongTermOrderOffer;

export interface ActiveOrderWeeklyTracking {
  /** 1-based gameplay day when the current weekly tracking period started */
  weekStartGameDay: number;
  /** Packages expected to be delivered before Sunday 23:59 */
  expectedPackagesThisWeek: number;
  /** Packages picked up from sender during the current week */
  pickedUpPackagesThisWeek: number;
  /** Packages delivered to recipients during the current week */
  deliveredPackagesThisWeek: number;
  /** Count of late pickup incidents during the current week */
  latePickupsThisWeek: number;
  /** Last Sunday gameplay day that was already evaluated at 23:59 */
  lastSettledSundayGameDay: number | null;
  /** 1-based gameplay day on which packages were last picked up from the sender */
  lastPickupGameDay?: number;
  /** Number of packages picked up from the sender on `lastPickupGameDay` */
  pickedUpOnLastPickupDay?: number;
}

export type WeeklyTaskType = 'pickup' | 'delivery';

export interface WeeklyScheduleTask {
  /** Stable unique identifier for independent priority ordering (e.g. "ord-1:pickup", "ord-1:delivery") */
  taskId: string;
  /** Fulfillment stage: 'pickup' (sender -> Base warehouse) or 'delivery' (Base warehouse -> recipients) */
  taskType: WeeklyTaskType;
  orderId: string;
  weekdayIndex: number;
  kind: OrderKind;
  clientName: string;
  pickupAddress: string;
  /** Short Polish stage label ("Odbiór" or "Rozwózka") */
  taskLabel: string;
  /** Number of packages scheduled / remaining for this stage */
  packageCount: number;
  /** Order's current satisfaction % for quick dispatch awareness */
  satisfaction: number;
  /** 1-based priority rank within this weekday */
  priorityRank: number;
}

export interface ActiveOrderBase {
  status: Exclude<OrderStatus, 'pending'>;
  acceptedAtGameDay: number;
  acceptedAtMinutes: number;
  endGameDay: number;
  endMinutes: number;
  /** Individual active contract satisfaction bar (starts at 80%, range 0–100%) */
  satisfaction: number;
  deliveredPackagesTotal: number;
  totalEarnedPayout: number;
  totalPenaltiesPaid: number;
  weekly: ActiveOrderWeeklyTracking;
  concludedAtGameDay?: number;
  concludedAtMinutes?: number;
  terminationReason?: string;
}

export interface ActiveShortTermOrder extends ShortTermOrderOffer, ActiveOrderBase {
  /** True once the final package has been delivered and the lump sum was paid out */
  lumpSumPaid: boolean;
}

export interface ActiveLongTermOrder extends LongTermOrderOffer, ActiveOrderBase {
  /** Earnings accrued from packages delivered in the current billing month */
  accruedMonthlyPayout: number;
  /** Active delivery stops for the current week */
  currentWeekDeliveryStops: OrderDeliveryStop[];
}

export type ActiveOrder = ActiveShortTermOrder | ActiveLongTermOrder;

export interface WeeklyOrderSettlementResult {
  orderId: string;
  clientName: string;
  sundayGameDay: number;
  previousSatisfaction: number;
  newSatisfaction: number;
  satisfactionDelta: number;
  latePickups: number;
  undeliveredPackages: number;
  penaltyAmount: number;
  terminated: boolean;
}

export type EmployeeRole = 'owner_bike_courier' | 'bike_courier' | 'van_driver';

export type HirableEmployeeRole = Exclude<EmployeeRole, 'owner_bike_courier'>;

export interface CompanyEmployee {
  id: string;
  name: string;
  role: EmployeeRole;
  /** True for the starter player-owner courier ($0/mies. salary, only $90/mies. courier insurance) */
  isOwner: boolean;
  /** Monthly salary in USD ($0 owner, $1 650 bike courier, $2 300 van driver) */
  monthlySalary: number;
  /** Monthly insurance in USD ($90 courier insurance, $180 driver & van insurance) */
  monthlyInsurance: number;
  hiredAtGameDay: number;
}

export interface MonthlyCostBreakdown {
  /** Fixed base tax & upkeep cost ($350) */
  baseUpkeepAndTaxCost: number;
  /** Total monthly salaries for all hired employees ($0 for owner) */
  salariesCost: number;
  /** Total monthly insurance for owner + hired bike couriers ($90 each) */
  courierInsuranceCost: number;
  /** Total monthly driver & vehicle insurance for hired van drivers ($180 each) */
  vanInsuranceCost: number;
  /** Combined monthly insurance cost (courierInsuranceCost + vanInsuranceCost) */
  insuranceCost: number;
  /** Total monthly operating costs (baseUpkeepAndTaxCost + salariesCost + insuranceCost) */
  totalFixedCosts: number;
}

export interface MonthlySettlementRecord {
  id: string;
  /** Calendar year of the 1st-of-month settlement date */
  year: number;
  /** 0-based month index of the 1st-of-month settlement date (e.g. 6 = Lipiec) */
  monthIndex: number;
  monthName: string;
  /** Label of the previous month covered by this settlement */
  settledPeriodLabel: string;
  /** Fixed base tax & upkeep cost ($350) */
  baseUpkeepAndTaxCost: number;
  /** Total monthly employee salaries billed on this settlement */
  salariesCost: number;
  /** Monthly courier insurance cost ($90 per bike courier including owner) */
  courierInsuranceCost: number;
  /** Monthly van driver & vehicle insurance cost ($180 per van driver) */
  vanInsuranceCost: number;
  /** Combined monthly insurance cost (courierInsuranceCost + vanInsuranceCost) */
  insuranceCost: number;
  /** Total monthly fixed/operating costs (base upkeep + salaries + insurance) */
  totalFixedCosts: number;
  /** Accumulated payout for packages delivered in the previous month under long-term contracts */
  longTermContractPayout: number;
  /** Net balance change: longTermContractPayout - totalFixedCosts */
  netChange: number;
  /** Company balance immediately after applying this settlement */
  balanceAfter: number;
}

export type WarehouseTier = 1 | 2 | 3 | 4;

export interface WarehouseTierConfig {
  tier: WarehouseTier;
  name: string;
  /** Maximum number of packages that can be stored in Base warehouse simultaneously */
  capacity: number;
  /** One-time USD cost to upgrade from the previous tier (0 for starter Tier 1) */
  upgradeCost: number;
}

export interface WarehouseUpgradeInfo {
  currentTier: WarehouseTier;
  nextTier: WarehouseTier;
  currentCapacity: number;
  nextCapacity: number;
  cost: number;
}

export interface ParkingSpotUpgradeInfo {
  currentSpots: number;
  nextSpotNumber: number;
  maxSpots: number;
  cost: number;
}

export interface EmployeeLicenseUpgradeInfo {
  currentMaxEmployees: number;
  nextEmployeeSlot: number;
  maxEmployees: number;
  cost: number;
}

export interface WarehouseUnloadResult {
  state: OrderEconomyState;
  /** Number of packages actually stored in Base warehouse */
  unloadedCount: number;
  /** Packages that could not fit due to insufficient free warehouse space */
  overflowCount: number;
}

export interface WarehouseLoadedBatch {
  orderId: string;
  count: number;
}

export interface WarehouseLoadForBikeResult {
  state: OrderEconomyState;
  /** Batches loaded from Base warehouse onto the bicycle (total <= BIKE_COURIER_CAPACITY) */
  loadedPackages: WarehouseLoadedBatch[];
  totalLoaded: number;
}

export interface UpgradePurchaseResult {
  state: OrderEconomyState;
  purchased: boolean;
  cost: number;
  reason?: 'max_reached' | 'insufficient_funds';
}

export interface OrderEconomyState {
  balance: number;
  /** Total successfully completed orders (starts at 0) */
  completedOrdersCount: number;
  /** Sum of final satisfaction scores of orders concluded in the current calendar year */
  annualSatisfactionSum: number;
  /** Count of orders concluded (completed or terminated) in the current calendar year */
  annualSatisfactionCount: number;
  /** Average satisfaction % for the current calendar year (starts at 0%, resets every 1 Styczeń) */
  annualSatisfactionAvg: number;
  /** Calendar year tracked by the annual satisfaction stats */
  annualStatsYear: number;
  /** Current company reputation tier (1–4) */
  reputationLevel: ReputationLevel;
  /** Base warehouse expansion level (1–4; determines capacity & Base building size) */
  warehouseTier: WarehouseTier;
  /** Maximum package capacity of the Base warehouse (30 / 70 / 140 / 250) */
  warehouseCapacity: number;
  /** Current total number of packages stored in the Base warehouse awaiting delivery */
  warehousePackages: number;
  /** Per-order counts of packages currently stored in the Base warehouse */
  warehouseInventory: Record<string, number>;
  /** Number of unlocked car parking spots directly at Base (starts at 1, max 8) */
  parkingSpots: number;
  /** Number of unlocked employee licenses/slots (starts at 1, max 6) */
  maxEmployees: number;
  /** Active company staff roster (starts with 1 owner-courier at $0 salary + $90 courier insurance) */
  employees: CompanyEmployee[];
  /** Number of owned bicycles including the owner's starter bike (starts at 1, max MAX_BICYCLES = 3) */
  bicyclesCount: number;
  /** Number of owned delivery vans (starts at 0, prepared for future vehicle fleet) */
  deliveryVansCount: number;
  /** Pending offers waiting to be accepted (max 7 at once, expire after 4 days) */
  pendingOffers: OrderOffer[];
  /** Currently signed & ongoing orders (no upper limit) */
  activeOrders: ActiveOrder[];
  /** Completed, terminated, or expired orders archive */
  archivedOrders: ActiveOrder[];
  /** Unpaid accrued earnings from long-term contract deliveries made in the current month */
  pendingMonthlyLongTermPayout: number;
  /** History of 1st-of-month financial settlements */
  monthlySettlements: MonthlySettlementRecord[];
  /** Most recent weekly Sunday 23:59 settlement results */
  recentWeeklySettlements: WeeklyOrderSettlementResult[];
  /** 1-based gameplay day when offers were last generated */
  lastOfferGenerationGameDay: number;
  /** Last processed world clock timestamp in total minutes */
  lastProcessedMinutes: number;
  /** Month key (e.g. "1-06") of the latest settled/initialized month */
  lastSettledMonthKey: string;
  /** Monotonic sequence counter for deterministic unique order IDs */
  nextOrderSeq: number;
  /** Deterministic PRNG state for pure offer generation */
  rngState: number;
  /** Saved per-weekday (0 = Pon .. 6 = Nd) priority order of active order IDs for courier dispatch */
  weeklyPriorityOrder: Record<number, string[]>;
}
