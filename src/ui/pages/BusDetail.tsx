import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useGame } from '../../store/gameStore'
import { BUS_MODELS, CLASS_LABEL, coachKind, isCargoModel, modelTitle } from '../../engine/data/busModels'
import { FITTING_CATALOG, busHasFitting } from '../../engine/data/amenitiesCatalog'
import { ROUTES, routeName } from '../../engine/data/routes'
import { cityName } from '../../engine/data/cities'
import { fmtDate, fmtClock, festivalEffect } from '../../engine/core/calendar'
import { isBusInTransit } from '../../engine/sim/depot'
import { SUBSYSTEMS, type StaffRole, type SubsystemId } from '../../engine/types'
import { sellSettlement, busAgeYears, busStatusDetail, leaseBreakCost } from '../../engine/sim/fleet'
import {
  bServiceDueKm,
  calculateAnnualRoadTax,
  overhaulDueInfo,
  ownerPaysService,
  serviceDueKm,
  tyreLifeFor,
  tyresDue,
  axleTyresDue,
  quoteInsurance,
  quoteFitness,
  quoteRepair,
  quoteService,
  quoteReplaceTyres,
  determineDueServiceTier,
  chassisCondition,
  quoteRebody,
  quoteSeatRefurb,
  seatRefurbDone,
  conductorCleanlinessTarget,
  serviceDeferredForBus,
  serviceResumeDay,
} from '../../engine/sim/maintenance'
import { modelNeedsHp } from '../../engine/data/busModels'
import {
  coachTitle,
  busComfort,
  modelSupportsBodyDesigns,
  designsForModel,
  getDesign,
  getBuilderForDesign,
  shortBuilderName,
  bodyPackagePrice,
} from '../../engine/data/bodyBuilders'
import { hasUnfilledHpDuty, isStaffResting } from '../../engine/sim/staffing'
import { canCrewBus, crewLimit, crewOnBus, freeCrew } from '../crew'
import { BAL } from '../../engine/data/balance'
import { fmtCompact } from '../../engine/core/money'
import { Bar, KV, M, Panel, ratingTone, GroupBadge } from '../bits'
import { activeGroups } from '../../engine/sim/groups'
import { canAfford } from '../../engine/sim/finance'
import { pushLog } from '../../engine/sim/log'


function VitalGroup({ title, rows }: { title: string; rows: [React.ReactNode, React.ReactNode][] }) {
  if (!rows.length) return null
  return (
    <div>
      <div className="vital-group-title">{title}</div>
      <KV rows={rows} />
    </div>
  )
}


function SlotRow({ busId, role, label, slots }: { busId: string; role: StaffRole; label: string; slots: number }) {
  const s = useGame((g) => g.state)!
  const g = useGame()
  const posted = crewOnBus(s, busId, role)
  const free = freeCrew(s, role)
  const opsStaffing = !!s.company.opsId && !!s.company.opsAutoStaff
  const pool = opsStaffing ? [] : s.hiringPool.filter((c) => c.role === role)
  const rows = Array.from({ length: slots }, (_, i) => posted[i] ?? null)

  const pick = (raw: string) => {
    if (!raw) return
    if (raw.startsWith('hire:')) {
      if (opsStaffing) return // ops cannot hire from pool — hire on Staff instead
      const id = raw.slice(5)
      g.hire(id)
      g.assignStaff(id, busId)
    } else {
      g.assignStaff(raw, busId)
    }
  }

  return (
    <>
      {rows.map((st, i) => (
        <tr key={`${role}-${i}`}>
          <td className="dim">
            {role === 'driver' && slots > 1
              ? `Driver ${i + 1}`
              : role === 'conductor' && slots > 1
                ? `Conductor ${i + 1}`
                : label}
          </td>
          {st ? (
            <>
              <td>
                {st.name} <span className="dim">skill {st.skill}</span>
                {st.licenceClass === 'HMV_HP' && <span className="good small"> [HP]</span>}
              </td>
              <td>
                {role === 'driver' && (
                  <span className={(Number(st.fatigue) || 0) >= 80 ? 'bad' : (Number(st.fatigue) || 0) >= 65 ? 'warn' : 'dim'}>
                    fatigue {Math.round(Number(st.fatigue) || 0)}%
                  </span>
                )}
                {role === 'conductor' && isStaffResting(s, st) && (
                  <span className="bad small">resting</span>
                )}
              </td>
              <td className="num"><button className="small" onClick={() => g.assignStaff(st.id, undefined)}>unassign</button></td>
            </>
          ) : (
            <>
              <td colSpan={3}>
                {free.length === 0 && pool.length === 0 ? (
                  <span className="warn">
                    {opsStaffing
                      ? `No ${role} free on payroll. Hire on the Staff tab — ops cannot hire from the pool.`
                      : `No ${role}s free or in the hiring pool. Wait for the pool to refresh (Staff tab).`}
                  </span>
                ) : (
                  <select
                    value=""
                    onChange={(e) => {
                      const v = e.target.value
                      if (v) pick(v)
                    }}
                  >
                    <option value="">{opsStaffing ? `assign ${role} from payroll…` : `assign or hire ${role}…`}</option>
                    {free.length > 0 && (
                      <optgroup label="On rolls (unassigned)">
                        {free.map((p) => {
                          const isHp = p.licenceClass === 'HMV_HP'
                          const busObj = s.buses[busId]
                          const isHpBus = busObj ? modelNeedsHp(busObj.modelId) : false
                          const resting = isStaffResting(s, p)
                          const hpDutyBlocked = !isHpBus && isHp && hasUnfilledHpDuty(s)
                          const hpRestBlocked = !isHpBus && isHp && resting
                          const hpPrimaryBlocked = isHpBus && i === 0 && !isHp
                          const disabled = hpDutyBlocked || hpRestBlocked || hpPrimaryBlocked
                          let extra = ''
                          if (isHp) extra += ' [HP]'
                          if (resting) extra += ' (resting)'
                          else if (hpDutyBlocked) extra += ' (HP duty needed)'
                          else if (hpPrimaryBlocked) extra += ' (needs HMV_HP)'
                          return (
                            <option key={p.id} value={p.id} disabled={disabled}>
                              {p.name} · skill {p.skill} · {fmtCompact(p.salary)}/mo{extra}
                            </option>
                          )
                        })}
                      </optgroup>
                    )}
                    {pool.length > 0 && (
                      <optgroup label="Hire from market">
                        {pool.map((p) => (
                          <option key={p.id} value={`hire:${p.id}`}>{p.name} · skill {p.skill} · {fmtCompact(p.salary)}/mo</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                )}
              </td>
            </>
          )}
        </tr>
      ))}
    </>
  )
}

export function BusDetailPage() {
  const { busId } = useParams()
  const nav = useNavigate()
  const s = useGame((g) => g.state)!
  const g = useGame()
  const bus = busId ? s.buses[busId] : undefined

  if (!bus) {
    return <Panel title="Bus"><span className="dim">This bus is no longer in the fleet.</span> <Link to="/fleet">Back to fleet</Link></Panel>
  }
  const model = BUS_MODELS[bus.modelId]
  const [targetGroupId, setTargetGroupId] = useState<string>(bus.groupId ?? '')
  const [doRebrand, setDoRebrand] = useState(false)
  const supportsBody = modelSupportsBodyDesigns(model)
  const designOpts = supportsBody && model ? designsForModel(s, model) : []
  const [rebodyDesignId, setRebodyDesignId] = useState<string>(
    (bus.bodyDesignId && designOpts.some((o) => o.design.id === bus.bodyDesignId)
      ? bus.bodyDesignId
      : designOpts[0]?.design.id) ?? '',
  )
  const crewed = canCrewBus(bus)
  const tyreLife = tyreLifeFor(bus)
  const tyreReady = tyresDue(bus)
  const due = serviceDueKm(bus)
  const busy = bus.status !== 'active'
  const age = busAgeYears(s, bus)
  const odoMark = s.config?.odoHighlightKm ?? 400_000
  const odoOver = bus.odometer >= odoMark
  const odoFar = bus.odometer >= odoMark * 1.25

  return (
    <>
      <div className="page-title">
        <span className="accent">{bus.reg}</span>
        {bus.refurbishedDay !== undefined && <span className="pill info small" style={{ marginLeft: 6 }}>refurbished</span>}{' '}
        "{bus.nickname}" — {coachTitle(model, bus.bodyDesignName)}
        <span className="sub">{CLASS_LABEL[model.cls]} · {coachKind(model)} {model.layout.cols} · {model.seats} {model.layout.kind === 'hybrid' ? 'berths+seats' : model.sleeper ? 'berths' : 'seats'} · {bus.ownership}</span>
        <span className="spacer" />
        <Link to="/fleet">◂ fleet</Link>
      </div>

      <div className="grid-3">
        <Panel
          title="Vitals"
          info="Idle buses of the same class (enough seats) can cover workshop downtime. A workshop manager pulls idle cover automatically."
        >
          <div className="vital-groups">
            <VitalGroup
              title="Operations"
              rows={[
              ['Status', (() => {
              const detail = busStatusDetail(bus, s.day)
              return busy
                ? <span className="warn">{bus.status}{detail ? ` (${detail})` : ''}</span>
                : <span className="good">active</span>
            })()],
              ['Current Halt', (
              isBusInTransit(s, bus) && bus.inTransitToCityId ? (
                <span className="accent" title={`En route from ${bus.inTransitFromCityId ? cityName(bus.inTransitFromCityId) : '…'} to ${cityName(bus.inTransitToCityId)}`}>
                  🚌 In transit → {cityName(bus.inTransitToCityId)}
                </span>
              ) : (
              <span className={(bus.parkedCityId ?? s.company.homeCityId) === s.company.homeCityId ? 'good' : s.yards.some((y) => y.cityId === (bus.parkedCityId ?? s.company.homeCityId)) ? 'info' : 'warn'}>
                📍 {cityName(bus.parkedCityId ?? s.company.homeCityId)} {(bus.parkedCityId ?? s.company.homeCityId) === s.company.homeCityId ? '(Home Depot)' : s.yards.some((y) => y.cityId === (bus.parkedCityId ?? s.company.homeCityId)) ? '(Leased Yard)' : '(Outstation / Bay)'}
              </span>
              )
            )],
              ['Schedule', bus.coveringBusId && s.buses[bus.coveringBusId]
              ? (() => {
                  const line = s.buses[bus.coveringBusId]
                  const sch = bus.scheduleId ? s.schedules[bus.scheduleId] : undefined
                  const isFest = sch && (sch.festivalOnly || sch.outboundDuty === 'festival' || sch.returnDuty === 'festival')
                  const label = (
                    <span className="info">
                      spared · {line ? line.reg : bus.coveringBusId}
                      {sch ? (
                        <span className="dim">
                          {' · '}
                          {isFest && <span title="Festival schedule" style={{ marginRight: 3 }}>🎉</span>}
                          {routeName(sch.routeId)} {fmtClock(sch)}
                        </span>
                      ) : null}
                    </span>
                  )
                  return sch ? (
                    <Link to={`/schedules?sch=${sch.id}`} title="Open schedule">
                      {label}
                    </Link>
                  ) : label
                })()
              : bus.scheduleId && s.schedules[bus.scheduleId]
                ? (() => {
                    const sch = s.schedules[bus.scheduleId]
                    const route = ROUTES[sch.routeId]
                    const busIdx = sch.busIds.indexOf(bus.id)
                    const isMirror = busIdx === 1 && sch.paired && route
                    const displayName = isMirror ? `${cityName(route.to)} — ${cityName(route.from)}` : routeName(sch.routeId)
                    const isAllFest = sch.festivalOnly || (sch.outboundDuty === 'festival' && (!sch.paired || sch.returnDuty === 'festival'))
                    const isMixedFest = sch.paired && (sch.outboundDuty === 'festival' || sch.returnDuty === 'festival')
                    const isFest = sch.festivalOnly || sch.outboundDuty === 'festival' || sch.returnDuty === 'festival'
                    const fest = festivalEffect(s.day)
                    const festTitle = isAllFest
                      ? (fest.name ? `Festival schedule (${fest.name} active today)` : 'Seasonal festival schedule (runs on festival dates)')
                      : isMixedFest
                      ? (sch.outboundDuty === 'festival' ? 'Seasonal 1st + daily 2nd' : 'Daily 1st + seasonal 2nd')
                      : 'Festival schedule'
                    return (
                      <Link to={`/schedules?sch=${sch.id}`} title={isFest ? festTitle : 'Open schedule'}>
                        {isFest && <span style={{ marginRight: 4 }} title={festTitle}>🎉</span>}
                        {displayName} {fmtClock(sch)}
                      </Link>
                    )
                  })()
                : <span className="warn">idle</span>],
              ...(bus.impoundUntilDay !== undefined && bus.impoundUntilDay > s.day ? [
              ['RTO Impound', <span className="bad">Impounded at checkpost until {fmtDate(bus.impoundUntilDay)}</span>] as [string, React.ReactNode]
            ] : []),
            ]}
            />
            <VitalGroup
              title="Coach"
              rows={[
              ['Mfg year / age', `${bus.mfgYear} · ${age} year${age === 1 ? '' : 's'}`],
              ['Odometer', <span className={odoFar ? 'bad' : odoOver ? 'warn' : undefined}>{Math.round(bus.odometer).toLocaleString('en-IN')} km{odoOver ? ` · past ${odoMark.toLocaleString('en-IN')} km mark` : ''}</span>],
              ['Accident history', bus.accidentHistory ? <span className="warn">yes</span> : 'clean'],
              ['Quality (reviews)', <span className={ratingTone(bus.qualityScore)} style={{ fontWeight: 600 }}>{bus.qualityScore.toFixed(1)} <span style={{ color: '#f59e0b' }}>★</span> <span className="dim">/ 5</span></span>],
              ...(model && modelSupportsBodyDesigns(model) ? [
                (() => {
                  const design = getDesign(s, bus.bodyDesignId)
                  const builder = getBuilderForDesign(s, bus.bodyDesignId)
                    ?? (bus.bodyBuilderId && s.bodyBuilders?.[bus.bodyBuilderId]
                      ? s.bodyBuilders[bus.bodyBuilderId]
                      : undefined)
                  const designName = bus.bodyDesignName ?? design?.name
                  const bodyLabel = designName
                    ? (builder ? `${shortBuilderName(builder.name)} · ${designName}` : designName)
                    : null
                  return ['Body design', bodyLabel
                    ? <span>{bodyLabel}</span>
                    : <span className="dim">not set</span>] as [string, React.ReactNode]
                })(),
              ] : []),
              ...(!isCargoModel(model) ? [
              ['Comfort', `${busComfort(s, bus).toFixed(1)}/10${(bus.comfortBonus ?? 0) > 0 ? ` · seats +${(bus.comfortBonus ?? 0).toFixed(1)}` : ''}`],
            ] as [string, React.ReactNode][] : []),
              ['Re-body', bus.refurbishedDay !== undefined
              ? <span className="info">re-bodied {fmtDate(bus.refurbishedDay)} · +{bus.lifeExtensionYears ?? 0} yr useful life</span>
              : <span className="dim">never re-bodied</span>],
            ]}
            />
            <VitalGroup
              title="Workshop & tyres"
              rows={[
              ['Service', ownerPaysService(bus)
                ? <span className="dim">owner's workshop</span>
                : (() => {
                    const tier = determineDueServiceTier(s, bus)
                    const q = quoteService(s, bus, tier)
                    const isOverdue = due > 0 || bServiceDueKm(bus) > 0 || overhaulDueInfo(s, bus).isDue
                    const deferred = serviceDeferredForBus(s, bus)
                    const resume = serviceResumeDay(s.day)
                    return (
                      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                        {bus.status !== 'delivery' && (
                          <button
                            className="small"
                            onClick={() => g.serviceBus(bus.id, tier)}
                            disabled={!isOverdue || bus.status === 'workshop' || deferred}
                            title={deferred
                              ? `Festival hold — scheduled coach keeps running; workshop booking opens after ${resume ? `day ${resume}` : 'the festival + 3 days'}`
                              : isOverdue
                              ? `Service coach (${tier.toUpperCase()}-tier, ${q.days}d in ${q.outside ? 'outside garage' : 'workshop'})`
                              : 'Service is not due yet'}
                          >
                            Service ({tier.toUpperCase()} · {fmtCompact(q.cost)})
                          </button>
                        )}
                        {deferred && (
                          <span className="dim" title="Scheduled coaches are not pulled into the workshop on festival dates; the service stays due until 3 days after the festival ends.">
                            festival hold{resume ? ` · day ${resume}` : ''}
                          </span>
                        )}
                        <span className={isOverdue ? 'bad' : 'good'}>
                          {due > 0 ? `${Math.round(due / 1000)}k km OVERDUE` : `${Math.round(-due / 1000)}k km to next`}
                        </span>
                      </span>
                    )
                  })()],
              ['Cleanliness', (() => {
              const cond = Object.values(s.staff).find((st) => st.role === 'conductor' && st.busId === bus.id)
              const target = cond ? conductorCleanlinessTarget(cond.skill) : 0
              return (
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                  {bus.status !== 'workshop' && (
                    <button
                      className="small"
                      onClick={() => g.deepCleanBus(bus.id)}
                      title="Deep cleaning & disinfection in depot (restores to 95/100)"
                    >
                      Deep Clean ({fmtCompact(BAL.deepCleanCost)})
                    </button>
                  )}
                  <span className={(bus.busCleanliness ?? 85) >= 70 ? 'good' : (bus.busCleanliness ?? 85) >= 40 ? 'warn' : 'bad'}>
                    {Math.round(bus.busCleanliness ?? 85)}/100
                    {cond && (
                      <span className="dim small" style={{ marginLeft: 6 }}>
                        ({cond.name} {cond.skill}★ {target > 0 ? `· target ${target}` : '· no deep clean'})
                      </span>
                    )}
                  </span>
                </span>
              )
            })()],
              ['Front tyres (steer)', (() => {
              const info = axleTyresDue(bus)
              const pct = Math.round(info.frontPct * 100)
              const brand = (bus.frontBrand ?? 'oem').toUpperCase()
              const qFront = !ownerPaysService(bus) ? quoteReplaceTyres(s, bus, 'front', 'oem') : null
              const frontCost = qFront && typeof qFront === 'object' ? qFront.cost : null
              return (
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                  {!ownerPaysService(bus) && frontCost !== null && bus.status !== 'delivery' && (
                    <button
                      className="small"
                      onClick={() => g.replaceTyres(bus.id, 'front', 'oem')}
                      disabled={bus.status === 'workshop'}
                      title="Fit 2 new steer tyres on front axle"
                    >
                      New Steer ({fmtCompact(frontCost)})
                    </button>
                  )}
                  <span className={info.frontDue ? 'bad' : pct >= 75 ? 'warn' : undefined}>
                    {Math.round(info.frontKm / 1000)}k / {Math.round(info.frontLife / 1000)}k km ({brand}) · {pct}% wear
                  </span>
                </span>
              )
            })()],
              ['Rear tyres (drive)', (() => {
              const info = axleTyresDue(bus)
              const pct = Math.round(info.rearPct * 100)
              const brand = (bus.rearBrand ?? 'oem').toUpperCase()
              const qRearOEM = !ownerPaysService(bus) ? quoteReplaceTyres(s, bus, 'rear', 'oem') : null
              const qRearRetread = !ownerPaysService(bus) ? quoteReplaceTyres(s, bus, 'rear', 'retread') : null
              const oemCost = qRearOEM && typeof qRearOEM === 'object' ? qRearOEM.cost : null
              const retreadCost = qRearRetread && typeof qRearRetread === 'object' ? qRearRetread.cost : null
              return (
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                  {!ownerPaysService(bus) && bus.status !== 'delivery' && (
                    <>
                      {oemCost !== null && (
                        <button
                          className="small"
                          onClick={() => g.replaceTyres(bus.id, 'rear', 'oem')}
                          disabled={bus.status === 'workshop'}
                          title="Fit new drive tyres on rear axle"
                        >
                          New Drive ({fmtCompact(oemCost)})
                        </button>
                      )}
                      {retreadCost !== null && (
                        <button
                          className="small"
                          onClick={() => g.replaceTyres(bus.id, 'rear', 'retread')}
                          disabled={bus.status === 'workshop'}
                          title="Fit retread tyres on rear axle (economy option)"
                        >
                          Retread ({fmtCompact(retreadCost)})
                        </button>
                      )}
                    </>
                  )}
                  <span className={info.rearDue ? 'bad' : pct >= 75 ? 'warn' : undefined}>
                    {Math.round(info.rearKm / 1000)}k / {Math.round(info.rearLife / 1000)}k km ({brand}) · {pct}% wear
                  </span>
                </span>
              )
            })()],
            ]}
            />
            <VitalGroup
              title="Compliance"
              rows={[
              ['Insurance', (() => {
              const isExpired = bus.insuranceExpiryDay < s.day
              const isDue = bus.insuranceExpiryDay - s.day <= 30
              const prem = quoteInsurance(s, bus)
              return (
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                  {!ownerPaysService(bus) && (
                    <button
                      className="small"
                      onClick={() => g.renewInsurance(bus.id)}
                      disabled={!isDue && !isExpired}
                      title={!isDue && !isExpired ? 'Insurance can be renewed within 30 days of expiry' : 'Renew commercial vehicle insurance policy'}
                    >
                      Renew Insurance ({fmtCompact(prem)})
                    </button>
                  )}
                  <span className={isExpired ? 'bad' : isDue ? 'warn' : 'good'}>
                    {fmtDate(bus.insuranceExpiryDay)}
                    {isExpired ? ' (EXPIRED)' : isDue ? ' (Due)' : ''}
                  </span>
                </span>
              )
            })()],
              ['Fitness cert', (() => {
              if (bus.fitnessFailed) {
                return (
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                    {!ownerPaysService(bus) && (
                      <button
                        className="small"
                        onClick={() => g.retestFitness(bus.id)}
                        title="Re-test fitness at RTO after repairing mechanicals in workshop"
                      >
                        Retest Fitness ({fmtCompact(BAL.fitnessRenewalCost)})
                      </button>
                    )}
                    <span className="bad">FAILED RTO TEST (brakes/body/chassis &lt; 40%)</span>
                  </span>
                )
              }
              const isExpired = bus.fitnessExpiryDay < s.day
              const isDue = bus.fitnessExpiryDay - s.day <= 30
              const fitCost = quoteFitness(s, bus)
              return (
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                  {!ownerPaysService(bus) && (
                    <button
                      className="small"
                      onClick={() => g.renewFitness(bus.id)}
                      disabled={!isDue && !isExpired}
                      title={!isDue && !isExpired ? 'Fitness can be renewed within 30 days of expiry' : 'Renew RTO Fitness Certificate'}
                    >
                      Renew Fitness ({fmtCompact(fitCost)})
                    </button>
                  )}
                  <span className={isExpired ? 'bad' : isDue ? 'warn' : 'good'}>
                    {fmtDate(bus.fitnessExpiryDay)}
                    {isExpired ? ' (EXPIRED)' : isDue ? ' (Due)' : ''}
                  </span>
                </span>
              )
            })()],
              ['PUC (Pollution)', (() => {
              const pucDay = bus.pucExpiryDay ?? s.day
              const isExpired = pucDay < s.day
              const isDue = pucDay - s.day <= 30
              return (
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                  {!ownerPaysService(bus) && (
                    <button
                      className="small"
                      onClick={() => g.renewPuc(bus.id)}
                      disabled={!isDue && !isExpired}
                      title={!isDue && !isExpired ? 'PUC can be renewed within 30 days of expiry' : 'Renew Pollution Under Control certification'}
                    >
                      Renew PUC ({fmtCompact(BAL.pucCost)})
                    </button>
                  )}
                  <span className={isExpired ? 'bad' : isDue ? 'warn' : 'good'}>
                    {fmtDate(pucDay)}
                    {isExpired ? ' (EXPIRED)' : isDue ? ' (Due)' : ''}
                  </span>
                </span>
              )
            })()],
              ['GPS (AIS-140)', (() => {
              if (bus.gpsDeviceFitted) {
                return <span className="good">Fitted · Telematics active (-15% delay)</span>
              }
              return (
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                  {!ownerPaysService(bus) && (
                    <button
                      className="small"
                      onClick={() => g.fitGps(bus.id)}
                      title="Retrofit AIS-140 GPS telematics device"
                    >
                      Fit GPS ({fmtCompact(BAL.gpsFitCost)})
                    </button>
                  )}
                  <span className="bad">Missing (Expressway fine risk)</span>
                </span>
              )
            })()],
              ['Annual road tax', (() => {
              const dueDay = bus.roadTaxPayableDay ?? (s.day + 365)
              const overdue = s.day > dueDay
              const isDue = s.day >= dueDay - BAL.roadTaxGraceDays
              const taxCost = calculateAnnualRoadTax(s, bus)
              return (
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                  {!ownerPaysService(bus) && (
                    <button
                      className="small"
                      onClick={() => g.payRoadTax(bus.id)}
                      disabled={!isDue}
                      title={isDue ? 'Pay annual commercial vehicle road tax to RTO' : 'Road tax can be paid within 30 days of the due date'}
                    >
                      Pay Tax ({fmtCompact(taxCost)})
                    </button>
                  )}
                  <span className={overdue ? 'bad' : isDue ? 'warn' : 'good'}>
                    {fmtDate(dueDay)}
                    {overdue ? ' (OVERDUE)' : isDue ? ' (Due)' : ''}
                  </span>
                </span>
              )
            })()],
            ]}
            />
            <VitalGroup
              title="Economics"
              rows={[
              ['Book value', <M v={bus.bookValue} />],
              ...(bus.ownership === 'owned'
              ? [[
                  'Depreciation',
                  bus.depreciationMethod === 'NONE'
                    ? <span className="dim">none — asset stays at cost</span>
                    : <span>
                        {bus.depreciationMethod ?? 'SLM'}
                        {bus.depreciationRatePct !== undefined
                          ? ` · ${bus.depreciationRatePct.toFixed(1)}% p.a.`
                          : ' · legacy rate'}
                      </span>,
                ] as [string, React.ReactNode]]
              : []),
              ['Life revenue / cost', <><M v={bus.lifeRevenue} /> / <M v={bus.lifeCost} /></>],
              ['Life trips', bus.lifeTrips],
            ]}
            />
          </div>
        </Panel>

        <Panel
          title="Condition"
          info={ownerPaysService(bus)
            ? 'The bus owner pays service, tyres, overhauls, insurance, fitness and road tax. You only crew this vehicle (and fuel it if leased).'
            : 'Subsystems can be overhauled in your workshop or an outside commercial garage. Re-body & seat refurbishment restore coach life and comfort without needing an own workshop.'}
        >
          <table className="data">
            <tbody>
              {SUBSYSTEMS.map((sub: SubsystemId) => {
                const v = bus.condition[sub]
                const qRep = !ownerPaysService(bus) ? quoteRepair(s, bus.id, sub) : null
                return (
                  <tr key={sub}>
                    <td style={{ textTransform: 'capitalize' }}>{sub}</td>
                    <td><Bar value={v / 100} tone="auto" width={10} /> {Math.round(v)}</td>
                    <td className="num dim small">
                      {ownerPaysService(bus) ? (
                        'owner'
                      ) : qRep ? (
                        <button
                          className="small"
                          onClick={() => g.repairSubsystem(bus.id, sub)}
                          disabled={bus.status === 'delivery'}
                          title={`Overhaul ${sub} (${qRep.days}d)`}
                        >
                          Repair ({fmtCompact(qRep.cost)} · {qRep.days}d)
                        </button>
                      ) : (
                        <span className="good">ok</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {!ownerPaysService(bus) && isCargoModel(model) && (
            <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 500 }}>Re-body</div>
                <div className="dim small" style={{ marginTop: 2 }}>
                  {bus.refurbishedDay !== undefined
                    ? `Done · +${bus.lifeExtensionYears ?? 0}y useful life`
                    : 'Resets body / AC / electrical (scores above) · +5y useful life'}
                </div>
              </div>
              <div>
                {bus.refurbishedDay !== undefined ? (
                  <span className="good small">completed</span>
                ) : bus.ownership !== 'owned' ? (
                  <span className="dim small">owned only</span>
                ) : (() => {
                  const chassis = Math.round(chassisCondition(bus))
                  if (chassis < BAL.refurb.chassisMinCondition) {
                    return <span className="bad small">chassis {chassis}/100</span>
                  }
                  const qRebody = quoteRebody(s, bus)
                  return (
                    <button
                      className="small"
                      onClick={() => g.rebodyBus(bus.id)}
                      disabled={bus.status !== 'active'}
                    >
                      Re-body ({fmtCompact(qRebody.cost)} · {qRebody.days}d)
                    </button>
                  )
                })()}
              </div>
            </div>
          )}

          {!ownerPaysService(bus) && !isCargoModel(model) && (
            <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 8 }}>Re-body & Coach Refurbishment</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Re-body trigger */}
                {(() => {
                  const rebodyAvg = Math.round((bus.condition.body + bus.condition.ac + bus.condition.electrical) / 3)
                  const chassis = Math.round(chassisCondition(bus))
                  const chosenDesign = designOpts.find((o) => o.design.id === rebodyDesignId)?.design
                  const qRebody = quoteRebody(s, bus, supportsBody ? rebodyDesignId : undefined)
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontWeight: 500 }}>Re-body</span>
                            <span className={rebodyAvg >= 75 ? 'good small' : rebodyAvg >= 50 ? 'warn small' : 'bad small'} style={{ fontWeight: 600 }}>
                              <Bar value={rebodyAvg / 100} tone="auto" width={6} /> {rebodyAvg}%
                            </span>
                          </div>
                          <div className="dim small" style={{ marginTop: 2 }}>
                            {bus.refurbishedDay !== undefined
                              ? `Already re-bodied on day ${bus.refurbishedDay} (+${bus.lifeExtensionYears ?? 0}y useful life)`
                              : 'Resets body / AC / electrical to 90 and adds 5y useful life (scores above)'}
                          </div>
                        </div>
                        <div>
                          {bus.refurbishedDay !== undefined ? (
                            <span className="good small">completed</span>
                          ) : bus.ownership !== 'owned' ? (
                            <span className="dim small">owned only</span>
                          ) : (() => {
                            const chassisOk = chassis >= BAL.refurb.chassisMinCondition
                            if (!chassisOk) {
                              return (
                                <span className="bad small" title="Engine, gearbox and suspension must each be 50+">
                                  chassis {chassis}/100 (needs 50+)
                                </span>
                              )
                            }
                            return (
                              <button
                                className="small"
                                onClick={() => g.rebodyBus(bus.id, supportsBody ? rebodyDesignId : undefined)}
                                disabled={bus.status !== 'active'}
                                title={`${qRebody.days}d at specialist bodybuilder — body, AC, electrical reset to 90`}
                              >
                                Re-body ({fmtCompact(qRebody.cost)} · {qRebody.days}d)
                              </button>
                            )
                          })()}
                        </div>
                      </div>
                      {bus.refurbishedDay === undefined && bus.ownership === 'owned' && supportsBody && designOpts.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, background: 'var(--panel-alt, #151a21)', padding: 8, borderRadius: 4, border: '1px solid var(--border)' }}>
                          <span className="small dim" style={{ minWidth: 80 }}>Pick design:</span>
                          <select
                            value={rebodyDesignId}
                            onChange={(e) => setRebodyDesignId(e.target.value)}
                            style={{ flex: 1 }}
                          >
                            {designOpts.map(({ builder, design }) => (
                              <option key={design.id} value={design.id}>
                                {builder.name} — {design.name} (+{fmtCompact(bodyPackagePrice(builder.id, design, model?.name ?? ''))})
                              </option>
                            ))}
                          </select>
                          {chosenDesign?.image && (
                            <img
                              src={chosenDesign.image}
                              alt={chosenDesign.name}
                              style={{ width: 44, height: 28, objectFit: 'cover', borderRadius: 3, border: '1px solid var(--border)' }}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* Seat refurbishment trigger */}
                {(() => {
                  const seatComfort = Number(((model?.comfort ?? 7) + (bus.comfortBonus ?? 0)).toFixed(1))
                  const seatComfortPct = Math.round((seatComfort / 10) * 100)
                  const cleanPct = Math.round(bus.busCleanliness ?? 85)
                  return (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 500 }}>Seat Refurbishment</span>
                          <span className={seatComfortPct >= 75 ? 'good small' : seatComfortPct >= 50 ? 'warn small' : 'bad small'} style={{ fontWeight: 600 }}>
                            <Bar value={seatComfortPct / 100} tone="auto" width={6} /> {seatComfortPct}%
                          </span>
                        </div>
                        <div className="dim small" style={{ marginTop: 2 }}>
                          Current: Comfort {seatComfort}/10{bus.comfortBonus ? ` (+${bus.comfortBonus.toFixed(1)} bonus)` : ''} · Cabin {cleanPct}% clean
                        </div>
                        <div className="dim small" style={{ marginTop: 2 }}>
                          {seatRefurbDone(bus)
                            ? `Refurbished (+${BAL.refurb.seatRefurbComfortBonus} comfort bonus)`
                            : 'New ergonomic cushions, armrests & footrests (+1.5 comfort & PSS lift)'}
                        </div>
                      </div>
                      <div>
                        {seatRefurbDone(bus) ? (
                          <span className="good small">completed</span>
                        ) : bus.ownership !== 'owned' ? (
                          <span className="dim small">owned only</span>
                        ) : (() => {
                          const qSeat = quoteSeatRefurb(s, bus)
                          return (
                            <button
                              className="small"
                              onClick={() => g.refurbishSeats(bus.id)}
                              disabled={bus.status !== 'active'}
                              title={`${qSeat.days}d at specialist trimmer — replaces cushions, armrests & footrests`}
                            >
                              Refurbish Seats ({fmtCompact(qSeat.cost)} · {qSeat.days}d)
                            </button>
                          )
                        })()}
                      </div>
                    </div>
                  )
                })()}

                {/* In-Cabin Tech & Safety Retrofits */}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-dim)', marginBottom: 8 }}>
                    IN-CABIN TECH & SAFETY RETROFITS
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
                    {FITTING_CATALOG.map((f) => {
                      const fitted = busHasFitting(bus, f.id)
                      return (
                        <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <div>
                            <div style={{ fontWeight: 500 }}>{f.title}</div>
                            <div className="dim small">
                              {f.blurb}
                              {f.pssBonus > 0 ? ` (+${f.pssBonus} PSS)` : ''}
                            </div>
                          </div>
                          <div style={{ flexShrink: 0 }}>
                            {fitted ? (
                              <span className="pill good small">✓ Fitted</span>
                            ) : bus.ownership !== 'owned' ? (
                              <span className="dim small">owned only</span>
                            ) : (
                              <button
                                className="small"
                                onClick={() => g.retrofitBus(bus.id, f.id)}
                                disabled={bus.status === 'delivery'}
                              >
                                Fit ({fmtCompact(f.retrofitCost)})
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {!ownerPaysService(bus) && (
            <p className="dim small mt12">
              <Link to="/workshop">Open Workshop</Link>
              {due > 0 ? ` · service overdue ${Math.round(due / 1000)}k km` : ''}
              {tyreReady ? ' · tyres due' : ''}
            </p>
          )}
        </Panel>

        <Panel
          title="Crew"
          info={bus.ownership === 'attached'
            ? 'Attached bus — the owner supplies drivers and a conductor. You do not assign crew.'
            : 'A conductor sells tickets and keeps the cabin. Without one the bus still departs, but reviews take a hit. Long routes (over 9h) need two drivers.'}
        >
          {bus.ownership === 'attached' && (
            <p className="dim">Owner supplies crew.</p>
          )}
          {crewed && (
            <>
              <table className="data">
                <tbody>
                  <SlotRow busId={bus.id} role="driver" label="Driver" slots={crewLimit(s, bus, 'driver')} />
                  <SlotRow busId={bus.id} role="conductor" label="Conductor" slots={crewLimit(s, bus, 'conductor')} />
                </tbody>
              </table>
              <div className="dim small" style={{ marginTop: 6 }}>
                CMVR: a leg over 10h needs 2 drivers. One driver can cover up to 13h in a day. Paired schedules (2 trips/day) require 2 drivers (one per trip) and 2 conductors. After a night departure crew members rest until 8:00.
              </div>
            </>
          )}

          <div className="panel-title" style={{ margin: '10px -10px 8px', borderTop: '1px solid var(--border)' }}><span>Subsidiary</span></div>
          {(() => {
            const nextGid = targetGroupId ? targetGroupId : undefined
            const same = targetGroupId === (bus.groupId ?? '')
            const canRebrand = !same && nextGid !== undefined
            const rebrandFee = canRebrand && doRebrand ? BAL.rebrandCost : 0
            const afford = rebrandFee <= 0 || canAfford(s, rebrandFee)
            return (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <GroupBadge group={bus.groupId && s.groups ? s.groups[bus.groupId] : undefined} />
                  <select
                    value={targetGroupId}
                    onChange={(e) => {
                      setTargetGroupId(e.target.value)
                      setDoRebrand(false)
                    }}
                    style={{ minWidth: 160 }}
                  >
                    {activeGroups(s).map((grp) => (
                      <option key={grp.id} value={grp.id}>
                        {grp.code} - {grp.name}
                      </option>
                    ))}
                    <option value="">Unassigned</option>
                  </select>
                  <button
                    disabled={same || !afford}
                    onClick={() => {
                      const oldName = bus.groupId && s.groups?.[bus.groupId] ? s.groups[bus.groupId].name : 'Unassigned'
                      const newName = nextGid && s.groups?.[nextGid] ? s.groups[nextGid].name : 'Unassigned'
                      const err = g.assignBusToGroup(bus.id, nextGid, { chargeRebrand: rebrandFee > 0 })
                      if (err) {
                        pushLog(s, 'warn', err)
                        return
                      }
                      setDoRebrand(false)
                      pushLog(
                        s,
                        'info',
                        rebrandFee > 0
                          ? `Coach ${bus.reg} transferred from ${oldName} to ${newName} (rebranding ${fmtCompact(rebrandFee)}).`
                          : `Coach ${bus.reg} transferred from ${oldName} to ${newName}.`,
                      )
                    }}
                  >
                    Transfer
                  </button>
                </div>
                {canRebrand && (
                  <label className={`small ${afford || !doRebrand ? 'dim' : 'bad'}`} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={doRebrand}
                      onChange={(e) => setDoRebrand(e.target.checked)}
                    />
                    Rebrand livery (+<M v={BAL.rebrandCost} />)
                    {doRebrand && !afford && ' — not enough liquidity'}
                  </label>
                )}
              </div>
            )
          })()}

          <div className="panel-title" style={{ margin: '10px -10px 8px', borderTop: '1px solid var(--border)' }}><span>Exit</span></div>
          {bus.ownership === 'owned' && (() => {
            const settle = sellSettlement(s, bus.id)!
            const hypothecated = !!settle.loan
            return (
              <div>
                <div className="flex flex-wrap">
                  <button
                    className="danger"
                    disabled={hypothecated && !settle.canAfford}
                    onClick={() => { g.sellBus(bus.id); nav('/fleet') }}
                  >
                    {hypothecated
                      ? settle.net >= 0
                        ? <>Sell & clear loan — keep ~<M v={settle.net} /></>
                        : <>Sell & clear loan — pay ~<M v={settle.shortfall} /></>
                      : <>Sell for ~<M v={settle.proceeds} /></>}
                  </button>
                </div>
                {hypothecated && (
                  <p className="small dim mt12">
                    Sale <M v={settle.proceeds} /> · {settle.loan!.lender} due <M v={settle.loan!.balance} />
                    {settle.fee > 0 && <> + fee <M v={settle.fee} /></>}
                    {' '}→ net {settle.net >= 0 ? <span className="good">+<M v={settle.net} /></span> : <span className="warn">−<M v={settle.shortfall} /></span>} cash
                    {!settle.canAfford && (
                      <span className="bad"> — need <M v={settle.shortfall} /> liquidity (cash + OD)</span>
                    )}
                  </p>
                )}
              </div>
            )
          })()}
          {bus.ownership === 'leased' && (() => {
            const locked = !!(bus.leaseEndDay && s.day < bus.leaseEndDay)
            const br = leaseBreakCost(bus, s.day)
            return (
              <div>
                {locked ? (
                  <>
                    <button
                      className="danger"
                      onClick={() => { if (g.endLease(bus.id)) nav('/fleet') }}
                    >
                      Break lease — pay <M v={br.penalty} />
                    </button>
                    <p className="small dim mt12">
                      Lock-in ends in {br.daysLeft}d. Early exit costs {br.monthsLeft} month{br.monthsLeft === 1 ? '' : 's'} of rent
                      ({fmtCompact(br.penalty)}); your security deposit is forfeited.
                    </p>
                  </>
                ) : (
                  <button className="danger" onClick={() => { if (g.endLease(bus.id)) nav('/fleet') }}>
                    Return lease (deposit refunded)
                  </button>
                )}
              </div>
            )
          })()}
          {bus.ownership === 'attached' && (
            <button className="danger" onClick={() => { g.releaseAttach(bus.id); nav('/fleet') }}>End attach agreement</button>
          )}
        </Panel>
      </div>
    </>
  )
}
