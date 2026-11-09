import type { City, CargoCargoType } from '../types'

export type FreightTier = 'metro' | 'industrial' | 'commercial' | 'agri' | 'pilgrim' | 'port' | 'town'

export interface CityFreightProfile {
  tier: FreightTier
  shipIndex: number // 0.15 - 1.0: outbound freight generated
  attractIndex: number // 0.15 - 1.0: inbound freight attracted
  mixBias: Record<CargoCargoType, number> // default commodity weights
}

export const CITIES: Record<string, City> = {
  // Big metros — many suburb / depot pickups
  maa: { id: 'maa', name: 'Chennai', state: 'Tamil Nadu', metro: 0.85, pickups: 6 },
  blr: { id: 'blr', name: 'Bengaluru', state: 'Karnataka', metro: 0.95, pickups: 6 },
  hyd: { id: 'hyd', name: 'Hyderabad', state: 'Telangana', metro: 0.9, pickups: 6 },
  mum: { id: 'mum', name: 'Mumbai', state: 'Maharashtra', metro: 1.0, pickups: 7 },
  pnq: { id: 'pnq', name: 'Pune', state: 'Maharashtra', metro: 0.8, pickups: 5 },
  // Large cities
  koc: { id: 'koc', name: 'Kochi', state: 'Kerala', metro: 0.5, pickups: 4 },
  cbe: { id: 'cbe', name: 'Coimbatore', state: 'Tamil Nadu', metro: 0.45, pickups: 4 },
  viz: { id: 'viz', name: 'Visakhapatnam', state: 'Andhra Pradesh', metro: 0.4, pickups: 4 },
  trv: { id: 'trv', name: 'Thiruvananthapuram', state: 'Kerala', metro: 0.4, pickups: 3 },
  // Mid-size
  mdu: { id: 'mdu', name: 'Madurai', state: 'Tamil Nadu', metro: 0.3, pickups: 3 },
  try: { id: 'try', name: 'Tiruchirappalli', state: 'Tamil Nadu', metro: 0.28, pickups: 3 },
  vga: { id: 'vga', name: 'Vijayawada', state: 'Andhra Pradesh', metro: 0.35, pickups: 3 },
  mys: { id: 'mys', name: 'Mysuru', state: 'Karnataka', metro: 0.3, pickups: 3 },
  clt: { id: 'clt', name: 'Kozhikode', state: 'Kerala', metro: 0.32, pickups: 3 },
  tcr: { id: 'tcr', name: 'Thrissur', state: 'Kerala', metro: 0.32, pickups: 3 },
  pkd: { id: 'pkd', name: 'Palakkad', state: 'Kerala', metro: 0.25, pickups: 2 },
  knr: { id: 'knr', name: 'Kannur', state: 'Kerala', metro: 0.28, pickups: 3 },
  mlr: { id: 'mlr', name: 'Mangaluru', state: 'Karnataka', metro: 0.28, pickups: 3 },
  goa: { id: 'goa', name: 'Panaji (Goa)', state: 'Goa', metro: 0.25, pickups: 3 },
  tir: { id: 'tir', name: 'Tirupati', state: 'Andhra Pradesh', metro: 0.2, pickups: 3 },
  // Smaller towns — fewer formal boards
  slm: { id: 'slm', name: 'Salem', state: 'Tamil Nadu', metro: 0.22, pickups: 2 },
  ten: { id: 'ten', name: 'Tirunelveli', state: 'Tamil Nadu', metro: 0.18, pickups: 2 },
  erd: { id: 'erd', name: 'Erode', state: 'Tamil Nadu', metro: 0.22, pickups: 2 },
  dgl: { id: 'dgl', name: 'Dindigul', state: 'Tamil Nadu', metro: 0.22, pickups: 2 },
  tnj: { id: 'tnj', name: 'Thanjavur', state: 'Tamil Nadu', metro: 0.2, pickups: 2 },
  tvr: { id: 'tvr', name: 'Thiruvarur', state: 'Tamil Nadu', metro: 0.16, pickups: 2 },
  rmd: { id: 'rmd', name: 'Ramanathapuram', state: 'Tamil Nadu', metro: 0.14, pickups: 2 },
  nlr: { id: 'nlr', name: 'Nellore', state: 'Andhra Pradesh', metro: 0.16, pickups: 2 },
  kno: { id: 'kno', name: 'Kurnool', state: 'Andhra Pradesh', metro: 0.22, pickups: 2 },
  rjy: { id: 'rjy', name: 'Rajahmundry', state: 'Andhra Pradesh', metro: 0.25, pickups: 3 },
  hbl: { id: 'hbl', name: 'Hubballi', state: 'Karnataka', metro: 0.35, pickups: 3 },
  qln: { id: 'qln', name: 'Kollam', state: 'Kerala', metro: 0.25, pickups: 3 },
  pdy: { id: 'pdy', name: 'Puducherry', state: 'Puducherry', metro: 0.2, pickups: 2 },
  kkm: { id: 'kkm', name: 'Kanyakumari', state: 'Tamil Nadu', metro: 0.08, pickups: 2 },
  // Northern & Western hubs
  del: { id: 'del', name: 'Delhi NCR', state: 'Delhi', metro: 1.0, pickups: 7 },
  jai: { id: 'jai', name: 'Jaipur', state: 'Rajasthan', metro: 0.55, pickups: 4 },
  ixc: { id: 'ixc', name: 'Chandigarh', state: 'Chandigarh', metro: 0.45, pickups: 4 },
  lko: { id: 'lko', name: 'Lucknow', state: 'Uttar Pradesh', metro: 0.6, pickups: 4 },
  agr: { id: 'agr', name: 'Agra', state: 'Uttar Pradesh', metro: 0.35, pickups: 3 },
  amd: { id: 'amd', name: 'Ahmedabad', state: 'Gujarat', metro: 0.7, pickups: 5 },
  nag: { id: 'nag', name: 'Nagpur', state: 'Maharashtra', metro: 0.5, pickups: 4 },
  bbs: { id: 'bbs', name: 'Bhubaneswar', state: 'Odisha', metro: 0.45, pickups: 4 },
  // Added with the round-to-100 corridors
  idr: { id: 'idr', name: 'Indore', state: 'Madhya Pradesh', metro: 0.55, pickups: 4 },
  klp: { id: 'klp', name: 'Kolhapur', state: 'Maharashtra', metro: 0.3, pickups: 3 },
  bgm: { id: 'bgm', name: 'Belagavi', state: 'Karnataka', metro: 0.3, pickups: 3 },
  tut: { id: 'tut', name: 'Thoothukudi', state: 'Tamil Nadu', metro: 0.25, pickups: 2 },
  ktm: { id: 'ktm', name: 'Kottayam', state: 'Kerala', metro: 0.25, pickups: 3 },
  udp: { id: 'udp', name: 'Udupi', state: 'Karnataka', metro: 0.2, pickups: 2 },
  kkd: { id: 'kkd', name: 'Karaikudi', state: 'Tamil Nadu', metro: 0.15, pickups: 2 },
  klb: { id: 'klb', name: 'Kalaburagi', state: 'Karnataka', metro: 0.35, pickups: 3 },
  hpt: { id: 'hpt', name: 'Hosapete (Hampi)', state: 'Karnataka', metro: 0.28, pickups: 3 },
  wyd: { id: 'wyd', name: 'Wayanad (Kalpetta)', state: 'Kerala', metro: 0.25, pickups: 3 },
  ccu: { id: 'ccu', name: 'Kolkata', state: 'West Bengal', metro: 0.9, pickups: 6 },
  smg: { id: 'smg', name: 'Shivamogga', state: 'Karnataka', metro: 0.2, pickups: 2 },
  rpr: { id: 'rpr', name: 'Raipur', state: 'Chhattisgarh', metro: 0.4, pickups: 3 },
  bhp: { id: 'bhp', name: 'Bhopal', state: 'Madhya Pradesh', metro: 0.5, pickups: 4 },
}

export function cityName(id: string): string {
  return CITIES[id]?.name ?? id
}

export function cityPickups(id: string): number {
  return CITIES[id]?.pickups ?? 3
}

export const CITY_FREIGHT: Record<string, CityFreightProfile> = {
  maa: { tier: 'metro', shipIndex: 0.95, attractIndex: 0.95, mixBias: { hardware: 0.35, textiles: 0.20, fmcg: 0.25, mixed: 0.15, agri: 0.05 } },
  blr: { tier: 'metro', shipIndex: 0.90, attractIndex: 1.00, mixBias: { fmcg: 0.35, mixed: 0.30, hardware: 0.20, textiles: 0.10, agri: 0.05 } },
  hyd: { tier: 'metro', shipIndex: 0.85, attractIndex: 0.90, mixBias: { fmcg: 0.35, hardware: 0.25, mixed: 0.25, textiles: 0.10, agri: 0.05 } },
  mum: { tier: 'metro', shipIndex: 1.00, attractIndex: 1.00, mixBias: { fmcg: 0.30, textiles: 0.30, hardware: 0.20, mixed: 0.15, agri: 0.05 } },
  pnq: { tier: 'industrial', shipIndex: 0.85, attractIndex: 0.80, mixBias: { hardware: 0.50, fmcg: 0.20, mixed: 0.20, textiles: 0.05, agri: 0.05 } },
  koc: { tier: 'port', shipIndex: 0.75, attractIndex: 0.80, mixBias: { mixed: 0.30, fmcg: 0.30, agri: 0.20, hardware: 0.15, textiles: 0.05 } },
  cbe: { tier: 'industrial', shipIndex: 0.85, attractIndex: 0.50, mixBias: { textiles: 0.50, hardware: 0.30, mixed: 0.10, fmcg: 0.05, agri: 0.05 } },
  viz: { tier: 'port', shipIndex: 0.70, attractIndex: 0.65, mixBias: { hardware: 0.45, mixed: 0.25, agri: 0.15, fmcg: 0.10, textiles: 0.05 } },
  trv: { tier: 'commercial', shipIndex: 0.40, attractIndex: 0.65, mixBias: { fmcg: 0.40, mixed: 0.35, hardware: 0.10, textiles: 0.10, agri: 0.05 } },
  mdu: { tier: 'commercial', shipIndex: 0.55, attractIndex: 0.60, mixBias: { textiles: 0.35, agri: 0.25, mixed: 0.20, fmcg: 0.15, hardware: 0.05 } },
  try: { tier: 'industrial', shipIndex: 0.55, attractIndex: 0.50, mixBias: { hardware: 0.45, mixed: 0.25, fmcg: 0.15, agri: 0.10, textiles: 0.05 } },
  vga: { tier: 'commercial', shipIndex: 0.65, attractIndex: 0.65, mixBias: { agri: 0.40, fmcg: 0.30, mixed: 0.15, hardware: 0.10, textiles: 0.05 } },
  mys: { tier: 'commercial', shipIndex: 0.45, attractIndex: 0.55, mixBias: { mixed: 0.35, fmcg: 0.30, textiles: 0.15, hardware: 0.10, agri: 0.10 } },
  clt: { tier: 'commercial', shipIndex: 0.50, attractIndex: 0.60, mixBias: { fmcg: 0.35, mixed: 0.30, agri: 0.25, textiles: 0.05, hardware: 0.05 } },
  tcr: { tier: 'commercial', shipIndex: 0.45, attractIndex: 0.50, mixBias: { fmcg: 0.35, mixed: 0.35, textiles: 0.15, agri: 0.10, hardware: 0.05 } },
  pkd: { tier: 'agri', shipIndex: 0.40, attractIndex: 0.35, mixBias: { agri: 0.55, mixed: 0.20, fmcg: 0.15, hardware: 0.05, textiles: 0.05 } },
  knr: { tier: 'commercial', shipIndex: 0.40, attractIndex: 0.45, mixBias: { textiles: 0.40, mixed: 0.30, fmcg: 0.20, agri: 0.05, hardware: 0.05 } },
  mlr: { tier: 'port', shipIndex: 0.60, attractIndex: 0.55, mixBias: { mixed: 0.35, agri: 0.30, hardware: 0.20, fmcg: 0.10, textiles: 0.05 } },
  goa: { tier: 'commercial', shipIndex: 0.35, attractIndex: 0.60, mixBias: { fmcg: 0.45, mixed: 0.35, agri: 0.10, hardware: 0.05, textiles: 0.05 } },
  tir: { tier: 'pilgrim', shipIndex: 0.25, attractIndex: 0.65, mixBias: { fmcg: 0.45, mixed: 0.35, agri: 0.10, textiles: 0.05, hardware: 0.05 } },
  slm: { tier: 'industrial', shipIndex: 0.65, attractIndex: 0.40, mixBias: { hardware: 0.45, textiles: 0.25, agri: 0.20, mixed: 0.08, fmcg: 0.02 } },
  ten: { tier: 'town', shipIndex: 0.30, attractIndex: 0.30, mixBias: { agri: 0.45, mixed: 0.25, fmcg: 0.15, textiles: 0.10, hardware: 0.05 } },
  erd: { tier: 'industrial', shipIndex: 0.70, attractIndex: 0.35, mixBias: { textiles: 0.60, agri: 0.25, mixed: 0.10, hardware: 0.03, fmcg: 0.02 } },
  dgl: { tier: 'commercial', shipIndex: 0.40, attractIndex: 0.35, mixBias: { hardware: 0.40, agri: 0.30, mixed: 0.15, textiles: 0.10, fmcg: 0.05 } },
  tnj: { tier: 'pilgrim', shipIndex: 0.30, attractIndex: 0.40, mixBias: { agri: 0.40, fmcg: 0.25, mixed: 0.20, textiles: 0.10, hardware: 0.05 } },
  tvr: { tier: 'agri', shipIndex: 0.30, attractIndex: 0.30, mixBias: { agri: 0.50, mixed: 0.25, fmcg: 0.15, textiles: 0.05, hardware: 0.05 } },
  rmd: { tier: 'town', shipIndex: 0.25, attractIndex: 0.30, mixBias: { agri: 0.45, mixed: 0.25, fmcg: 0.20, textiles: 0.05, hardware: 0.05 } },
  nlr: { tier: 'agri', shipIndex: 0.45, attractIndex: 0.35, mixBias: { agri: 0.60, mixed: 0.20, fmcg: 0.10, hardware: 0.05, textiles: 0.05 } },
  kno: { tier: 'agri', shipIndex: 0.40, attractIndex: 0.35, mixBias: { agri: 0.50, mixed: 0.25, fmcg: 0.15, hardware: 0.05, textiles: 0.05 } },
  rjy: { tier: 'agri', shipIndex: 0.45, attractIndex: 0.40, mixBias: { agri: 0.50, mixed: 0.25, fmcg: 0.15, hardware: 0.05, textiles: 0.05 } },
  hbl: { tier: 'commercial', shipIndex: 0.55, attractIndex: 0.55, mixBias: { mixed: 0.35, fmcg: 0.30, hardware: 0.20, agri: 0.10, textiles: 0.05 } },
  qln: { tier: 'port', shipIndex: 0.45, attractIndex: 0.40, mixBias: { agri: 0.50, mixed: 0.25, fmcg: 0.15, hardware: 0.05, textiles: 0.05 } },
  pdy: { tier: 'commercial', shipIndex: 0.35, attractIndex: 0.45, mixBias: { fmcg: 0.40, mixed: 0.30, textiles: 0.15, hardware: 0.10, agri: 0.05 } },
  kkm: { tier: 'town', shipIndex: 0.18, attractIndex: 0.25, mixBias: { agri: 0.40, mixed: 0.30, fmcg: 0.20, textiles: 0.05, hardware: 0.05 } },
  del: { tier: 'metro', shipIndex: 1.00, attractIndex: 1.00, mixBias: { fmcg: 0.35, mixed: 0.25, textiles: 0.20, hardware: 0.15, agri: 0.05 } },
  jai: { tier: 'commercial', shipIndex: 0.65, attractIndex: 0.65, mixBias: { textiles: 0.45, mixed: 0.25, hardware: 0.15, fmcg: 0.10, agri: 0.05 } },
  ixc: { tier: 'commercial', shipIndex: 0.55, attractIndex: 0.65, mixBias: { fmcg: 0.40, mixed: 0.30, hardware: 0.15, textiles: 0.10, agri: 0.05 } },
  lko: { tier: 'commercial', shipIndex: 0.60, attractIndex: 0.70, mixBias: { textiles: 0.35, fmcg: 0.30, mixed: 0.20, hardware: 0.10, agri: 0.05 } },
  agr: { tier: 'commercial', shipIndex: 0.50, attractIndex: 0.50, mixBias: { hardware: 0.35, textiles: 0.30, mixed: 0.20, fmcg: 0.10, agri: 0.05 } },
  amd: { tier: 'metro', shipIndex: 0.90, attractIndex: 0.85, mixBias: { textiles: 0.45, hardware: 0.25, fmcg: 0.15, mixed: 0.10, agri: 0.05 } },
  nag: { tier: 'industrial', shipIndex: 0.70, attractIndex: 0.65, mixBias: { hardware: 0.40, fmcg: 0.30, mixed: 0.15, textiles: 0.10, agri: 0.05 } },
  bbs: { tier: 'commercial', shipIndex: 0.55, attractIndex: 0.60, mixBias: { agri: 0.35, fmcg: 0.30, mixed: 0.20, hardware: 0.10, textiles: 0.05 } },
  idr: { tier: 'commercial', shipIndex: 0.65, attractIndex: 0.65, mixBias: { fmcg: 0.35, textiles: 0.20, mixed: 0.20, hardware: 0.15, agri: 0.10 } },
  klp: { tier: 'agri', shipIndex: 0.50, attractIndex: 0.40, mixBias: { agri: 0.40, textiles: 0.20, hardware: 0.20, mixed: 0.15, fmcg: 0.05 } },
  bgm: { tier: 'commercial', shipIndex: 0.45, attractIndex: 0.45, mixBias: { agri: 0.30, hardware: 0.25, mixed: 0.25, fmcg: 0.15, textiles: 0.05 } },
  tut: { tier: 'port', shipIndex: 0.55, attractIndex: 0.45, mixBias: { mixed: 0.30, agri: 0.30, hardware: 0.20, fmcg: 0.15, textiles: 0.05 } },
  ktm: { tier: 'commercial', shipIndex: 0.40, attractIndex: 0.50, mixBias: { agri: 0.40, fmcg: 0.25, mixed: 0.25, hardware: 0.05, textiles: 0.05 } },
  udp: { tier: 'pilgrim', shipIndex: 0.25, attractIndex: 0.35, mixBias: { agri: 0.30, fmcg: 0.30, mixed: 0.30, hardware: 0.05, textiles: 0.05 } },
  kkd: { tier: 'town', shipIndex: 0.20, attractIndex: 0.25, mixBias: { mixed: 0.35, agri: 0.30, fmcg: 0.20, textiles: 0.10, hardware: 0.05 } },
  klb: { tier: 'commercial', shipIndex: 0.45, attractIndex: 0.40, mixBias: { agri: 0.45, hardware: 0.25, fmcg: 0.15, mixed: 0.10, textiles: 0.05 } },
  hpt: { tier: 'industrial', shipIndex: 0.50, attractIndex: 0.40, mixBias: { hardware: 0.45, mixed: 0.25, fmcg: 0.15, agri: 0.10, textiles: 0.05 } },
  wyd: { tier: 'commercial', shipIndex: 0.45, attractIndex: 0.40, mixBias: { agri: 0.55, fmcg: 0.20, mixed: 0.15, hardware: 0.05, textiles: 0.05 } },
  ccu: { tier: 'metro', shipIndex: 0.90, attractIndex: 0.95, mixBias: { textiles: 0.35, fmcg: 0.30, mixed: 0.20, hardware: 0.10, agri: 0.05 } },
  smg: { tier: 'agri', shipIndex: 0.35, attractIndex: 0.35, mixBias: { agri: 0.50, mixed: 0.25, fmcg: 0.15, hardware: 0.05, textiles: 0.05 } },
  rpr: { tier: 'industrial', shipIndex: 0.60, attractIndex: 0.50, mixBias: { hardware: 0.45, agri: 0.25, mixed: 0.15, fmcg: 0.10, textiles: 0.05 } },
  bhp: { tier: 'commercial', shipIndex: 0.55, attractIndex: 0.60, mixBias: { fmcg: 0.35, mixed: 0.30, agri: 0.15, hardware: 0.15, textiles: 0.05 } },
}

const DEFAULT_FREIGHT_PROFILE: CityFreightProfile = {
  tier: 'town',
  shipIndex: 0.30,
  attractIndex: 0.30,
  mixBias: { mixed: 0.40, fmcg: 0.25, agri: 0.20, textiles: 0.10, hardware: 0.05 },
}

export function cityFreightProfile(id: string): CityFreightProfile {
  return CITY_FREIGHT[id] ?? DEFAULT_FREIGHT_PROFILE
}
