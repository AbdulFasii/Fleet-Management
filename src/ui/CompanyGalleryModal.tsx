import { useEffect, useRef, useState } from 'react'
import type { BusGroup } from '../engine/types'
import { isCloudImagesConfigured } from '../lib/supabase'
import {
  deleteImage,
  listImages,
  uploadGameImage,
  type GameImageRecord,
} from '../store/cloudImages'
import { Modal } from './bits'
import { LightboxModal } from './LightboxModal'

export const MAX_COMPANY_GALLERY_IMAGES = 40
const COMPANY_OWNER_KEY = 'company'

/**
 * Every photo in the company gallery: the company list plus anything that was
 * uploaded to an individual brand's gallery before galleries became company-wide.
 */
export function companyGalleryUrls(companyGallery: string[] | undefined, groups: BusGroup[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const url of [...(companyGallery ?? []), ...groups.flatMap((g) => g.gallery ?? [])]) {
    if (!seen.has(url)) {
      seen.add(url)
      out.push(url)
    }
  }
  return out
}

export interface CompanyGalleryModalProps {
  isOpen: boolean
  onClose: () => void
  companyName: string
  /** The company gallery as saved (company.gallery). */
  companyGallery: string[] | undefined
  /** All brands (retired too): their old galleries are folded in, and a photo shows which brands use it as livery. */
  groups: BusGroup[]
  onSaveGallery: (urls: string[]) => string | null
  onToast: (msg: string, kind?: 'good' | 'bad' | 'warn') => void
}

function recordFor(url: string, ownerKey: string): GameImageRecord {
  return { id: url, kind: 'gallery', owner_key: ownerKey, path: url, url, mime: 'image/jpeg', bytes: 0 }
}

export function CompanyGalleryModal({
  isOpen,
  onClose,
  companyName,
  companyGallery,
  groups,
  onSaveGallery,
  onToast,
}: CompanyGalleryModalProps) {
  const [images, setImages] = useState<GameImageRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string>('')
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const savedUrls = companyGalleryUrls(companyGallery, groups)
  const groupKey = groups.map((g) => g.id).join(',')

  // Load cloud records for the company gallery and for any legacy brand galleries.
  useEffect(() => {
    if (!isOpen) return
    let isMounted = true
    setLoading(true)
    const ownerKeys = [COMPANY_OWNER_KEY, ...groups.map((g) => `group:${g.id}`)]
    Promise.all(ownerKeys.map((k) => listImages(k, 'gallery').catch(() => [] as GameImageRecord[])))
      .then((lists) => {
        if (!isMounted) return
        const merged: GameImageRecord[] = []
        const seen = new Set<string>()
        for (const r of lists.flat()) {
          if (seen.has(r.url)) continue
          seen.add(r.url)
          merged.push(r)
        }
        for (const url of savedUrls) {
          if (!seen.has(url)) {
            seen.add(url)
            merged.push(recordFor(url, COMPANY_OWNER_KEY))
          }
        }
        setImages(merged.slice(0, MAX_COMPANY_GALLERY_IMAGES))
      })
      .finally(() => {
        if (isMounted) setLoading(false)
      })
    return () => {
      isMounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, groupKey])

  if (!isOpen) return null

  const save = (urls: string[]) => onSaveGallery(urls.slice(0, MAX_COMPANY_GALLERY_IMAGES))

  const handleUploadFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFiles = Array.from(e.target.files || [])
    e.target.value = ''
    if (rawFiles.length === 0) return

    if (!isCloudImagesConfigured()) {
      onToast('Cloud image storage is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local.', 'bad')
      return
    }

    if (images.length >= MAX_COMPANY_GALLERY_IMAGES) {
      onToast(`The gallery is limited to ${MAX_COMPANY_GALLERY_IMAGES} photos. Remove some before adding more.`, 'bad')
      return
    }

    let filesToUpload = rawFiles
    if (images.length + filesToUpload.length > MAX_COMPANY_GALLERY_IMAGES) {
      const allowed = MAX_COMPANY_GALLERY_IMAGES - images.length
      onToast(`Only adding ${allowed} photo${allowed > 1 ? 's' : ''} (capped at ${MAX_COMPANY_GALLERY_IMAGES}).`, 'warn')
      filesToUpload = filesToUpload.slice(0, allowed)
    }

    setUploading(true)
    const newRecords: GameImageRecord[] = []
    for (let i = 0; i < filesToUpload.length; i++) {
      const f = filesToUpload[i]
      setUploadStatus(`Uploading ${i + 1} of ${filesToUpload.length}…`)
      try {
        const res = await uploadGameImage({ file: f, kind: 'gallery', ownerKey: COMPANY_OWNER_KEY, fileName: f.name })
        newRecords.push(res.record ?? { ...recordFor(res.url, COMPANY_OWNER_KEY), id: res.id, mime: f.type || 'image/jpeg', bytes: f.size })
      } catch (err: any) {
        onToast(`Upload failed for ${f.name}: ${err.message || 'Error'}`, 'bad')
      }
    }

    if (newRecords.length > 0) {
      const next = [...newRecords, ...images].slice(0, MAX_COMPANY_GALLERY_IMAGES)
      const err = save(next.map((r) => r.url))
      if (err) onToast(err, 'bad')
      else onToast(`Added ${newRecords.length} photo${newRecords.length > 1 ? 's' : ''} to the gallery.`, 'good')
      setImages(next)
    }

    setUploading(false)
    setUploadStatus('')
  }

  const handleDeleteImage = async (img: GameImageRecord) => {
    try {
      if (img.id !== img.url) await deleteImage(img.id)
      const next = images.filter((i) => i.id !== img.id && i.url !== img.url)
      save(next.map((r) => r.url))
      setImages(next)
      onToast('Photo removed from the gallery.', 'good')
    } catch (err: any) {
      onToast(`Could not delete photo: ${err.message}`, 'bad')
    }
  }

  const liveryOwners = (url: string) => groups.filter((g) => g.brandingPic === url)

  return (
    <>
      <Modal onClose={onClose} title={<span>{companyName} — Gallery</span>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%', minWidth: 320, maxWidth: 720 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
              borderBottom: '1px solid var(--border)',
              paddingBottom: 12,
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>Showcase Fleet & Livery Gallery</div>
              <div className="dim small">
                {images.length} / {MAX_COMPANY_GALLERY_IMAGES} photos · shared by every brand
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input ref={fileInputRef} type="file" multiple accept="image/*" style={{ display: 'none' }} onChange={handleUploadFiles} />
              <button
                type="button"
                className="primary small"
                disabled={uploading || images.length >= MAX_COMPANY_GALLERY_IMAGES}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? uploadStatus || 'Uploading…' : '+ Add Photos…'}
              </button>
            </div>
          </div>

          {loading ? (
            <div className="dim small" style={{ textAlign: 'center', padding: '32px 0' }}>Loading gallery…</div>
          ) : images.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '36px 16px',
                background: 'var(--bg3)',
                borderRadius: 8,
                border: '1px dashed var(--border)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <div style={{ fontSize: '1.8rem' }}>🖼️</div>
              <div style={{ fontWeight: 600 }}>No gallery photos yet</div>
              <div className="dim small" style={{ maxWidth: 380 }}>
                Upload photos of liveries, coach interiors, passenger amenities, or scenic fleet runs. Any photo can be set as a brand's livery.
              </div>
              <button type="button" className="small primary" disabled={uploading} onClick={() => fileInputRef.current?.click()} style={{ marginTop: 8 }}>
                + Upload Photos
              </button>
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: 12,
                maxHeight: '55vh',
                overflowY: 'auto',
                paddingRight: 4,
              }}
            >
              {images.map((img, idx) => {
                const owners = liveryOwners(img.url)
                const kb = img.bytes ? `${(img.bytes / 1024).toFixed(0)} KB` : null
                const dims = img.width && img.height ? `${img.width}×${img.height}` : null
                return (
                  <div
                    key={img.id || idx}
                    style={{
                      background: 'var(--bg3)',
                      borderRadius: 6,
                      border: owners.length > 0 ? '2px solid var(--accent, #2563eb)' : '1px solid var(--border)',
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    <div
                      style={{ position: 'relative', height: 120, background: '#0a0a0a', cursor: 'pointer', overflow: 'hidden' }}
                      onClick={() => setLightboxUrl(img.url)}
                      title="Click to view original full size"
                    >
                      <img src={img.url} alt={`Gallery ${idx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      {owners.length > 0 && (
                        <div
                          style={{
                            position: 'absolute',
                            bottom: 4,
                            left: 4,
                            background: 'var(--accent, #2563eb)',
                            color: '#fff',
                            fontSize: '0.65rem',
                            fontWeight: 600,
                            padding: '2px 6px',
                            borderRadius: 3,
                          }}
                        >
                          Livery: {owners.map((o) => o.code).join(', ')}
                        </div>
                      )}
                    </div>
                    <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div className="dim small" style={{ fontSize: '0.72rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {[dims, kb].filter(Boolean).join(' · ') || 'Cloud original'}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="dim small" style={{ paddingTop: 8, borderTop: '1px solid var(--border)', fontSize: '0.78rem', lineHeight: 1.4 }}>
            💡 Images live in Supabase Storage at original quality. Game save exports store public URLs so the gallery stays reachable anywhere.
          </div>
        </div>
      </Modal>

      {lightboxUrl && (
        <LightboxModal
          url={lightboxUrl}
          title={`${companyName} Showcase Photo`}
          onClose={() => setLightboxUrl(null)}
          onDelete={() => {
            const img = images.find((i) => i.url === lightboxUrl)
            setLightboxUrl(null)
            if (img) void handleDeleteImage(img)
          }}
        />
      )}
    </>
  )
}
