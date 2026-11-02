import { defineConfig, type Plugin, type Connect } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import cp from 'node:child_process'

function gameSavePlugin(): Plugin {
  const saveDir = path.join(os.homedir(), 'Downloads', 'gameSave')

  function getSaveFiles() {
    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true })
    }
    const entries = fs.readdirSync(saveDir, { withFileTypes: true })
    let maxSeries = 0
    const files: { name: string; size: number; mtime: string }[] = []
    for (const ent of entries) {
      if (!ent.isFile() || !ent.name.endsWith('.json')) continue
      const m = ent.name.match(/^gameSave_s(\d+)(?:\(\d+\))?\.json$/i)
      if (m) {
        const num = parseInt(m[1], 10)
        if (num > maxSeries) maxSeries = num
      }
      try {
        const stat = fs.statSync(path.join(saveDir, ent.name))
        files.push({
          name: ent.name,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        })
      } catch {
        files.push({ name: ent.name, size: 0, mtime: '' })
      }
    }
    // Sort descending by mtime or series
    files.sort((a, b) => b.mtime.localeCompare(a.mtime))
    return { files, nextSeriesNumber: maxSeries + 1, saveDir }
  }

  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const url = new URL(req.url || '/', 'http://localhost')
    const pathname = url.pathname

    if (pathname === '/api/save-files' && req.method === 'GET') {
      try {
        const data = getSaveFiles()
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: true, ...data }))
      } catch (err: any) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: false, error: err?.message || 'Error listing save files' }))
      }
      return
    }

    if (pathname === '/api/shared-body-designs' && req.method === 'GET') {
      try {
        if (!fs.existsSync(saveDir)) {
          fs.mkdirSync(saveDir, { recursive: true })
        }
        const filePath = path.join(saveDir, 'shared_body_designs.json')
        if (fs.existsSync(filePath)) {
          const raw = fs.readFileSync(filePath, 'utf-8')
          const data = JSON.parse(raw)
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, bodyBuilders: data }))
        } else {
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, bodyBuilders: null }))
        }
      } catch (err: any) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: false, error: err?.message || 'Error reading shared body designs' }))
      }
      return
    }

    if (pathname === '/api/shared-body-designs' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        try {
          const data = JSON.parse(body)
          if (!fs.existsSync(saveDir)) {
            fs.mkdirSync(saveDir, { recursive: true })
          }
          const filePath = path.join(saveDir, 'shared_body_designs.json')
          const content = data.bodyBuilders ?? data
          fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf-8')
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true }))
        } catch (err: any) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, error: err?.message || 'Failed to save shared body designs' }))
        }
      })
      return
    }

    if (pathname === '/api/export-save' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        try {
          const data = JSON.parse(body)
          const content = data.content
          if (!content || typeof content !== 'string') {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: false, error: 'Save content is required' }))
            return
          }
          if (!fs.existsSync(saveDir)) {
            fs.mkdirSync(saveDir, { recursive: true })
          }

          const { nextSeriesNumber } = getSaveFiles()
          let targetFilename = (data.filename ? path.basename(data.filename) : '').trim()
          if (!targetFilename || !targetFilename.endsWith('.json')) {
            targetFilename = `gameSave_s${nextSeriesNumber}.json`
          }

          const m = targetFilename.match(/^gameSave_s(\d+)\.json$/i)
          if (m && !data.overwrite) {
            const num = parseInt(m[1], 10)
            if (num < nextSeriesNumber && fs.existsSync(path.join(saveDir, targetFilename))) {
              targetFilename = `gameSave_s${nextSeriesNumber}.json`
            }
          }

          const targetPath = path.join(saveDir, targetFilename)
          fs.writeFileSync(targetPath, content, 'utf-8')

          const updated = getSaveFiles()
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({
            ok: true,
            filename: targetFilename,
            path: targetPath,
            saveDir,
            files: updated.files,
            nextSeriesNumber: updated.nextSeriesNumber,
          }))
        } catch (err: any) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, error: err?.message || 'Failed to save file' }))
        }
      })
      return
    }

    if (pathname === '/api/load-save' && req.method === 'GET') {
      const fileName = url.searchParams.get('file')
      if (!fileName) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: false, error: 'File query parameter is required' }))
        return
      }
      const safeName = path.basename(fileName)
      const targetPath = path.join(saveDir, safeName)
      if (!fs.existsSync(targetPath)) {
        res.statusCode = 404
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: false, error: 'File not found in gameSave' }))
        return
      }
      try {
        const content = fs.readFileSync(targetPath, 'utf-8')
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: true, filename: safeName, content }))
      } catch (err: any) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: false, error: err?.message || 'Failed to read save' }))
      }
      return
    }

    if (pathname === '/api/open-save-dir' && req.method === 'POST') {
      try {
        if (!fs.existsSync(saveDir)) {
          fs.mkdirSync(saveDir, { recursive: true })
        }
        if (process.platform === 'win32') {
          cp.exec(`explorer.exe "${saveDir}"`)
        } else if (process.platform === 'darwin') {
          cp.exec(`open "${saveDir}"`)
        } else {
          cp.exec(`xdg-open "${saveDir}"`)
        }
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: true, path: saveDir }))
      } catch (err: any) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: false, error: err?.message || 'Could not open folder' }))
      }
      return
    }

    next()
  }

  return {
    name: 'game-save-plugin',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}

export default defineConfig({
  server: {
    host: true,
  },
  preview: {
    host: true,
  },
  plugins: [react(), gameSavePlugin()],
})
