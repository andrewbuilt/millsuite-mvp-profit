// lib/pricing.ts
// Subproject pricing math — single source of truth

export interface SubprojectPricing {
  materialCost: number
  consumableMarkupPct: number
  laborHours: number
  shopRate: number
  profitMarginPct: number
  manualPrice?: number | null // if set, overrides computed price
}

/**
 * Compute subproject financials.
 *
 * material_with_consumables = materialCost × (1 + consumableMarkupPct / 100)
 * laborCost = laborHours × shopRate
 * cost = laborCost + material_with_consumables
 * price = cost × (1 + profitMarginPct / 100)
 *
 * If manualPrice is set, price = manualPrice and margin becomes a computed output.
 */
export function computeSubprojectPrice(input: SubprojectPricing) {
  const materialWithConsumables = input.materialCost * (1 + input.consumableMarkupPct / 100)
  const laborCost = input.laborHours * input.shopRate
  const cost = laborCost + materialWithConsumables

  if (input.manualPrice != null && input.manualPrice > 0) {
    const effectiveMarginPct = cost > 0 ? ((input.manualPrice - cost) / input.manualPrice) * 100 : 0
    return {
      materialWithConsumables: round(materialWithConsumables),
      laborCost: round(laborCost),
      cost: round(cost),
      price: round(input.manualPrice),
      profitMarginPct: round(effectiveMarginPct, 1),
      isManualPrice: true,
    }
  }

  const price = cost * (1 + input.profitMarginPct / 100)
  return {
    materialWithConsumables: round(materialWithConsumables),
    laborCost: round(laborCost),
    cost: round(cost),
    price: round(price),
    profitMarginPct: input.profitMarginPct,
    isManualPrice: false,
  }
}

/**
 * Compute project-level P&L from actuals.
 */
export function computeProjectPL(params: {
  bidTotal: number
  actualLaborCost: number
  actualMaterialCost: number
}) {
  const actualTotal = params.actualLaborCost + params.actualMaterialCost
  const variance = params.bidTotal - actualTotal
  const variancePct = params.bidTotal > 0 ? (variance / params.bidTotal) * 100 : 0

  return {
    bidTotal: round(params.bidTotal),
    actualTotal: round(actualTotal),
    actualLaborCost: round(params.actualLaborCost),
    actualMaterialCost: round(params.actualMaterialCost),
    variance: round(variance),
    variancePct: round(variancePct, 1),
    isOverBudget: variance < 0,
  }
}

/**
 * Compute shop rate from overhead inputs.
 */
export function computeShopRate(params: {
  monthlyRent: number
  monthlyUtilities: number
  monthlyInsurance: number
  monthlyEquipment: number
  monthlyMisc: number
  ownerSalary: number
  totalPayroll: number
  targetProfitPct: number
  workingDaysPerMonth: number
  hoursPerDay: number
}) {
  const monthlyOverhead = params.monthlyRent + params.monthlyUtilities +
    params.monthlyInsurance + params.monthlyEquipment + params.monthlyMisc
  const monthlyLaborCost = params.ownerSalary + params.totalPayroll
  const totalMonthlyCost = monthlyOverhead + monthlyLaborCost
  const productionHoursPerMonth = params.workingDaysPerMonth * params.hoursPerDay
  const costPerHour = productionHoursPerMonth > 0 ? totalMonthlyCost / productionHoursPerMonth : 0
  const shopRate = costPerHour * (1 + params.targetProfitPct / 100)

  return {
    monthlyOverhead: round(monthlyOverhead),
    monthlyLaborCost: round(monthlyLaborCost),
    totalMonthlyCost: round(totalMonthlyCost),
    productionHoursPerMonth: round(productionHoursPerMonth),
    costPerHour: round(costPerHour),
    shopRate: round(shopRate),
  }
}

function round(n: number, decimals = 2) {
  const factor = Math.pow(10, decimals)
  return Math.round(n * factor) / factor
}
