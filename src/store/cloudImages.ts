import { getSupabase, isCloudImagesConfigured, SUPABASE_BUCKET } from '../lib/supabase'

export type ImageKind = 'branding' | 'gallery' | 'body_design'

export interface GameImageRecord {
  id: string
  kind: ImageKind
  owner_key: string
  path: string
  url: string
  mime: string
  bytes: number
  width?: number
  height?: number
  created_at?: string
}

export interface UploadGameImageParams {
  file: File | Blob
  kind: ImageKind
  ownerKey: string
  fileName?: string
}

export interface UploadGameImageResult {
  id: string
  url: string
  record?: GameImageRecord
}

/** Sanitize ownerKey for safe use in storage path (e.g. "group:grp_1" -> "group_grp_1"). */
export function sanitizeStorageKey(key: string): string {
  return key.trim().replace(/[^a-zA-Z0-9_\-\.]/g, '_')
}

/** Get image dimensions from a File or Blob without downscaling or altering bytes. */
export async function measureImageDimensions(file: File | Blob): Promise<{ width?: number; height?: number }> {
  try {
    if (typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(file)
      const dims = { width: bmp.width, height: bmp.height }
      bmp.close()
      return dims
    }
  } catch {
    // Fallback to Image element
  }

  if (typeof window !== 'undefined' && typeof Image !== 'undefined') {
    return new Promise((resolve) => {
      const objectUrl = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => {
        const dims = {
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height,
        }
        URL.revokeObjectURL(objectUrl)
        resolve(dims)
      }
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl)
        resolve({})
      }
      img.src = objectUrl
    })
  }

  return {}
}

/** Determine file extension from File name or MIME type. */
function getExtension(file: File | Blob, customName?: string): string {
  if (customName && customName.includes('.')) {
    return customName.split('.').pop()?.toLowerCase() || 'jpg'
  }
  if ('name' in file && typeof file.name === 'string' && file.name.includes('.')) {
    return file.name.split('.').pop()?.toLowerCase() || 'jpg'
  }
  const type = file.type || ''
  if (type.includes('png')) return 'png'
  if (type.includes('webp')) return 'webp'
  if (type.includes('gif')) return 'gif'
  if (type.includes('svg')) return 'svg'
  return 'jpg'
}

/**
 * Upload an original image to Supabase Storage and register in game_images table.
 * Preserves full original bytes (no crushing/downscaling).
 */
export async function uploadGameImage({
  file,
  kind,
  ownerKey,
  fileName,
}: UploadGameImageParams): Promise<UploadGameImageResult> {
  if (!isCloudImagesConfigured()) {
    throw new Error('Cloud image storage is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local.')
  }

  const supabase = getSupabase()
  if (!supabase) {
    throw new Error('Supabase client failed to initialize.')
  }

  const id = crypto.randomUUID()
  const ext = getExtension(file, fileName)
  const safeOwner = sanitizeStorageKey(ownerKey)
  // Path convention: {owner_key}/{kind}/{uuid}.{ext}
  const path = `${safeOwner}/${kind}/${id}.${ext}`

  const dims = await measureImageDimensions(file)
  const mime = file.type || (ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg')

  // Upload original bytes to Supabase Storage
  const { error: uploadErr } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .upload(path, file, {
      contentType: mime,
      upsert: true,
    })

  if (uploadErr) {
    throw new Error(`Storage upload failed: ${uploadErr.message}`)
  }

  // Get public URL
  const { data: pubData } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(path)
  const url = pubData.publicUrl

  const record: GameImageRecord = {
    id,
    kind,
    owner_key: ownerKey,
    path,
    url,
    mime,
    bytes: file.size,
    width: dims.width,
    height: dims.height,
    created_at: new Date().toISOString(),
  }

  // Record metadata in game_images table
  try {
    const { error: dbErr } = await supabase.from('game_images').insert({
      id,
      kind,
      owner_key: ownerKey,
      path,
      url,
      mime: record.mime,
      bytes: record.bytes,
      width: record.width ?? null,
      height: record.height ?? null,
    })
    if (dbErr) {
      console.warn('game_images table metadata insert warning:', dbErr.message)
    }
  } catch (dbEx) {
    console.warn('game_images table metadata insert exception:', dbEx)
  }

  return { id, url, record }
}

/**
 * List images for a given ownerKey (and optional kind).
 * Queries game_images table, with fallback to Storage listing if table is unavailable.
 */
export async function listImages(ownerKey: string, kind?: ImageKind): Promise<GameImageRecord[]> {
  if (!isCloudImagesConfigured()) return []
  const supabase = getSupabase()
  if (!supabase) return []

  try {
    let q = supabase
      .from('game_images')
      .select('*')
      .eq('owner_key', ownerKey)
      .order('created_at', { ascending: false })

    if (kind) {
      q = q.eq('kind', kind)
    }

    const { data, error } = await q
    if (!error && data && data.length > 0) {
      return data as GameImageRecord[]
    }
  } catch (err) {
    console.warn('listImages DB query error:', err)
  }

  // Fallback: list from storage bucket if table query returned nothing / table not created
  try {
    const safeOwner = sanitizeStorageKey(ownerKey)
    const folder = kind ? `${safeOwner}/${kind}` : safeOwner
    const { data: storageFiles, error: sErr } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .list(folder)

    if (!sErr && storageFiles) {
      return storageFiles
        .filter((f) => f.name && !f.name.startsWith('.'))
        .map((f) => {
          const filePath = `${folder}/${f.name}`
          const { data } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(filePath)
          const nameParts = f.name.split('.')
          const uuid = nameParts[0] || crypto.randomUUID()
          return {
            id: uuid,
            kind: (kind || 'gallery') as ImageKind,
            owner_key: ownerKey,
            path: filePath,
            url: data.publicUrl,
            mime: 'image/jpeg',
            bytes: (f.metadata?.size as number) || 0,
            created_at: f.created_at || new Date().toISOString(),
          }
        })
    }
  } catch (sEx) {
    console.warn('listImages storage fallback error:', sEx)
  }

  return []
}

/**
 * Delete an image by ID, storage path, or public URL.
 * Removes both the metadata record and the Storage file.
 */
export async function deleteImage(idOrPathOrUrl: string): Promise<boolean> {
  if (!isCloudImagesConfigured()) return false
  const supabase = getSupabase()
  if (!supabase) return false

  try {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrPathOrUrl)
    let storagePath = ''

    if (isUuid) {
      // Find path from table
      const { data } = await supabase
        .from('game_images')
        .select('path')
        .eq('id', idOrPathOrUrl)
        .maybeSingle()

      if (data?.path) {
        storagePath = data.path
      }
      await supabase.from('game_images').delete().eq('id', idOrPathOrUrl)
    } else {
      // Input is a URL or a storage path
      if (idOrPathOrUrl.includes(`/${SUPABASE_BUCKET}/`)) {
        storagePath = idOrPathOrUrl.split(`/${SUPABASE_BUCKET}/`)[1]
      } else {
        storagePath = idOrPathOrUrl
      }
      await supabase
        .from('game_images')
        .delete()
        .or(`path.eq.${storagePath},url.eq.${idOrPathOrUrl}`)
    }

    if (storagePath) {
      await supabase.storage.from(SUPABASE_BUCKET).remove([storagePath])
    }
    return true
  } catch (err) {
    console.warn('deleteImage error:', err)
    return false
  }
}
