export interface TabDef {
  path: string
  label: string
  name: string
  key: string
  description: string
  /** Tabs with the same group sit together; a divider shows between groups. */
  group: number
}

export const TABS: TabDef[] = [
  { path: '/', label: 'Dash', name: 'Dashboard', key: '1', description: 'Overview, quick metrics, daily summary', group: 0 },
  { path: '/inbox', label: 'Inbox', name: 'Inbox', key: 'i', description: '30-day alerts, events, regulatory notices', group: 0 },
  { path: '/routes', label: 'Routes', name: 'Routes', key: '4', description: 'Permits, corridors, stop pricing', group: 1 },
  { path: '/schedules', label: 'Sched', name: 'Schedules', key: '5', description: 'Timetables, bus dispatch, slots', group: 1 },
  { path: '/trips', label: 'Trips', name: 'Trip Board', key: '6', description: 'Live departures, pricing, passenger PSS', group: 1 },
  { path: '/fleet', label: 'Fleet', name: 'Fleet', key: '2', description: 'Bus roster, health, documents & tax', group: 2 },
  { path: '/market', label: 'Market', name: 'Market', key: '3', description: 'New & used coaches, lease, attachment deals', group: 2 },
  { path: '/workshop', label: 'Wkshp', name: 'Workshop', key: '8', description: 'Tiered servicing, maintenance bays, mechanics', group: 2 },
  { path: '/staff', label: 'Staff', name: 'Staff', key: '7', description: 'Drivers, conductors, managerial desk staff', group: 3 },
  { path: '/cargo', label: 'Cargo', name: 'Cargo Desk', key: 'c', description: 'Courier contracts, parcel weight/volume logistics', group: 3 },
  { path: '/charters', label: 'Chtr', name: 'Charters', key: 'h', description: 'Pilgrimage, wedding & group block contracts', group: 3 },
  { path: '/lounges', label: 'Lounge', name: 'Passenger Lounges', key: 'u', description: 'City boarding lounges, waiting areas, snack sales & tour offices', group: 3 },
  { path: '/money', label: 'Money', name: 'Money & Banking', key: '0', description: 'Cash flow, P&L, MSME schemes, balance sheet', group: 4 },
  { path: '/analytics', label: 'Anlyt', name: 'Analytics', key: 'a', description: 'Route economics, seat-km margins, tier costs', group: 4 },
  { path: '/settings', label: 'Cfg', name: 'Settings', key: ',', description: 'Policies, app upgrades, game options', group: 5 },
]

export const GLOBAL_SHORTCUTS = [
  { key: 'N', action: 'Advance 1 day' },
  { key: 'W', action: 'Fast-forward 7 days (skip week)' },
  { key: 'S', action: 'Quick-save game' },
]
