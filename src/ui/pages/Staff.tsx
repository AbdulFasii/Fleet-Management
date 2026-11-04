import { careerInfo, careerRank } from '../../engine/sim/careers'
import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useGame } from '../../store/gameStore'
import { BAL } from '../../engine/data/balance'
import { routeName } from '../../engine/data/routes'
import {
  AUTO_HIRE_ROLES,
  DEFAULT_AUTO_FIRE_SALARY,
  DESK_LABEL,
  ROLE_LABEL,
  STAFF_ROLES,
  autoHireRoleTarget,
  deskOf,
  experienceNow,
  hrOnDuty,
  managersOnPayroll,
  marketSalary,
  opsOnDuty,
  scheduleManagerOnDuty,
  estimateCrewRequirements,
  isStaffResting,
  monthlyOfficeAdminCost,
  staffCountForRole,
  type CrewEstimateItem,
  type DeskPost,
} from '../../engine/sim/staffing'
import { fmtClock } from '../../engine/core/calendar'
import { fmtCompact, rs, toRupees } from '../../engine/core/money'
import { conductorCleanlinessTarget } from '../../engine/sim/maintenance'
import { companyCargoFillRate } from '../../engine/sim/cargo'
import type { GameState, HrAutoHire, ID, Staff, StaffRole } from '../../engine/types'
import { CREW_ROLES } from '../crew'
import { Bar, DataTable, M, Panel, SpanMeter, type Col, Hint, StatRow, BusLink, Tabs, PageHeader } from '../bits'
import { qty } from '../format'
import { spanMeters, DESK_UNIT, officeStaffingStats } from '../../engine/sim/span'

const HIRE_POOL_ROLES: StaffRole[] = STAFF_ROLES.filter((r) => r !== 'co_driver')

const MECHANIC_TRADE_LABEL: Record<string, string> = {
  engine_gearbox: 'Engine & Gearbox',
  electrical_ac: 'Electrical & AC',
  body_suspension: 'Body & Suspension',
  general: 'General Workshop',
}

function skillTone(skill: number): 'good' | 'warn' | 'bad' {
  if (skill >= 8) return 'good'
  if (skill >= 5) return 'warn'
  return 'bad'
}

function candidateSpec(c: Staff): { label: string; tone?: 'good' | 'warn' | 'dim' } {
  if (c.role === 'driver' || c.role === 'co_driver') {
    const style = c.drivingStyle === 'aggressive' ? 'Aggressive' : 'Cautious'
    const licence = c.licenceClass ?? 'HMV_PSV'
    return {
      label: `${style} · ${licence}`,
      tone: c.drivingStyle === 'aggressive' ? 'warn' : 'good',
    }
  }
  if (c.role === 'conductor') return { label: 'Cabin & Luggage Duty', tone: 'dim' }
  if (c.role === 'mechanic') {
    return { label: MECHANIC_TRADE_LABEL[c.mechanicTrade ?? 'general'] ?? c.mechanicTrade ?? 'General', tone: 'dim' }
  }
  if (c.role === 'manager') return { label: 'Department Management', tone: 'good' }
  return { label: '—', tone: 'dim' }
}

function ManagerPick({
  s,
  value,
  desk: _desk,
  onChange,
  excludePosted = true,
  placeholder = '— Unassigned —',
}: {
  s: GameState
  value: ID | undefined
  desk: DeskPost
  onChange: (id: ID | undefined) => void
  excludePosted?: boolean
  placeholder?: string
}) {
  const managers = managersOnPayroll(s)
  // Only include unassigned managers (plus the currently appointed manager for this desk)
  const filtered = excludePosted
    ? managers.filter((st) => st.id === value || !deskOf(s, st.id))
    : managers

  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      style={{ padding: '2px 6px', fontSize: 12, minWidth: 140 }}
    >
      <option value="">{placeholder}</option>
      {filtered.map((st) => (
        <option key={st.id} value={st.id}>
          {st.name} · Skill {st.skill}
        </option>
      ))}
    </select>
  )
}

function DeskAssistants({ s, desk }: { s: GameState; desk: DeskPost }) {
  const g = useGame()
  const list = s.company.deskAssistants?.[desk] ?? []
  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--panel-border, rgba(255,255,255,0.1))' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span className="dim small bold">Assistant Managers ({list.length})</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <ManagerPick
            s={s}
            value={undefined}
            desk={desk}
            excludePosted
            placeholder="+ Appoint assistant..."
            onChange={(id) => {
              if (id) g.appointDeskAssistant(desk, id)
            }}
          />
        </div>
      </div>
      {list.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
          {list.map((aid) => {
            const st = s.staff[aid]
            if (!st) return null
            return (
              <span key={aid} className="pill small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {st.name} (Sk {st.skill})
                <button
                  onClick={() => g.unappointDeskAssistant(desk, aid)}
                  style={{ background: 'none', border: 'none', color: 'var(--red, #ef4444)', cursor: 'pointer', padding: '0 2px', fontWeight: 'bold' }}
                  title="Remove assistant"
                >
                  ×
                </button>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CrewHeadcountTable({ s }: { s: GameState }) {
  const est = estimateCrewRequirements(s)
  const renderBadge = (item: CrewEstimateItem) => {
    if (item.current < item.line) {
      return <span className="pill bad small">-{item.line - item.current} line duty</span>
    }
    if (item.current < item.required) {
      return <span className="pill warn small">need {item.required - item.current} relief</span>
    }
    return (
      <span className="pill good small">
        OK{item.current > item.required ? ` (+${item.current - item.required} spare)` : ''}
      </span>
    )
  }

  return (
    <div>
      <table className="data" style={{ width: '100%', margin: 0 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Role / Licence Category</th>
            <th className="num" title="Currently on company payroll">On Payroll</th>
            <th className="num" title="Line duties required on active schedules">Line Duty</th>
            <th className="num" title="Total requirement including ~15% CMVR relief buffer">Total Req (w/ Relief)</th>
            <th className="num">Coverage Status</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Total Drivers</strong></td>
            <td className="num"><b>{est.drivers.total.current}</b></td>
            <td className="num">{est.drivers.total.line}</td>
            <td className="num">{est.drivers.total.required}</td>
            <td className="num">{renderBadge(est.drivers.total)}</td>
          </tr>
          <tr>
            <td style={{ paddingLeft: 18 }} className="dim">↳ HMV_PSV (Standard Buses)</td>
            <td className="num">{est.drivers.psv.current}</td>
            <td className="num">{est.drivers.psv.line}</td>
            <td className="num">{est.drivers.psv.required}</td>
            <td className="num">{renderBadge(est.drivers.psv)}</td>
          </tr>
          <tr>
            <td style={{ paddingLeft: 18 }} className="dim">↳ HMV_HP (Heavy Multi-Axle Volvo/Scania)</td>
            <td className="num">{est.drivers.hp.current}</td>
            <td className="num">{est.drivers.hp.line}</td>
            <td className="num">{est.drivers.hp.required}</td>
            <td className="num">{renderBadge(est.drivers.hp)}</td>
          </tr>
          <tr>
            <td><strong>Conductors</strong></td>
            <td className="num"><b>{est.conductors.current}</b></td>
            <td className="num">{est.conductors.line}</td>
            <td className="num">{est.conductors.required}</td>
            <td className="num">{renderBadge(est.conductors)}</td>
          </tr>
        </tbody>
      </table>
      <Hint text={"* Total Req includes ~15% relief buffer for CMVR statutory night rest, weekly off, and sick leave."} />
    </div>
  )
}

function RoleSalaryCapsEditor({
  s,
  hr,
  autoFire,
  autoFireCaps,
  onSaveCaps,
}: {
  s: GameState
  hr: Staff | undefined
  autoFire: { enabled: boolean; maxSalaryByRole?: Partial<Record<StaffRole, number>> }
  autoFireCaps: Record<StaffRole, number>
  onSaveCaps: (caps: Record<StaffRole, number>) => void
}) {
  const staff = Object.values(s.staff)
  const [draftCaps, setDraftCaps] = useState<Record<StaffRole, number>>(() => ({ ...autoFireCaps }))
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!dirty) {
      setDraftCaps({ ...autoFireCaps })
    }
  }, [autoFireCaps, dirty])

  const visibleRoles = STAFF_ROLES.filter((r) => r !== 'co_driver')

  const handleUpdate = (role: StaffRole, newCap: number) => {
    setDraftCaps((prev) => ({ ...prev, [role]: newCap }))
    setDirty(true)
  }

  const handleSave = () => {
    onSaveCaps(draftCaps)
    setDirty(false)
  }

  const handleResetDraft = () => {
    setDraftCaps({ ...autoFireCaps })
    setDirty(false)
  }

  return (
    <div style={{ background: 'var(--bg3)', padding: 10, border: '1px solid var(--border)', marginBottom: 10, borderRadius: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <b className="small">Role Salary Caps (Auto-Fire Thresholds):</b>
          <Hint text={"HR automatically fires any employee whose monthly salary crosses their role's cap (no confirmation needed, 1 month severance paid)."} />
        </div>
        <div className="row gap">
          {dirty && (
            <span className="warn small">
              Unsaved changes
            </span>
          )}
          <button
            type="button"
            className="primary small"
            disabled={!dirty}
            onClick={handleSave}
            title="Submit and save these salary caps for HR auto-firing"
          >
            Submit Caps
          </button>
          {dirty && (
            <button
              type="button"
              className="small faint"
              onClick={handleResetDraft}
              title="Discard unsaved changes"
            >
              Cancel
            </button>
          )}
          {autoFire.enabled && hr && <span className="pill good small">Active</span>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
        {visibleRoles.map((role) => {
          const cap = draftCaps[role] ?? DEFAULT_AUTO_FIRE_SALARY[role]
          const capInRs = Math.round(toRupees(cap))
          const roleStaff = staff.filter((x) => x.role === role)
          const overCapCount = roleStaff.filter((x) => x.salary > cap).length

          return (
            <div
              key={role}
              style={{
                background: 'var(--bg2)',
                padding: '8px',
                border: '1px solid var(--border)',
                borderRadius: 4,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{ROLE_LABEL[role]}</span>
                <span className="dim small">{roleStaff.length} on rolls</span>
              </div>

              <div className="row gap6">
                <span className="dim small" style={{ fontSize: 11, minWidth: 28 }}>Cap:</span>
                <input
                  type="number"
                  min={5000}
                  max={200000}
                  step={1000}
                  value={capInRs}
                  onChange={(e) => {
                    const val = Number(e.target.value)
                    if (val >= 1000) {
                      handleUpdate(role, rs(val))
                    }
                  }}
                  style={{ width: 90, padding: '3px 6px', fontSize: 12, textAlign: 'right' }}
                />
                <span className="dim small">/mo</span>
              </div>

              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <button
                  type="button"
                  className="small faint"
                  style={{ padding: '2px 6px', fontSize: 11 }}
                  title="Decrease cap by ₹1,000"
                  onClick={() => {
                    const next = Math.max(5000, capInRs - 1000)
                    handleUpdate(role, rs(next))
                  }}
                >
                  -1k
                </button>
                <button
                  type="button"
                  className="small faint"
                  style={{ padding: '2px 6px', fontSize: 11 }}
                  title="Increase cap by ₹1,000"
                  onClick={() => {
                    const next = capInRs + 1000
                    handleUpdate(role, rs(next))
                  }}
                >
                  +1k
                </button>
                <button
                  type="button"
                  className="small faint"
                  style={{ padding: '2px 6px', fontSize: 11, marginLeft: 'auto' }}
                  title={`Reset to default (${fmtCompact(DEFAULT_AUTO_FIRE_SALARY[role])})`}
                  onClick={() => {
                    handleUpdate(role, DEFAULT_AUTO_FIRE_SALARY[role])
                  }}
                >
                  Reset
                </button>
              </div>

              {overCapCount > 0 ? (
                <div className="bad small" style={{ fontSize: 11 }}>
                  {overCapCount} currently over cap
                </div>
              ) : (
                <div className="good small" style={{ fontSize: 11 }}>
                  All staff within cap
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function matchTargetHint(role: StaffRole): string {
  if (role === 'driver' || role === 'conductor') return 'Ops crew roster'
  if (role === 'mechanic') return 'Workshop bay capacity'
  if (role === 'manager') return 'Office required managers'
  return 'Target headcount'
}

function AutoHireRulesEditor({
  auto,
  autoMode,
  g,
  s,
}: {
  auto: HrAutoHire
  autoMode: 'match' | 'unlimited'
  g: any
  s: GameState
}) {
  const [activeRoleTab, setActiveRoleTab] = useState<StaffRole>('driver')

  const drivingStyles = auto.drivingStyle ?? []
  const licenceClasses = auto.licenceClass ?? []
  const mechanicTrades = auto.mechanicTrade ?? []
  const activeTarget = autoHireRoleTarget(s, activeRoleTab)
  const activeHave = staffCountForRole(s, activeRoleTab)

  return (
    <div style={{ background: 'var(--bg3)', padding: 10, border: '1px solid var(--border)', marginBottom: 8, borderRadius: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
        <div>
          <b className="small">Auto-Hire Candidate Filters:</b>
          <div className="dim small">
            Skill / style filters for HR auto-hire.
            {autoMode === 'match' && (
              <> Match mode: drivers & conductors → Ops roster · mechanics → bay capacity · managers → office required staff.</>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="dim small">Target Mode:</span>
          <button
            type="button"
            className={autoMode === 'match' ? 'primary small' : 'small'}
            title="Stop hiring each role once Ops / bay / office targets are filled"
            onClick={() => g.setHrAutoHire({ mode: 'match' })}
          >
            Match Targets
          </button>
          <button
            type="button"
            className={autoMode === 'unlimited' ? 'primary small' : 'small'}
            onClick={() => g.setHrAutoHire({ mode: 'unlimited' })}
          >
            Unlimited
          </button>
        </div>
      </div>

      {/* Role Tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <span className="dim small" style={{ minWidth: 80 }}>Roles:</span>
        {AUTO_HIRE_ROLES.map((role) => {
          const isEnabled = auto.byRole[role] !== undefined
          const isSelected = activeRoleTab === role
          const skillsCount = auto.byRole[role]?.length ?? 0
          const target = autoHireRoleTarget(s, role)
          const have = staffCountForRole(s, role)
          return (
            <button
              key={role}
              type="button"
              className={isSelected ? 'primary small' : isEnabled ? 'small' : 'small faint'}
              style={{
                fontWeight: isSelected ? 700 : 400,
                border: isSelected ? '1px solid var(--fg)' : undefined,
              }}
              title={autoMode === 'match' ? `${matchTargetHint(role)}: ${have} / ${target}` : undefined}
              onClick={() => setActiveRoleTab(role)}
            >
              {isEnabled ? '' : '✕ '}
              {ROLE_LABEL[role]}
              <span className="dim" style={{ marginLeft: 4, fontSize: 11 }}>
                ({isEnabled ? `${skillsCount} skills` : 'off'}
                {autoMode === 'match' ? ` · ${have}/${target}` : ''})
              </span>
            </button>
          )
        })}
      </div>

      {/* Active Role Configuration Card */}
      {auto.byRole[activeRoleTab] !== undefined ? (
        <div style={{ background: 'var(--bg2)', padding: 10, border: '1px solid var(--border)', borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <div className="row gap wrap">
              <span style={{ fontWeight: 600, fontSize: 13 }}>{ROLE_LABEL[activeRoleTab]} Auto-Hire Criteria</span>
              <span className="pill good small">Active</span>
              {autoMode === 'match' && (
                <span className={`pill small ${activeHave < activeTarget ? 'warn' : 'good'}`} title={matchTargetHint(activeRoleTab)}>
                  {matchTargetHint(activeRoleTab)}: {activeHave} / {activeTarget}
                </span>
              )}
            </div>
            <button
              type="button"
              className="small faint"
              style={{ fontSize: 11 }}
              title={`Disable ${ROLE_LABEL[activeRoleTab]} auto-hire`}
              onClick={() => g.setHrAutoHire({ toggleRole: activeRoleTab })}
            >
              Turn Off {ROLE_LABEL[activeRoleTab]}
            </button>
          </div>

          {/* Skill Filter Row */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
              <span className="dim small bold">Skill Filter (1–10):</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  type="button"
                  className="small faint"
                  style={{ fontSize: 10, padding: '1px 5px' }}
                  onClick={() => {
                    const newByRole = { ...auto.byRole, [activeRoleTab]: [4, 5, 6, 7, 8, 9, 10] }
                    g.setHrAutoHire({ byRole: newByRole })
                  }}
                >
                  4–10 (Default)
                </button>
                <button
                  type="button"
                  className="small faint"
                  style={{ fontSize: 10, padding: '1px 5px' }}
                  onClick={() => {
                    const newByRole = { ...auto.byRole, [activeRoleTab]: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }
                    g.setHrAutoHire({ byRole: newByRole })
                  }}
                >
                  All (1–10)
                </button>
                <button
                  type="button"
                  className="small faint"
                  style={{ fontSize: 10, padding: '1px 5px' }}
                  onClick={() => {
                    const newByRole = { ...auto.byRole, [activeRoleTab]: [] }
                    g.setHrAutoHire({ byRole: newByRole })
                  }}
                >
                  Clear
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((sk) => {
                const hasSkill = (auto.byRole[activeRoleTab] ?? []).includes(sk)
                return (
                  <button
                    key={sk}
                    type="button"
                    className={hasSkill ? 'primary small' : 'small faint'}
                    style={{ minWidth: 28, padding: '3px 6px', fontWeight: hasSkill ? 700 : 400 }}
                    onClick={() => g.setHrAutoHire({ toggleSkill: { role: activeRoleTab, skill: sk } })}
                  >
                    {sk}
                  </button>
                )
              })}
              <span className="dim small ml8">
                {auto.byRole[activeRoleTab]?.length
                  ? `Hires skill ${(auto.byRole[activeRoleTab] ?? []).join(', ')}`
                  : 'No skills selected — hiring paused for this role'}
              </span>
            </div>
          </div>

          {/* Driver-Specific Filters: Driving Style & Licence Class */}
          {activeRoleTab === 'driver' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
              {/* Driving Style Selectors */}
              <div className="row gap wrap">
                <span className="dim small" style={{ fontWeight: 600, minWidth: 100 }}>Driving Style:</span>
                <button
                  type="button"
                  className={drivingStyles.includes('cautious') ? 'primary small' : 'small faint'}
                  onClick={() => g.setHrAutoHire({ toggleDrivingStyle: 'cautious' })}
                >
                  {drivingStyles.includes('cautious') ? '' : ''}Cautious
                </button>
                <button
                  type="button"
                  className={drivingStyles.includes('aggressive') ? 'primary small' : 'small faint'}
                  onClick={() => g.setHrAutoHire({ toggleDrivingStyle: 'aggressive' })}
                >
                  {drivingStyles.includes('aggressive') ? '' : ''}Aggressive
                </button>
                <span className="dim small">
                  {drivingStyles.length === 0 || drivingStyles.length === 2
                    ? '(Any driving style accepted)'
                    : drivingStyles.includes('cautious')
                      ? '(Cautious drivers only)'
                      : '(Aggressive drivers only)'}
                </span>
              </div>

              {/* Licence Class Selectors */}
              <div className="row gap wrap">
                <span className="dim small" style={{ fontWeight: 600, minWidth: 100 }}>Licence Class:</span>
                <button
                  type="button"
                  className={licenceClasses.includes('HMV_PSV') ? 'primary small' : 'small faint'}
                  onClick={() => g.setHrAutoHire({ toggleLicenceClass: 'HMV_PSV' })}
                >
                  {licenceClasses.includes('HMV_PSV') ? '' : ''}HMV_PSV (Standard)
                </button>
                <button
                  type="button"
                  className={licenceClasses.includes('HMV_HP') ? 'primary small' : 'small faint'}
                  onClick={() => g.setHrAutoHire({ toggleLicenceClass: 'HMV_HP' })}
                >
                  {licenceClasses.includes('HMV_HP') ? '' : ''}HMV_HP (Heavy Coach)
                </button>
                <span className="dim small">
                  {licenceClasses.length === 0 || licenceClasses.length === 2
                    ? '(Any licence class accepted)'
                    : licenceClasses.includes('HMV_HP')
                      ? '(Heavy coach HP licence only)'
                      : '(Standard PSV licence only)'}
                </span>
              </div>
            </div>
          )}

          {/* Mechanic-Specific Filters: Trade Specialization */}
          {activeRoleTab === 'mechanic' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingTop: 6, borderTop: '1px solid var(--border)' }}>
              <span className="dim small" style={{ fontWeight: 600, minWidth: 100 }}>Trade Spec:</span>
              {[
                ['engine_gearbox', 'Engine & Gearbox'],
                ['electrical_ac', 'Electrical & AC'],
                ['body_suspension', 'Body & Suspension'],
                ['general', 'General'],
              ].map(([tradeKey, tradeLabel]) => {
                const isSelected = mechanicTrades.includes(tradeKey as any)
                return (
                  <button
                    key={tradeKey}
                    type="button"
                    className={isSelected ? 'primary small' : 'small faint'}
                    onClick={() => g.setHrAutoHire({ toggleMechanicTrade: tradeKey as any })}
                  >
                    {isSelected ? '' : ''}{tradeLabel}
                  </button>
                )
              })}
              <span className="dim small">
                {mechanicTrades.length === 0 ? '(Any trade accepted)' : `(${mechanicTrades.length} trades selected)`}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div style={{ background: 'var(--bg2)', padding: 12, border: '1px solid var(--border)', borderRadius: 4, textAlign: 'center' }}>
          <div className="dim small">
            {ROLE_LABEL[activeRoleTab]} auto-hire is currently disabled.
          </div>
          <button
            type="button"
            className="small primary"
            style={{ marginTop: 6 }}
            onClick={() => g.setHrAutoHire({ toggleRole: activeRoleTab })}
          >
            + Enable {ROLE_LABEL[activeRoleTab]} Auto-Hire
          </button>
        </div>
      )}
    </div>
  )
}

type StaffTab = 'payroll' | 'hiring' | 'desks' | 'planning'

function staffTabFromSearch(raw: string | null): StaffTab | null {
  if (raw === 'payroll' || raw === 'hiring' || raw === 'desks' || raw === 'planning') return raw
  if (raw === 'office' || raw === 'headoffice') return 'desks'
  return null
}

export function StaffPage() {
  const s = useGame((g) => g.state)!
  const g = useGame()
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState<StaffTab>(
    () => staffTabFromSearch(searchParams.get('tab')) ?? 'payroll',
  )
  useEffect(() => {
    const tab = staffTabFromSearch(searchParams.get('tab'))
    if (tab && tab !== activeTab) setActiveTab(tab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])
  const selectTab = (id: StaffTab) => {
    setActiveTab(id)
    setSearchParams(id === 'payroll' ? {} : { tab: id }, { replace: true })
  }
  const [roleFilter, setRoleFilter] = useState<StaffRole | 'all'>('all')
  const [poolFilter, setPoolFilter] = useState<StaffRole | 'all'>('all')
  const [poolSearch, setPoolSearch] = useState('')
  const [search, setSearch] = useState('')
  const [showAutoHireRules, setShowAutoHireRules] = useState(false)
  const [showAutoFireRules, setShowAutoFireRules] = useState(false)

  const staff = Object.values(s.staff)
  const drivers = staff.filter((x) => x.role === 'driver' || (x.role as string) === 'co_driver')
  const conductors = staff.filter((x) => x.role === 'conductor')
  const mechanics = staff.filter((x) => x.role === 'mechanic')
  const meters = spanMeters(s)

  const restingCount = staff.filter((x) => isStaffResting(s, x)).length
  const onLeaveCount = staff.filter((x) => x.onLeaveUntilDay && x.onLeaveUntilDay >= s.day).length
  const activeCrewCount = staff.filter((x) => CREW_ROLES.includes(x.role) && !isStaffResting(s, x) && (!x.onLeaveUntilDay || x.onLeaveUntilDay < s.day)).length

  const filteredStaff = staff.filter((x) => {
    if (roleFilter !== 'all' && x.role !== roleFilter) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const bus = x.busId ? s.buses[x.busId] : undefined
      const matchesName = x.name.toLowerCase().includes(q)
      const matchesBus = bus?.reg.toLowerCase().includes(q)
      if (!matchesName && !matchesBus) return false
    }
    return true
  })

  const totalPayroll = staff.reduce((a, x) => a + x.salary, 0)
  const shownPayroll = filteredStaff.reduce((a, x) => a + x.salary, 0)
  const officeCost = monthlyOfficeAdminCost(s)
  const officeStaff = officeStaffingStats(s)
  const est = estimateCrewRequirements(s)

  const hr = hrOnDuty(s)
  const ops = opsOnDuty(s)
  const scheduleMgr = scheduleManagerOnDuty(s)
  const workshopMgr = s.workshop.managerId ? s.staff[s.workshop.managerId] : undefined
  const cargoMgr = s.company.cargoManagerId ? s.staff[s.company.cargoManagerId] : undefined
  const docsMgr = s.company.docsManagerId ? s.staff[s.company.docsManagerId] : undefined
  const crmMgr = s.company.crmId ? s.staff[s.company.crmId] : undefined
  const accountantMgr = s.company.accountantId ? s.staff[s.company.accountantId] : undefined
  const charterMgr = s.company.charterManagerId ? s.staff[s.company.charterManagerId] : undefined
  const pool = (poolFilter === 'all' ? s.hiringPool : s.hiringPool.filter((c) => c.role === poolFilter))
    .filter((c) => {
      if (!poolSearch.trim()) return true
      const q = poolSearch.toLowerCase()
      const spec = candidateSpec(c).label.toLowerCase()
      return (
        c.name.toLowerCase().includes(q)
        || (ROLE_LABEL[c.role] ?? c.role).toLowerCase().includes(q)
        || spec.includes(q)
        || (c.licenceClass ?? '').toLowerCase().includes(q)
        || (c.mechanicTrade ?? '').toLowerCase().includes(q)
      )
    })

  const poolDaysLeft = Math.max(0, s.poolRefreshDay - s.day)
  const poolAskingTotal = pool.reduce((a, c) => a + c.salary, 0)

  const auto = s.company.hrAutoHire ?? { enabled: false, byRole: { driver: [4, 5, 6, 7, 8, 9, 10] } as Partial<Record<StaffRole, number[]>> }
  const autoMode = auto.mode === 'match' ? 'match' : 'unlimited'

  const autoFire = s.company.hrAutoFire ?? { enabled: false, maxSalaryByRole: DEFAULT_AUTO_FIRE_SALARY }
  const autoFireCaps: Record<StaffRole, number> = {
    ...DEFAULT_AUTO_FIRE_SALARY,
    ...autoFire.maxSalaryByRole,
  }

  /* Staff Table Columns */
  const cols: Col<Staff>[] = [
    {
      key: 'name',
      label: 'Staff Member',
      sort: (x) => x.name,
      render: (x) => (
        <div>
          <b>{x.name}</b>
          <span className="pill small dim ml6">
            {ROLE_LABEL[x.role] ?? x.role}
          </span>
          {x.onLeaveUntilDay && x.onLeaveUntilDay >= s.day && (
            <span className="pill small warn" style={{ marginLeft: 4 }}>
              Leave ({x.onLeaveUntilDay - s.day}d)
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'rank',
      label: 'Rank',
      sort: (x) => careerRank(x),
      render: (x) => {
        if (x.role !== 'driver' && (x.role as string) !== 'co_driver') return <span className="dim">—</span>
        const info = careerInfo(x)
        return (
          <span
            className={`pill small ${info.rank >= 3 ? 'accent' : info.rank === 2 ? 'good' : info.rank === 1 ? 'info' : 'dim'}`}
            title={info.next ? `Next rank: ${info.next}` : 'Top rank. Rivals notice Masters, so keep them paid and happy.'}
          >
            {info.name}
          </span>
        )
      },
    },
    {
      key: 'style_licence',
      label: 'Licence & Duty Spec',
      render: (x) => {
        if (x.role === 'driver' || (x.role as string) === 'co_driver') {
          const isResting = isStaffResting(s, x)
          return (
            <div>
              <span className={x.drivingStyle === 'aggressive' ? 'warn' : 'good'}>
                {x.drivingStyle === 'aggressive' ? 'Aggressive' : 'Cautious'}
              </span>
              {' · '}
              <span className={x.licenceClass === 'HMV_HP' ? 'good' : 'dim'} title={x.licenceClass === 'HMV_HP' ? 'Heavy coach licence' : 'Standard bus licence'}>
                {x.licenceClass ?? 'HMV_PSV'}
              </span>
              <div className="small">
                {isResting ? (
                  <span className="pill small bad">Night Rest (CMVR)</span>
                ) : (
                  <span className="dim">{x.cmvrHoursToday ?? 0}h driven today</span>
                )}
              </div>
            </div>
          )
        }
        if (x.role === 'conductor') {
          const isResting = isStaffResting(s, x)
          const targetClean = conductorCleanlinessTarget(x.skill)
          return (
            <div>
              {isResting ? (
                <span className="pill small bad">Resting</span>
              ) : (
                <span className="good small">Active Duty</span>
              )}
              <div className="small">
                {x.skill >= 5 ? (
                  <span className="good" title={`Maintains cabin at ${targetClean}/100 cleanliness`}>
                    Cleanliness: {targetClean}★
                  </span>
                ) : (
                  <span className="dim">Basic clean</span>
                )}
              </div>
            </div>
          )
        }
        if (x.role === 'mechanic') {
          const tradeLabels: Record<string, string> = {
            engine_gearbox: 'Engine & Gearbox',
            electrical_ac: 'Electrical & AC',
            body_suspension: 'Body & Suspension',
            general: 'General Workshop',
          }
          return <span className="dim">{tradeLabels[x.mechanicTrade ?? 'general'] ?? x.mechanicTrade}</span>
        }
        if (x.role === 'manager') {
          const posted = deskOf(s, x.id)
          return posted ? <span className="pill small good">{DESK_LABEL[posted]}</span> : <span className="dim small">Unposted</span>
        }
        return <span className="dim">—</span>
      },
    },
    {
      key: 'skill',
      label: 'Skill & Exp',
      num: true,
      sort: (x) => x.skill,
      render: (x) => (
        <div>
          <b>{x.skill}/10</b>
          <div className="dim small">
            {Math.floor(experienceNow(s, x))} yrs exp{x.role === 'driver' ? ` · ${x.safety}★ safety` : ''}
          </div>
        </div>
      ),
    },
    {
      key: 'salary',
      label: 'Salary / mo',
      num: true,
      sort: (x) => x.salary,
      render: (x) => {
        const mkt = marketSalary(x.role, x.skill)
        const under = x.salary < mkt * 0.9
        const cap = autoFireCaps[x.role] ?? DEFAULT_AUTO_FIRE_SALARY[x.role]
        const isOver = autoFire.enabled && cap > 0 && x.salary > cap
        const isNear = autoFire.enabled && cap > 0 && !isOver && x.salary >= cap * 0.95
        return (
          <div>
            <b><M v={x.salary} /></b>
            {isOver && (
              <div className="bad small" title={`Exceeds ${ROLE_LABEL[x.role]} auto-fire cap of ${fmtCompact(cap)}/mo (will be auto-fired by HR)`}>
                Over cap ({fmtCompact(cap)})
              </div>
            )}
            {isNear && (
              <div className="warn small" title={`Near ${ROLE_LABEL[x.role]} auto-fire cap of ${fmtCompact(cap)}/mo`}>
                Near cap ({fmtCompact(cap)})
              </div>
            )}
            {under && <div className="bad small" title={`Market rate: ${fmtCompact(mkt)}`}>▼ Under market</div>}
          </div>
        )
      },
    },
    {
      key: 'morale',
      label: 'Morale',
      sort: (x) => x.morale,
      render: (x) => (
        <div className="row gap6">
          <Bar value={x.morale / 100} tone="auto" width={6} />
          <span className="small">{Math.round(x.morale)}%</span>
        </div>
      ),
    },
    {
      key: 'fatigue',
      label: 'Fatigue',
      sort: (x) => -(Number(x.fatigue) || 0),
      render: (x) => {
        if (x.role !== 'driver' && x.role !== 'conductor') return <span className="dim">—</span>
        const fat = Math.round(Number(x.fatigue) || 0)
        return (
          <div className="row gap6">
            <Bar value={fat / 100} tone={fat >= BAL.hrFatigueSwapAt ? 'bad' : fat >= BAL.fatigueAccidentThreshold ? 'warn' : 'auto'} width={6} />
            <span className={`small ${fat >= BAL.hrFatigueSwapAt ? 'bad' : fat >= BAL.fatigueAccidentThreshold ? 'warn' : 'dim'}`}>{fat}%</span>
          </div>
        )
      },
    },
    {
      key: 'post',
      label: 'Assigned Duty / Bus',
      sort: (x) => {
        const desk = deskOf(s, x.id)
        if (desk) return `aaa-${desk}`
        if ((s.workshop.mechanicIds ?? []).includes(x.id)) return 'bay'
        const bus = x.busId ? s.buses[x.busId] : undefined
        if (!bus) return x.role === 'driver' ? 'zzz-spare' : x.role === 'manager' ? 'zzz-unposted' : 'zzz-none'
        const sch = bus.scheduleId ? s.schedules[bus.scheduleId] : undefined
        return `${sch ? routeName(sch.routeId) : 'idle'} ${bus.reg}`
      },
      render: (x) => {
        const desk = deskOf(s, x.id)
        if (desk) {
          const unappoint = () => {
            if (desk === 'hr') g.appointHr(undefined)
            else if (desk === 'ops') g.appointOps(undefined)
            else if (desk === 'workshop') g.appointFleetManager(undefined)
            else if (desk === 'schedule') g.appointScheduleManager(undefined)
            else if (desk === 'cargo') g.appointCargoManager(undefined)
            else if (desk === 'documents') g.appointDocsManager(undefined)
            else if (desk === 'crm') g.appointCrm(undefined)
            else if (desk === 'accountant') g.appointAccountant(undefined)
          }
          return (
            <div>
              <span className="good">{DESK_LABEL[desk]}</span>{' '}
              <button className="small faint" onClick={unappoint}>unappoint</button>
            </div>
          )
        }
        if ((s.workshop.mechanicIds ?? []).includes(x.id)) {
          return (
            <div>
              <span className="good">Workshop Bay</span>{' '}
              <button className="small faint" onClick={() => g.unappointBayMechanic(x.id)}>release</button>
            </div>
          )
        }
        if (
          x.role === 'mechanic'
          && s.workshop.level > 0
          && (s.workshop.mechanicIds ?? []).filter(Boolean).length < s.workshop.bays
        ) {
          return <button className="small primary" onClick={() => g.appointBayMechanic(x.id)}>+ Assign to Bay</button>
        }
        if (x.role === 'manager') {
          return <span className="dim small">Unposted</span>
        }
        if (!CREW_ROLES.includes(x.role)) return <span className="dim small">Depot</span>
        if (!x.busId || !s.buses[x.busId]) {
          return x.role === 'driver' ? (
            <span className="pill info small">Spare Bench</span>
          ) : (
            <span className="pill warn small">Unassigned</span>
          )
        }
        const bus = s.buses[x.busId]
        const sch = bus.scheduleId ? s.schedules[bus.scheduleId] : undefined
        const covering = bus.coveringBusId ? s.buses[bus.coveringBusId] : undefined
        const routeLabel = covering
          ? `Spared · ${covering.reg}${sch ? ` · ${routeName(sch.routeId)} ${fmtClock(sch)}` : ''}`
          : sch
            ? `${routeName(sch.routeId)} ${fmtClock(sch)}`
            : 'Idle in yard'
        return (
          <div>
            <BusLink id={bus.id} reg={bus.reg} />
            <div className="dim small">{routeLabel}</div>
            {x.role === 'driver' && (
              <button className="small faint" style={{ marginTop: 2 }} onClick={() => g.appointSpareDriver(x.id)}>
                to bench
              </button>
            )}
          </div>
        )
      },
    },
    {
      key: 'act',
      label: 'Actions',
      render: (x) => (
        <span className="nowrap" style={{ display: 'inline-flex', gap: 4 }}>
          <button
            className="small"
            title={`Skill Training (+1 skill): ${fmtCompact(BAL.trainingCostPerStaff)}`}
            onClick={() => g.trainStaff(x.id)}
          >
            Train
          </button>
          {(x.role === 'driver' || x.role === 'co_driver') && x.drivingStyle === 'aggressive' && (
            <button
              className="small warn"
              title="Defensive driving retraining (₹15,000, 30 days leave) -> Cautious style"
              onClick={() => g.retrainDriver(x.id)}
            >
              Retrain
            </button>
          )}
          {(x.role === 'driver' || x.role === 'co_driver') && x.licenceClass !== 'HMV_HP' && (
            <button
              className="small"
              title="Upgrade licence to HMV_HP for heavy luxury coaches (₹20,000, 30 days leave)"
              onClick={() => g.upgradeLicence(x.id)}
            >
              + HP
            </button>
          )}
          <button
            className="small"
            title="+10% Salary Raise to boost morale & retention"
            onClick={() => g.raiseSalary(x.id, Math.round(x.salary * 1.1))}
          >
            +10%
          </button>
          <button
            className="small danger"
            title="Terminate employment immediately (no confirmation needed, 1 month severance paid)"
            onClick={() => {
              g.fire(x.id)
            }}
          >
            Fire
          </button>
        </span>
      ),
    },
  ]

  const poolCols: Col<Staff>[] = [
    {
      key: 'name',
      label: 'Candidate',
      sort: (c) => c.name,
      render: (c) => {
        const spec = candidateSpec(c)
        return (
          <div>
            <b>{c.name}</b>
            <div className={`small ${spec.tone === 'good' ? 'good' : spec.tone === 'warn' ? 'warn' : 'dim'}`}>
              {spec.label}
            </div>
          </div>
        )
      },
    },
    {
      key: 'role',
      label: 'Role',
      sort: (c) => ROLE_LABEL[c.role] ?? c.role,
      render: (c) => {
        const have = staffCountForRole(s, c.role)
        const need = autoHireRoleTarget(s, c.role)
        const short = need > have
        return (
          <div>
            <span className="pill small dim">{ROLE_LABEL[c.role] ?? c.role}</span>
            {short && (
              <div className="warn small" style={{ marginTop: 2 }}>
                Need {need - have} more
              </div>
            )}
          </div>
        )
      },
    },
    {
      key: 'skill',
      label: 'Skill',
      num: true,
      sort: (c) => c.skill * 100 + (c.safety ?? 0),
      render: (c) => (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <span className={skillTone(c.skill)}><b>{c.skill}</b><span className="dim">/10</span></span>
          <Bar value={c.skill / 10} width={5} tone="auto" />
          {(c.role === 'driver' || c.role === 'co_driver') && (
            <span className="dim small" title="Accident avoidance">Safety {c.safety}★</span>
          )}
        </div>
      ),
    },
    {
      key: 'exp',
      label: 'Exp',
      num: true,
      sort: (c) => c.experienceYears,
      render: (c) => <span>{c.experienceYears} yrs</span>,
    },
    {
      key: 'salary',
      label: 'Asking',
      num: true,
      sort: (c) => c.salary,
      render: (c) => {
        const market = marketSalary(c.role, c.skill)
        const delta = c.salary - market
        const deal = delta <= 0 ? 'good' : delta <= market * 0.08 ? 'dim' : 'warn'
        return (
          <div style={{ textAlign: 'right' }}>
            <b><M v={c.salary} /></b><span className="dim">/mo</span>
            <div className={`small ${deal}`} title={`Market for skill ${c.skill}: ${fmtCompact(market)}/mo`}>
              {delta === 0
                ? 'at market'
                : delta < 0
                  ? `${fmtCompact(-delta)} under`
                  : `${fmtCompact(delta)} over`}
            </div>
          </div>
        )
      },
    },
    {
      key: 'value',
      label: '₹/skill',
      num: true,
      sort: (c) => c.salary / Math.max(1, c.skill),
      render: (c) => (
        <span className="dim" title="Asking salary per skill point">
          <M v={Math.round(c.salary / Math.max(1, c.skill))} />
        </span>
      ),
    },
    {
      key: 'act',
      label: '',
      render: (c) => (
        <button
          className="small primary"
          title={`Hire ${c.name} at ${fmtCompact(c.salary)}/mo`}
          onClick={() => g.hire(c.id)}
        >
          Hire
        </button>
      ),
    },
  ]

  return (
    <>
      {/* Page Title & Navigation */}
      <PageHeader title="Staff" facts={<>{staff.length} on rolls · Payroll <M v={totalPayroll} />/mo · Head Office <M v={officeCost.total} />/mo</>}>
        <Tabs inline tabs={[
            ['payroll', `Rolls (${staff.length})`],
            ['hiring', `Hiring Pool (${s.hiringPool.length})`],
            ['desks', `Head Office (${officeStaff.totalFilled}/${officeStaff.totalRequired})`],
            ['planning', 'Crew Planning'],
          ] as const} value={activeTab} onChange={selectTab} />
      </PageHeader>

      <StatRow
        items={[
          { label: 'Staff', value: staff.length, title: `${drivers.length} drivers · ${conductors.length} conductors · ${mechanics.length} mechanics` },
          { label: 'Payroll/mo', value: <M v={totalPayroll} />, title: `Avg ${fmtCompact(staff.length > 0 ? Math.round(totalPayroll / staff.length) : 0)} per employee` },
          { label: 'Crew', value: `${activeCrewCount} active${restingCount > 0 ? ` · ${restingCount} rest` : ''}${onLeaveCount > 0 ? ` · ${onLeaveCount} leave` : ''}`, tone: est.drivers.total.current < est.drivers.total.required ? 'warn' : 'good', title: est.drivers.total.current < est.drivers.total.required ? 'Driver buffer needed' : 'Crew requirement covered' },
          { label: 'Desks', value: `${officeStaff.totalFilled}/${officeStaff.totalRequired}`, tone: officeStaff.tone as 'good' | 'warn' | 'bad', title: `${officeStaff.headsFilled}/8 heads · office rent ${fmtCompact(officeCost.total)}/mo` },
        ]}
      />

      {(() => {
        const avgMorale = drivers.length > 0 ? Math.round(drivers.reduce((x, d) => x + d.morale, 0) / drivers.length) : 100
        const dormTier = s.config?.driverDormitoryTier ?? 'none'
        const dormLabel = dormTier === 'ac_canteen' ? 'AC bunks and canteen' : dormTier === 'basic' ? 'depot bunks' : 'roadside'
        const festTier = s.config?.festivalBonusTier ?? (s.config?.festivalBonus === false ? 'skip' : 'full')
        const festLabel = festTier === 'full' ? 'full month' : festTier === 'half' ? 'half month' : festTier === 'gift' ? 'gift' : 'skipped'
        const strikeThreshold = dormTier === 'ac_canteen' ? 22 : dormTier === 'basic' ? 30 : BAL.strikeMoraleThreshold
        const onStrike = Boolean(s.world.strikeUntilDay && s.world.strikeUntilDay >= s.day)
        const strikeRisk = avgMorale < strikeThreshold + 10
        return (
          <>
            <StatRow
              items={[
                { label: 'Driver morale', value: `${avgMorale}%`, tone: avgMorale >= 70 ? 'good' : avgMorale >= 50 ? 'warn' : 'bad' },
                { label: 'Union', value: onStrike ? `strike ${s.world.strikeUntilDay - s.day + 1}d` : strikeRisk ? 'at risk' : 'calm', tone: onStrike || strikeRisk ? 'bad' : 'good', title: `Strike below ${strikeThreshold}% morale` },
                { label: 'Quarters', value: dormLabel, tone: dormTier === 'ac_canteen' ? 'good' : dormTier === 'basic' ? 'warn' : undefined },
                { label: 'Festival bonus', value: festLabel, tone: festTier !== 'skip' ? 'good' : 'bad' },
              ]}
            />
            <div className="mb12 right"><Link to="/settings?tab=welfare" className="small">Welfare and dorms ›</Link></div>
          </>
        )
      })()}

      {/* ========================================================================= */}
      {/* TAB 1: PAYROLL & EMPLOYEE DIRECTORY                                       */}
      {/* ========================================================================= */}
      {activeTab === 'payroll' && (
        <Panel flat title={`Rolls (${filteredStaff.length} of ${staff.length})`}>
          {/* HR Auto-Fire Status & Role Caps on Rolls */}
          <div
            style={{
              padding: '8px 10px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--bg2)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <label className="flex" style={{ alignItems: 'center', gap: 6, cursor: hr ? 'pointer' : 'not-allowed', fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={autoFire.enabled}
                    disabled={!hr}
                    onChange={(e) => g.setHrAutoFire({ enabled: e.target.checked })}
                  />
                  <span>HR Auto-Fire by Salary Cap</span>
                </label>
                {hr ? (
                  <span className={autoFire.enabled ? 'pill good small' : 'pill dim small'}>
                    {autoFire.enabled ? `Active (${hr.name})` : 'Disabled'}
                  </span>
                ) : (
                  <span className="pill warn small" title="Appoint an HR manager in Head Office to activate auto-fire">
                    Requires HR Manager
                  </span>
                )}
                <Hint text={"Auto-terminates employees when salary crosses role cap (no confirmation needed, 1 mo severance)."} />
              </div>
              <button
                type="button"
                className="small faint"
                onClick={() => setShowAutoFireRules(!showAutoFireRules)}
              >
                {showAutoFireRules ? '▲ Hide Role Caps' : 'Configure Role Caps'}
              </button>
            </div>

            {showAutoFireRules && (
              <RoleSalaryCapsEditor
                s={s}
                hr={hr}
                autoFire={autoFire}
                autoFireCaps={autoFireCaps}
                onSaveCaps={(caps) => g.setHrAutoFire({ maxSalaryByRole: caps })}
              />
            )}
          </div>
          <div
            style={{
              padding: '6px 10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              flexWrap: 'wrap',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <Tabs
              inline
              tabs={([['all', `All (${staff.length})`], ...STAFF_ROLES.map((r) => [r, `${ROLE_LABEL[r]} (${staff.filter((x) => x.role === r).length})`])]) as unknown as readonly (readonly [typeof roleFilter, string])[]}
              value={roleFilter}
              onChange={setRoleFilter}
            />

            <div className="row gap">
              {roleFilter !== 'all' && (
                <span className="dim small">Subtotal: <b className="good"><M v={shownPayroll} />/mo</b></span>
              )}
              <input
                type="text"
                placeholder="Search staff or bus..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ padding: '3px 8px', fontSize: 12, width: 170 }}
              />
            </div>
          </div>

          <DataTable
            cols={cols}
            rows={filteredStaff}
            rowKey={(x) => x.id}
            initialSort="salary"
            persistKey="staff-v2"
            empty={
              staff.length === 0
                ? 'Nobody on rolls. Hire candidates from the Hiring Pool tab.'
                : 'No staff members match the selected filter.'
            }
          />
        </Panel>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: HIRING POOL                                                        */}
      {/* ========================================================================= */}
      {activeTab === 'hiring' && (
        <Panel
          flat
          title="Candidates"
          right={
            <div className="flex" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className={`pill small ${poolDaysLeft <= 1 ? 'warn' : 'info'}`}>
                Refresh in {poolDaysLeft}d
              </span>
              <span className="dim small">
                {s.hiringPool.length} on market · weekly refresh
              </span>
            </div>
          }
        >
          {/* HR Auto-Hire Bar in Hiring Pool */}
          <div
            style={{
              padding: '8px 10px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--bg2)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <label className="flex" style={{ alignItems: 'center', gap: 6, cursor: hr ? 'pointer' : 'not-allowed', fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={auto.enabled}
                    disabled={!hr}
                    onChange={(e) => g.setHrAutoHire({ enabled: e.target.checked })}
                  />
                  <span>HR Auto-Hire from Pool</span>
                </label>
                {hr ? (
                  <span className={auto.enabled ? 'pill good small' : 'pill dim small'}>
                    {auto.enabled ? `Active (${hr.name}) · Mode: ${autoMode === 'match' ? 'Match Targets' : 'Unlimited'}` : 'Disabled'}
                  </span>
                ) : (
                  <span className="pill warn small" title="Appoint an HR manager in Head Office to activate auto-hire">
                    Requires HR Manager
                  </span>
                )}
                <Hint text={"Auto-hires matching role, skill, and driving style filters."} />
              </div>
              <button
                type="button"
                className="small faint"
                onClick={() => setShowAutoHireRules(!showAutoHireRules)}
              >
                {showAutoHireRules ? '▲ Hide Auto-Hire Rules' : 'Configure Auto-Hire Rules'}
              </button>
            </div>

            {showAutoHireRules && (
              <AutoHireRulesEditor
                auto={auto}
                autoMode={autoMode}
                g={g}
                s={s}
              />
            )}
          </div>
          <div
            style={{
              padding: '6px 10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              flexWrap: 'wrap',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <Tabs
              inline
              tabs={([['all', `All (${s.hiringPool.length})`], ...HIRE_POOL_ROLES.map((r) => {
                const short = autoHireRoleTarget(s, r) > staffCountForRole(s, r)
                return [r, `${ROLE_LABEL[r]} (${s.hiringPool.filter((x) => x.role === r).length})${short ? ' · short' : ''}`]
              })]) as unknown as readonly (readonly [typeof poolFilter, string])[]}
              value={poolFilter}
              onChange={setPoolFilter}
            />
            <div className="row gap wrap">
              {pool.length > 0 && (
                <span className="dim small">
                  {pool.length} shown · ask <b className="good"><M v={poolAskingTotal} />/mo</b>
                </span>
              )}
              <input
                type="text"
                placeholder="Search name, role, licence…"
                value={poolSearch}
                onChange={(e) => setPoolSearch(e.target.value)}
                style={{ padding: '3px 8px', fontSize: 12, width: 190 }}
              />
            </div>
          </div>

          <DataTable
            cols={poolCols}
            rows={pool}
            rowKey={(c) => c.id}
            initialSort="skill"
            persistKey="hiring-pool-v1"
            empty={
              s.hiringPool.length === 0
                ? 'Pool is empty. New candidates arrive on the weekly refresh.'
                : poolSearch.trim()
                  ? 'No candidates match this search.'
                  : 'No candidates in this role. Try All or wait for the next refresh.'
            }
          />
        </Panel>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: MANAGEMENT DESKS (HEAD OFFICE COMMAND CENTER)                      */}
      {/* ========================================================================= */}
      {activeTab === 'desks' && (
        <>
          <div className="row between mb12">
            <span className="muted" title={`Each desk adds ${fmtCompact(BAL.officeAdminPerManager)}/month of office overhead`}>
              {officeStaff.headsFilled} of 8 desks manned · {officeStaff.totalFilled}/{officeStaff.totalRequired} managers
            </span>
            <span className="muted">Office rent <b><M v={officeCost.total} />/mo</b> ({fmtCompact(officeCost.base)} base + {officeCost.assignedManagers} desks)</span>
          </div>

          <div className="grid-2" style={{ gap: 10 }}>
            {/* 1. HR Desk */}
            <Panel title="HR" info="Maintains crew morale, coaches skills over time (+1 skill every 6 months), manages rest rotations, and handles recruitment.">
              <div className="row between mb8">
                <div className="row gap">
                  <label className="dim small w60">Manager</label>
                  <ManagerPick s={s} value={s.company.hrId} desk="hr" onChange={(id) => g.appointHr(id)} />
                </div>
                <span className={hr ? 'pill good small' : 'pill warn small'}>
                  {hr ? `${hr.name}` : 'Unassigned'}
                </span>
              </div>

              <SpanMeter meter={meters.hr} unit={DESK_UNIT.hr} />
              <DeskAssistants s={s} desk="hr" />

              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <label className="flex" style={{ alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={auto.enabled}
                    disabled={!hr}
                    onChange={(e) => g.setHrAutoHire({ enabled: e.target.checked })}
                  />
                  <span>Auto-Hire</span>
                </label>

                <label className="flex" style={{ alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={!!s.company.hrAutoRaise}
                    disabled={!hr}
                    onChange={(e) => g.setHrAutoRaise(e.target.checked)}
                  />
                  <span>Auto-Raise (Matches market)</span>
                </label>

                <label className="flex" style={{ alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={autoFire.enabled}
                    disabled={!hr}
                    onChange={(e) => g.setHrAutoFire({ enabled: e.target.checked })}
                  />
                  <span>Auto-Fire by Salary Cap</span>
                </label>

                <button
                  type="button"
                  className="small faint"
                  onClick={() => selectTab('planning')}
                  title="Configure auto-hire filters and salary caps on Crew Planning"
                >
                  HR Rules → Planning
                </button>
              </div>

              {!hr && <div className="warn small">No HR appointed. Morale recovery and skill coaching operate at baseline.</div>}
            </Panel>

            {/* 2. Ops Desk */}
            <Panel title="Operations" info="Auto-assigns crew from payroll to bus schedules, balances duty hours, manages CMVR night rest.">
              <div className="row between mb8">
                <div className="row gap">
                  <label className="dim small w60">Manager</label>
                  <ManagerPick s={s} value={s.company.opsId} desk="ops" onChange={(id) => g.appointOps(id)} />
                </div>
                <span className={ops ? 'pill good small' : 'pill warn small'}>
                  {ops ? `${ops.name}` : 'Unassigned'}
                </span>
              </div>

              <SpanMeter meter={meters.ops} unit={DESK_UNIT.ops} />
              <DeskAssistants s={s} desk="ops" />

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 8 }}>
                <label className="flex" style={{ alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={!!s.company.opsAutoStaff}
                    disabled={!ops}
                    onChange={(e) => g.setOpsAutoStaff(e.target.checked)}
                  />
                  <span>Auto-Staff Crew to Schedules</span>
                </label>
                <button className="small faint" onClick={() => selectTab('planning')}>
                  View Crew Estimates →
                </button>
              </div>

              {!ops && <div className="warn small">No Ops manager. Must manually assign drivers and conductors to all buses.</div>}
            </Panel>

            {/* 3. Workshop Desk */}
            <Panel title="Workshop" info="Supervises mechanics, runs periodic maintenance, and covers idle buses during breakdowns.">
              <div className="row between mb8">
                <div className="row gap">
                  <label className="dim small w60">Manager</label>
                  <ManagerPick s={s} value={s.workshop.managerId} desk="workshop" onChange={(id) => g.appointFleetManager(id)} />
                </div>
                <span className={workshopMgr ? 'pill good small' : 'pill warn small'}>
                  {workshopMgr ? `${workshopMgr.name}` : 'Unassigned'}
                </span>
              </div>

              <SpanMeter meter={meters.workshop} unit={DESK_UNIT.workshop} />
              <DeskAssistants s={s} desk="workshop" />

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 6 }}>
                <span className="small">
                  Workshop Bays: <b>{(s.workshop.mechanicIds ?? []).filter(Boolean).length} / {s.workshop.bays} Staffed</b>
                </span>
                <Link to="/workshop" className="small">Open Workshop Page →</Link>
              </div>

              {!workshopMgr && <div className="warn small">No Workshop manager. Maintenance must be triggered manually.</div>}
            </Panel>

            {/* 4. Cargo Desk */}
            <Panel title="Cargo" info="Maximizes bus luggage boot parcel fill and handles corporate logistics contracts.">
              <div className="row between mb8">
                <div className="row gap">
                  <label className="dim small w60">Manager</label>
                  <ManagerPick s={s} value={s.company.cargoManagerId} desk="cargo" onChange={(id) => g.appointCargoManager(id)} />
                </div>
                <span className={cargoMgr ? 'pill good small' : 'pill warn small'}>
                  {cargoMgr ? `${cargoMgr.name}` : 'Unassigned'}
                </span>
              </div>

              <SpanMeter meter={meters.cargo} unit={DESK_UNIT.cargo} />
              <DeskAssistants s={s} desk="cargo" />

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 6 }}>
                <span className="small">
                  Mode: <b>{s.company.dedicatedCargoSubsidiary ? 'Logistics Subsidiary' : 'Coach Belly Parcels'}</b>
                </span>
                <Link to="/cargo" className="small">Open Cargo Tab →</Link>
              </div>

              <div className="dim small">
                {cargoMgr ? `Booking efficiency bonus +${Math.round(companyCargoFillRate(s) * 100)}% · Counter spot queueing active` : 'No Cargo manager. Parcel fill operates at basic floor rate.'}
              </div>
            </Panel>

            {/* 5. Schedule & Festival Planning */}
            <Panel title="Schedules and festivals" info="Manages peak festival schedules, selects idle coaches 3 days prior, auto-accepts group charters, and optimizes timetables.">
              <div className="row between mb8">
                <div className="row gap">
                  <label className="dim small w60">Manager</label>
                  <ManagerPick s={s} value={s.company.scheduleManagerId} desk="schedule" onChange={(id) => g.appointScheduleManager(id)} />
                </div>
                <span className={scheduleMgr ? 'pill good small' : 'pill warn small'}>
                  {scheduleMgr ? `${scheduleMgr.name}` : 'Unassigned'}
                </span>
              </div>

              <SpanMeter meter={meters.schedule} unit={DESK_UNIT.schedule} />
              <DeskAssistants s={s} desk="schedule" />

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 6 }}>
                <span />
                <Link to="/schedules" className="small">View Schedules →</Link>
              </div>

              {!scheduleMgr && <div className="warn small">No Schedule manager. Extra festival coach rostering requires an appointed Schedule manager.</div>}
            </Panel>

            {/* 6. Compliance & Documents */}
            <Panel title="Compliance and documents" info="Handles RTO paperwork, halves route permit rejections, and auto-renews expiring docs.">
              <div className="row between mb8">
                <div className="row gap">
                  <label className="dim small w60">Manager</label>
                  <ManagerPick s={s} value={s.company.docsManagerId} desk="documents" onChange={(id) => g.appointDocsManager(id)} />
                </div>
                <span className={docsMgr ? 'pill good small' : 'pill warn small'}>
                  {docsMgr ? `${docsMgr.name}` : 'Unassigned'}
                </span>
              </div>

              <SpanMeter meter={meters.documents} unit={DESK_UNIT.documents} />
              <DeskAssistants s={s} desk="documents" />

              {!docsMgr && <div className="warn small">No Documents manager. Expiring documents must be renewed manually in Fleet.</div>}
            </Panel>

            {/* 7. CRM & Grievances */}
            <Panel title="Customer relations" info="Resolves passenger disputes, protects operator star ratings, and processes refunds.">
              <div className="row between mb8">
                <div className="row gap">
                  <label className="dim small w60">Manager</label>
                  <ManagerPick s={s} value={s.company.crmId} desk="crm" onChange={(id) => g.appointCrm(id)} />
                </div>
                <span className={crmMgr ? 'pill good small' : 'pill warn small'}>
                  {crmMgr ? `${crmMgr.name}` : 'Unassigned'}
                </span>
              </div>

              <SpanMeter meter={meters.crm} unit={DESK_UNIT.crm} />
              <DeskAssistants s={s} desk="crm" />

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 6 }}>
                <label className="dim small w60">Policy</label>
                <select
                  value={s.company.crmPolicy ?? 'ask'}
                  onChange={(e) => g.setCrmPolicy(e.target.value as any)}
                  style={{ padding: '2px 6px', fontSize: 12 }}
                >
                  <option value="ask">Ask (Manual review)</option>
                  <option value="refund">Auto-refund small (≤ ₹500)</option>
                  <option value="suggest_refund">Suggest refund (Auto-settle)</option>
                  <option value="dispute">Dispute all claims</option>
                </select>
                <span className="dim small">
                  {s.company.grievanceCount ? `${s.company.grievanceCount} open` : '0 open disputes'}
                </span>
              </div>

              {!crmMgr && <div className="warn small">No CRM manager. Customer complaints remain open until addressed.</div>}
            </Panel>

            {/* 8. Accounts & Finance */}
            <Panel title="Accounts and tax" info="Remits monthly GST on time, files quarterly TDS, handles insurance claims, clears cheque bounces.">
              <div className="row between mb8">
                <div className="row gap">
                  <label className="dim small w60">Manager</label>
                  <ManagerPick s={s} value={s.company.accountantId} desk="accountant" onChange={(id) => g.appointAccountant(id)} />
                </div>
                <span className={accountantMgr ? 'pill good small' : 'pill warn small'}>
                  {accountantMgr ? `${accountantMgr.name}` : 'Unassigned'}
                </span>
              </div>

              <SpanMeter meter={meters.accountant} unit={DESK_UNIT.accountant} />
              <DeskAssistants s={s} desk="accountant" />

              {!accountantMgr && <div className="warn small">No Accountant. Must file taxes and insurance claims manually in Finance.</div>}
            </Panel>

            {/* 9. Charters & Special Hire */}
            <Panel title="Charters" info="Negotiates group hire contracts, optimizes quotes according to pricing policy, and coordinates dedicated charter fleet.">
              <div className="row between mb8">
                <div className="row gap">
                  <label className="dim small w60">Manager</label>
                  <ManagerPick s={s} value={s.company.charterManagerId} desk="charter" onChange={(id) => g.appointCharterManager(id)} />
                </div>
                <span className={charterMgr ? 'pill good small' : 'pill warn small'}>
                  {charterMgr ? `${charterMgr.name}` : 'Unassigned'}
                </span>
              </div>

              <SpanMeter meter={meters.charter} unit={DESK_UNIT.charter} />
              <DeskAssistants s={s} desk="charter" />

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 6 }}>
                <span />
                <Link to="/charters" className="small">Charters Desk →</Link>
              </div>

              {charterMgr && (
                <div style={{ marginTop: 6, marginBottom: 6 }}>
                  <label className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={s.company.charterConfig?.autoAccept ?? false}
                      onChange={(e) => g.setCharterAutoAccept(e.target.checked)}
                    />
                    <span>Auto-assign best contracts</span>
                  </label>
                </div>
              )}

              {!charterMgr && <div className="warn small">No Charter Manager. Must review and dispatch contracts manually in Charters.</div>}
            </Panel>
          </div>
        </>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: CREW PLANNING & CMVR COMPLIANCE                                    */}
      {/* ========================================================================= */}
      {activeTab === 'planning' && (
        <div className="stack12">
          <Panel
            title="Auto-hire rules"
            flat
            right={
              <div className="flex" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <label className="flex" style={{ alignItems: 'center', gap: 6, cursor: hr ? 'pointer' : 'not-allowed' }}>
                  <input
                    type="checkbox"
                    checked={auto.enabled}
                    disabled={!hr}
                    onChange={(e) => g.setHrAutoHire({ enabled: e.target.checked })}
                  />
                  <span className="small">Enabled</span>
                </label>
                {hr ? (
                  <span className={auto.enabled ? 'pill good small' : 'pill dim small'}>
                    {auto.enabled ? `Active · ${hr.name}` : 'Disabled'}
                  </span>
                ) : (
                  <span className="pill warn small">Needs HR Manager</span>
                )}
                <span className="dim small">
                  Office target {officeStaff.totalFilled}/{officeStaff.totalRequired} · Bays {mechanics.length}/{s.workshop.bays ?? 0}
                </span>
              </div>
            }
          >
            <div style={{ padding: 10 }}>
              <AutoHireRulesEditor auto={auto} autoMode={autoMode} g={g} s={s} />
            </div>
          </Panel>

          <Panel
            title="Salary caps (auto-fire)"
            flat
            right={
              <div className="flex" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <label className="flex" style={{ alignItems: 'center', gap: 6, cursor: hr ? 'pointer' : 'not-allowed' }}>
                  <input
                    type="checkbox"
                    checked={autoFire.enabled}
                    disabled={!hr}
                    onChange={(e) => g.setHrAutoFire({ enabled: e.target.checked })}
                  />
                  <span className="small">Enabled</span>
                </label>
                {hr ? (
                  <span className={autoFire.enabled ? 'pill good small' : 'pill dim small'}>
                    {autoFire.enabled ? 'Active' : 'Disabled'}
                  </span>
                ) : (
                  <span className="pill warn small">Needs HR Manager</span>
                )}
              </div>
            }
          >
            <div style={{ padding: 10 }}>
              <RoleSalaryCapsEditor
                s={s}
                hr={hr}
                autoFire={autoFire}
                autoFireCaps={autoFireCaps}
                onSaveCaps={(caps) => g.setHrAutoFire({ maxSalaryByRole: caps })}
              />
            </div>
          </Panel>

          <Panel title="Desk coverage" flat>
            <div style={{ padding: 12 }}>
              <DataTable
                rows={Object.values(spanMeters(s)).sort((a, b) => a.coverage - b.coverage)}
                rowKey={(m) => m.desk}
                cols={[
                  { key: 'desk', label: 'Desk', render: (m) => <b>{DESK_LABEL[m.desk]}</b> },
                  { key: 'demand', label: 'Demand', render: (m) => `${qty(m.demand)} ${DESK_UNIT[m.desk]}` },
                  { key: 'capacity', label: 'Capacity', render: (m) => `${qty(m.capacity)} ${DESK_UNIT[m.desk]}` },
                  { key: 'coverage', label: 'Coverage', render: (m) => <span className={m.coverage >= 1 ? 'good' : m.coverage >= 0.6 ? 'warn' : 'bad'}>{Math.round(m.coverage * 100)}%</span> },
                  {
                    key: 'unattended',
                    label: 'Unattended',
                    render: (m) => {
                      const gap = Math.max(0, m.demand - m.capacity)
                      return gap > 1e-9 ? <span className="bad">+{qty(gap)}</span> : <span className="dim">0</span>
                    },
                  },
                  { key: 'assistants', label: 'Assistants Needed', render: (m) => m.assistantsToCover > 0 ? <span className="warn">+{m.assistantsToCover}</span> : <span className="dim">0</span> },
                ]}
              />
            </div>
          </Panel>

          <div className="grid-2" style={{ gap: 12 }}>
            <Panel title="Crew needed" flat>
              <div style={{ padding: 12 }}>
                <CrewHeadcountTable s={s} />
              </div>
            </Panel>

            <Panel title="CMVR rules" flat>
              <table className="data">
                <tbody>
                  <tr><td><b>8 hours</b></td><td className="muted">Most a driver can drive in 24 hours</td></tr>
                  <tr><td><b>Night rest</b></td><td className="muted">8 hours after an overnight shift</td></tr>
                  <tr><td><b>Co-driver</b></td><td className="muted">Needed beyond 9 hours or 450 km</td></tr>
                  <tr><td><b>HMV_HP</b></td><td className="muted">Licence for Volvo 9400/9600 and Scania</td></tr>
                  <tr><td><b>Relief bench</b></td><td className="muted">Keep about 15% spare drivers for leave</td></tr>
                </tbody>
              </table>
            </Panel>
          </div>
        </div>
      )}
    </>
  )
}
