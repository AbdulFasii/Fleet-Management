import { useEffect, useRef, useState } from 'react'
import type { BusGroup } from '../engine/types'
import { isCloudImagesConfigured } from '../lib/supabase'
import {
  deleteImage,
  listImages,
  uploadGameImage,
  type GameImageRecord,
} from '../store/cloudImages'
import { GroupBadge, Modal } from './bits'
import { LightboxModal } from './LightboxModal'

const MAX_GALLERY_IMAGES = 12

export interface BrandGalleryModalProps {
  group: BusGroup | null
  isOpen: boolean
  onClose: () => void
  onUpdateGroup: (id: string, patch: Partial<BusGroup>) => string | null
  onToast: (msg: string, kind?: 'good' | 'bad' | 'warn') => void
}

export function BrandGalleryModal({
  group,
  isOpen,
  onClose,
  onUpdateGroup,
  onToast,
}: BrandGalleryModalProps) {
  const [images, setImages] = useState<GameImageRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string>('')
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const ownerKey = group ? `group:${group.id}` : ''

  // Load gallery photos whenever the modal opens or the active brand changes
  useEffect(() => {
    if (!isOpen || !group) return

    let isMounted = true
    setLoading(true)

    listImages(ownerKey, 'gallery')
      .then((records) => {
        if (!isMounted) return
        // Merge with any URLs saved on group.gallery (for instant offline/export consistency)
        const recordUrls = new Set(records.map((r) => r.url))
        const localGallery = group.gallery ?? []
        const merged: GameImageRecord[] = [...records]

        for (const url of localGallery) {
          if (!recordUrls.has(url)) {
            merged.push({
              id: url,
              kind: 'gallery',
              owner_key: ownerKey,
              path: url,
              url,
              mime: 'image/jpeg',
              bytes: 0,
              created_at: new Date().toISOString(),
            })
          }
        }

        setImages(merged)
      })
      .catch((err) => {
        if (!isMounted) return
        console.warn('Failed to load gallery images:', err)
        // Fallback to local group.gallery
        const fallback = (group.gallery ?? []).map((url) => ({
          id: url,
          kind: 'gallery' as const,
          owner_key: ownerKey,
          path: url,
          url,
          mime: 'image/jpeg',
          bytes: 0,
        }))
        setImages(fallback)
      })
      .finally(() => {
        if (isMounted) setLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [isOpen, group?.id, ownerKey])

  if (!isOpen || !group) return null

  const handleUploadFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFiles = Array.from(e.target.files || [])
    e.target.value = ''
    if (rawFiles.length === 0) return

    if (!isCloudImagesConfigured()) {
      onToast('Cloud image storage is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local.', 'bad')
      return
    }

    const currentCount = images.length
    if (currentCount >= MAX_GALLERY_IMAGES) {
      onToast(`Brand gallery is limited to ${MAX_GALLERY_IMAGES} images. Remove some before adding more.`, 'bad')
      return
    }

    let filesToUpload = rawFiles
    if (currentCount + filesToUpload.length > MAX_GALLERY_IMAGES) {
      const allowed = MAX_GALLERY_IMAGES - currentCount
      onToast(`Only adding ${allowed} photo${allowed > 1 ? 's' : ''} (capped at ${MAX_GALLERY_IMAGES} photos per brand).`, 'warn')
      filesToUpload = filesToUpload.slice(0, allowed)
    }

    setUploading(true)
    let uploadedCount = 0
    const newRecords: GameImageRecord[] = []
    const newUrls: string[] = []

    for (let i = 0; i < filesToUpload.length; i++) {
      const f = filesToUpload[i]
      setUploadStatus(`Uploading ${i + 1} of ${filesToUpload.length}…`)
      try {
        const res = await uploadGameImage({
          file: f,
          kind: 'gallery',
          ownerKey,
          fileName: f.name,
        })
        uploadedCount++
        newUrls.push(res.url)
        if (res.record) {
          newRecords.push(res.record)
        } else {
          newRecords.push({
            id: res.id,
            kind: 'gallery',
            owner_key: ownerKey,
            path: res.url,
            url: res.url,
            mime: f.type || 'image/jpeg',
            bytes: f.size,
          })
        }
      } catch (err: any) {
        onToast(`Upload failed for ${f.name}: ${err.message || 'Error'}`, 'bad')
      }
    }

    if (uploadedCount > 0) {
      const updatedGallery = [...(group.gallery || []), ...newUrls].slice(0, MAX_GALLERY_IMAGES)
      const err = onUpdateGroup(group.id, { gallery: updatedGallery })
      if (err) onToast(err, 'bad')
      else onToast(`Added ${uploadedCount} photo${uploadedCount > 1 ? 's' : ''} to brand gallery.`, 'good')

      setImages((prev) => [...newRecords, ...prev].slice(0, MAX_GALLERY_IMAGES))
    }

    setUploading(false)
    setUploadStatus('')
  }

  const handleDeleteImage = async (img: GameImageRecord) => {
    try {
      await deleteImage(img.id)
      const updatedGallery = (group.gallery || []).filter((u) => u !== img.url && u !== img.id)
      onUpdateGroup(group.id, { gallery: updatedGallery })
      setImages((prev) => prev.filter((i) => i.id !== img.id && i.url !== img.url))
      onToast('Photo removed from brand gallery.', 'good')
    } catch (err: any) {
      onToast(`Could not delete photo: ${err.message}`, 'bad')
    }
  }

  const handleSetAsBrandingPic = (url: string) => {
    const err = onUpdateGroup(group.id, { brandingPic: url })
    if (err) onToast(err, 'bad')
    else onToast('Set as main brand livery photo.', 'good')
  }

  if (!isOpen) return null

  return (
    <>
      <Modal
        onClose={onClose}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <GroupBadge group={group} />
            <span>{group.name} — Brand Gallery</span>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%', minWidth: 320, maxWidth: 680 }}>
          {/* Header controls & stats */}
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
                {images.length} / {MAX_GALLERY_IMAGES} photos uploaded
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleUploadFiles}
              />
              <button
                type="button"
                className="primary small"
                disabled={uploading || images.length >= MAX_GALLERY_IMAGES}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? uploadStatus || 'Uploading…' : '+ Add Photos…'}
              </button>
            </div>
          </div>

          {/* Grid of gallery photos */}
          {loading ? (
            <div className="dim small" style={{ textAlign: 'center', padding: '32px 0' }}>
              Loading brand gallery…
            </div>
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
                Upload original high-resolution photos of liveries, coach interiors, passenger amenities, or scenic fleet runs.
              </div>
              <button
                type="button"
                className="small primary"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                style={{ marginTop: 8 }}
              >
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
                const isCurrentBranding = group.brandingPic === img.url
                const kb = img.bytes ? `${(img.bytes / 1024).toFixed(0)} KB` : null
                const dims = img.width && img.height ? `${img.width}×${img.height}` : null

                return (
                  <div
                    key={img.id || idx}
                    style={{
                      background: 'var(--bg3)',
                      borderRadius: 6,
                      border: isCurrentBranding ? '2px solid var(--accent, #2563eb)' : '1px solid var(--border)',
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column',
                      position: 'relative',
                    }}
                  >
                    {/* Thumbnail */}
                    <div
                      style={{
                        position: 'relative',
                        height: 120,
                        background: '#0a0a0a',
                        cursor: 'pointer',
                        overflow: 'hidden',
                      }}
                      onClick={() => setLightboxUrl(img.url)}
                      title="Click to view original full size"
                    >
                      <img
                        src={img.url}
                        alt={`Brand gallery ${idx + 1}`}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          display: 'block',
                        }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          top: 4,
                          right: 4,
                          background: 'rgba(0,0,0,0.65)',
                          color: '#fff',
                          fontSize: '0.65rem',
                          padding: '2px 5px',
                          borderRadius: 3,
                          backdropFilter: 'blur(2px)',
                        }}
                      >
                        🔍 View
                      </div>
                      {isCurrentBranding && (
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
                          Main Livery
                        </div>
                      )}
                    </div>

                    {/* Metadata & Actions */}
                    <div
                      style={{
                        padding: '8px 10px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        flex: 1,
                        justifyContent: 'space-between',
                      }}
                    >
                      <div className="dim small" style={{ fontSize: '0.72rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {[dims, kb].filter(Boolean).join(' · ') || 'Cloud original'}
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                        {!isCurrentBranding ? (
                          <button
                            type="button"
                            className="small"
                            style={{ fontSize: '0.7rem', padding: '2px 6px' }}
                            onClick={() => handleSetAsBrandingPic(img.url)}
                            title="Set as the main branding livery photo for this brand"
                          >
                            Set Livery
                          </button>
                        ) : (
                          <span className="good small" style={{ fontSize: '0.7rem' }}>
                            ✓ Active
                          </span>
                        )}

                        <button
                          type="button"
                          className="danger small"
                          style={{ fontSize: '0.7rem', padding: '2px 6px' }}
                          onClick={() => handleDeleteImage(img)}
                          title="Remove from brand gallery"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Dim note explaining storage & export persistence */}
          <div
            className="dim small"
            style={{
              paddingTop: 8,
              borderTop: '1px solid var(--border)',
              fontSize: '0.78rem',
              lineHeight: 1.4,
            }}
          >
            💡 Images live in Supabase Storage at original quality without downscaling. Game save exports store public URLs so your fleet gallery remains reachable anywhere.
          </div>
        </div>
      </Modal>

      {lightboxUrl && (
        <LightboxModal
          url={lightboxUrl}
          title={`${group.name} Showcase Photo`}
          onClose={() => setLightboxUrl(null)}
        />
      )}
    </>
  )
}
