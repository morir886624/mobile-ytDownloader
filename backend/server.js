import express from 'express'
import cors from 'cors'
import { spawn } from 'child_process'
import os from 'os'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const app = express()
app.use(cors())
app.use(express.json())

const AUTH_USERNAME = process.env.AUTH_USERNAME || 'morir'
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || '6624'

// Session tokens store: token -> { username, createdAt }
const activeTokens = new Map()

function extractToken(req) {
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    return req.headers.authorization.slice(7).trim()
  }
  if (req.query && req.query.token) {
    return String(req.query.token).trim()
  }
  return null
}

function requireAuth(req, res, next) {
  const token = extractToken(req)
  if (!token || !activeTokens.has(token)) {
    return res.status(401).json({ error: 'Non autorisé. Veuillez vous connecter.' })
  }
  req.user = activeTokens.get(token)
  next()
}

// Authentication endpoints
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {}
  if (username === AUTH_USERNAME && password === AUTH_PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex')
    activeTokens.set(token, { username, createdAt: Date.now() })
    return res.json({ success: true, token, user: { username } })
  }
  return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' })
})

app.get('/api/auth/verify', (req, res) => {
  const token = extractToken(req)
  if (token && activeTokens.has(token)) {
    const session = activeTokens.get(token)
    return res.json({ valid: true, user: { username: session.username } })
  }
  return res.status(401).json({ error: 'Session invalide ou expirée' })
})

app.post('/api/logout', (req, res) => {
  const token = extractToken(req)
  if (token) {
    activeTokens.delete(token)
  }
  res.json({ success: true })
})

function runYtDlp(url) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', [
      '--flat-playlist',
      '-J',
      '--no-warnings',
      '--extractor-args', 'youtube:player_client=default,ios,android,web',
      url
    ])
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', d => { stdout += d })
    proc.stderr.on('data', d => { stderr += d })
    proc.on('close', code => {
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr || `yt-dlp exited with code ${code}`))
    })
  })
}

function formatDuration(seconds) {
  if (!seconds) return null
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

app.get('/api/video', requireAuth, async (req, res) => {
  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'URL manquante' })

  try {
    const proc = spawn('yt-dlp', [
      '-J',
      '--no-warnings',
      '--no-playlist',
      '--extractor-args', 'youtube:player_client=default,ios,android,web',
      url
    ])
    let stdout = ''
    let stderr = ''
    const raw = await new Promise((resolve, reject) => {
      proc.stdout.on('data', d => { stdout += d })
      proc.stderr.on('data', d => { stderr += d })
      proc.on('close', code => {
        if (code === 0) resolve(stdout)
        else reject(new Error(stderr || `yt-dlp exited with code ${code}`))
      })
    })
    const data = JSON.parse(raw)
    res.json({
      id: data.id,
      title: data.title ?? 'Vidéo sans titre',
      duration: formatDuration(data.duration),
      url: `https://www.youtube.com/watch?v=${data.id}`,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/playlist', requireAuth, async (req, res) => {
  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'URL manquante' })

  try {
    const raw = await runYtDlp(url)
    const data = JSON.parse(raw)
    const entries = data.entries ?? []
    const videos = entries.map((entry, i) => ({
      index: i + 1,
      id: entry.id,
      title: entry.title ?? `Vidéo ${i + 1}`,
      duration: formatDuration(entry.duration),
      url: entry.url?.startsWith('http') ? entry.url : `https://www.youtube.com/watch?v=${entry.id}`,
    }))
    res.json({ count: videos.length, title: data.title, videos })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/download', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  res.write(': connected\n\n')

  const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`)
  const fail = msg => { send({ type: 'error', message: msg }); res.end() }

  const { url, quality, format, dir } = req.query
  if (!url) return fail('URL manquante')

  const outputDir = (dir || process.env.DOWNLOAD_DIR || '~/Downloads/YouTube').replace(/^~/, os.homedir())
  try { fs.mkdirSync(outputDir, { recursive: true }) } catch (_) {}

  const formatArgs = format === 'mp3'
    ? ['-x', '--audio-format', 'mp3']
    : ['--merge-output-format', format || 'mp4']

  const args = [
    '-f', quality || 'bestvideo[height<=1080]+bestaudio/best',
    ...formatArgs,
    '--newline',
    '--add-metadata',
    '--retries', '10',
    '--fragment-retries', '10',
    '--extractor-retries', '5',
    '--extractor-args', 'youtube:player_client=default,ios,android,web',
    '-o', path.join(outputDir, '%(title)s.%(ext)s'),
    url,
  ]

  const proc = spawn('yt-dlp', args)
  let stderrBuf = ''
  let finalFilename = ''
  let destination = ''

  proc.stdout.on('data', chunk => {
    const lines = chunk.toString().split('\n')
    for (const line of lines) {
      const mProg = line.match(/\[download\]\s+([\d.]+)%/)
      if (mProg) send({ type: 'progress', percent: parseFloat(mProg[1]) })
      
      const mDest = line.match(/\[download\] Destination: (.*)/)
      if (mDest) destination = mDest[1].trim()
      
      const mAlready = line.match(/\[download\] (.*) has already been downloaded/)
      if (mAlready) destination = mAlready[1].trim()

      const mMerge = line.match(/\[Merger\] Merging formats into "(.*)"/)
      if (mMerge) destination = mMerge[1].trim()
    }
  })

  proc.stderr.on('data', chunk => { stderrBuf += chunk.toString() })

  proc.on('error', err => {
    send({ type: 'error', message: err.message })
    res.end()
  })

  proc.on('close', code => {
    if (code === 0) {
      if (destination) {
        finalFilename = path.basename(destination)
      }
      send({ type: 'done', fileUrl: finalFilename ? `/api/files/${encodeURIComponent(finalFilename)}` : null, fileName: finalFilename })
    } else {
      const msg = stderrBuf.split('\n').filter(l => l.includes('ERROR:')).join(' ').trim()
      send({ type: 'error', message: msg || `yt-dlp exited with code ${code}` })
    }
    res.end()
  })

  req.on('close', () => proc.kill())
})

// Serve the downloaded files
const downloadDir = (process.env.DOWNLOAD_DIR || '~/Downloads/YouTube').replace(/^~/, os.homedir())
app.use('/api/files', express.static(downloadDir, {
  setHeaders: (res, filePath) => {
    res.setHeader('Content-Disposition', 'attachment; filename="' + path.basename(filePath) + '"')
  }
}))

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`Backend sur http://localhost:${PORT}`))
