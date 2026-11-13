import { rs } from '../core/money'
import type { RouteDef } from '../types'
import { CITIES, cityPickups } from './cities'
import { realPaxPerDay } from './corridorSupply'

/** Named rivals per corridor, used for flavour in the market view and events. */
export const RIVALS: Record<string, string[]> = {
  // Chennai hub — Tamil Nadu
  'maa-cbe': ['KPN Travels', 'Parveen', 'SRM Transports', 'TNSTC'],
  'mdu-maa': ['KPN Travels', 'Parveen', 'ABT Travels', 'TNSTC'],
  'maa-mdu': ['KPN Travels', 'Parveen', 'ABT Travels', 'TNSTC'],
  'maa-mdu-ecr': ['KPN Travels', 'Parveen', 'RATHIMEENA', 'TNSTC', 'PRTC'],
  'mdu-maa-ecr': ['KPN Travels', 'Parveen', 'RATHIMEENA', 'TNSTC', 'PRTC'],
  'maa-try': ['KPN Travels', 'SRM Transports', 'TNSTC', 'Parveen'],
  'maa-slm': ['TNSTC', 'SRM Transports', 'KPN Travels'],
  'maa-ten': ['KPN Travels', 'Parveen', 'Universal Travels', 'TNSTC'],
  'maa-kkm': ['KPN Travels', 'Parveen', 'Universal Travels', 'TNSTC', 'SRM Transports'],
  'maa-rmd': ['TNSTC', 'SETC', 'RATHIMEENA', 'Parveen'],
  'maa-tvr': ['TNSTC', 'SETC', 'RATHIMEENA', 'PRTC'],
  // Chennai hub — interstate
  'maa-pdy': ['TNSTC', 'PRTC', 'Parveen'],
  'maa-tir': ['APSRTC', 'TNSTC', 'Sri Krishna Travels'],
  'maa-nlr': ['APSRTC', 'TNSTC', 'Morning Star'],
  'maa-blr': ['KPN Travels', 'SRS Travels', 'Parveen', 'TNSTC', 'FlixBus'],
  'blr-maa': ['KPN Travels', 'SRS Travels', 'Parveen', 'TNSTC', 'FlixBus'],
  'maa-mys': ['KSRTC', 'KPN Travels', 'SRS Travels'],
  'maa-vga': ['APSRTC', 'KPN Travels', 'Morning Star'],
  'maa-hyd': ['Orange Travels', 'KPN Travels', 'Jabbar Travels', 'TSRTC'],
  'maa-koc': ['Kallada Travels', 'KPN Travels', 'KSRTC (Kerala)'],
  'maa-trv': ['Kallada Travels', 'KPN Travels', 'Universal Travels', 'KSRTC (Kerala)'],
  'maa-clt': ['Kallada Travels', 'KSRTC (Kerala)', 'KPN Travels'],
  'maa-mlr': ['VRL', 'KSRTC', 'Sugama Tourists'],
  'maa-viz': ['APSRTC', 'Morning Star', 'KPN Travels'],
  'maa-goa': ['VRL', 'KPN Travels', 'Paulo Travels'],
  'maa-mum': ['VRL', 'National Travels', 'SRS Travels', 'Neeta Tours'],
  // Rest of the South
  'blr-hyd': ['Orange Travels', 'VRL', 'IntrCity SmartBus', 'Zingbus', 'KSRTC'],
  'hyd-vga': ['Orange Travels', 'Morning Star', 'APSRTC', 'TSRTC', 'Jabbar Travels'],
  'blr-tir': ['KSRTC', 'APSRTC', 'IRT', 'Sri Krishna Travels'],
  'blr-goa': ['VRL', 'Paulo Travels', 'KSRTC Airavat', 'Sea Bird'],
  'mdu-blr': ['KPN Travels', 'SRS Travels', 'Parveen', 'TNSTC', 'IntrCity SmartBus'],
  'blr-mdu': ['KPN Travels', 'SRS Travels', 'Parveen', 'TNSTC', 'IntrCity SmartBus'],
  'koc-blr': ['Kallada Travels', 'KSRTC (Kerala)', 'Greenline', 'IntrCity SmartBus'],
  'mum-pnq': ['Neeta Tours', 'Purple Bus', 'MSRTC Shivneri', 'Zingbus', 'FlixBus'],
  'blr-mum': ['VRL', 'SRS Travels', 'National Travels', 'IntrCity SmartBus'],
  'hyd-goa': ['Orange Travels', 'VRL', 'Paulo Travels'],

  // Tamil Nadu to Kerala
  'cbe-koc': ['Kallada Travels', 'KSRTC (Kerala)', 'KPN Travels', 'Parveen'],
  'cbe-clt': ['Kallada Travels', 'KSRTC (Kerala)', 'KPN Travels'],
  'cbe-trv': ['Kallada Travels', 'KSRTC (Kerala)', 'KPN Travels'],
  'mdu-koc': ['KPN Travels', 'Kallada Travels', 'TNSTC'],
  'mdu-trv': ['KPN Travels', 'SETC', 'Kallada Travels', 'Parveen'],
  'ten-trv': ['TNSTC', 'KSRTC (Kerala)', 'KPN Travels'],
  'slm-koc': ['Kallada Travels', 'KSRTC (Kerala)', 'KPN Travels'],

  // Tamil Nadu to Karnataka
  'blr-cbe': ['KPN Travels', 'SRS Travels', 'KSRTC Airavat', 'IntrCity SmartBus', 'TNSTC'],
  'blr-try': ['KPN Travels', 'SRS Travels', 'Parveen', 'KSRTC Airavat'],
  'blr-slm': ['KSRTC Airavat', 'TNSTC', 'SRS Travels', 'KPN Travels'],
  'blr-ten': ['KPN Travels', 'SRS Travels', 'Parveen', 'KSRTC Airavat'],
  'blr-kkm': ['KPN Travels', 'SRS Travels', 'Universal Travels'],
  'mys-cbe': ['KSRTC Airavat', 'TNSTC', 'KPN Travels'],
  'mdu-mys': ['KSRTC Airavat', 'KPN Travels', 'TNSTC', 'SRS Travels'],

  // Karnataka mainly Bengaluru to Kerala
  'blr-clt': ['Kallada Travels', 'KSRTC (Kerala)', 'SRS Travels', 'Orange Travels'],
  'blr-trv': ['Kallada Travels', 'KSRTC (Kerala)', 'Orange Travels', 'SRS Travels'],
  'blr-tcr': ['Kallada Travels', 'KSRTC (Kerala)', 'SRS Travels', 'Greenline'],
  'blr-knr': ['Kallada Travels', 'KSRTC (Kerala)', 'SRS Travels'],
  'blr-pkd': ['Kallada Travels', 'KSRTC (Kerala)', 'SRS Travels'],
  'blr-mlr': ['VRL', 'SRS Travels', 'KSRTC Airavat', 'Sugama Tourists'],
  'mys-clt': ['KSRTC (Kerala)', 'KSRTC Airavat', 'Kallada Travels'],

  // Major South Indian interstate & mid/long hauls
  'blr-vga': ['Morning Star', 'Orange Travels', 'APSRTC', 'Jabbar Travels', 'KSRTC'],
  'blr-viz': ['Orange Travels', 'Morning Star', 'Kaveri Travels', 'APSRTC'],
  'hyd-viz': ['Orange Travels', 'Morning Star', 'TSRTC', 'APSRTC', 'Kaveri Travels'],
  'hyd-cbe': ['Orange Travels', 'KSRTC', 'TSRTC', 'SRS Travels'],
  'hyd-koc': ['Orange Travels', 'Kallada Travels', 'KSRTC (Kerala)', 'Alhind Tours'],
  'hyd-tir': ['APSRTC', 'TSRTC', 'Orange Travels', 'Morning Star'],
  'hyd-pnq': ['Orange Travels', 'VRL', 'Jabbar Travels', 'TSRTC', 'MSRTC'],
  'hyd-mum': ['VRL', 'Orange Travels', 'National Travels', 'SRS Travels'],
  'hyd-kno': ['TSRTC', 'APSRTC', 'Orange Travels'],
  'vga-viz': ['APSRTC', 'Morning Star', 'Orange Travels', 'Kaveri Travels'],
  'koc-mlr': ['Kallada Travels', 'KSRTC (Kerala)', 'Sugama Tourists', 'SRS Travels'],
  'trv-clt': ['KSRTC (Kerala)', 'Kallada Travels', 'Murahara', 'Orange Travels'],
  'trv-koc': ['KSRTC (Kerala)', 'Kallada Travels', 'SPS Travels'],
  'mlr-goa': ['VRL', 'Paulo Travels', 'KSRTC Airavat', 'Sea Bird'],
  'blr-pdy': ['KSRTC Airavat', 'TNSTC', 'PRTC', 'SRS Travels'],
  'blr-hbl': ['VRL', 'SRS Travels', 'Sugama Tourists', 'NWKRTC'],
  'hbl-goa': ['NWKRTC', 'Paulo Travels', 'VRL'],
  'cbe-mdu': ['TNSTC', 'KPN Travels', 'ABT Travels'],
  'mdu-cbe': ['TNSTC', 'KPN Travels', 'ABT Travels'],
  'try-cbe': ['TNSTC', 'KPN Travels', 'RATHIMEENA'],
  'blr-koc': ['Kallada Travels', 'KSRTC (Kerala)', 'Greenline', 'IntrCity SmartBus'],
  'maa-dgl': ['KPN Travels', 'Parveen', 'SETC', 'IntrCity SmartBus'],
  'blr-dgl': ['KPN Travels', 'SRS Travels', 'KSRTC Airavat', 'VRL'],
  'cbe-dgl': ['TNSTC', 'KPN Travels', 'ABT Travels'],
  'try-dgl': ['TNSTC', 'KPN Travels', 'RATHIMEENA'],

  // Northern & Western hubs
  'del-jai': ['Zingbus', 'IntrCity SmartBus', 'FlixBus', 'RSRTC'],
  'del-ixc': ['Zingbus', 'IntrCity SmartBus', 'FlixBus', 'HRTC'],
  'del-lko': ['Zingbus', 'IntrCity SmartBus', 'UPSRTC', 'FlixBus'],
  'del-agr': ['Zingbus', 'IntrCity SmartBus', 'UPSRTC'],
  'mum-amd': ['VRL', 'SRS Travels', 'IntrCity SmartBus', 'Neeta Tours'],
  'del-srinagar': ['Zingbus', 'IntrCity SmartBus', 'FlixBus', 'RSRTC'],
  'del-nag': ['VRL', 'Zingbus', 'National Travels', 'MSRTC'],

  // South to North / West / East Prestige Marathons
  'blr-nag': ['VRL', 'Orange Travels', 'KSRTC Airavat', 'Hans Travels'],
  'maa-bbs': ['Morning Star', 'KPN Travels', 'OSRTC', 'Orange Travels'],

  // Round-to-100 corridors
  'maa-hpt': ['KPN Travels', 'SRS Travels', 'VRL', 'Greenline'],
  'blr-klb': ['VRL', 'Orange Travels', 'KSRTC Airavat', 'Greenline'],
  'blr-udp': ['VRL', 'Sugama Tourists', 'KSRTC Airavat', 'SRS Travels'],
  'mum-klp': ['Neeta Tours', 'MSRTC', 'VRL', 'National Travels'],
  'hyd-rjy': ['Orange Travels', 'Morning Star', 'APSRTC', 'Kaveri Travels'],
  'hyd-nag': ['Orange Travels', 'TSRTC', 'MSRTC', 'IntrCity SmartBus'],
  'pnq-goa': ['Neeta Tours', 'VRL', 'MSRTC', 'Sea Bird'],
  'mum-goa': ['Neeta Tours', 'VRL', 'Sea Bird', 'MSRTC'],
  'blr-pnq': ['VRL', 'SRS Travels', 'National Travels', 'IntrCity SmartBus'],
  'blr-ktm': ['Kallada Travels', 'KSRTC (Kerala)', 'Greenline', 'IntrCity SmartBus'],
  'maa-qln': ['Kallada Travels', 'KSRTC (Kerala)', 'KPN Travels', 'Universal Travels'],
  'maa-wyd': ['Kallada Travels', 'KSRTC (Kerala)', 'Greenline', 'Parveen'],
  'mum-idr': ['National Travels', 'VRL', 'IntrCity SmartBus', 'MSRTC'],
  'blr-qln': ['Kallada Travels', 'KSRTC (Kerala)', 'Greenline', 'SRS Travels'],
  'maa-pnq': ['VRL', 'KPN Travels', 'National Travels', 'SRS Travels'],
  'pnq-nag': ['Prasanna Purple', 'Saini Travels', 'VRL', 'MSRTC'],
  'viz-ccu': ['Shyamoli Paribahan', 'Dolphin Travels', 'OSRTC', 'Greenline'],
}

const R = (
  id: string, km: number, hours: number, marketFareAC: number,
  competition: number, rail: number, ghat: boolean, borderTax: number, tollPerKm: number,
  unlockRep: number, notes: string,
  /** Explicit endpoints when the id is not a plain `from-to` pair (e.g. path variants). */
  endpoints?: [string, string],
): RouteDef => {
  const [from, to] = endpoints ?? (id.split('-') as [string, string])
  return {
    id, from, to, km, hours,
    marketFareAC: rs(marketFareAC),
    // Private-operator pax/day per direction, from the corridor supply table.
    baseDemand: realPaxPerDay(id),
    competition,
    railCompetition: rail,
    ghat,
    interstate: CITIES[from].state !== CITIES[to].state,
    borderTaxPerTrip: rs(borderTax * 0.2),
    tollPerKm: rs(tollPerKm * 0.5),
    unlockRep,
    notes,
  }
}

export const ROUTES: Record<string, RouteDef> = Object.fromEntries(
  [
    // —— Chennai hub, open from day 1 ——
    // Freight follows each corridor's passenger demand, per direction.
    R('maa-blr', 350, 7, 950, 0.8, 0.7, false, 1800, 2.4, 0, 'IT commuters; strong rail rivalry, evening semis do well'),
    R('maa-try', 330, 6, 750, 0.75, 0.55, false, 0, 2.1, 0, 'Students and day or evening commuters; Rock Fort corridor'),
    R('maa-mdu', 460, 8, 1000, 0.8, 0.65, false, 0, 2.3, 0, 'Pilgrims; temple-town overnight with big festival swings'),
    R('maa-mdu-ecr', 480, 9, 1000, 0.75, 0.4, false, 0, 2.1, 0, 'Leisure and festival travellers; coastal ECR overnight run', ['maa', 'mdu']),
    R('maa-rmd', 490, 10, 1050, 0.65, 0.35, false, 0, 2.0, 0, 'Pilgrims; coastal overnight run toward the southern shrine'),
    R('maa-tvr', 310, 7, 720, 0.7, 0.3, false, 0, 1.9, 0, 'Day seaters and evening semi commuters; delta corridor'),

    // —— Chennai hub, Tamil Nadu overnight ——
    R('maa-cbe', 500, 9, 1100, 0.75, 0.6, false, 0, 2.2, 5, 'Textile workers and IT returns; overnight workhorse route'),
    R('maa-ten', 625, 11, 1350, 0.65, 0.4, false, 0, 2.1, 5, 'Loyal families and Onam travellers; deep-south sleeper run'),
    R('maa-kkm', 705, 13, 1450, 0.7, 0.45, false, 0, 2.2, 5, 'Pilgrims and tourists; land\'s-end overnight run'),

    // —— Chennai hub, neighbouring states ——
    R('maa-mys', 480, 9, 1100, 0.6, 0.25, false, 1600, 2.0, 5, 'Weekend tourists; palace-city overnight, quiet Tuesdays'),
    R('maa-vga', 455, 8, 1000, 0.7, 0.55, false, 1400, 2.1, 5, 'Day and night travellers; commercial corridor, steady trade'),
    R('maa-hyd', 625, 12, 1450, 0.75, 0.55, false, 2200, 2.2, 10, 'IT staff; two-IT-hub overnight, fierce competition'),
    R('maa-koc', 690, 13, 1500, 0.65, 0.35, true, 2000, 1.9, 10, 'Kerala migrant workers; Onam rush, enormous flows'),
    R('maa-trv', 720, 14, 1500, 0.6, 0.4, true, 2000, 1.9, 10, 'Tourists and office staff; capital-to-capital run'),
    R('maa-clt', 655, 13, 1400, 0.55, 0.25, true, 2000, 1.9, 10, 'Gulf returnees and Onam families; Malabar sleeper run'),
    R('maa-mlr', 710, 14, 1450, 0.5, 0.2, true, 1800, 1.8, 10, 'Port workers and pilgrims; coastal Karnataka run'),
    R('maa-viz', 780, 15, 1600, 0.55, 0.45, false, 2200, 2.0, 15, 'Business travellers; coastal marathon, thin midweek'),
    R('maa-goa', 920, 21, 1850, 0.5, 0.15, true, 2600, 1.8, 20, 'Tourists and weekend partygoers; party-and-beach haul'),
    R('maa-mum', 1340, 24, 2400, 0.5, 0.55, true, 3200, 2.1, 20, 'Premium travellers; west-coast prestige haul, rail competition'),

    // —— Tamil Nadu to Kerala ——
    R('cbe-trv', 380, 9, 1050, 0.7, 0.6, false, 2000, 2.1, 5, 'Mixed travellers; central Kerala overnight connector'),
    R('mdu-koc', 260, 8, 750, 0.6, 0.3, true, 1800, 1.8, 5, 'Tourists and spice traders; Bodimettu ghat scenic haul'),
    R('mdu-trv', 305, 7, 800, 0.7, 0.55, false, 1800, 2.0, 0, 'Pilgrims and traders; southern corridor run'),
    R('slm-koc', 355, 8, 950, 0.65, 0.5, false, 2000, 2.1, 5, 'Industrial workers and port cargo; NH544 overnight run'),

    // —— Tamil Nadu to Karnataka ——
    R('mdu-mys', 485, 9, 1200, 0.65, 0.25, true, 1600, 2.0, 5, 'Festival pilgrims and weekend families; temple-to-palace overnight'),
    R('blr-cbe', 365, 7, 900, 0.85, 0.6, false, 1800, 2.3, 0, 'IT workers, parcels and passengers; premier industry corridor'),
    R('blr-try', 340, 7, 850, 0.75, 0.5, false, 1800, 2.2, 0, 'Students and tech workers; central TN link run'),
    R('blr-ten', 585, 11, 1350, 0.75, 0.5, false, 2000, 2.3, 5, 'Families and students; two-state sleeper run, bypass route'),
    R('blr-kkm', 665, 13, 1450, 0.7, 0.5, false, 2000, 2.3, 5, 'Tourists and pilgrims; direct NH44 long-haul sleeper'),
    R('mys-cbe', 200, 7, 550, 0.6, 0.2, true, 1600, 1.8, 0, 'Tourists; scenic hairpin ghat with slow speeds'),

    // —— Karnataka to Kerala (Mainly Bengaluru to Kerala) ——
    R('blr-clt', 360, 9, 1100, 0.85, 0.45, true, 2000, 2.0, 0, 'Malabar migrants; Thamarassery ghat, sells out'),
    R('blr-trv', 730, 13, 1600, 0.8, 0.55, false, 2400, 2.2, 10, 'Onam travellers and office staff; capital marathon'),
    R('blr-tcr', 480, 9, 1200, 0.75, 0.5, false, 2000, 2.1, 5, 'Weekend migrants and Pooram crowds; mountain-gap route'),
    R('blr-knr', 320, 9, 1050, 0.75, 0.4, true, 2000, 1.9, 0, 'Daily commuters and North Kerala families; Coorg ghat run'),
    R('blr-pkd', 415, 8, 1000, 0.7, 0.5, false, 2000, 2.1, 0, 'Office commuters and Kerala families; NH544 mid-haul'),
    R('blr-mlr', 350, 7, 950, 0.85, 0.4, true, 0, 2.0, 0, 'Coastal tourists and commuters; Shiradi ghat, year-round volume'),
    R('mys-clt', 250, 8, 650, 0.65, 0.25, true, 1600, 1.8, 0, 'Interstate travellers and traders; Western Ghats transit'),

    // —— Rest of the South (Interstate & Intra-State) ——
    R('blr-hyd', 570, 10, 1350, 0.85, 0.5, false, 2500, 2.2, 0, 'IT professionals; classic overnight corridor, huge demand'),
    R('hyd-vga', 275, 6, 700, 0.85, 0.5, false, 0, 2.0, 0, 'Daytime commuters and evening travellers; dense Telugu corridor'),
    R('blr-tir', 250, 6, 650, 0.7, 0.3, false, 1200, 2.0, 0, 'Pilgrims and weekend travellers; strong weekend spikes'),
    R('blr-mdu', 435, 8, 1100, 0.75, 0.45, false, 1600, 2.1, 0, 'Festival pilgrims and weekend families; festivals sell hard'),
    R('blr-goa', 560, 12, 1500, 0.6, 0.2, true, 2200, 1.8, 10, 'Tourists; monsoon rough, peak season gold, ghat route'),
    R('blr-koc', 550, 10, 1350, 0.8, 0.5, true, 2000, 1.9, 0, 'Kerala migrants and festival travellers; migrant weekend corridor'),
    R('hyd-goa', 665, 15, 1600, 0.55, 0.15, true, 2400, 1.9, 20, 'Tourists; weekend and New Year party surges'),

    // —— Northern & Western Corridors ——
    R('del-jai', 275, 6, 650, 0.9, 0.65, false, 1800, 2.5, 5, 'Tourists and commuters; Pink City expressway, high competition'),
    R('del-lko', 535, 9, 1200, 0.85, 0.7, false, 2200, 2.6, 10, 'Commuters and business travellers; fast expressway sleeper'),
    R('mum-amd', 530, 11, 1300, 0.85, 0.75, false, 2400, 2.4, 15, 'Freight, corporate and business travellers; NH48 trade spine'),
    R('blr-mum', 985, 19, 1950, 0.65, 0.6, true, 3000, 2.1, 20, 'Long-haul travellers; marathon haul over the ghats'),

    // —— South → North Prestige Marathons ——
    R('blr-nag', 1100, 22, 2250, 0.70, 0.60, false, 2800, 2.2, 20, 'Long-haul luxury travellers; NH44 marathon, Vidarbha reach'),
    R('maa-bbs', 1250, 23, 2400, 0.65, 0.65, false, 3200, 2.1, 20, 'Traders, students and cultural travellers; NH16 East Coast corridor'),

    // —— Major South Indian Mid-Haul & Long-Haul Additions ——
    // Andhra & Telangana corridors
    R('blr-vga', 640, 12, 1450, 0.8, 0.55, false, 2000, 2.2, 5, 'Night travellers; busy NH44 and NH16 artery, multi-axle services'),
    R('blr-viz', 1005, 18, 2050, 0.7, 0.5, false, 2400, 2.2, 15, 'Business and weekend travellers; East Coast marathon, sells out'),
    R('hyd-viz', 620, 11, 1450, 0.85, 0.6, false, 0, 2.2, 5, 'Business travellers and sleeper commuters; coastal Andhra flagship'),
    R('hyd-cbe', 920, 16, 1950, 0.65, 0.45, false, 2600, 2.2, 10, 'IT workers and steady travellers; long NH44 industry link'),
    R('hyd-koc', 1090, 18, 2200, 0.6, 0.4, true, 2800, 2.1, 15, 'Long-haul tourists and migrants; Kerala marathon run'),
    R('hyd-tir', 560, 11, 1250, 0.8, 0.45, false, 1800, 2.1, 0, 'Pilgrims; festival-peak travellers, round-the-clock demand'),
    R('hyd-pnq', 560, 11, 1300, 0.8, 0.55, false, 2400, 2.3, 5, 'Techies and students; Deccan IT corridor, NH65'),
    R('hyd-mum', 710, 14, 1650, 0.75, 0.6, false, 2800, 2.3, 10, 'Parcel and freight travellers; western trade highway'),
    R('vga-viz', 350, 7, 800, 0.8, 0.65, false, 0, 2.1, 0, 'Day commuters and night travellers; coastal NH16 route'),

    // Kerala & Coastal Karnataka corridors
    R('koc-mlr', 420, 9, 1150, 0.75, 0.5, true, 1800, 2.0, 5, 'Traders and students; coastal NH66 corridor'),
    R('trv-clt', 390, 9, 1050, 0.8, 0.65, false, 0, 2.0, 0, 'Office commuters and tourists; North-South spine'),
    R('mlr-goa', 365, 8, 950, 0.65, 0.3, true, 1800, 2.0, 5, 'Tourists and beachgoers; scenic Konkan coast run'),

    // Karnataka, Tamil Nadu & Puducherry mid-hauls
    R('blr-pdy', 310, 7, 750, 0.75, 0.3, false, 1400, 2.0, 0, 'Weekend tourists; Friday and Sunday getaway surges'),
    R('blr-hbl', 410, 8, 900, 0.8, 0.5, false, 0, 2.2, 0, 'Corporate staff and students; North Karnataka NH48 lifeline'),

    // Popular Dindigul corridors
    R('maa-dgl', 420, 8, 850, 0.75, 0.55, false, 0, 2.2, 0, 'Merchants, students and farmers; NH45 corridor'),
    R('blr-dgl', 375, 8, 850, 0.75, 0.45, false, 1600, 2.2, 0, 'Traders and hill-station tourists; NH44 trade corridor'),

    // —— Round-to-100: night hauls ——
    R('maa-hpt', 520, 10, 1150, 0.70, 0.40, false, 1400, 2.1, 5, 'Pilgrims, tourists and steel-belt workers; heritage route'),
    R('blr-klb', 560, 10, 1150, 0.75, 0.45, false, 1600, 2.2, 5, 'Courts, students and cement traders; Kalyana-Karnataka overnight'),
    R('blr-udp', 400, 9, 1000, 0.7, 0.2, true, 0, 1.8, 5, 'Pilgrims and coastal weekend tourists; Shiradi ghat sleeper'),
    R('mum-klp', 380, 8, 950, 0.75, 0.5, false, 0, 2.6, 10, 'Sugar-belt travellers; expressway, packed pre-Diwali'),
    R('hyd-rjy', 400, 8, 950, 0.8, 0.5, false, 1400, 2.1, 5, 'Telugu hometown travellers; Godavari run, Sankranti rush'),
    R('hyd-nag', 500, 9, 1050, 0.65, 0.6, false, 2000, 2.3, 10, 'Business travellers; NH44 run, midweek rail competition'),
    R('pnq-goa', 450, 9, 1100, 0.7, 0.3, true, 1800, 2.0, 10, 'Weekend tourists; New Year gold, Friday-to-Sunday trips'),

    // —— Round-to-100: night marathons ——
    R('mum-goa', 590, 12, 1400, 0.85, 0.55, true, 1800, 2.2, 15, 'Leisure travellers; busy sleeper, slow monsoon ghats'),
    R('blr-pnq', 840, 15, 1800, 0.75, 0.55, false, 2600, 2.3, 15, 'Weekend travellers and students; NH48 marathon'),
    R('blr-ktm', 600, 11, 1350, 0.75, 0.45, false, 2000, 2.0, 10, 'Kerala families; Onam and Christmas rush, sleeper run'),
    R('maa-qln', 690, 13, 1500, 0.70, 0.45, false, 2000, 2.1, 10, 'Migrants and business travellers; Kerala overnight run'),
    R('maa-wyd', 590, 11, 1350, 0.75, 0.45, false, 1800, 2.1, 5, 'Hill tourists and spice traders; hill-country sleeper'),
    R('mum-idr', 590, 11, 1350, 0.7, 0.55, false, 2400, 2.4, 15, 'Freight and steady traders; NH52 trade marathon'),
    R('blr-qln', 680, 12, 1500, 0.7, 0.5, false, 2000, 2.1, 10, 'Kerala families; first private link, sleeper run'),

    // —— Round-to-100: ultra marathons ——
    R('maa-pnq', 1180, 19, 2200, 0.55, 0.6, false, 3000, 2.2, 20, 'Students and IT staff; NH48 ultra run'),
    R('pnq-nag', 710, 12, 1550, 0.75, 0.45, false, 0, 2.4, 10, 'Students, government staff, traders; Samruddhi expressway'),
    R('viz-ccu', 880, 17, 1850, 0.70, 0.50, false, 2200, 2.1, 15, 'Students, business and holidaymakers; NH16 trunk'),
    // —— Replaces the day hops: mid-haul, night haul, marathon and long marathon ——
    R('koc-mys', 450, 9, 1000, 0.7, 0.4, false, 1400, 2.1, 0, 'Tourists and traders; Malabar run, Gundlupet gap'),
    R('cbe-pdy', 390, 7, 880, 0.7, 0.4, false, 900, 2.0, 0, 'Pilgrims and students; western TN coast run'),
    R('blr-nlr', 500, 9, 1150, 0.7, 0.4, false, 1600, 2.1, 0, 'Overnight sleeper travellers; long trade run'),
    R('mdu-pdy', 420, 8, 950, 0.7, 0.35, false, 800, 2.0, 0, 'Temple pilgrims and beach tourists; coastal leisure run'),
    R('hbl-mys', 500, 9, 1100, 0.6, 0.2, true, 1400, 1.9, 0, 'Overnight travellers; ghat sleeper route'),
    R('hyd-mys', 720, 13, 1500, 0.65, 0.35, false, 2000, 2.0, 5, 'Tourists and IT sleepers; overnight run'),
    R('vga-cbe', 740, 13, 1550, 0.6, 0.35, false, 1600, 2.0, 0, 'Textile traders and sleeper travellers; trade corridor'),
    R('pnq-hbl', 500, 9, 1050, 0.65, 0.3, false, 1600, 2.1, 5, 'Students and traders; NH48 night haul'),
    R('mys-viz', 1100, 20, 2200, 0.5, 0.25, false, 2600, 2.1, 15, 'Long-haul travellers; ultra run, strong sleeper demand'),
    R('mlr-trv', 640, 12, 1400, 0.6, 0.3, true, 1800, 2.0, 10, 'Onam travellers and coastal tourists; coastal Karnataka run'),
    R('blr-smg', 280, 6, 650, 0.6, 0.15, true, 900, 1.9, 0, 'Pilgrims and day commuters; Malnad gateway, Jog traffic'),
    R('jai-ixc', 520, 9, 1100, 0.7, 0.5, false, 1500, 2.1, 0, 'Traders and students; NCR overnight run'),
    R('amd-jai', 670, 12, 1400, 0.65, 0.45, false, 1800, 2.0, 5, 'Traders and pilgrims; NH48 sleeper corridor'),
    R('del-srinagar', 850, 16, 2000, 0.45, 0.10, true, 2400, 2.2, 25, 'Tourists and army-leave travellers; mountain run over Banihal'),
    R('del-nag', 1100, 20, 2100, 0.65, 0.50, false, 2600, 2.2, 15, 'Traders and students; long NH44 marathon'),
    R('hyd-rpr', 780, 14, 1600, 0.6, 0.35, false, 2000, 2.0, 5, 'Business and migrant travellers; eastern rail corridor'),
    R('viz-nag', 890, 15, 1800, 0.55, 0.45, false, 2200, 2.1, 10, 'Port workers and traders; Eastern Ghats run'),
    R('amd-del', 920, 15, 1850, 0.55, 0.55, false, 2300, 2.1, 10, 'Premium travellers; western marathon run'),
    R('lko-ccu', 1000, 18, 2000, 0.5, 0.6, false, 2500, 2.1, 15, 'Long-haul sleeper travellers; Gangetic plain marathon'),
  ].map((r) => [r.id, r]),
)

export const ROUTE_LIST = Object.values(ROUTES).sort((a, b) =>
  routeName(a.id).localeCompare(routeName(b.id)),
)

// Backward compatibility and bidirectional aliases
if (ROUTES['maa-blr']) {
  ROUTES['blr-maa'] = {
    ...ROUTES['maa-blr'],
    id: 'blr-maa',
    from: 'blr',
    to: 'maa',
  }
}
if (ROUTES['maa-mdu']) {
  ROUTES['mdu-maa'] = {
    ...ROUTES['maa-mdu'],
    id: 'mdu-maa',
    from: 'mdu',
    to: 'maa',
  }
}
if (ROUTES['maa-mdu-ecr']) {
  ROUTES['mdu-maa-ecr'] = {
    ...ROUTES['maa-mdu-ecr'],
    id: 'mdu-maa-ecr',
    from: 'mdu',
    to: 'maa',
  }
}
if (ROUTES['blr-mdu']) {
  ROUTES['mdu-blr'] = {
    ...ROUTES['blr-mdu'],
    id: 'mdu-blr',
    from: 'mdu',
    to: 'blr',
  }
}
if (ROUTES['blr-koc']) {
  ROUTES['koc-blr'] = {
    ...ROUTES['blr-koc'],
    id: 'koc-blr',
    from: 'koc',
    to: 'blr',
  }
}
if (ROUTES['mdu-cbe']) {
  ROUTES['cbe-mdu'] = {
    ...ROUTES['mdu-cbe'],
    id: 'cbe-mdu',
    from: 'cbe',
    to: 'mdu',
  }
}
if (ROUTES['maa-dgl']) {
  ROUTES['dgl-maa'] = {
    ...ROUTES['maa-dgl'],
    id: 'dgl-maa',
    from: 'dgl',
    to: 'maa',
  }
}
if (ROUTES['blr-dgl']) {
  ROUTES['dgl-blr'] = {
    ...ROUTES['blr-dgl'],
    id: 'dgl-blr',
    from: 'dgl',
    to: 'blr',
  }
}
if (ROUTES['cbe-dgl']) {
  ROUTES['dgl-cbe'] = {
    ...ROUTES['cbe-dgl'],
    id: 'dgl-cbe',
    from: 'dgl',
    to: 'cbe',
  }
}
if (ROUTES['try-dgl']) {
  ROUTES['dgl-try'] = {
    ...ROUTES['try-dgl'],
    id: 'dgl-try',
    from: 'dgl',
    to: 'try',
  }
}

// `var`: route tables below call canonicalRouteId while this module is still initialising.
// eslint-disable-next-line no-var
var canonicalCache: Map<string, string> | undefined

/** Canonical id of a corridor (memoised: the sim asks for it millions of times a day). */
export function canonicalRouteId(id: string): string {
  const cache = (canonicalCache ??= new Map<string, string>())
  let out = cache.get(id)
  if (out === undefined) {
    out = computeCanonicalRouteId(id)
    cache.set(id, out)
  }
  return out
}

function computeCanonicalRouteId(id: string): string {
  if (id === 'cbe-mdu' || id === 'mdu-cbe') return 'mdu-cbe'
  if (id === 'mdu-maa' || id === 'maa-mdu') return 'maa-mdu'
  if (id === 'mdu-maa-ecr' || id === 'maa-mdu-ecr') return 'maa-mdu-ecr'
  if (id === 'mdu-blr' || id === 'blr-mdu') return 'blr-mdu'
  if (id === 'koc-blr' || id === 'blr-koc') return 'blr-koc'
  if (id === 'blr-maa' || id === 'maa-blr') return 'maa-blr'
  if (id === 'dgl-maa' || id === 'maa-dgl') return 'maa-dgl'
  if (id === 'dgl-blr' || id === 'blr-dgl') return 'blr-dgl'
  if (id === 'dgl-cbe' || id === 'cbe-dgl') return 'cbe-dgl'
  if (id === 'dgl-try' || id === 'try-dgl') return 'try-dgl'
  // Any other corridor named in the reverse order (e.g. 'cbe-maa') resolves to
  // the defined id, keeping a path suffix such as '-ecr'.
  if (!ROUTES[id]) {
    const [a, b, ...rest] = id.split('-')
    const reversed = [b, a, ...rest].join('-')
    if (ROUTES[reversed]) return reversed
  }
  return id
}

export function routeName(id: string): string {
  const r = ROUTES[id]
  if (!r) return id

  // Path variants that share endpoints with another corridor keep a distinct label.
  if (canonicalRouteId(id) === 'maa-mdu-ecr') return 'Chennai ECR – Madurai'

  // Major city on the left: the larger metro (by CITIES metro score) starts the name.
  // Chennai and Bengaluru are the state capitals and always lead.
  const lead = (id: string) => (id === 'maa' || id === 'blr' ? 2 : (CITIES[id]?.metro ?? 0))
  const [a, b] = lead(r.from) >= lead(r.to) ? [r.from, r.to] : [r.to, r.from]
  return `${CITIES[a]?.name ?? a} – ${CITIES[b]?.name ?? b}`
}

export function isOvernight(r: RouteDef): boolean {
  return r.hours >= 7.5
}

/* -------------------------------- via cities ------------------------------- */

/**
 * Intermediate cities a corridor actually runs through. Every id here is a city
 * that is already an endpoint of another network corridor, so "via" never
 * invents a place we don't serve.
 *
 * Written in A → B order; the opposite direction is derived by flipping the
 * list, so a mirrored corridor (e.g. maa-mdu / mdu-maa) reads correctly.
 */
const VIA_CORRIDORS: [string, string, string[]][] = [
  // Chennai hub — coastal / southern
  ['maa', 'vga', ['nlr']],
  ['maa', 'hyd', ['nlr', 'vga']],
  ['maa', 'viz', ['nlr', 'vga']],
  ['maa', 'cbe', ['slm']],
  ['maa', 'dgl', ['try']],
  ['maa', 'mdu', ['try']],
  ['maa', 'ten', ['try', 'mdu']],
  ['maa', 'kkm', ['try', 'mdu', 'ten']],
  ['maa', 'rmd', ['tnj']],
  ['maa', 'tvr', ['pdy']],
  ['maa', 'koc', ['slm', 'cbe', 'tcr']],
  ['maa', 'trv', ['try', 'mdu', 'ten']],
  ['maa', 'clt', ['slm', 'cbe', 'pkd']],
  ['maa', 'mlr', ['slm', 'blr']],
  ['maa', 'mys', ['blr']],
  ['maa', 'goa', ['blr']],
  ['maa', 'mum', ['blr', 'pnq']],

  // Tamil Nadu ⇄ Kerala & Intra-State
  ['cbe', 'koc', ['pkd', 'tcr']],
  ['cbe', 'clt', ['pkd']],
  ['cbe', 'trv', ['pkd', 'tcr', 'koc']],
  ['mdu', 'cbe', ['dgl']],
  ['mdu', 'trv', ['ten']],
  ['mdu', 'mys', ['dgl', 'cbe']],
  ['slm', 'koc', ['cbe', 'pkd', 'tcr']],

  // Karnataka ⇄ Tamil Nadu / Kerala
  ['blr', 'cbe', ['slm']],
  ['blr', 'try', ['slm']],
  ['blr', 'dgl', ['slm']],
  ['blr', 'mdu', ['slm', 'dgl']],
  ['blr', 'ten', ['slm', 'dgl', 'mdu']],
  ['blr', 'kkm', ['slm', 'dgl', 'mdu', 'ten']],
  ['blr', 'clt', ['mys']],
  ['mys', 'clt', ['knr']],
  ['blr', 'trv', ['slm', 'dgl', 'mdu', 'ten']],
  ['blr', 'tcr', ['slm', 'pkd']],
  ['blr', 'knr', ['mys']],
  ['blr', 'pkd', ['slm', 'cbe']],
  ['blr', 'mum', ['pnq']],
  ['koc', 'blr', ['tcr', 'cbe', 'slm']],

  // Andhra & Telangana corridors
  ['blr', 'vga', ['tir', 'nlr']],
  ['blr', 'viz', ['tir', 'nlr', 'vga', 'rjy']],
  ['hyd', 'viz', ['vga', 'rjy']],
  ['hyd', 'cbe', ['kno', 'blr', 'slm']],
  ['hyd', 'koc', ['kno', 'blr', 'cbe', 'tcr']],
  ['hyd', 'tir', ['kno']],
  ['hyd', 'mum', ['pnq']],
  ['vga', 'viz', ['rjy']],

  // Kerala & Coastal corridors
  ['koc', 'mlr', ['tcr', 'clt', 'knr']],
  ['trv', 'clt', ['qln', 'koc', 'tcr']],
  ['trv', 'koc', ['qln']],

  // Karnataka & Tamil Nadu mid-hauls
  ['blr', 'pdy', ['slm']],
  ['try', 'cbe', ['erd']],

  // North & West
  ['del', 'lko', ['agr']],

  // South to North / West / East Marathons
  ['blr', 'nag', ['kno', 'hyd']],
  ['maa', 'bbs', ['nlr', 'vga', 'viz']],

  // Round-to-100 corridors (no via where the road only passes towns we do not serve)
  ['maa', 'hpt', ['tir']],
  ['blr', 'klb', ['kno']],
  ['blr', 'udp', ['mlr']],
  ['mum', 'klp', ['pnq']],
  ['hyd', 'rjy', ['vga']],
  ['pnq', 'goa', ['klp', 'bgm']],
  ['mum', 'goa', ['pnq', 'klp', 'bgm']],
  ['blr', 'pnq', ['hbl', 'bgm', 'klp']],
  ['blr', 'ktm', ['slm', 'cbe', 'pkd', 'tcr']],
  ['maa', 'qln', ['try', 'mdu', 'ten']],
  ['maa', 'wyd', ['slm', 'cbe']],
  ['blr', 'qln', ['slm', 'cbe', 'tcr', 'koc']],
  ['maa', 'pnq', ['blr', 'hbl', 'bgm', 'klp']],
  ['viz', 'ccu', ['bbs']],
  ['jai', 'ixc', ['del']],
  ['hyd', 'rpr', ['nag']],
  ['amd', 'del', ['jai']],
]

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)

const VIA_INDEX = (() => {
  const m = new Map<string, { a: string; b: string; via: string[] }>()
  for (const [a, b, via] of VIA_CORRIDORS) m.set(pairKey(a, b), { a, b, via })
  return m
})()

/**
 * Path variants that share endpoints with another corridor (e.g. Madurai ECR).
 * Takes precedence over the city-pair VIA index so both roads keep distinct vias.
 * Listed in A → B order for the canonical route id's from → to.
 */
const VIA_BY_ROUTE_ID: Record<string, string[]> = {
  'maa-mdu-ecr': ['pdy', 'tnj'],
  'mdu-maa-ecr': ['tnj', 'pdy'],
}

/** City ids on the way, in travel order for this corridor's direction. */
export function routeViaCities(routeId: string): string[] {
  const r = ROUTES[routeId]
  if (!r) return []
  const byId = VIA_BY_ROUTE_ID[routeId] ?? VIA_BY_ROUTE_ID[canonicalRouteId(routeId)]
  if (byId) return byId.filter((id) => id !== r.from && id !== r.to)
  const hit = VIA_INDEX.get(pairKey(r.from, r.to))
  if (!hit) return []
  const via = hit.via.filter((id) => id !== r.from && id !== r.to)
  return r.from === hit.a ? via : [...via].reverse()
}

export function routeViaNames(routeId: string): string[] {
  return routeViaCities(routeId).map((id) => CITIES[id]?.name ?? id)
}

/** "via Salem, Coimbatore, Thrissur", or null when the run is direct. */
export function routeViaLabel(routeId: string): string | null {
  const names = routeViaNames(routeId)
  return names.length > 0 ? `via ${names.join(', ')}` : null
}

/* ------------------------------ haul headlines ----------------------------- */

export type HaulStyle = 'mid' | 'overnight' | 'marathon' | 'ultra'

export function haulStyleOfHours(hours: number): HaulStyle {
  const h = displayRouteHours(hours)
  if (h > 16) return 'ultra'
  if (h > 10) return 'marathon'
  if (h >= 8) return 'overnight'
  return 'mid'
}

export function haulStyle(r: RouteDef): HaulStyle {
  return haulStyleOfHours(r.hours)
}

/**
 * Prime departure windows per haul band, as `[fromHour, toHour]` on a 24h
 * clock (24 = midnight). This is the single source of truth: the demand model,
 * corridor profiles, tooltips and the Routes filter all read from here.
 */
export const HAUL_WINDOWS: Record<HaulStyle, [number, number][]> = {
  mid: [[18, 24]],
  overnight: [[20, 23.5]],
  marathon: [[18, 23.5]],
  ultra: [[16, 22]],
}

/** True when a departure clock hour (0-23.5) sits inside the band's prime window(s). */
export function inPrimeWindow(style: HaulStyle, h: number): boolean {
  // A 00:00 departure is the end of an "-24:00" window, not the start of the day.
  return HAUL_WINDOWS[style].some(([from, to]) => {
    const x = h === 0 && to >= 24 ? 24 : h
    return x >= from && x <= to
  })
}

function fmtClock(h: number): string {
  const hh = Math.floor(h) % 24
  const mm = h % 1 === 0.5 ? '30' : '00'
  return `${String(hh).padStart(2, '0')}:${mm}`
}

/** "08:00–12:00 and 18:00–22:00" */
export function haulWindowLabel(style: HaulStyle): string {
  return HAUL_WINDOWS[style].map(([a, b]) => `${fmtClock(a)}–${fmtClock(b)}`).join(' and ')
}

/** Short badge text for the haul. */
export function haulTitle(r: RouteDef): string {
  switch (haulStyle(r)) {
    case 'ultra': return 'Ultra marathon'
    case 'marathon': return 'Marathon night haul'
    case 'overnight': return 'Night haul'
    case 'mid': return 'Mid-haul'
    default: return 'Mid-haul'
  }
}

/**
 * How this haul actually earns — the departure window that works, what layout
 * sells, and (10–16h) the two-driver rule. Kept in one place so the corridor
 * table, schedule builder and setup screen all say the same thing.
 */
export function haulBrief(r: RouteDef): string {
  return haulBriefFor(haulStyle(r), displayRouteHours(r.hours))
}

/** Same description for a band; `hours` is optional (used by the Routes filter tooltip). */
export function haulBriefFor(style: HaulStyle, hours?: number): string {
  const win = haulWindowLabel(style)
  const on = hours !== undefined ? ` — ${hours}h on the road` : ''
  switch (style) {
    case 'ultra':
      return `Ultra marathon${on}. ${win}, with multi-coach rotation and two-crew sleepers.`
    case 'marathon':
      return `Marathon night haul${on}. ${win}, with sleeper berths only. Use two drivers, because the CMVR limit is 10 hrs per driver.`
    case 'overnight':
      return `Night haul${on}. ${win}. The coach runs while passengers sleep, so berths sell.`
    case 'mid':
      return `Mid-haul${on}. ${win} is the money window. A hybrid coach (berths plus rear cabin) works fine.`
    default:
      return `Mid-haul${on}. ${win} is the money window. A hybrid coach (berths plus rear cabin) works fine.`
  }
}

/** Full journey line: "Kochi – Chennai · via Salem, Coimbatore, Thrissur". */
export function routeJourney(routeId: string): string {
  const via = routeViaLabel(routeId)
  return via ? `${routeName(routeId)} (${via})` : routeName(routeId)
}

/**
 * Display helper for route duration:
 * Snaps travel hours between 8 and 10 to strictly 8 or 10 (never in-between fractional values).
 */
export function displayRouteHours(hours: number): number {
  if (hours > 8 && hours < 10) {
    return hours <= 9 ? 8 : 10
  }
  return hours
}

export type RouteCategory = 'all' | 'interstate' | 'south_state' | 'north'

export const SOUTH_INDIAN_STATES = new Set([
  'Tamil Nadu', 'Kerala', 'Karnataka', 'Andhra Pradesh', 'Telangana', 'Puducherry', 'Goa',
])

export function getRouteCategory(route: RouteDef): 'interstate' | 'south_state' | 'north' {
  const s1 = CITIES[route.from]?.state
  const s2 = CITIES[route.to]?.state
  const isS1South = SOUTH_INDIAN_STATES.has(s1)
  const isS2South = SOUTH_INDIAN_STATES.has(s2)

  // Pure Northern / Western corridor (neither city is South)
  if (!isS1South && !isS2South) {
    return 'north'
  }

  // South Intra-State (both cities in same South state)
  if (isS1South && isS2South && !route.interstate) {
    return 'south_state'
  }

  // Inter-State (South interstate or cross-region)
  return 'interstate'
}

export function routeMatchesCategory(route: RouteDef, cat: RouteCategory): boolean {
  if (cat === 'all') return true
  const s1 = CITIES[route.from]?.state
  const s2 = CITIES[route.to]?.state
  const isS1South = SOUTH_INDIAN_STATES.has(s1)
  const isS2South = SOUTH_INDIAN_STATES.has(s2)

  if (cat === 'interstate') {
    return route.interstate === true
  }
  if (cat === 'south_state') {
    return isS1South && isS2South && !route.interstate
  }
  if (cat === 'north') {
    return !isS1South || !isS2South
  }
  return true
}

export function routeMatchesHours(route: RouteDef, filter: string): boolean {
  if (filter === 'all') return true
  const h = displayRouteHours(route.hours)
  if (filter === '6-8') return h >= 6 && h < 8
  if (filter === '8-10') return h >= 8 && h <= 10
  if (filter === '10-16' || filter === '>10') return h > 10 && h <= 16
  if (filter === '>16' || filter === '>18') return h > 16
  return true
}

/**
 * Fixed boarding-point count for a corridor from the two cities' pickup
 * density, plus a couple of mid-route towns on longer hauls.
 */
export function boardingPointsForRoute(routeId: string): number {
  const r = ROUTES[routeId]
  if (!r) return 3
  const a = cityPickups(r.from)
  const b = cityPickups(r.to)
  const mid = r.km >= 500 ? 2 : r.km >= 300 ? 1 : 0
  return Math.max(2, Math.min(10, Math.round((a + b) / 2) + mid))
}

export { cityName } from './cities'

// Anything cached while the tables above were still being built may be stale.
canonicalCache = undefined
