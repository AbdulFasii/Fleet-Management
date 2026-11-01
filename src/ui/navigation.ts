export interface TabDef {
  path: string
  label: string
  name: string
  key: string
  description: string
}

export const TABS: TabDef[] = [
  { path: '/', label: 'Dash', name: 'Dashboard', key: '1', description: 'Overview, quick metrics, daily summary' },
  { path: '/fleet', label: 'Fleet', name: 'Fleet', key: '2', description: 'Bus roster, health, documents & tax' },
  { path: '/market', label: 'Market', name: 'Market', key: '3', description: 'New & used coaches, lease, attachment deals' },
  { path: '/routes', label: 'Routes', name: 'Routes', key: '4', description: 'Permits, corridors, stop pricing' },
  { path: '/schedules', label: 'Sched', name: 'Schedules', key: '5', description: 'Timetables, bus dispatch, slots' },
  { path: '/trips', label: 'Trips', name: 'Trip Board', key: '6', description: 'Live departures, pricing, passenger PSS' },
  { path: '/staff', label: 'Staff', name: 'Staff', key: '7', description: 'Drivers, conductors, managerial desk staff' },
  { path: '/cargo', label: 'Cargo', name: 'Cargo Desk', key: 'c', description: 'Courier contracts, parcel weight/volume logistics' },
  { path: '/workshop', label: 'Wkshp', name: 'Workshop', key: '8', description: 'Tiered servicing, maintenance bays, mechanics' },
  { path: '/money', label: 'Money', name: 'Money & Banking', key: '0', description: 'Cash flow, P&L, MSME schemes, balance sheet' },
  { path: '/analytics', label: 'Anlyt', name: 'Analytics', key: 'a', description: 'Route economics, seat-km margins, tier costs' },
  { path: '/inbox', label: 'Inbox', name: 'Inbox', key: 'i', description: '30-day alerts, events, regulatory notices' },
  { path: '/settings', label: 'Cfg', name: 'Settings', key: ',', description: 'Policies, app upgrades, game options' },
]

export const GLOBAL_SHORTCUTS = [
  { key: 'N', action: 'Advance 1 day' },
  { key: 'W', action: 'Fast-forward 7 days (skip week)' },
  { key: 'S', action: 'Quick-save game' },
]
