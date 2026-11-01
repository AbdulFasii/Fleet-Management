import { rs } from '../core/money'
import type { RouteDef } from '../types'
import { CITIES, cityPickups } from './cities'

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
  'maa-pnq': ['VRL', 'National Travels', 'Neeta Tours'],
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
}

const R = (
  id: string, km: number, hours: number, marketFareAC: number, baseDemand: number,
  competition: number, rail: number, ghat: boolean, borderTax: number, tollPerKm: number,
  unlockRep: number, notes: string,
  /** Explicit endpoints when the id is not a plain `from-to` pair (e.g. path variants). */
  endpoints?: [string, string],
): RouteDef => {
  const [from, to] = endpoints ?? (id.split('-') as [string, string])
  return {
    id, from, to, km, hours,
    marketFareAC: rs(marketFareAC),
    baseDemand, competition,
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
    R('maa-blr', 350, 6.5, 950, 4200, 0.8, 0.7, false, 1800, 2.4, 0, 'The IT hop. Strong rail competition; evening semis do well.'),
    R('maa-pdy', 165, 3.5, 450, 2800, 0.7, 0.15, false, 400, 1.6, 0, 'Weekend leisure shuttle. Multiple day trips per bus.'),
    R('maa-tir', 150, 3.5, 480, 3200, 0.65, 0.25, false, 800, 1.8, 0, 'Pilgrim day-and-evening run. Weekends and Brahmotsavam explode.'),
    R('maa-nlr', 175, 4, 420, 2400, 0.6, 0.35, false, 700, 1.7, 0, 'Andhra day shuttle up NH16. Multiple turns; thin sleeper demand.'),
    R('maa-try', 330, 6, 750, 3000, 0.75, 0.55, false, 0, 2.1, 0, 'Rock Fort corridor. Day seaters and evening semis both work.'),
    R('maa-slm', 340, 6, 720, 2600, 0.7, 0.5, false, 0, 2.0, 0, 'NH44 industrial hop. Steady weekday traffic, thin sleeper demand.'),
    R('maa-mdu', 460, 8, 1000, 5500, 0.8, 0.65, false, 0, 2.3, 0, 'Temple-town overnight connecting Chennai to Madurai via Trichy. Festival swings are massive.'),
    R('maa-mdu-ecr', 480, 8.5, 1000, 3500, 0.75, 0.4, false, 0, 2.1, 0, 'East Coast Road temple-town overnight via Puducherry and Thanjavur. Coastal leisure plus festival flows.', ['maa', 'mdu']),
    R('maa-rmd', 490, 10, 1050, 2000, 0.65, 0.35, false, 0, 2.0, 0, 'Deep-south coastal overnight via Thanjavur. Pilgrim traffic toward Rameswaram.'),
    R('maa-tvr', 310, 6.5, 720, 2400, 0.7, 0.3, false, 0, 1.9, 0, 'Delta corridor via Puducherry. Evening semis and day seaters both work.'),

    // —— Chennai hub, Tamil Nadu overnight ——
    R('maa-cbe', 500, 8, 1100, 3800, 0.75, 0.6, false, 0, 2.2, 5, 'Overnight TN workhorse. Textile and IT return flows.'),
    R('maa-ten', 625, 11, 1350, 3000, 0.65, 0.4, false, 0, 2.1, 5, 'Deep-south sleeper via Madurai. Two drivers; loyal Nellai crowd.'),
    R('maa-kkm', 705, 13, 1450, 2200, 0.7, 0.45, false, 0, 2.2, 5, 'Land\'s-end overnight. Pilgrim and tourist sleepers; two drivers.'),

    // —— Chennai hub, neighbouring states ——
    R('maa-mys', 480, 8, 1100, 1800, 0.6, 0.25, false, 1600, 2.0, 5, 'Palace-city overnight. Leisure weekends, quiet Tuesdays.'),
    R('maa-vga', 455, 7, 1000, 2400, 0.7, 0.55, false, 1400, 2.1, 5, 'Andhra commercial corridor. Day and night both sell.'),
    R('maa-hyd', 625, 11, 1450, 2800, 0.75, 0.55, false, 2200, 2.2, 10, 'Two-IT-hub overnight. Fierce private competition.'),
    R('maa-koc', 690, 12, 1500, 2100, 0.65, 0.35, true, 2000, 1.9, 10, 'Kerala migrant sleeper. Onam flows are enormous.'),
    R('maa-trv', 720, 13, 1500, 1900, 0.6, 0.4, true, 2000, 1.9, 10, 'Capital-to-capital via Nagercoil. Tourist plus office traffic.'),
    R('maa-clt', 655, 12, 1400, 1700, 0.55, 0.25, true, 2000, 1.9, 10, 'Malabar sleeper via Palakkad. Gulf-leave and Onam peaks.'),
    R('maa-mlr', 710, 13, 1450, 1500, 0.5, 0.2, true, 1800, 1.8, 10, 'Coastal Karnataka via Salem. Port and pilgrim traffic.'),
    R('maa-viz', 780, 14, 1600, 1600, 0.55, 0.45, false, 2200, 2.0, 15, 'Coastal marathon. Two drivers; thinner midweek.'),
    R('maa-goa', 920, 16, 1850, 1200, 0.5, 0.15, true, 2600, 1.8, 20, 'Party-and-beach haul. Weekend and New Year gold, dead weekdays.'),
    R('maa-pnq', 1170, 20, 2150, 1100, 0.45, 0.35, true, 2800, 2.0, 20, 'Deccan marathon. IT and student sleepers; two drivers.'),
    R('maa-mum', 1340, 22, 2400, 1400, 0.5, 0.55, true, 3200, 2.1, 20, 'West-coast prestige haul. Rail eats the middle; premium sleepers win.'),

    // —— Tamil Nadu to Kerala ——
    R('cbe-koc', 190, 4.5, 650, 3800, 0.75, 0.6, false, 1600, 2.1, 0, 'Industrial and trade shuttle via Palakkad gap. High turnover and cargo.'),
    R('cbe-clt', 180, 4.5, 600, 2800, 0.65, 0.5, false, 1600, 2.0, 0, 'Western TN to Malabar connection via Palakkad. Steady day and evening runs.'),
    R('cbe-trv', 380, 8, 1050, 2600, 0.7, 0.6, false, 2000, 2.1, 5, 'Overnight connector traversing central Kerala down to the capital.'),
    R('mdu-koc', 260, 6.5, 750, 2200, 0.6, 0.3, true, 1800, 1.8, 5, 'Spice route crossing Bodimettu ghat. Scenic mountain haul; heavy tourist flow.'),
    R('mdu-trv', 305, 6.5, 800, 3000, 0.7, 0.55, false, 1800, 2.0, 0, 'Southern corridor via Tirunelveli and Nagercoil. Pilgrim and trader traffic.'),
    R('ten-trv', 160, 3.5, 450, 3200, 0.65, 0.6, false, 1400, 1.9, 0, 'Cross-border southern express via Nagercoil. Quick turnaround day service.'),
    R('slm-koc', 355, 8, 950, 2200, 0.65, 0.5, false, 2000, 2.1, 5, 'NH544 overnight connecting TN industrial hub to Cochin port.'),

    // —— Tamil Nadu to Karnataka ——
    R('mdu-mys', 485, 9, 1200, 2200, 0.65, 0.25, true, 1600, 2.0, 5, 'Temple-to-palace overnight via Dindigul and the Karnataka border. Leisure weekends and festival sleepers.'),
    R('blr-cbe', 365, 7, 900, 5600, 0.85, 0.6, false, 1800, 2.3, 0, 'The premier industrial & tech corridor. Massive daily passenger and parcel volume.'),
    R('blr-try', 340, 7, 850, 3800, 0.75, 0.5, false, 1800, 2.2, 0, 'Direct Central TN link via Salem and Namakkal. High student and tech worker flows.'),
    R('blr-slm', 200, 4, 550, 3400, 0.7, 0.45, false, 1600, 2.2, 0, 'Rapid 4-lane NH44 day hopper. High frequency business transit.'),
    R('blr-ten', 585, 10, 1350, 3100, 0.75, 0.5, false, 2000, 2.3, 5, 'Deep-south long-range overnight sleeper via Salem, Dindigul and Madurai bypass. Two drivers.'),
    R('blr-kkm', 665, 12, 1450, 2500, 0.7, 0.5, false, 2000, 2.3, 5, 'Direct NH44 cape terminus run. Long haul tourist and pilgrim sleepers.'),
    R('mys-cbe', 200, 6.5, 550, 2000, 0.6, 0.2, true, 1600, 1.8, 0, 'Chamarajanagar and Dhimbam hairpin turns. Breathtaking scenery, slow ghat speeds.'),

    // —— Karnataka to Kerala (Mainly Bengaluru to Kerala) ——
    R('blr-clt', 360, 10, 1100, 5000, 0.85, 0.45, true, 2000, 2.0, 0, 'Crucial Malabar artery over Wayanad ghats (Thamarassery Churam). Premium sleepers sell out.'),
    R('blr-trv', 730, 13.5, 1600, 3600, 0.8, 0.55, false, 2400, 2.2, 10, 'Prestige capital-to-capital marathon. Two drivers; Onam and holiday demand spikes.'),
    R('blr-tcr', 480, 8, 1200, 3400, 0.75, 0.5, false, 2000, 2.1, 5, 'Cultural capital express via Palakkad gap. High weekend migration; Pooram festival surges.'),
    R('blr-knr', 320, 8, 1050, 3200, 0.75, 0.4, true, 2000, 1.9, 0, 'North Kerala connector navigating Coorg and Makutta ghats. Robust daily patronage.'),
    R('blr-pkd', 415, 8, 1000, 2800, 0.7, 0.5, false, 2000, 2.1, 0, 'Gateway corridor into Kerala along NH544. Consistent mid-haul flow.'),
    R('blr-mlr', 350, 8, 950, 4500, 0.85, 0.4, true, 0, 2.0, 0, 'Karnataka premier coastal link across Shiradi ghat. Year-round heavy volume.'),
    R('mys-clt', 250, 8, 650, 2400, 0.65, 0.25, true, 1600, 1.8, 0, 'Interstate transit navigating the Western Ghats to Kozhikode via Kannur.'),

    // —— Rest of the South (Interstate & Intra-State) ——
    R('blr-hyd', 570, 10, 1350, 5500, 0.85, 0.5, false, 2500, 2.2, 0, 'The classic overnight IT corridor. Huge demand, brutal competition.'),
    R('hyd-vga', 275, 6.5, 700, 5200, 0.85, 0.5, false, 0, 2.0, 0, 'Dense Telugu corridor. Day and evening services both work.'),
    R('blr-tir', 250, 5, 650, 3000, 0.7, 0.3, false, 1200, 2.0, 0, 'Pilgrim traffic from Bengaluru, weekend spikes.'),
    R('blr-mdu', 435, 8, 1100, 3200, 0.75, 0.45, false, 1600, 2.1, 0, 'Temple-town overnight connecting Bengaluru to Madurai via Salem and Dindigul. Festival and weekend sleepers sell hard.'),
    R('blr-goa', 560, 12, 1500, 1800, 0.6, 0.2, true, 2200, 1.8, 10, 'Tourist route over the ghats. Monsoon is rough, season is gold.'),
    R('blr-koc', 550, 10, 1350, 5200, 0.8, 0.5, true, 2000, 1.9, 0, 'Bengaluru–Kerala migrant corridor. Peak weekend and festival traffic.'),
    R('hyd-goa', 665, 12.5, 1600, 1500, 0.55, 0.15, true, 2400, 1.9, 20, 'Party route. Weekend and New Year surges.'),

    // —— Northern & Western Corridors ——
    R('del-jai', 275, 5, 650, 6200, 0.9, 0.65, false, 1800, 2.5, 5, 'Pink City tourist and commercial expressway corridor. High competition.'),
    R('del-ixc', 250, 4.5, 600, 5800, 0.9, 0.7, false, 1600, 2.4, 5, 'GT Road high-frequency executive shuttle. Day seats and evening luxury.'),
    R('del-lko', 535, 8, 1200, 4800, 0.85, 0.7, false, 2200, 2.6, 10, 'Yamuna & Agra-Lucknow expressway overnight sleeper. Fast tarmac.'),
    R('del-agr', 230, 3.5, 500, 4400, 0.8, 0.7, false, 1400, 2.6, 5, 'Taj Mahal expressway shuttle. Tourist day-trippers and corporate hops.'),
    R('mum-amd', 530, 10, 1300, 5400, 0.85, 0.75, false, 2400, 2.4, 15, 'Western trade spine along NH48. High commercial freight and corporate sleepers.'),
    R('mum-pnq', 150, 3.5, 550, 9000, 0.95, 0.6, true, 0, 3.2, 10, 'Expressway shuttle. Volume game if you expand west.'),
    R('blr-mum', 985, 17, 1950, 2500, 0.65, 0.6, true, 3000, 2.1, 20, 'Marathon haul. Premium sleepers and two drivers.'),

    // —— Major South Indian Mid-Haul & Long-Haul Additions ——
    // Andhra & Telangana corridors
    R('blr-vga', 640, 11, 1450, 4800, 0.8, 0.55, false, 2000, 2.2, 5, 'Bustling IT and commercial artery. Constant multi-axle night services along NH44/NH16.'),
    R('blr-viz', 1005, 17, 2050, 2400, 0.7, 0.5, false, 2400, 2.2, 15, 'The East Coast marathon connecting Bengaluru to the City of Destiny. Premium sleepers sell out.'),
    R('hyd-viz', 620, 10.5, 1450, 5200, 0.85, 0.6, false, 0, 2.2, 5, 'Telangana to Andhra coastal flagship corridor. Very high sleeper demand and business travel.'),
    R('hyd-cbe', 920, 15, 1950, 2200, 0.65, 0.45, false, 2600, 2.2, 10, 'Long-haul manufacturing and IT link along NH44. Steady year-round patronage; two drivers.'),
    R('hyd-koc', 1090, 18, 2200, 1800, 0.6, 0.4, true, 2800, 2.1, 15, 'Interstate marathon connecting Cyberabad to Kerala commercial heartland. Two drivers.'),
    R('hyd-tir', 560, 9.5, 1250, 4600, 0.8, 0.45, false, 1800, 2.1, 0, 'Pilgrim spine via Kurnool. Constant round-the-clock demand with intense festival peaks.'),
    R('hyd-pnq', 560, 9.5, 1300, 4500, 0.8, 0.55, false, 2400, 2.3, 5, 'Deccan IT corridor along NH65. High techie and student weekend migration.'),
    R('hyd-mum', 710, 12.5, 1650, 3200, 0.75, 0.6, false, 2800, 2.3, 10, 'Trade and financial highway via Solapur. Commercial parcel and sleeper volume; two drivers.'),
    R('hyd-kno', 215, 4, 480, 3800, 0.75, 0.45, false, 1200, 2.1, 0, 'NH44 express connector from Hyderabad into the Rayalaseema heartland.'),
    R('vga-viz', 350, 6.5, 800, 4600, 0.8, 0.65, false, 0, 2.1, 0, 'Coastal Andhra golden corridor along NH16 via Rajahmundry. Day pushbacks and evening AC sleepers.'),

    // Kerala & Coastal Karnataka corridors
    R('koc-mlr', 420, 9, 1150, 3600, 0.75, 0.5, true, 1800, 2.0, 5, 'The coastal NH66 corridor linking Kerala to South Canara. High trade and student volume.'),
    R('trv-clt', 390, 8.5, 1050, 4200, 0.8, 0.65, false, 0, 2.0, 0, 'Kerala premier North-South spine connecting Travancore to Malabar via Kochi.'),
    R('trv-koc', 210, 5, 550, 5000, 0.85, 0.65, false, 0, 2.1, 0, 'Capital to commercial capital express along NH66. Heavy year-round commuter & executive demand.'),
    R('mlr-goa', 365, 7.5, 950, 2400, 0.65, 0.3, true, 1800, 2.0, 5, 'Coastal Konkan scenic corridor via Udupi and Karwar. Tourist and beach traveler traffic.'),

    // Karnataka, Tamil Nadu & Puducherry mid-hauls
    R('blr-pdy', 310, 6.5, 750, 3400, 0.75, 0.3, false, 1400, 2.0, 0, 'Weekend getaway and cultural route. Heavy Friday night and Sunday evening surges.'),
    R('blr-hbl', 410, 7, 900, 4400, 0.8, 0.5, false, 0, 2.2, 0, 'North Karnataka industrial lifeline on NH48. High frequency corporate and student transit.'),
    R('hbl-goa', 155, 3.5, 420, 2800, 0.65, 0.15, true, 1200, 1.8, 0, 'Western Ghats connector descending Anmod Ghat to the Goan coast.'),
    R('mdu-cbe', 215, 4.5, 520, 3600, 0.7, 0.4, false, 0, 2.0, 0, 'Madurai to Western TN corridor via Dindigul. Steady merchant and student traffic.'),
    R('try-cbe', 210, 4.5, 500, 3200, 0.7, 0.45, false, 0, 2.0, 0, 'Central Tamil Nadu textile and industrial hop along NH81 via Karur.'),

    // Popular Dindigul corridors
    R('maa-dgl', 420, 8, 850, 3600, 0.75, 0.55, false, 0, 2.2, 0, 'State capital to the lock city along NH45 via Trichy. Heavy merchant, student and agricultural trade transit.'),
    R('blr-dgl', 375, 8, 850, 3400, 0.75, 0.45, false, 1600, 2.2, 0, 'Direct interstate link on NH44 via Salem and Karur. Gateway corridor to Dindigul trade and Kodaikanal tourism.'),
    R('cbe-dgl', 165, 3.5, 420, 3200, 0.7, 0.35, false, 0, 2.0, 0, 'Western Tamil Nadu corridor connecting Manchester of South India to Dindigul via Pollachi and Palani.'),
    R('try-dgl', 100, 2, 280, 2800, 0.7, 0.5, false, 0, 2.0, 0, 'Rapid Central TN connector along NH83. Steady daytime merchant and student movement.'),
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
  ['maa', 'pnq', ['blr']],
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

export type HaulStyle = 'day' | 'mid' | 'overnight' | 'marathon'

export function haulStyle(r: RouteDef): HaulStyle {
  const h = displayRouteHours(r.hours)
  if (h > 10) return 'marathon'
  if (h >= 8) return 'overnight'
  if (h < 6) return 'day'
  return 'mid'
}

/** Short badge text for the haul. */
export function haulTitle(r: RouteDef): string {
  switch (haulStyle(r)) {
    case 'marathon': return 'Marathon night haul'
    case 'overnight': return 'Night haul'
    case 'mid': return 'Mid-haul'
    default: return 'Day hop'
  }
}

/**
 * How this haul actually earns — the departure window that works, what layout
 * sells, and (over 10h) the two-driver rule. Kept in one place so the corridor
 * table, schedule builder and setup screen all say the same thing.
 */
export function haulBrief(r: RouteDef): string {
  const h = displayRouteHours(r.hours)
  switch (haulStyle(r)) {
    case 'marathon':
      return `Marathon night haul — ${h}h on the road needs two drivers (CMVR limit is 10h per driver). Sleeper berths only; departures between 19:30 and 23:30 sell, while a 01:00–05:30 start arrives mid-afternoon and runs near empty.`
    case 'overnight':
      return `Night haul — the coach runs while passengers sleep, so berths sell. Depart 19:30–23:30 for the best loads; a 07:30–11:00 start wastes the passenger's working day and loads thin.`
    case 'mid':
      return `Mid-haul — evening departures (17:00–23:00) are the money window. Berths and rear cabin fill at the same rate, so a hybrid coach works as well as a pure sleeper.`
    default:
      return `Day hop — morning (06:00–10:00) and evening (16:00–20:00) departures carry the coach on seaters. Midday is soft and the small hours are dead.`
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
  if (filter === '8-10') return h === 8 || h === 10
  if (filter === '>10') return h > 10
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
