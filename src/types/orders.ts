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
  /** Unique 3-digit human-readable order number (101–999) */
  orderNumber: number;
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
  /** 1-based gameplay day when unused offer expires (+2 days short-term, +3 days long-term) */
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
  /** 1-based pickup gameDay of the latest batch that already incurred an overdue 3-day delivery incident */
  penalizedDeliveryBatchGameDay?: number;
}

export type WeeklyTaskType = 'order' | 'pickup' | 'delivery' | 'repair';

export type WeeklyTaskSortMode =
  | 'short_term_first'
  | 'long_term_first'
  | 'packages_desc'
  | 'packages_asc';

export interface WeeklyScheduleTask {
  /** Stable unique identifier per order or repair task in a weekday priority queue (e.g. "ord-1", "repair:van:1") */
  taskId: string;
  /** Unified task marker ('order' for merged pickup+delivery rows; 'repair' for mechanic trips; 'pickup'/'delivery' kept for legacy saves) */
  taskType: WeeklyTaskType;
  orderId: string;
  /** Unique 3-digit human-readable order number (101–999; 0 for service tasks) */
  orderNumber: number;
  weekdayIndex: number;
  kind: OrderKind;
  clientName: string;
  pickupAddress: string;
  /** Short Polish task label ("Realizacja" or "Serwis") */
  taskLabel: string;
  /** Number of packages remaining / scheduled for this task (0 for service tasks) */
  packageCount: number;
  /** Number of packages already picked up from sender for this task */
  pickedUpCount: number;
  /** Number of packages already delivered to recipients for this task */
  deliveredCount: number;
  /** Total number of packages for this task */
  totalPackages: number;
  /** Order's current satisfaction % for quick dispatch awareness */
  satisfaction: number;
  /** 1-based priority rank within this weekday */
  priorityRank: number;
  /** Optional 1-based courier slot index (#1–#6) currently executing this task */
  assignedCourierId?: number;
  /** Present when taskType === 'repair': concrete vehicle scheduled for mechanic repair */
  repairVehicle?: ActiveVehicleSelection;
  /** Present when taskType === 'repair': current durability % (0–100) */
  repairDurability?: number;
  /** Present when taskType === 'repair': true when no qualified courier is currently assigned to this vehicle */
  repairWaitingForCourier?: boolean;
  /** Present when taskType === 'repair' && repairWaitingForCourier */
  repairWaitingReason?: 'no_courier' | 'no_van_license';
  /** True when the viewed weekday is the final day to complete this order (short-term expiry or weekly/contract/3-day delivery deadline) */
  isExpiringOnDay?: boolean;
  /** True specifically when the viewed weekday is the final day of a long-term order's 3-day post-pickup delivery window */
  isDeliveryWindowDeadline?: boolean;
}

export interface ActiveOrderBase {
  status: Exclude<OrderStatus, 'pending'>;
  acceptedAtGameDay: number;
  acceptedAtMinutes: number;
  endGameDay: number;
  endMinutes: number;
  /** Individual active contract satisfaction bar (starts at 80%, range 0–100%) */
  satisfaction: number;
  /** Cumulative packages picked up from sender across the entire lifetime of this active order */
  pickedUpPackagesTotal: number;
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

/** Courier driving qualification profile ('bike_only' = $1 600/mies., 'bike_and_van' = $2 300/mies.) */
export type CourierQualification = 'bike_only' | 'bike_and_van';

export interface CompanyEmployee {
  id: string;
  name: string;
  role: EmployeeRole;
  /** True for the starter player-owner courier ($0/mies. salary, starter bicycle included in Base Lv.1 upkeep) */
  isOwner: boolean;
  /** Monthly salary in USD ($0 owner, $1 600 bike courier, $2 300 bike+van courier) */
  monthlySalary: number;
  /** Monthly insurance in USD ($50 additional bike, $130 owned used van, $180 hired van driver) */
  monthlyInsurance: number;
  hiredAtGameDay: number;
}

export type ActiveVehicleType = 'bike' | 'scooter' | 'van';

export type ScooterModelId = 'scooter_city' | 'scooter_cargo';

export interface ScooterModelSpec {
  id: ScooterModelId;
  name: string;
  /** Maximum packages this scooter model can carry in a single trip */
  capacity: number;
  /** Cruising speed in world px/s */
  speedPxPerSec: number;
  /** One-time purchase price in USD */
  purchasePrice: number;
  /** Monthly insurance & maintenance cost in USD */
  monthlyInsurance: number;
  /** Mechanic garage service duration in in-game minutes */
  repairGameMinutes: number;
  /** Fuel tank capacity in liters */
  fuelTankCapacityLiters: number;
  /** Relative fuel consumption rate */
  fuelConsumptionRate: number;
}

export interface OwnedScooter {
  id: string;
  /** 1-based scooter fleet index matching ActiveVehicleSelection.index */
  index: number;
  modelId: ScooterModelId;
  /** Current mechanical durability (0–100%) */
  durability: number;
  /** Current fuel level in liters (0 .. fuelTankCapacityLiters) */
  fuelLiters: number;
}

export type VanCondition = 'used' | 'new';

export type VanTier = 'lite' | 'standard' | 'pro';

export type VanModelId =
  | 'used_lite'
  | 'used_standard'
  | 'used_pro'
  | 'new_lite'
  | 'new_standard'
  | 'new_pro';

export interface VanModelSpec {
  id: VanModelId;
  condition: VanCondition;
  tier: VanTier;
  name: string;
  /** Maximum packages this van model can carry in a single trip */
  capacity: number;
  /** One-time purchase price in USD */
  purchasePrice: number;
  /** Monthly insurance & maintenance cost in USD */
  monthlyInsurance: number;
  /** Fuel tank capacity in liters */
  fuelTankCapacityLiters: number;
  /** Relative fuel burn multiplier (higher for used vans, lower for new vans) */
  fuelConsumptionRate: number;
}

export interface OwnedVan {
  id: string;
  /** 1-based fleet index matching ActiveVehicleSelection.index and Base stall P1–P8 */
  index: number;
  modelId: VanModelId;
  condition: VanCondition;
  tier: VanTier;
  /** Current mechanical durability (0–100%) */
  durability: number;
  /** Current fuel level in liters (0 .. fuelTankCapacityLiters) */
  fuelLiters: number;
}

export interface ActiveVehicleSelection {
  type: ActiveVehicleType;
  /** 1-based fleet index (e.g. Rower #1, Skuter #1, Bus #1) */
  index: number;
}

export interface VehicleRepairTask {
  /** Stable task ID matching Plan tygodnia priority list (e.g. "repair:bike:1", "repair:van:2") */
  id: string;
  vehicle: ActiveVehicleSelection;
  /** 1-based gameplay day when the repair was ordered */
  requestedAtGameDay: number;
  /** Repair fee already paid upfront when sending the vehicle to the mechanic */
  costPaid: number;
}

export interface VehicleRepairRequestResult {
  state: OrderEconomyState;
  queued: boolean;
  cost: number;
  reason?: 'not_found' | 'above_threshold' | 'already_pending' | 'insufficient_funds';
}

export interface VehicleRefuelResult {
  state: OrderEconomyState;
  refueled: boolean;
  litersAdded: number;
  cost: number;
  reason?: 'not_found' | 'not_applicable' | 'already_full' | 'insufficient_funds';
}

export interface CompanyCourier {
  /** 1-based courier slot index (1 = Właściciel, 2..6 = Kurier #2..#6) */
  slotIndex: number;
  /** Stable courier identifier ('courier-1' .. 'courier-6') */
  id: string;
  /** Display name ('Właściciel' or 'Kurier #2'..'Kurier #6') */
  name: string;
  /** True only for Kurier #1 (Właściciel) */
  isOwner: boolean;
  /** True once the license for this slot has been unlocked (slot #1 starts unlocked) */
  unlocked: boolean;
  /** True while a courier is currently employed in this slot */
  hired: boolean;
  /** Driving qualification profile: Owner starts with 'bike_and_van', hired couriers choose 'bike_only' or 'bike_and_van' */
  qualification: CourierQualification;
  /** Assigned vehicle from the owned fleet, or null ("Brak pojazdu") */
  assignedVehicle: ActiveVehicleSelection | null;
  /** Monthly salary in USD ($0 owner, $1 600 bike_only, $2 300 bike_and_van; $0 if not hired) */
  monthlySalary: number;
  /** 1-based gameplay day when hired (null when vacant or locked) */
  hiredAtGameDay: number | null;
}

export interface MonthlyCostBreakdown {
  /** Fixed base upkeep & tax cost for current warehouse level ($350 / $440 / $540 / $680) */
  baseUpkeepAndTaxCost: number;
  /** Total monthly salaries for all hired employees ($0 for owner) */
  salariesCost: number;
  /** Total monthly insurance for additional bicycles ($50 each from the 2nd bike onward) */
  courierInsuranceCost: number;
  /** Total monthly insurance for owned scooters ($70 / $85 each) */
  scooterInsuranceCost: number;
  /** Total monthly insurance for owned delivery vans ($90–$155 each) */
  vanInsuranceCost: number;
  /** Combined monthly insurance cost (courierInsuranceCost + scooterInsuranceCost + vanInsuranceCost) */
  insuranceCost: number;
  /** Total monthly operating costs (baseUpkeepAndTaxCost + salariesCost + insuranceCost) */
  totalFixedCosts: number;
}

export interface CurrentMonthLedger {
  /** Payouts received for completed short-term orders during the current month */
  shortTermRevenue: number;
  /** Accrued earnings from long-term contract deliveries during the current month */
  longTermAccruedRevenue: number;
  /** Total refueling costs paid during the current month */
  fuelExpenses: number;
  /** Total mechanic repair costs paid during the current month */
  repairExpenses: number;
  /** Total financial penalties paid for undelivered packages during the current month */
  penaltyExpenses: number;
  /** Number of orders completed during the current month */
  completedOrdersCount: number;
  /** Sum of company satisfaction snapshots recorded during the current month */
  satisfactionSamplesSum: number;
  /** Count of company satisfaction snapshots recorded during the current month */
  satisfactionSamplesCount: number;
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
  /** Monthly bicycle insurance cost */
  courierInsuranceCost: number;
  /** Monthly scooter insurance cost */
  scooterInsuranceCost?: number;
  /** Monthly van driver & vehicle insurance cost */
  vanInsuranceCost: number;
  /** Combined monthly insurance cost (courierInsuranceCost + scooterInsuranceCost + vanInsuranceCost) */
  insuranceCost: number;
  /** Total monthly fixed/operating costs (base upkeep + salaries + insurance) */
  totalFixedCosts: number;
  /** Accumulated payout for packages delivered in the previous month under long-term contracts */
  longTermContractPayout: number;
  /** Short-term order payouts earned during the settled month */
  shortTermRevenue?: number;
  /** Fuel expenses paid during the settled month */
  fuelExpenses?: number;
  /** Mechanic repair expenses paid during the settled month */
  repairExpenses?: number;
  /** Undelivered package penalties paid during the settled month */
  penaltyExpenses?: number;
  /** Total revenue for the settled month (shortTermRevenue + longTermContractPayout) */
  totalRevenue?: number;
  /** Total expenses for the settled month (totalFixedCosts + fuel + repairs + penalties) */
  totalExpenses?: number;
  /** Orders completed during the settled month */
  completedOrdersCount?: number;
  /** Average company satisfaction % during the settled month */
  averageSatisfaction?: number;
  /** Net monthly result: totalRevenue - totalExpenses */
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
  /** Monthly Base fixed upkeep cost in USD ($350 / $440 / $540 / $680) */
  monthlyUpkeepCost: number;
}

export interface WarehouseUpgradeInfo {
  currentTier: WarehouseTier;
  nextTier: WarehouseTier;
  currentCapacity: number;
  nextCapacity: number;
  currentMonthlyUpkeepCost: number;
  nextMonthlyUpkeepCost: number;
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
  reason?: 'max_reached' | 'insufficient_funds' | 'no_parking_spot';
}

export interface OrderEconomyState {
  balance: number;
  /** Total successfully completed orders (starts at 0) */
  completedOrdersCount: number;
  /** Sum of final satisfaction scores of orders concluded in the current calendar year */
  annualSatisfactionSum: number;
  /** Count of orders concluded (completed or terminated) in the current calendar year */
  annualSatisfactionCount: number;
  /** Smooth continuous company satisfaction % (0–100, starts at 80) */
  companySatisfaction: number;
  /** Kept synchronized with companySatisfaction for reputation tier checks */
  annualSatisfactionAvg: number;
  /** Calendar year tracked by the annual satisfaction stats */
  annualStatsYear: number;
  /** Live financial & operational ledger for the current calendar month (reset on 1st of month) */
  currentMonthLedger: CurrentMonthLedger;
  /** Current company reputation tier (1–4) */
  reputationLevel: ReputationLevel;
  /** Base warehouse expansion level (1–4; determines capacity, Base upkeep & building size) */
  warehouseLevel: WarehouseTier;
  /** Alias for warehouseLevel kept strictly in sync */
  warehouseTier: WarehouseTier;
  /** Maximum package capacity of the Base warehouse (30 / 70 / 140 / 250) */
  warehouseCapacity: number;
  /** Current total number of packages stored in the Base warehouse awaiting delivery */
  warehousePackages: number;
  /** Per-order counts of packages currently stored in the Base warehouse */
  warehouseInventory: Record<string, number>;
  /** Number of unlocked car/van parking spots directly at Base (starts at 0, max 8) */
  parkingSpots: number;
  /** Number of unlocked employee licenses/slots (starts at 1, max 6) */
  maxEmployees: number;
  /** Complete 6-slot company courier roster (slot #1 Właściciel + slots #2–#6 licenced positions) */
  couriers: CompanyCourier[];
  /** Active hired company staff mirror kept in sync with `couriers` */
  employees: CompanyEmployee[];
  /** Number of owned courier bicycles including the owner's starter bike (shared max 4 two-wheelers with scooters) */
  bikesCount: number;
  /** Alias for bikesCount kept strictly in sync */
  bicyclesCount: number;
  /** Mechanical durability (0–100%) per owned bicycle (index 0 = Rower #1 ..) */
  bikeDurabilities: number[];
  /** Owned delivery scooters sharing the 4-slot two-wheeler shelter with bicycles */
  scooters: OwnedScooter[];
  /** Number of owned scooters (always equal to scooters.length) */
  scootersCount: number;
  /** Owned delivery vans with individual models, capacities & durability (limit = parkingSpots <= 8) */
  vans: OwnedVan[];
  /** Number of owned delivery vans (always equal to vans.length, max = parkingSpots <= 8) */
  vansCount: number;
  /** Alias for vansCount kept strictly in sync with vans.length */
  deliveryVansCount: number;
  /** Vehicle currently assigned to the owner courier (Kurier #1) */
  activeVehicle: ActiveVehicleSelection;
  /** Vehicles currently queued for or undergoing repair at the Mechanic Garage */
  pendingVehicleRepairs: VehicleRepairTask[];
  /** Pending offers waiting to be accepted (max 7 at once; expire after 2 days short-term / 3 days long-term) */
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
  /** Deterministic PRNG state used during Days 1–14 for repeatable onboarding offers */
  rngState: number;
  /** System-clock-seeded PRNG state used from Day 15 onward for fully randomized offers */
  randomRngState: number;
  /** Saved per-weekday (0 = Pon .. 6 = Nd) priority order of active order IDs for courier dispatch */
  weeklyPriorityOrder: Record<number, string[]>;
  /** Current fuel market price in USD per liter (starts at $1.60/L) */
  currentFuelPricePerLiter: number;
  /** Previous fuel market price in USD per liter for trend direction (▲/▼) */
  previousFuelPricePerLiter: number;
  /** 1-based gameplay day when the next fuel market price update occurs */
  nextFuelPriceChangeGameDay: number;
}
