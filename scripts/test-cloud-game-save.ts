import { toSaveDto } from '../src/store/saveCodec'
import { computeDelta, foldDeltas } from '../src/store/cloudGameSave'

async function runTest() {
  console.log('Testing save codec thinning and cloud deltas...')

  const mockState: any = {
    version: 4,
    day: 10,
    company: { name: 'Royal Express', cash: 500000 },
    difficulty: 'malik',
    bodyBuilders: {
      prakesh: { name: 'Prakesh', designs: [] }
    },
    groups: {
      g1: { id: 'g1', name: 'Luxury Group', brandingPic: 'data:image/png;base64,iVBORw0KGgo...' },
      g2: { id: 'g2', name: 'Budget Group', brandingPic: 'https://supabase.co/img.png' }
    },
    trips: {
      t1: { id: 't1', routeId: 'r1', busId: 'b1', day: 10, status: 'open', price: 600 },
      t2: { id: 't2', routeId: 'r2', busId: 'b2', day: 10, status: 'open', price: 750 }
    },
    buses: {
      b1: { id: 'b1', odoKm: 12000, condition: 0.95 },
      b2: { id: 'b2', odoKm: 25000, condition: 0.88 }
    }
  }

  // 1. Verify toSaveDto thins bodyBuilders & strips data: urls
  const dto1 = toSaveDto(mockState)
  if ('bodyBuilders' in dto1) {
    throw new Error('bodyBuilders was NOT omitted from save DTO!')
  }
  if ((dto1.groups as any)?.g1?.brandingPic) {
    throw new Error('Accidental data: URL was NOT stripped from brandingPic!')
  }
  if ((dto1.groups as any)?.g2?.brandingPic !== 'https://supabase.co/img.png') {
    throw new Error('Valid https URL was improperly modified!')
  }
  console.log('✔ toSaveDto thinning and data: sanitization passed.')

  // 2. Simulate next day state
  const mockStateDay11: any = {
    ...mockState,
    day: 11,
    company: { name: 'Royal Express', cash: 540000 },
    trips: {
      // t1 modified, t2 deleted (e.g. rolled up), t3 added
      t1: { id: 't1', routeId: 'r1', busId: 'b1', day: 10, status: 'completed', price: 600 },
      t3: { id: 't3', routeId: 'r1', busId: 'b1', day: 11, status: 'open', price: 620 }
    },
    buses: {
      b1: { id: 'b1', odoKm: 12450, condition: 0.94 },
      b2: { id: 'b2', odoKm: 25000, condition: 0.88 } // unchanged
    }
  }

  const dto2 = toSaveDto(mockStateDay11)
  const patch = computeDelta(dto1, dto2)

  console.log('Generated delta keys:', Object.keys(patch))
  if (patch.day !== 11) throw new Error('Expected patch.day === 11')
  if (!patch.trips?.t1 || !patch.trips?.t3) throw new Error('Expected changed trips t1 and t3')
  if (!patch.deletedTrips?.includes('t2')) throw new Error('Expected deletedTrips to contain t2')
  if (!patch.buses?.b1 || patch.buses?.b2) throw new Error('Expected only modified bus b1 in patch')

  // 3. Fold delta onto base dto1
  const folded = foldDeltas(dto1, [{ day: 11, patch }])
  if (folded.day !== 11) throw new Error('Folded day mismatch')
  if (folded.company.cash !== 540000) throw new Error('Folded cash mismatch')
  if (folded.trips.t1.status !== 'completed') throw new Error('Folded trip t1 status mismatch')
  if (folded.trips.t2 !== undefined) throw new Error('Deleted trip t2 still present in folded!')
  if (folded.trips.t3.price !== 620) throw new Error('New trip t3 missing from folded!')
  if (folded.buses.b1.odoKm !== 12450) throw new Error('Bus b1 odo mismatch in folded')
  if (folded.buses.b2.odoKm !== 25000) throw new Error('Bus b2 odo mismatch in folded')

  console.log('✔ computeDelta and foldDeltas correctly round-tripped and pruned data!')
}

runTest().catch((err) => {
  console.error('Test failed:', err)
  process.exit(1)
})
