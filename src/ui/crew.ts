import { BAL } from '../engine/data/balance'
import { ROUTES } from '../engine/data/routes'
import { isCargoModel, modelNeedsHp } from '../engine/data/busModels'
import { spareConductorBench, spareDriverBench } from '../engine/sim/staffing'
import type { Bus, GameState, Staff, StaffRole } from '../engine/types'

export const CREW_ROLES: StaffRole[] = ['driver', 'conductor']

export function crewLimit(s: GameState, bus: Bus, role: StaffRole): number {
  if (isCargoModel(bus.modelId)) {
    if (role === 'conductor') return 0
  }
  const sch = bus.scheduleId ? s.schedules[bus.scheduleId] : undefined
  const route = sch ? ROUTES[sch.routeId] : undefined
  const isLong = route ? route.hours > BAL.maxDrivingHoursSingleDriver : false
  const tripsPerDay = sch && sch.paired && sch.returnDepHour !== undefined ? 2 : 1

  if (role === 'conductor') return tripsPerDay > 1 ? 2 : 1
  if (role === 'driver') {
    return (isLong ? 2 : 1) * tripsPerDay
  }
  if (role === 'co_driver') {
    return 0
  }
  return 0
}

export function crewOnBus(s: GameState, busId: string, role?: StaffRole): Staff[] {
  return Object.values(s.staff).filter(
    (st) => st.busId === busId && (role === undefined || st.role === role || (role === 'driver' && st.role === 'co_driver')),
  )
}

export function freeCrew(s: GameState, role: StaffRole): Staff[] {
  return Object.values(s.staff).filter(
    (st) => !st.busId && (st.role === role || (role === 'driver' && st.role === 'co_driver')),
  )
}

export function canCrewBus(bus: Bus): boolean {
  return bus.ownership === 'owned' || bus.ownership === 'leased'
}

export function crewShort(s: GameState, bus: Bus): string | null {
  if (bus.ownership === 'attached') return null
  if (!bus.scheduleId) return 'unscheduled'
  const isCargo = isCargoModel(bus.modelId)
  const sch = bus.scheduleId ? s.schedules[bus.scheduleId] : undefined
  const route = sch ? ROUTES[sch.routeId] : undefined
  const isLong = route ? route.hours > BAL.maxDrivingHoursSingleDriver : false
  const tripsPerDay = sch && sch.paired && sch.returnDepHour !== undefined ? 2 : 1
  const needDrv = (isLong ? 2 : 1) * tripsPerDay
  const needCond = isCargo ? 0 : tripsPerDay

  const bits: string[] = []
  const drivers = crewOnBus(s, bus.id, 'driver')
  const conds = crewOnBus(s, bus.id, 'conductor')
  const hasSkilledCond = conds.some((c) => c.skill >= 5)

  const spareDrivers = spareDriverBench(s).length
  const totalAvailableDrivers = drivers.length + spareDrivers

  if (drivers.length < tripsPerDay && spareDrivers < (tripsPerDay - drivers.length)) {
    bits.push(tripsPerDay > 1 ? 'needs 2 drivers (2-trip sch)' : 'no primary drv')
  } else if (isLong && totalAvailableDrivers < needDrv && !hasSkilledCond) {
    bits.push('needs co-driver')
  }

  if (modelNeedsHp(bus.modelId)) {
    const hpAssigned = drivers.filter((d) => d.licenceClass === 'HMV_HP').length
    const hpSpares = spareDriverBench(s).filter((d) => d.licenceClass === 'HMV_HP').length
    if (hpAssigned < tripsPerDay && (hpAssigned + hpSpares) < tripsPerDay) {
      bits.push('needs HMV_HP driver')
    }
  }

  if (!isCargo) {
    const spareConds = spareConductorBench(s).length
    if (conds.length < needCond && (conds.length + spareConds) < needCond) {
      bits.push(needCond > 1 ? 'needs 2 cond (2-trip sch)' : 'no cond')
    }
  }
  return bits.length ? bits.join(' · ') : null
}
