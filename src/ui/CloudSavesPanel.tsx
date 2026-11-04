import { useEffect, useState } from 'react'
import { fmtDate } from '../engine/core/calendar'
import { useGame } from '../store/gameStore'
import {
  listCloudSaves,
  renameCloudSave,
  deleteCloudSave,
  getActiveCloudSaveId,
  type CloudSaveHeader,
} from '../store/cloudGameSave'
import { isCloudImagesConfigured } from '../lib/supabase'
import { Panel, Modal } from './bits'

export function CloudSavesPanel() {
  const g = useGame()
  const s = g.state

  const [saves, setSaves] = useState<CloudSaveHeader[]>([])
  const [loading, setLoading] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(() => getActiveCloudSaveId())

  // Modals state
  const [newModalOpen, setNewModalOpen] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [renameTarget, setRenameTarget] = useState<CloudSaveHeader | null>(null)
  const [renameLabel, setRenameLabel] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<CloudSaveHeader | null>(null)
  const [actionBusy, setActionBusy] = useState(false)

  const isConfigured = isCloudImagesConfigured()

  const refresh = async () => {
    if (!isConfigured) return
    setLoading(true)
    try {
      const list = await listCloudSaves()
      setSaves(list)
      setActiveId(getActiveCloudSaveId())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const activeSave = saves.find((save) => save.id === activeId)

  const handleSaveAsNew = async () => {
    if (!s) return
    const label = newLabel.trim() || s.company.name || 'Cloud Save'
    setActionBusy(true)
    try {
      const res = await g.saveToNewCloudSlot(label)
      if (res.ok) {
        g.toast(`Saved new cloud game: "${label}"`, 'good')
        setNewModalOpen(false)
        setNewLabel('')
        await refresh()
      } else {
        g.toast(res.error || 'Failed to create cloud save.', 'bad')
      }
    } finally {
      setActionBusy(false)
    }
  }

  const handleUpdateCurrent = async () => {
    if (!activeId) return
    setActionBusy(true)
    try {
      const res = await g.updateActiveCloudSlot()
      if (res.ok) {
        g.toast(res.compacted ? 'Compacted & synced to cloud!' : 'Cloud slot updated!', 'good')
        await refresh()
      } else {
        g.toast(res.error || 'Failed to update cloud save.', 'bad')
      }
    } finally {
      setActionBusy(false)
    }
  }

  const handleLoad = async (header: CloudSaveHeader) => {
    if (!confirm(`Load cloud save "${header.label}" (${header.company_name}, ${fmtDate(header.day)})?\n\nAny unsaved changes in your current session will be replaced.`)) {
      return
    }
    setActionBusy(true)
    try {
      const res = await g.loadCloudSaveById(header.id)
      if (res.ok) {
        g.toast(`Loaded "${header.label}" from cloud.`, 'good')
        setActiveId(header.id)
        await refresh()
      } else {
        g.toast(res.error || 'Failed to load cloud save.', 'bad')
      }
    } finally {
      setActionBusy(false)
    }
  }

  const handleRenameConfirm = async () => {
    if (!renameTarget) return
    const label = renameLabel.trim()
    if (!label) {
      g.toast('Please enter a label.', 'bad')
      return
    }
    setActionBusy(true)
    try {
      const res = await renameCloudSave(renameTarget.id, label)
      if (res.ok) {
        g.toast('Cloud save renamed.', 'good')
        setRenameTarget(null)
        await refresh()
      } else {
        g.toast(res.error || 'Failed to rename.', 'bad')
      }
    } finally {
      setActionBusy(false)
    }
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    setActionBusy(true)
    try {
      const res = await deleteCloudSave(deleteTarget.id)
      if (res.ok) {
        g.toast('Cloud save deleted.', 'good')
        setDeleteTarget(null)
        if (activeId === deleteTarget.id) {
          setActiveId(null)
        }
        await refresh()
      } else {
        g.toast(res.error || 'Failed to delete.', 'bad')
      }
    } finally {
      setActionBusy(false)
    }
  }

  const handleUnlink = () => {
    g.unlinkActiveCloudSlot()
    setActiveId(null)
    g.toast('Disconnected from cloud slot. Auto-sync is paused.', 'info')
  }

  return (
    <Panel
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span>☁️ Supabase Cloud Saves (Multi-Slot)</span>
          <span
            className="pill small"
            style={{
              background: isConfigured ? 'rgba(34, 197, 94, 0.12)' : 'rgba(234, 179, 8, 0.12)',
              color: isConfigured ? '#4ade80' : '#facc15',
              border: `1px solid ${isConfigured ? 'rgba(34, 197, 94, 0.3)' : 'rgba(234, 179, 8, 0.3)'}`,
              fontSize: '0.75rem',
            }}
          >
            {isConfigured ? 'Connected' : 'Not Configured'}
          </span>
        </div>
      }
      flat
      info="Cloud saves are stored directly on Supabase. Each slot keeps an append history with day deltas. Switching or continuing updates your slot across devices."
      right={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {s && (
            <button
              className="small primary"
              onClick={() => {
                setNewLabel(s.company.name || '')
                setNewModalOpen(true)
              }}
              title="Create a new independent cloud save slot from current game"
            >
              + Save as New Cloud Game
            </button>
          )}
          <button
            className="small"
            onClick={refresh}
            disabled={loading}
            title="Refresh cloud saves from Supabase"
          >
            {loading ? 'Refreshing…' : '🔄 Refresh'}
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Active slot status bar */}
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--bg3)',
            borderRadius: 6,
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            fontSize: '0.85rem',
          }}
        >
          {activeSave ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: '#22c55e',
                  display: 'inline-block',
                }}
              />
              <div>
                Active Slot: <b>{activeSave.label}</b> ({activeSave.company_name}, {fmtDate(activeSave.day)})
                <span className="dim" style={{ marginLeft: 8 }}>· Auto-syncs on advance</span>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: '#94a3b8',
                  display: 'inline-block',
                }}
              />
              <span className="dim">
                No active cloud slot connected. Progress stays local until you <b>Save as New</b> or <b>Load</b> a cloud slot.
              </span>
            </div>
          )}

          {activeSave && s && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="small"
                onClick={handleUpdateCurrent}
                disabled={actionBusy}
                title="Immediately push latest state into this active slot"
              >
                Sync Now
              </button>
              <button
                className="small dim"
                onClick={handleUnlink}
                disabled={actionBusy}
                title="Pause cloud sync for this session"
              >
                Disconnect
              </button>
            </div>
          )}
        </div>

        {/* Saves Table */}
        {!isConfigured ? (
          <div style={{ padding: '24px 16px', textAlign: 'center' }} className="dim small">
            Supabase environment variables are missing. Configure <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to enable cloud saves.
          </div>
        ) : loading && saves.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center' }} className="dim small">
            Loading cloud saves from Supabase…
          </div>
        ) : saves.length === 0 ? (
          <div style={{ padding: '28px 16px', textAlign: 'center' }}>
            <div className="dim small" style={{ marginBottom: 12 }}>
              No cloud saves found in this Supabase database.
            </div>
            {s && (
              <button
                className="small primary"
                onClick={() => {
                  setNewLabel(s.company.name || '')
                  setNewModalOpen(true)
                }}
              >
                + Save Current Game to Cloud
              </button>
            )}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data small" style={{ width: '100%', margin: 0 }}>
              <thead>
                <tr>
                  <th style={{ width: 80 }}>Status</th>
                  <th>Slot Label</th>
                  <th>Company</th>
                  <th className="num">Day</th>
                  <th>Difficulty</th>
                  <th>Last Synced</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {saves.map((item) => {
                  const isActive = item.id === activeId
                  const dateStr = item.updated_at
                    ? new Date(item.updated_at).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '—'

                  return (
                    <tr
                      key={item.id}
                      style={{
                        background: isActive ? 'rgba(34, 197, 94, 0.05)' : undefined,
                      }}
                    >
                      <td>
                        {isActive ? (
                          <span
                            className="pill small"
                            style={{
                              background: 'rgba(34, 197, 94, 0.15)',
                              color: '#4ade80',
                              border: '1px solid rgba(34, 197, 94, 0.3)',
                              fontWeight: 600,
                            }}
                          >
                            ● Active
                          </span>
                        ) : (
                          <span className="dim">—</span>
                        )}
                      </td>
                      <td>
                        <b>{item.label}</b>
                      </td>
                      <td>{item.company_name || '—'}</td>
                      <td className="num">{fmtDate(item.day)}</td>
                      <td style={{ textTransform: 'capitalize' }}>{item.difficulty || 'standard'}</td>
                      <td className="dim">{dateStr}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <button
                            className={`small ${isActive ? 'primary' : ''}`}
                            onClick={() => handleLoad(item)}
                            disabled={actionBusy}
                            title="Load this cloud save into current game"
                          >
                            Load
                          </button>
                          <button
                            className="small"
                            onClick={() => {
                              setRenameTarget(item)
                              setRenameLabel(item.label)
                            }}
                            disabled={actionBusy}
                            title="Rename slot"
                          >
                            Rename
                          </button>
                          <button
                            className="small danger"
                            onClick={() => setDeleteTarget(item)}
                            disabled={actionBusy}
                            title="Delete this cloud save slot"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: New Cloud Save */}
      {newModalOpen && (
        <Modal
          title="Save as New Cloud Game"
          onClose={() => setNewModalOpen(false)}
          actions={
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="primary" onClick={handleSaveAsNew} disabled={actionBusy}>
                {actionBusy ? 'Saving…' : 'Save to Cloud'}
              </button>
              <button onClick={() => setNewModalOpen(false)}>Cancel</button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p className="small">
              Upload your current company snapshot as an independent cloud save slot. Future days will append to this slot.
            </p>
            <div className="form-row">
              <label>Slot Label</label>
              <input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. My Sleeper Empire, Expansion Run..."
                maxLength={40}
                style={{ width: '100%' }}
                autoFocus
              />
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: Rename */}
      {renameTarget && (
        <Modal
          title="Rename Cloud Save Slot"
          onClose={() => setRenameTarget(null)}
          actions={
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="primary" onClick={handleRenameConfirm} disabled={actionBusy}>
                {actionBusy ? 'Saving…' : 'Rename'}
              </button>
              <button onClick={() => setRenameTarget(null)}>Cancel</button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="form-row">
              <label>New Label</label>
              <input
                value={renameLabel}
                onChange={(e) => setRenameLabel(e.target.value)}
                maxLength={40}
                style={{ width: '100%' }}
                autoFocus
              />
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: Delete Confirmation */}
      {deleteTarget && (
        <Modal
          title="Delete Cloud Save Slot?"
          onClose={() => setDeleteTarget(null)}
          actions={
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="danger" onClick={handleDeleteConfirm} disabled={actionBusy}>
                {actionBusy ? 'Deleting…' : 'Yes, Delete Slot'}
              </button>
              <button onClick={() => setDeleteTarget(null)}>Cancel</button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p>
              Are you sure you want to permanently delete cloud save <b>"{deleteTarget.label}"</b> ({deleteTarget.company_name}, {fmtDate(deleteTarget.day)})?
            </p>
            <p className="dim small bad">
              This cannot be undone. All base snapshots and day deltas in this slot will be erased.
            </p>
          </div>
        </Modal>
      )}
    </Panel>
  )
}
