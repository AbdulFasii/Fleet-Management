/**
 * Cargo service licence: contracts are invited only on licensed corridors, the
 * licence runs a year, closing it ends the corridor's contracts, and a lapse
 * stops new freight until it is renewed.
 *   npx tsx scripts/cargo-permit-probe.ts
 */
import assert from 'node:assert/strict'
import { newGame } from '../src/engine/newGame'
import { BAL } from '../src/engine/data/balance'
import { ROUTES } from '../src/engine/data/routes'
import { rs } from '../src/engine/core/money'
import {
  cargoContractsOnCorridor,
  cargoLicence,
  cargoPermitActive,
  cargoPermitFee,
  cargoPermitPass,
  closeCargoPermit,
  getAvailableContracts,
  openCargoPermit,
  renewCargoPermit,
  signCargoContract,
} from '../src/engine/sim/cargo'
import { appointCargoManager } from '../src/engine/sim/staffing'
import type { Staff } from '../src/engine/types'

const s = newGame('Cargo licence', 'seth', 'mdu-maa', 42)
s.company.cash = 50_000_000_00
s.company.dedicatedCargoSubsidiary = true

const mgr: Staff = {
  id: 'mgr1', name: 'Biju Sen', role: 'manager', skill: 8, experienceYears: 6,
  salary: 3500000, loyalty: 80, morale: 80, fatigue: 10, safety: 7, hiredDay: s.day,
}
s.staff[mgr.id] = mgr
assert.equal(appointCargoManager(s, mgr.id), null)

const route = ROUTES['mdu-maa']!
const fee = cargoPermitFee(route)
const renewal = cargoPermitFee(route, { renewal: true })

// --- unlicensed corridor: no invites, no signatures -------------------------
assert.equal(cargoPermitActive(s, 'mdu-maa'), false, 'a fresh corridor has no cargo licence')
assert.equal(getAvailableContracts(s).length, 0, 'no proposals without a cargo licence')
assert(
  typeof signCargoContract(s, {
    partner: 'Delhivery', routeId: 'mdu-maa', direction: 'AB', laneKey: 'mdu>maa',
    offerKey: 'probe|mdu-maa|AB|0|1', lot: 1, durationDays: 30,
    ratePerKg100Km: 2.3, guaranteedKgPerDay: 200,
  }) === 'string',
  'signing must be refused without a cargo licence',
)
console.log('✓ no licence → no contract invites')

// --- buy the licence ---------------------------------------------------------
const cashBefore = s.company.cash
assert.equal(openCargoPermit(s, 'mdu-maa'), null)
assert.equal(s.company.cash, cashBefore - fee, `licence costs ${fee} paise`)
assert.equal(cargoLicence(s, 'mdu-maa')?.expiryDay, s.day + BAL.cargoPermitTermDays, 'licence runs a year')
assert.equal(cargoPermitActive(s, 'maa-mdu'), true, 'one licence covers both directions of the corridor')

const offered = getAvailableContracts(s)
assert(offered.length > 0, 'licensed corridor should be invited')
assert(offered.every((p) => p.routeId === 'mdu-maa' || p.routeId === 'maa-mdu'), 'only licensed lanes are offered')
for (const p of offered) assert.equal(signCargoContract(s, p), null)
const signed = cargoContractsOnCorridor(s, 'mdu-maa')
assert(signed.length === offered.length && signed.length > 0, `signed ${signed.length} of ${offered.length}`)
console.log(`✓ licence ₹${Math.round(fee / 100)} · ${signed.length} contracts invited and signed`)

// --- close the licence: contracts end, invites stop --------------------------
assert.equal(closeCargoPermit(s, 'maa-mdu'), null, 'closing via the alias direction works')
assert.equal(cargoContractCount(), 0, 'closing the licence ends its contracts')
assert.equal(cargoPermitActive(s, 'mdu-maa'), false, 'licence is gone')
assert.equal(getAvailableContracts(s).length, 0, 'no invites after closing')
console.log('✓ close licence → contracts closed, no new invites')

// --- re-open, then let it lapse ---------------------------------------------
assert.equal(openCargoPermit(s, 'mdu-maa'), null)
const again = getAvailableContracts(s)
for (const p of again.slice(0, 2)) assert.equal(signCargoContract(s, p), null)
assert(cargoContractCount() > 0, 're-licensed corridor takes freight again')

const licence = cargoLicence(s, 'mdu-maa')!
licence.expiryDay = s.day - 1 // the term ran out yesterday
cargoPermitPass(s)
assert.equal(licence.status, 'lapsed', 'expired licence lapses')
assert.equal(cargoContractCount(), 0, 'a lapsed licence closes its contracts')
assert.equal(getAvailableContracts(s).length, 0, 'no invites on a lapsed licence')
console.log('✓ lapse → contracts closed, desk goes quiet')

// --- renew ------------------------------------------------------------------
const cashBeforeRenew = s.company.cash
assert.equal(renewCargoPermit(s, 'maa-mdu'), null)
assert.equal(s.company.cash, cashBeforeRenew - renewal, `renewal costs ${renewal} paise`)
assert.equal(cargoPermitActive(s, 'mdu-maa'), true, 'renewal revives the licence')
assert(getAvailableContracts(s).length > 0, 'renewed corridor is invited again')
console.log(`✓ renewal ₹${Math.round(renewal / 100)} revives the corridor`)

function cargoContractCount(): number {
  return cargoContractsOnCorridor(s, 'mdu-maa').length
}

assert.equal(rs(0), 0)
console.log('✓ cargo licence probe passed')
