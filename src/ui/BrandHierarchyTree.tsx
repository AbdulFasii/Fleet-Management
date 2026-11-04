import { useMemo, useState } from 'react'
import type { BusGroup, GameState, ID } from '../engine/types'
import { GroupBadge } from './bits'
import { activeGroups } from '../engine/sim/groups'

interface TreeNode {
  group?: BusGroup
  isRoot?: boolean
  name: string
  code?: string
  color?: string
  children: TreeNode[]
}

interface BrandHierarchyTreeProps {
  s: GameState
  onSelectBrand?: (brandId: ID) => void
  onAddSubBrand?: (parentBrandId?: ID) => void
}

export function BrandHierarchyTree({ s, onSelectBrand, onAddSubBrand }: BrandHierarchyTreeProps) {
  const [viewMode, setViewMode] = useState<'chart' | 'outline'>('chart')
  const [collapsedNodes, setCollapsedNodes] = useState<Record<string, boolean>>({})

  const allActive = useMemo(() => activeGroups(s), [s.groups])

  // Build recursive tree
  const tree = useMemo(() => {
    const groupMap = new Map<ID, BusGroup>()
    for (const g of allActive) groupMap.set(g.id, g)

    const childMap = new Map<ID | 'root', BusGroup[]>()
    childMap.set('root', [])

    for (const g of allActive) {
      const pId = g.parentGroupId && groupMap.has(g.parentGroupId) ? g.parentGroupId : 'root'
      if (!childMap.has(pId)) childMap.set(pId, [])
      childMap.get(pId)!.push(g)
    }

    const buildNode = (g: BusGroup): TreeNode => {
      const children = (childMap.get(g.id) ?? []).map(buildNode)
      return {
        group: g,
        name: g.name,
        code: g.code,
        color: g.color,
        children,
      }
    }

    const rootChildren = (childMap.get('root') ?? []).map(buildNode)

    const rootNode: TreeNode = {
      isRoot: true,
      name: s.company.name || 'Royal Transport Company',
      children: rootChildren,
    }

    return rootNode
  }, [allActive, s.company.name])

  const totalBuses = Object.keys(s.buses ?? {}).length
  const totalSchedules = Object.keys(s.schedules ?? {}).length

  const toggleCollapse = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setCollapsedNodes((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  // Count fleet in node
  const getGroupMetrics = (groupId?: ID) => {
    if (!groupId) {
      return { buses: totalBuses, schedules: totalSchedules }
    }
    const bCount = Object.values(s.buses ?? {}).filter((b) => b.groupId === groupId).length
    const sCount = Object.values(s.schedules ?? {}).filter((sch) => sch.groupId === groupId).length
    return { buses: bCount, schedules: sCount }
  }

  // Render Org Chart Node Recursively
  const renderChartNode = (node: TreeNode, depth = 0) => {
    const isRoot = Boolean(node.isRoot)
    const nodeId = node.group?.id ?? 'root'
    const isCollapsed = Boolean(collapsedNodes[nodeId])
    const hasChildren = node.children.length > 0
    const metrics = getGroupMetrics(node.group?.id)

    return (
      <div
        key={nodeId}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          position: 'relative',
        }}
      >
        {/* Node Card */}
        <div
          onClick={() => {
            if (node.group && onSelectBrand) onSelectBrand(node.group.id)
          }}
          style={{
            background: isRoot
              ? 'linear-gradient(135deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.98) 100%)'
              : 'var(--panel-alt, #151a21)',
            border: `1.5px solid ${node.color ?? (isRoot ? 'var(--accent)' : 'var(--border)')}`,
            borderRadius: 8,
            padding: '10px 14px',
            minWidth: 200,
            maxWidth: 240,
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.35)',
            cursor: node.group ? 'pointer' : 'default',
            position: 'relative',
            zIndex: 2,
            transition: 'transform 0.15s ease, box-shadow 0.15s ease',
          }}
          className="org-node-box"
          title={node.group ? `Click to inspect ${node.name} settings` : 'Parent enterprise holding'}
        >
          {/* Top colored indicator bar */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 3,
              background: node.color ?? 'var(--accent)',
              borderTopLeftRadius: 6,
              borderTopRightRadius: 6,
            }}
          />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            {isRoot ? (
              <span className="pill accent small" style={{ fontSize: '0.72rem', fontWeight: 700 }}>
                🏢 Holding Enterprise
              </span>
            ) : node.group ? (
              <GroupBadge group={node.group} />
            ) : null}

            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              {node.group?.cargoBrand && <span className="pill warn small" style={{ fontSize: '0.68rem' }}>Cargo</span>}
              {node.group?.primo && <span className="pill good small" style={{ fontSize: '0.68rem' }}>★ Primo</span>}
              {hasChildren && (
                <button
                  type="button"
                  onClick={(e) => toggleCollapse(nodeId, e)}
                  className="small text"
                  style={{
                    padding: '0 4px',
                    fontSize: '0.75rem',
                    color: 'var(--fg-dim)',
                    lineHeight: 1,
                  }}
                  title={isCollapsed ? 'Expand sub-brands' : 'Collapse sub-brands'}
                >
                  {isCollapsed ? `+${node.children.length}` : '−'}
                </button>
              )}
            </div>
          </div>

          <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--fg)', marginTop: 2 }}>
            {node.name}
          </div>

          <div className="small dim mt4" style={{ fontSize: '0.76rem', display: 'flex', justifyContent: 'space-between' }}>
            <span>🚌 {metrics.buses} coaches</span>
            <span>🗓️ {metrics.schedules} runs</span>
          </div>

          {node.group && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
              <span className="small good" style={{ fontWeight: 600, fontSize: '0.76rem' }}>
                ★ {node.group.ratingCount > 0 ? node.group.rating.toFixed(1) : s.company.rating.toFixed(1)}
              </span>

              <div style={{ display: 'flex', gap: 4 }}>
                {onAddSubBrand && (
                  <button
                    type="button"
                    className="small"
                    style={{ fontSize: '0.72rem', padding: '2px 6px' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onAddSubBrand(node.group?.id)
                    }}
                    title={`Create a sub-brand under ${node.name}`}
                  >
                    + Sub-brand
                  </button>
                )}
                {onSelectBrand && (
                  <button
                    type="button"
                    className="small text"
                    style={{ fontSize: '0.72rem', padding: '2px 4px', color: 'var(--info)' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectBrand(node.group!.id)
                    }}
                  >
                    Edit ⬇
                  </button>
                )}
              </div>
            </div>
          )}

          {isRoot && onAddSubBrand && (
            <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--border)', textAlign: 'right' }}>
              <button
                type="button"
                className="small primary"
                style={{ fontSize: '0.74rem', padding: '2px 8px' }}
                onClick={(e) => {
                  e.stopPropagation()
                  onAddSubBrand('')
                }}
              >
                + Top-Level Brand
              </button>
            </div>
          )}
        </div>

        {/* Children Branches & Visual Connectors */}
        {hasChildren && !isCollapsed && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
            {/* Vertical stem dropping from parent */}
            <div style={{ width: 2, height: 20, background: 'var(--border)' }} />

            {/* If 1 child: straight vertical connection */}
            {node.children.length === 1 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                {renderChartNode(node.children[0], depth + 1)}
              </div>
            ) : (
              /* Multiple children: horizontal crossbar connecting all child branches */
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  position: 'relative',
                  gap: 20,
                  paddingTop: 20,
                }}
              >
                {/* Horizontal bar from first child center to last child center */}
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 'calc(100px + 10px)',
                    right: 'calc(100px + 10px)',
                    height: 2,
                    background: 'var(--border)',
                  }}
                />

                {node.children.map((child) => (
                  <div
                    key={child.group?.id ?? child.name}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      position: 'relative',
                    }}
                  >
                    {/* Vertical stem up to crossbar */}
                    <div
                      style={{
                        position: 'absolute',
                        top: -20,
                        width: 2,
                        height: 20,
                        background: 'var(--border)',
                      }}
                    />
                    {renderChartNode(child, depth + 1)}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // Render Indented Outline View
  const renderOutlineNode = (node: TreeNode, depth = 0) => {
    const isRoot = Boolean(node.isRoot)
    const nodeId = node.group?.id ?? 'root'
    const isCollapsed = Boolean(collapsedNodes[nodeId])
    const hasChildren = node.children.length > 0
    const metrics = getGroupMetrics(node.group?.id)

    return (
      <div key={nodeId} style={{ marginLeft: depth > 0 ? 24 : 0, marginTop: 6 }}>
        <div
          onClick={() => {
            if (node.group && onSelectBrand) onSelectBrand(node.group.id)
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            background: isRoot ? 'var(--bg3)' : 'var(--bg)',
            border: `1px solid ${node.color ?? (isRoot ? 'var(--accent)' : 'var(--border)')}`,
            borderRadius: 6,
            cursor: node.group ? 'pointer' : 'default',
          }}
        >
          {depth > 0 && <span className="dim">└─</span>}
          {isRoot ? (
            <span className="pill accent small">🏢 Holding Co.</span>
          ) : node.group ? (
            <GroupBadge group={node.group} />
          ) : null}
          <span style={{ fontWeight: 600 }}>{node.name}</span>
          <span className="dim small">({metrics.buses} buses · {metrics.schedules} runs)</span>
          {node.group?.cargoBrand && <span className="pill warn small">Cargo</span>}
          {node.group?.primo && <span className="pill good small">★ Primo</span>}

          {onAddSubBrand && (
            <button
              type="button"
              className="small"
              style={{ fontSize: '0.72rem', padding: '1px 6px', marginLeft: 6 }}
              onClick={(e) => {
                e.stopPropagation()
                onAddSubBrand(node.group?.id ?? '')
              }}
            >
              + Sub-brand
            </button>
          )}

          {hasChildren && (
            <button
              type="button"
              className="small text"
              onClick={(e) => toggleCollapse(nodeId, e)}
              style={{ fontSize: '0.75rem', color: 'var(--fg-dim)' }}
            >
              {isCollapsed ? `[+${node.children.length} sub-brands]` : '[− collapse]'}
            </button>
          )}
        </div>

        {hasChildren && !isCollapsed && (
          <div style={{ borderLeft: '1px dashed var(--border)', marginLeft: 12, paddingLeft: 6 }}>
            {node.children.map((c) => renderOutlineNode(c, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Controls Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
          background: 'var(--bg3)',
          padding: '8px 12px',
          borderRadius: 6,
          border: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
          <span style={{ fontWeight: 600 }}>Corporate Structure:</span>
          <span className="pill info small">{allActive.length} Subsidiary Brands</span>
          <span className="dim small">· {totalBuses} Active Fleet Buses</span>
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            type="button"
            className={`small ${viewMode === 'chart' ? 'primary' : ''}`}
            onClick={() => setViewMode('chart')}
          >
            🌿 Org Chart Diagram
          </button>
          <button
            type="button"
            className={`small ${viewMode === 'outline' ? 'primary' : ''}`}
            onClick={() => setViewMode('outline')}
          >
            📋 Outline View
          </button>
        </div>
      </div>

      {/* Main Diagram Canvas */}
      <div
        style={{
          overflowX: 'auto',
          padding: '24px 16px',
          background: 'var(--bg2)',
          borderRadius: 8,
          border: '1px solid var(--border)',
          minHeight: 260,
          display: 'flex',
          justifyContent: viewMode === 'chart' ? 'center' : 'flex-start',
        }}
      >
        {viewMode === 'chart' ? (
          <div style={{ width: 'max-content', minWidth: '100%', display: 'flex', justifyContent: 'center' }}>
            {renderChartNode(tree)}
          </div>
        ) : (
          <div style={{ width: '100%' }}>
            {renderOutlineNode(tree)}
          </div>
        )}
      </div>

      {/* Hierarchy Guidance Footer */}
      <div
        style={{
          fontSize: '0.78rem',
          color: 'var(--fg-dim)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
          padding: '0 4px',
        }}
      >
        <div>
          💡 <b>Multi-Tier Brand Tree:</b> Any brand can have specialized sub-brands (e.g. <i>Keralines Lux</i> under <i>Keralines</i>, or <i>Royal Xpress Cargo</i> under <i>Royal Xpress</i>). Re-assign parent brands anytime from each brand card below.
        </div>
        <span className="dim">Shared company balance sheet & workshop</span>
      </div>
    </div>
  )
}
