import type { BodyBuilder } from '../engine/types'
import { getSupabase, isCloudImagesConfigured } from '../lib/supabase'
import { uploadGameImage } from './cloudImages'

export interface CloudCatalogResult {
  bodyBuilders: Record<string, BodyBuilder>
  updatedAt: string
}

export interface PublishCatalogResult {
  ok: boolean
  uploadedImages: number
  error?: string
  bodyBuilders: Record<string, BodyBuilder>
  updatedAt?: string
}

/** Converts a data URL (base64) to a Blob for upload. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',')
  const mimeMatch = parts[0].match(/:(.*?);/)
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg'
  const isBase64 = parts[0].includes('base64')

  if (isBase64) {
    if (typeof atob === 'function') {
      const bstr = atob(parts[1])
      let n = bstr.length
      const u8arr = new Uint8Array(n)
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n)
      }
      return new Blob([u8arr], { type: mime })
    }
    if (typeof Buffer !== 'undefined') {
      const buf = Buffer.from(parts[1], 'base64')
      return new Blob([buf], { type: mime })
    }
  }

  const decoded = decodeURIComponent(parts[1] || '')
  return new Blob([decoded], { type: mime })
}

/**
 * Fetch the global coach catalog JSON document from Supabase.
 * Returns null if cloud is unconfigured, table is missing, or row does not exist yet.
 */
export async function fetchBodyCatalog(): Promise<CloudCatalogResult | null> {
  if (!isCloudImagesConfigured()) return null
  const supabase = getSupabase()
  if (!supabase) return null

  try {
    const { data, error } = await supabase
      .from('body_catalog')
      .select('body_builders, updated_at')
      .eq('id', 'global')
      .maybeSingle()

    if (error) {
      console.warn('Failed to fetch body_catalog from Supabase:', error.message)
      return null
    }

    if (!data || !data.body_builders || typeof data.body_builders !== 'object') {
      return null
    }

    return {
      bodyBuilders: data.body_builders as Record<string, BodyBuilder>,
      updatedAt: data.updated_at || new Date().toISOString(),
    }
  } catch (err: any) {
    console.warn('Exception fetching body_catalog:', err?.message || err)
    return null
  }
}

/**
 * Publishes the local body catalog to Supabase:
 * 1. Finds all designs with data-URLs or blobs.
 * 2. Uploads images to game-images storage bucket (skipping existing http/https URLs).
 * 3. Replaces image data-URLs with public storage URLs.
 * 4. Upserts the full body_builders JSON document to body_catalog (id='global').
 */
export async function publishBodyCatalog(
  builders: Record<string, BodyBuilder>,
  onProgress?: (status: string) => void,
): Promise<PublishCatalogResult> {
  if (!isCloudImagesConfigured()) {
    return {
      ok: false,
      uploadedImages: 0,
      error: 'Cloud storage is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local.',
      bodyBuilders: builders,
    }
  }

  const supabase = getSupabase()
  if (!supabase) {
    return {
      ok: false,
      uploadedImages: 0,
      error: 'Supabase client failed to initialize.',
      bodyBuilders: builders,
    }
  }

  // Deep clone to avoid mutating in-flight objects before success
  const clone: Record<string, BodyBuilder> = JSON.parse(JSON.stringify(builders))
  let uploadedImages = 0

  // 1. Collect all designs that have data-URL images
  const toUpload: { builderId: string; designId: string; dataUrl: string }[] = []
  for (const [bId, b] of Object.entries(clone)) {
    for (const d of b.designs) {
      if (d.image && (d.image.startsWith('data:image/') || d.image.startsWith('blob:'))) {
        toUpload.push({ builderId: bId, designId: d.id, dataUrl: d.image })
      }
    }
  }

  // 2. Upload images to Supabase Storage
  if (toUpload.length > 0) {
    onProgress?.(`Uploading ${toUpload.length} design photo${toUpload.length > 1 ? 's' : ''}…`)

    for (let i = 0; i < toUpload.length; i++) {
      const item = toUpload[i]
      onProgress?.(`Uploading photo ${i + 1} of ${toUpload.length}…`)
      try {
        let blob: Blob
        if (item.dataUrl.startsWith('blob:')) {
          const resp = await fetch(item.dataUrl)
          blob = await resp.blob()
        } else {
          blob = dataUrlToBlob(item.dataUrl)
        }

        const res = await uploadGameImage({
          file: blob,
          kind: 'body_design',
          ownerKey: `design:${item.designId}`,
          fileName: `${item.designId}.jpg`,
        })

        // Update clone with cloud URL
        const design = clone[item.builderId]?.designs.find((d) => d.id === item.designId)
        if (design) {
          design.image = res.url
        }
        uploadedImages++
      } catch (err: any) {
        console.warn(`Failed to upload photo for design ${item.designId}:`, err?.message || err)
        // Continue with other designs
      }
    }
  }

  // 3. Upsert JSON document into body_catalog
  onProgress?.('Saving catalog document to Supabase…')
  const now = new Date().toISOString()
  try {
    const { error: upsertErr } = await supabase.from('body_catalog').upsert({
      id: 'global',
      body_builders: clone,
      updated_at: now,
    })

    if (upsertErr) {
      return {
        ok: false,
        uploadedImages,
        error: `Database save failed: ${upsertErr.message}. Make sure body_catalog table exists and has RLS policies.`,
        bodyBuilders: clone,
      }
    }

    return {
      ok: true,
      uploadedImages,
      bodyBuilders: clone,
      updatedAt: now,
    }
  } catch (err: any) {
    return {
      ok: false,
      uploadedImages,
      error: `Network error saving to Supabase: ${err?.message || err}`,
      bodyBuilders: clone,
    }
  }
}
