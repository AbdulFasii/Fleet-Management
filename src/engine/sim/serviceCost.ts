/**
 * Coach maintenance-cost scaling, shared by the workshop (what a job costs us)
 * and the lease market (what the owner has to spend keeping the bus on the road).
 */
import { BAL } from '../data/balance'

export function bandMult(bands: { maxYears: number; mult: number }[], years: number): number {
  for (const b of bands) if (years <= b.maxYears) return b.mult
  return bands[bands.length - 1]?.mult ?? 1
}

/** Older / high-km / AC coaches cost more to keep on the road. */
export function serviceCostMult(ageYears: number, odoKm: number, ac: boolean): number {
  let m = bandMult(BAL.serviceAgeBands, Math.max(0, ageYears))
  const over = Math.max(0, odoKm - BAL.serviceOdoFromKm)
  m *= 1 + (over / 100_000) * BAL.serviceOdoPerLakh
  if (ac) m *= 1 + BAL.serviceAcSurcharge
  return m
}
