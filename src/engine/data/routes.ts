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
  'hyd-kkm': ['Orange Travels', 'KPN Travels', 'TSRTC', 'SETC'],
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
    R('maa-blr', 350, 7, 950, 0.8, 0.7, false, 1800, 2.4, 0, 'The IT hop. Strong rail competition; evening semis do well.'),
    R('maa-pdy', 165, 4, 450, 0.7, 0.15, false, 400, 1.6, 0, 'Weekend leisure shuttle. Multiple day trips per bus.'),
    R('maa-tir', 150, 3, 480, 0.65, 0.25, false, 800, 1.8, 0, 'Pilgrim day-and-evening run. Weekends and Brahmotsavam explode.'),
    R('maa-nlr', 175, 4, 420, 0.6, 0.35, false, 700, 1.7, 0, 'Andhra day shuttle up NH16. Multiple turns; thin sleeper demand.'),
    R('maa-try', 330, 6, 750, 0.75, 0.55, false, 0, 2.1, 0, 'Rock Fort corridor. Day seaters and evening semis both work.'),
    R('maa-slm', 340, 5, 720, 0.7, 0.5, false, 0, 2.0, 0, 'NH44 industrial hop. Steady weekday traffic, thin sleeper demand.'),
    R('maa-mdu', 460, 8, 1000, 0.8, 0.65, false, 0, 2.3, 0, 'Temple-town overnight connecting Chennai to Madurai via Trichy. Festival swings are massive.'),
    R('maa-mdu-ecr', 480, 9, 1000, 0.75, 0.4, false, 0, 2.1, 0, 'East Coast Road temple-town overnight via Puducherry and Thanjavur. Coastal leisure plus festival flows.', ['maa', 'mdu']),
    R('maa-rmd', 490, 10, 1050, 0.65, 0.35, false, 0, 2.0, 0, 'Deep-south coastal overnight via Thanjavur. Pilgrim traffic toward Rameswaram.'),
    R('maa-tvr', 310, 7, 720, 0.7, 0.3, false, 0, 1.9, 0, 'Delta corridor via Puducherry. Evening semis and day seaters both work.'),

    // —— Chennai hub, Tamil Nadu overnight ——
    R('maa-cbe', 500, 9, 1100, 0.75, 0.6, false, 0, 2.2, 5, 'Overnight TN workhorse. Textile and IT return flows.'),
    R('maa-ten', 625, 11, 1350, 0.65, 0.4, false, 0, 2.1, 5, 'Deep-south sleeper via Madurai. Two drivers; loyal Nellai crowd.'),
    R('maa-kkm', 705, 13, 1450, 0.7, 0.45, false, 0, 2.2, 5, 'Land\'s-end overnight. Pilgrim and tourist sleepers; two drivers.'),

    // —— Chennai hub, neighbouring states ——
    R('maa-mys', 480, 9, 1100, 0.6, 0.25, false, 1600, 2.0, 5, 'Palace-city overnight. Leisure weekends, quiet Tuesdays.'),
    R('maa-vga', 455, 8, 1000, 0.7, 0.55, false, 1400, 2.1, 5, 'Andhra commercial corridor. Day and night both sell.'),
    R('maa-hyd', 625, 12, 1450, 0.75, 0.55, false, 2200, 2.2, 10, 'Two-IT-hub overnight. Fierce private competition.'),
    R('maa-koc', 690, 13, 1500, 0.65, 0.35, true, 2000, 1.9, 10, 'Kerala migrant sleeper. Onam flows are enormous.'),
    R('maa-trv', 720, 14, 1500, 0.6, 0.4, true, 2000, 1.9, 10, 'Capital-to-capital via Nagercoil. Tourist plus office traffic.'),
    R('maa-clt', 655, 13, 1400, 0.55, 0.25, true, 2000, 1.9, 10, 'Malabar sleeper via Palakkad. Gulf-leave and Onam peaks.'),
    R('maa-mlr', 710, 14, 1450, 0.5, 0.2, true, 1800, 1.8, 10, 'Coastal Karnataka via Salem. Port and pilgrim traffic.'),
    R('maa-viz', 780, 15, 1600, 0.55, 0.45, false, 2200, 2.0, 15, 'Coastal marathon. Two drivers; thinner midweek.'),
    R('maa-goa', 920, 21, 1850, 0.5, 0.15, true, 2600, 1.8, 20, 'Party-and-beach haul. Weekend and New Year gold, dead weekdays.'),
    R('maa-mum', 1340, 24, 2400, 0.5, 0.55, true, 3200, 2.1, 20, 'West-coast prestige haul. Rail eats the middle; premium sleepers win.'),

    // —— Tamil Nadu to Kerala ——
    R('cbe-koc', 190, 4, 650, 0.75, 0.6, false, 1600, 2.1, 0, 'Industrial and trade shuttle via Palakkad gap. High turnover and cargo.'),
    R('cbe-clt', 180, 5, 600, 0.65, 0.5, false, 1600, 2.0, 0, 'Western TN to Malabar connection via Palakkad. Steady day and evening runs.'),
    R('cbe-trv', 380, 9, 1050, 0.7, 0.6, false, 2000, 2.1, 5, 'Overnight connector traversing central Kerala down to the capital.'),
    R('mdu-koc', 260, 8, 750, 0.6, 0.3, true, 1800, 1.8, 5, 'Spice route crossing Bodimettu ghat. Scenic mountain haul; heavy tourist flow.'),
    R('mdu-trv', 305, 7, 800, 0.7, 0.55, false, 1800, 2.0, 0, 'Southern corridor via Tirunelveli and Nagercoil. Pilgrim and trader traffic.'),
    R('ten-trv', 160, 3, 450, 0.65, 0.6, false, 1400, 1.9, 0, 'Cross-border southern express via Nagercoil. Quick turnaround day service.'),
    R('slm-koc', 355, 8, 950, 0.65, 0.5, false, 2000, 2.1, 5, 'NH544 overnight connecting TN industrial hub to Cochin port.'),

    // —— Tamil Nadu to Karnataka ——
    R('mdu-mys', 485, 9, 1200, 0.65, 0.25, true, 1600, 2.0, 5, 'Temple-to-palace overnight via Dindigul and the Karnataka border. Leisure weekends and festival sleepers.'),
    R('blr-cbe', 365, 7, 900, 0.85, 0.6, false, 1800, 2.3, 0, 'The premier industrial & tech corridor. Massive daily passenger and parcel volume.'),
    R('blr-try', 340, 7, 850, 0.75, 0.5, false, 1800, 2.2, 0, 'Direct Central TN link via Salem and Namakkal. High student and tech worker flows.'),
    R('blr-slm', 200, 4, 550, 0.7, 0.45, false, 1600, 2.2, 0, 'Rapid 4-lane NH44 day hopper. High frequency business transit.'),
    R('blr-ten', 585, 11, 1350, 0.75, 0.5, false, 2000, 2.3, 5, 'Deep-south long-range overnight sleeper via Salem, Dindigul and Madurai bypass. Two drivers.'),
    R('blr-kkm', 665, 13, 1450, 0.7, 0.5, false, 2000, 2.3, 5, 'Direct NH44 cape terminus run. Long haul tourist and pilgrim sleepers.'),
    R('mys-cbe', 200, 7, 550, 0.6, 0.2, true, 1600, 1.8, 0, 'Chamarajanagar and Dhimbam hairpin turns. Breathtaking scenery, slow ghat speeds.'),

    // —— Karnataka to Kerala (Mainly Bengaluru to Kerala) ——
    R('blr-clt', 360, 9, 1100, 0.85, 0.45, true, 2000, 2.0, 0, 'Crucial Malabar artery over Wayanad ghats (Thamarassery Churam). Premium sleepers sell out.'),
    R('blr-trv', 730, 13, 1600, 0.8, 0.55, false, 2400, 2.2, 10, 'Prestige capital-to-capital marathon. Two drivers; Onam and holiday demand spikes.'),
    R('blr-tcr', 480, 9, 1200, 0.75, 0.5, false, 2000, 2.1, 5, 'Cultural capital express via Palakkad gap. High weekend migration; Pooram festival surges.'),
    R('blr-knr', 320, 9, 1050, 0.75, 0.4, true, 2000, 1.9, 0, 'North Kerala connector navigating Coorg and Makutta ghats. Robust daily patronage.'),
    R('blr-pkd', 415, 8, 1000, 0.7, 0.5, false, 2000, 2.1, 0, 'Gateway corridor into Kerala along NH544. Consistent mid-haul flow.'),
    R('blr-mlr', 350, 7, 950, 0.85, 0.4, true, 0, 2.0, 0, 'Karnataka premier coastal link across Shiradi ghat. Year-round heavy volume.'),
    R('mys-clt', 250, 8, 650, 0.65, 0.25, true, 1600, 1.8, 0, 'Interstate transit navigating the Western Ghats to Kozhikode via Kannur.'),

    // —— Rest of the South (Interstate & Intra-State) ——
    R('blr-hyd', 570, 10, 1350, 0.85, 0.5, false, 2500, 2.2, 0, 'The classic overnight IT corridor. Huge demand, brutal competition.'),
    R('hyd-vga', 275, 6, 700, 0.85, 0.5, false, 0, 2.0, 0, 'Dense Telugu corridor. Day and evening services both work.'),
    R('blr-tir', 250, 6, 650, 0.7, 0.3, false, 1200, 2.0, 0, 'Pilgrim traffic from Bengaluru, weekend spikes.'),
    R('blr-mdu', 435, 8, 1100, 0.75, 0.45, false, 1600, 2.1, 0, 'Temple-town overnight connecting Bengaluru to Madurai via Salem and Dindigul. Festival and weekend sleepers sell hard.'),
    R('blr-goa', 560, 12, 1500, 0.6, 0.2, true, 2200, 1.8, 10, 'Tourist route over the ghats. Monsoon is rough, season is gold.'),
    R('blr-koc', 550, 10, 1350, 0.8, 0.5, true, 2000, 1.9, 0, 'Bengaluru–Kerala migrant corridor. Peak weekend and festival traffic.'),
    R('hyd-goa', 665, 15, 1600, 0.55, 0.15, true, 2400, 1.9, 20, 'Party route. Weekend and New Year surges.'),

    // —— Northern & Western Corridors ——
    R('del-jai', 275, 6, 650, 0.9, 0.65, false, 1800, 2.5, 5, 'Pink City tourist and commercial expressway corridor. High competition.'),
    R('del-ixc', 250, 5, 600, 0.9, 0.7, false, 1600, 2.4, 5, 'GT Road high-frequency executive shuttle. Day seats and evening luxury.'),
    R('del-lko', 535, 9, 1200, 0.85, 0.7, false, 2200, 2.6, 10, 'Yamuna & Agra-Lucknow expressway overnight sleeper. Fast tarmac.'),
    R('del-agr', 230, 4, 500, 0.8, 0.7, false, 1400, 2.6, 5, 'Taj Mahal expressway shuttle. Tourist day-trippers and corporate hops.'),
    R('mum-amd', 530, 11, 1300, 0.85, 0.75, false, 2400, 2.4, 15, 'Western trade spine along NH48. High commercial freight and corporate sleepers.'),
    R('mum-pnq', 150, 5, 550, 0.95, 0.6, true, 0, 3.2, 10, 'Expressway shuttle. Volume game if you expand west.'),
    R('blr-mum', 985, 19, 1950, 0.65, 0.6, true, 3000, 2.1, 20, 'Marathon haul. Premium sleepers and two drivers.'),

    // —— South → North Prestige Marathons ——
    R('blr-nag', 1100, 22, 2250, 0.70, 0.60, false, 2800, 2.2, 20, 'Deccan to Vidarbha grand trunk corridor along NH44. Luxury sleeper marathon linking Bengaluru IT to Central India hub; multi-coach rotation.'),
    R('maa-bbs', 1250, 23, 2400, 0.65, 0.65, false, 3200, 2.1, 20, 'East Coast golden corridor along NH16 linking Tamil Nadu to Odisha. Heavy commercial, student and cultural passenger movement.'),

    // —— Major South Indian Mid-Haul & Long-Haul Additions ——
    // Andhra & Telangana corridors
    R('blr-vga', 640, 12, 1450, 0.8, 0.55, false, 2000, 2.2, 5, 'Bustling IT and commercial artery. Constant multi-axle night services along NH44/NH16.'),
    R('blr-viz', 1005, 18, 2050, 0.7, 0.5, false, 2400, 2.2, 15, 'The East Coast marathon connecting Bengaluru to the City of Destiny. Premium sleepers sell out.'),
    R('hyd-viz', 620, 11, 1450, 0.85, 0.6, false, 0, 2.2, 5, 'Telangana to Andhra coastal flagship corridor. Very high sleeper demand and business travel.'),
    R('hyd-cbe', 920, 16, 1950, 0.65, 0.45, false, 2600, 2.2, 10, 'Long-haul manufacturing and IT link along NH44. Steady year-round patronage; two drivers.'),
    R('hyd-koc', 1090, 18, 2200, 0.6, 0.4, true, 2800, 2.1, 15, 'Interstate marathon connecting Cyberabad to Kerala commercial heartland. Two drivers.'),
    R('hyd-tir', 560, 11, 1250, 0.8, 0.45, false, 1800, 2.1, 0, 'Pilgrim spine via Kurnool. Constant round-the-clock demand with intense festival peaks.'),
    R('hyd-pnq', 560, 11, 1300, 0.8, 0.55, false, 2400, 2.3, 5, 'Deccan IT corridor along NH65. High techie and student weekend migration.'),
    R('hyd-mum', 710, 14, 1650, 0.75, 0.6, false, 2800, 2.3, 10, 'Trade and financial highway via Solapur. Commercial parcel and sleeper volume; two drivers.'),
    R('hyd-kno', 215, 4, 480, 0.75, 0.45, false, 1200, 2.1, 0, 'NH44 express connector from Hyderabad into the Rayalaseema heartland.'),
    R('vga-viz', 350, 7, 800, 0.8, 0.65, false, 0, 2.1, 0, 'Coastal Andhra golden corridor along NH16 via Rajahmundry. Day pushbacks and evening AC sleepers.'),

    // Kerala & Coastal Karnataka corridors
    R('koc-mlr', 420, 9, 1150, 0.75, 0.5, true, 1800, 2.0, 5, 'The coastal NH66 corridor linking Kerala to South Canara. High trade and student volume.'),
    R('trv-clt', 390, 9, 1050, 0.8, 0.65, false, 0, 2.0, 0, 'Kerala premier North-South spine connecting Travancore to Malabar via Kochi.'),
    R('trv-koc', 210, 5, 550, 0.85, 0.65, false, 0, 2.1, 0, 'Capital to commercial capital express along NH66. Heavy year-round commuter & executive demand.'),
    R('mlr-goa', 365, 8, 950, 0.65, 0.3, true, 1800, 2.0, 5, 'Coastal Konkan scenic corridor via Udupi and Karwar. Tourist and beach traveler traffic.'),

    // Karnataka, Tamil Nadu & Puducherry mid-hauls
    R('blr-pdy', 310, 7, 750, 0.75, 0.3, false, 1400, 2.0, 0, 'Weekend getaway and cultural route. Heavy Friday night and Sunday evening surges.'),
    R('blr-hbl', 410, 8, 900, 0.8, 0.5, false, 0, 2.2, 0, 'North Karnataka industrial lifeline on NH48. High frequency corporate and student transit.'),
    R('hbl-goa', 155, 4, 420, 0.65, 0.15, true, 1200, 1.8, 0, 'Western Ghats connector descending Anmod Ghat to the Goan coast.'),
    R('mdu-cbe', 215, 5, 520, 0.7, 0.4, false, 0, 2.0, 0, 'Madurai to Western TN corridor via Dindigul. Steady merchant and student traffic.'),
    R('try-cbe', 210, 4, 500, 0.7, 0.45, false, 0, 2.0, 0, 'Central Tamil Nadu textile and industrial hop along NH81 via Karur.'),

    // Popular Dindigul corridors
    R('maa-dgl', 420, 8, 850, 0.75, 0.55, false, 0, 2.2, 0, 'State capital to the lock city along NH45 via Trichy. Heavy merchant, student and agricultural trade transit.'),
    R('blr-dgl', 375, 8, 850, 0.75, 0.45, false, 1600, 2.2, 0, 'Direct interstate link on NH44 via Salem and Karur. Gateway corridor to Dindigul trade and Kodaikanal tourism.'),
    R('cbe-dgl', 165, 4, 420, 0.7, 0.35, false, 0, 2.0, 0, 'Western Tamil Nadu corridor connecting Manchester of South India to Dindigul via Pollachi and Palani.'),
    R('try-dgl', 100, 2, 280, 0.7, 0.5, false, 0, 2.0, 0, 'Rapid Central TN connector along NH83. Steady daytime merchant and student movement.'),

    // —— Round-to-100: night hauls ——
    R('maa-hpt', 520, 10, 1150, 0.70, 0.40, false, 1400, 2.1, 5, 'Tungabhadra corridor linking Tamil Nadu to the UNESCO Hampi heritage basin and Vijayanagar steel hub via Tirupati and Kadapa.'),
    R('blr-klb', 560, 10, 1150, 0.75, 0.45, false, 1600, 2.2, 5, 'Kalyana-Karnataka administrative and university lifeline. High Court, medical college and cement trade overnight.'),
    R('blr-udp', 400, 9, 1000, 0.7, 0.2, true, 0, 1.8, 5, 'Temple-town sleeper over Shiradi ghat via Mangaluru. Krishna Math pilgrims and coastal weekends.'),
    R('mum-klp', 380, 8, 950, 0.75, 0.5, false, 0, 2.6, 10, 'Mumbai to the sugar belt via Pune on the expressway. Busy every night, packed before Diwali.'),
    R('hyd-rjy', 400, 8, 950, 0.8, 0.5, false, 1400, 2.1, 5, 'Godavari corridor via Vijayawada. Dense Telugu hometown traffic; Sankranti is the big one.'),
    R('hyd-nag', 500, 9, 1050, 0.65, 0.6, false, 2000, 2.3, 10, 'Commercial NH44 run into Vidarbha. Rail competes hard midweek; trade traffic holds it up.'),
    R('pnq-goa', 450, 9, 1100, 0.7, 0.3, true, 1800, 2.0, 10, 'Weekend getaway via Kolhapur and Belagavi down the ghats. Friday out, Sunday back; New Year is gold.'),

    // —— Round-to-100: night marathons ——
    R('mum-goa', 590, 12, 1400, 0.85, 0.55, true, 1800, 2.2, 15, 'One of India\'s busiest sleeper routes, via Pune, Kolhapur and Belagavi. Huge leisure peaks; monsoon slows the ghats.'),
    R('blr-pnq', 840, 15, 1800, 0.75, 0.55, false, 2600, 2.3, 15, 'IT-city marathon up NH48 via Hubballi, Belagavi and Kolhapur. Two drivers; Friday and Sunday flows.'),
    R('blr-ktm', 600, 11, 1350, 0.75, 0.45, false, 2000, 2.0, 10, 'Central Kerala sleeper via Salem, Coimbatore and Thrissur. Onam and Christmas send it through the roof.'),
    R('maa-qln', 690, 13, 1500, 0.70, 0.45, false, 2000, 2.1, 10, 'Southern Kerala overnight connecting Chennai to the cashew and Ashtamudi backwaters capital via Madurai, Tenkasi and Sengottai. Strong migrant and business flows.'),
    R('maa-wyd', 590, 11, 1350, 0.75, 0.45, false, 1800, 2.1, 5, 'High-yield Western Ghats hill-country sleeper linking Chennai to the Kalpetta and Sultan Bathery plantation belt via Salem and Coimbatore. Premium weekend leisure and spice trade traffic.'),
    R('mum-idr', 590, 11, 1350, 0.7, 0.55, false, 2400, 2.4, 15, 'Trade marathon on NH52 into Madhya Pradesh. Merchants and students; steady all week.'),
    R('blr-qln', 680, 12, 1500, 0.7, 0.5, false, 2000, 2.1, 10, 'Southern Kerala sleeper via Coimbatore, Thrissur and Kochi. Kollam\'s first private link to Bengaluru.'),

    // —— Round-to-100: ultra marathons ——
    R('maa-pnq', 1180, 19, 2200, 0.55, 0.6, false, 3000, 2.2, 20, 'Ultra up NH48 via Bengaluru, Hubballi and Kolhapur. Students and IT staff when trains are full; multi-coach rotation.'),
    R('hyd-kkm', 1200, 20, 2300, 0.55, 0.5, false, 2800, 2.2, 20, 'Cape ultra via Kurnool, Bengaluru, Madurai and Tirunelveli. Pilgrims and tourists; one coach covers a direction every two days.'),
    R('viz-ccu', 880, 17, 1850, 0.70, 0.50, false, 2200, 2.1, 15, 'Grand Eastern trunk along NH16 linking Visakhapatnam port and steel hub to Kolkata via Bhubaneswar. High-volume business, university and coastal holiday movement.'),
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

export function canonicalRouteId(id: string): string {
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

  // 1. Chennai is the state capital and primary gateway: always starting point
  if (r.from === 'maa' || r.to === 'maa') {
    const other = r.from === 'maa' ? r.to : r.from
    return `Chennai – ${CITIES[other]?.name ?? other}`
  }
  // 2. Bengaluru is state capital / major intercity hub: always starting point (except with Chennai)
  if (r.from === 'blr' || r.to === 'blr') {
    const other = r.from === 'blr' ? r.to : r.from
    return `Bengaluru – ${CITIES[other]?.name ?? other}`
  }
  // 3. Madurai: always show Madurai as starting destination for non-capital corridors
  if (r.from === 'mdu' || r.to === 'mdu') {
    const other = r.from === 'mdu' ? r.to : r.from
    return `Madurai – ${CITIES[other]?.name ?? other}`
  }

  return `${CITIES[r.from]?.name ?? r.from} – ${CITIES[r.to]?.name ?? r.to}`
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
  ['hyd', 'kkm', ['kno', 'blr', 'mdu', 'ten']],
  ['viz', 'ccu', ['bbs']],
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

export type HaulStyle = 'day' | 'mid' | 'overnight' | 'marathon' | 'ultra'

export function haulStyleOfHours(hours: number): HaulStyle {
  const h = displayRouteHours(hours)
  if (h > 16) return 'ultra'
  if (h >= 10) return 'marathon'
  if (h >= 8) return 'overnight'
  if (h < 6) return 'day'
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
  day: [[8, 12], [18, 22]],
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
    default: return 'Day hop'
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
      return `Day hop${on}. ${win}. Seaters carry these.`
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
  if (filter === '<6') return h < 6
  if (filter === '6-8') return h >= 6 && h < 8
  if (filter === '8-10') return h >= 8 && h < 10
  if (filter === '10-16' || filter === '>10') return h >= 10 && h <= 16
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
