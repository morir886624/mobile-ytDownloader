import { useState, useRef, useEffect } from 'react'
import VideoCard from './components/VideoCard'
import { useToast, Toaster } from './components/Toast'
import Login from './components/Login'
import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'

function getFormatArg(fmt) {
  return fmt === 'mp3' ? '-x --audio-format mp3' : `--merge-output-format ${fmt}`
}

function buildCommands(vids, qual, fmt, dir, playlistUrl) {
  const formatArg = getFormatArg(fmt)
  const outputTemplate = `${dir}/%(playlist_index)02d - %(title)s.%(ext)s`
  const header = [
    `# ============================================`,
    `#  YT Playlist Downloader — Commandes générées`,
    `# ============================================`,
    ``,
    `# 1. Créer le dossier de destination`,
    `mkdir -p "${dir}"`,
    ``,
    `# 2. Télécharger toute la playlist`,
    `yt-dlp \\`,
    `  -f "${qual}" \\`,
    `  ${formatArg} \\`,
    `  --yes-playlist \\`,
    `  --ignore-errors \\`,
    `  --add-metadata \\`,
    `  --embed-thumbnail \\`,
    `  --write-info-json \\`,
    `  --concurrent-fragments 4 \\`,
    `  -o "${outputTemplate}" \\`,
    `  "${playlistUrl}"`,
    ``,
    `# ---- Commandes individuelles par vidéo ----`,
    ``,
  ].join('\n')

  const individual = vids.map((v, i) =>
    `# Vidéo ${String(i + 1).padStart(2, '0')} — ${v.title}\nyt-dlp -f "${qual}" ${formatArg} -o "${dir}/%(title)s.%(ext)s" "${v.url}"\n`
  ).join('\n')

  return header + individual
}

export default function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem('yt_auth_token') || '')
  const [currentUser, setCurrentUser] = useState(() => sessionStorage.getItem('yt_auth_user') || '')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [authLoading, setAuthLoading] = useState(true)

  const [url, setUrl] = useState('')
  const [quality, setQuality] = useState('bestvideo[height<=1080]+bestaudio/best')
  const [format, setFormat] = useState('mp4')
  const [outputDir, setOutputDir] = useState(import.meta.env.VITE_DEFAULT_DOWNLOAD_DIR || '~/Downloads/YouTube')
  const [videos, setVideos] = useState([])
  const [playlistInfo, setPlaylistInfo] = useState(null)
  const [cmdOutput, setCmdOutput] = useState('')
  const [isFetching, setIsFetching] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const cmdRef = useRef(null)
  const { toasts, notify, dismiss } = useToast()

  const apiBase = import.meta.env.VITE_API_URL || ''

  useEffect(() => {
    async function checkSession() {
      const savedToken = sessionStorage.getItem('yt_auth_token')
      if (!savedToken) {
        setAuthLoading(false)
        return
      }
      try {
        const res = await fetch(`${apiBase}/api/auth/verify`, {
          headers: { Authorization: `Bearer ${savedToken}` },
        })
        if (res.ok) {
          const data = await res.json()
          setToken(savedToken)
          setCurrentUser(data.user?.username || 'mmorir')
          setIsAuthenticated(true)
        } else {
          sessionStorage.removeItem('yt_auth_token')
          sessionStorage.removeItem('yt_auth_user')
          setToken('')
          setCurrentUser('')
          setIsAuthenticated(false)
        }
      } catch (_) {
        setIsAuthenticated(false)
      } finally {
        setAuthLoading(false)
      }
    }
    checkSession()
  }, [])

  function handleLoginSuccess({ token: newToken, user }) {
    sessionStorage.setItem('yt_auth_token', newToken)
    sessionStorage.setItem('yt_auth_user', user.username)
    setToken(newToken)
    setCurrentUser(user.username)
    setIsAuthenticated(true)
    notify(`Connecté en tant que ${user.username}`, 'success')
  }

  async function handleLogout() {
    try {
      if (token) {
        await fetch(`${apiBase}/api/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
      }
    } catch (_) {}
    sessionStorage.removeItem('yt_auth_token')
    sessionStorage.removeItem('yt_auth_user')
    setToken('')
    setCurrentUser('')
    setIsAuthenticated(false)
    setVideos([])
    setPlaylistInfo(null)
    setCmdOutput('')
    notify('Déconnexion réussie', 'info')
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === videos.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(videos.map(v => v.id)))
    }
  }

  function isPlaylistUrl(u) {
    return u.includes('list=') && !u.includes('watch?v=') && !u.includes('youtu.be/')
  }

  async function fetchPlaylist() {
    const trimmedUrl = url.trim()
    if (!trimmedUrl) {
      notify('Veuillez saisir une URL YouTube.', 'warning')
      return
    }
    setIsFetching(true)
    setSelected(new Set())
    try {
      if (isPlaylistUrl(trimmedUrl)) {
        const res = await fetch(`${apiBase}/api/playlist?url=${encodeURIComponent(trimmedUrl)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.status === 401) {
          handleLogout()
          throw new Error('Session expirée. Veuillez vous reconnecter.')
        }
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Erreur serveur')
        const newVideos = data.videos.map(v => ({ ...v, status: 'waiting', progress: 0 }))
        setVideos(newVideos)
        setPlaylistInfo({ title: data.title, count: data.count, isVideo: false })
        setCmdOutput('')
        notify(`${data.count} vidéo${data.count > 1 ? 's' : ''} chargée${data.count > 1 ? 's' : ''}`, 'success')
      } else {
        const res = await fetch(`${apiBase}/api/video?url=${encodeURIComponent(trimmedUrl)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.status === 401) {
          handleLogout()
          throw new Error('Session expirée. Veuillez vous reconnecter.')
        }
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Erreur serveur')
        const video = { ...data, index: 1, status: 'waiting', progress: 0 }
        setVideos([video])
        setPlaylistInfo({ title: data.title, count: 1, isVideo: true })
        setSelected(new Set([data.id]))
        setCmdOutput('')
        notify('Vidéo chargée', 'success')
      }
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setIsFetching(false)
    }
  }

  function generateAllCommands() {
    setCmdOutput(buildCommands(videos, quality, format, outputDir, url.trim()))
    setTimeout(() => cmdRef.current?.scrollIntoView({ behavior: 'smooth' }), 0)
  }

  function generateSingleCommand(index) {
    const v = videos[index]
    const formatArg = getFormatArg(format)
    setCmdOutput(
      `# Télécharger uniquement : ${v.title}\n\nyt-dlp -f "${quality}" ${formatArg} -o "${outputDir}/%(title)s.%(ext)s" "${v.url}"`
    )
    setTimeout(() => cmdRef.current?.scrollIntoView({ behavior: 'smooth' }), 0)
  }

  async function downloadVideo(video, index) {
    const params = new URLSearchParams({ url: video.url, quality, format, dir: outputDir, token })

    return new Promise((resolve, reject) => {
      let settled = false
      const es = new EventSource(`${apiBase}/api/download?${params}`)

      setVideos(prev => prev.map((v, i) =>
        i === index ? { ...v, status: 'downloading', progress: 0 } : v
      ))

      es.onmessage = e => {
        const data = JSON.parse(e.data)
        if (data.type === 'progress') {
          setVideos(prev => prev.map((v, i) =>
            i === index ? { ...v, progress: data.percent } : v
          ))
        } else if (data.type === 'done') {
          settled = true
          es.close()

          const finishDownload = () => {
            setVideos(prev => prev.map((v, i) =>
              i === index ? { ...v, status: 'done', progress: 100 } : v
            ))
            resolve()
          }

          if (Capacitor.isNativePlatform() && data.fileUrl && data.fileName) {
            setVideos(prev => prev.map((v, i) =>
              i === index ? { ...v, status: 'downloading', progress: 99 } : v
            ))
            
            const fileUrl = `${apiBase}${data.fileUrl}`
            Filesystem.requestPermissions().then(() => {
              Filesystem.downloadFile({
                url: fileUrl,
                path: data.fileName,
                directory: Directory.Documents, // Use Documents which is accessible on Android 11+
                recursive: true,
              }).then(() => {
                finishDownload()
              }).catch(err => {
                setVideos(prev => prev.map((v, i) =>
                  i === index ? { ...v, status: 'error', errorMsg: 'Échec de la sauvegarde sur l\'appareil' } : v
                ))
                reject(err)
              })
            }).catch(err => {
               setVideos(prev => prev.map((v, i) =>
                  i === index ? { ...v, status: 'error', errorMsg: 'Permission refusée' } : v
               ))
               reject(err)
            })
          } else if (!Capacitor.isNativePlatform() && data.fileUrl) {
            // Optional: trigger browser download
            const fileUrl = `${apiBase}${data.fileUrl}`
            window.open(fileUrl, '_blank')
            finishDownload()
          } else {
            finishDownload()
          }
        } else if (data.type === 'error') {
          settled = true
          es.close()
          setVideos(prev => prev.map((v, i) =>
            i === index ? { ...v, status: 'error', errorMsg: data.message || 'Échec du téléchargement' } : v
          ))
          reject(new Error(data.message || 'Échec du téléchargement'))
        }
      }

      es.onerror = () => {
        if (!settled) {
          settled = true
          es.close()
          setVideos(prev => prev.map((v, i) =>
            i === index ? { ...v, status: 'error', errorMsg: 'Connexion perdue' } : v
          ))
          reject(new Error('Connexion perdue'))
        }
      }
    })
  }

  async function downloadSelected() {
    if (isDownloading) return
    setIsDownloading(true)
    const toDownload = videos
      .map((v, i) => ({ video: v, index: i }))
      .filter(({ video }) => selected.has(video.id))

    let errors = 0
    for (const { video, index } of toDownload) {
      try {
        await downloadVideo(video, index)
      } catch (err) {
        errors++
        notify(`Erreur — ${video.title} : ${err.message}`, 'error')
      }
    }

    if (errors === 0) {
      const n = toDownload.length
      notify(`${n} vidéo${n > 1 ? 's' : ''} téléchargée${n > 1 ? 's' : ''} avec succès`, 'success')
    } else if (errors < toDownload.length) {
      notify(`${toDownload.length - errors} téléchargée(s), ${errors} erreur(s)`, 'warning')
    }

    setIsDownloading(false)
  }

  function copyCommands() {
    navigator.clipboard.writeText(cmdOutput).then(() => {
      notify('Commandes copiées dans le presse-papiers', 'success')
    }).catch(() => {
      notify('Impossible de copier dans le presse-papiers', 'error')
    })
  }

  const allSelected = videos.length > 0 && selected.size === videos.length

  if (authLoading) {
    return (
      <div className="auth-loading-screen">
        <span className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <>
        <Login onLoginSuccess={handleLoginSuccess} />
        <Toaster toasts={toasts} onDismiss={dismiss} />
      </>
    )
  }

  return (
    <>
      <header>
        <div className="logo-icon">
          <svg viewBox="0 0 24 24">
            <path d="M19.59 6.69a4.83 4.83 0 01-3.77-2.74 12.7 12.7 0 00-10.55 0A4.83 4.83 0 011.5 6.69 46.36 46.36 0 000 12a46.36 46.36 0 001.5 5.31 4.83 4.83 0 003.77 2.74 12.7 12.7 0 0010.55 0 4.83 4.83 0 003.77-2.74A46.36 46.36 0 0021 12a46.36 46.36 0 00-1.41-5.31zM9 15.5v-7l6 3.5z" />
          </svg>
        </div>
        <h1>YT Downloader</h1>
        <span className="header-tag">Usage privé uniquement</span>
        <div className="header-right">
          <span className="user-badge">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
            </svg>
            {currentUser || 'mmorir'}
          </span>
          <button className="btn-logout" onClick={handleLogout} title="Se déconnecter">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
            </svg>
            <span>Déconnexion</span>
          </button>
        </div>
      </header>

      <main>
        <div className="install-banner">
          <div className="icon">⚙️</div>
          <div className="install-banner-text">
            <h4>Prérequis : yt-dlp + ffmpeg</h4>
            <p>
              Installez d'abord : <code>pip install yt-dlp</code> et <code>brew install ffmpeg</code> (macOS) ou{' '}
              <code>sudo apt install ffmpeg</code> (Linux / Windows WSL).
            </p>
          </div>
        </div>

        <div className="input-card">
          <label>URL YouTube (vidéo ou playlist)</label>
          <div className="url-input-row">
            <input
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetchPlaylist()}
              placeholder="https://www.youtube.com/watch?v=... ou /playlist?list=..."
            />
            <button className="btn-fetch" onClick={fetchPlaylist} disabled={isFetching}>
              {isFetching ? (
                <><span className="spinner" /> Analyse...</>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                    <path d="M17 12l-5-5v3H6v4h6v3z" />
                    <path d="M19 19H5V5h14v2h2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-2h-2z" />
                  </svg>
                  Analyser
                </>
              )}
            </button>
          </div>

          <div className="options-row">
            <div className="option-group">
              <label>Qualité vidéo</label>
              <select value={quality} onChange={e => setQuality(e.target.value)}>
                <option value="bestvideo+bestaudio/best">Meilleure qualité (4K/1080p)</option>
                <option value="bestvideo[height<=1080]+bestaudio/best">1080p max</option>
                <option value="bestvideo[height<=720]+bestaudio/best">720p</option>
                <option value="bestvideo[height<=480]+bestaudio/best">480p</option>
                <option value="bestaudio/best">Audio seulement</option>
              </select>
            </div>
            <div className="option-group">
              <label>Format de sortie</label>
              <select value={format} onChange={e => setFormat(e.target.value)}>
                <option value="mp4">MP4</option>
                <option value="mkv">MKV</option>
                <option value="webm">WebM</option>
                <option value="mp3">MP3 (audio)</option>
              </select>
            </div>
            <div className="option-group">
              <label>Dossier de destination</label>
              <input
                type="text"
                className="dir-input"
                value={outputDir}
                onChange={e => setOutputDir(e.target.value)}
                placeholder="~/Downloads/YouTube"
              />
            </div>
          </div>

          {playlistInfo && (
            <div className="playlist-info">
              <div className="playlist-meta">
                <h3>{playlistInfo.title ?? (playlistInfo.isVideo ? 'Vidéo' : 'Playlist')}</h3>
                <p>{playlistInfo.isVideo ? 'Vidéo unique détectée' : `${playlistInfo.count} vidéos détectées`}</p>
              </div>
              <div className="playlist-actions">
                {selected.size > 0 && (
                  <button
                    className="btn-download-selected"
                    onClick={downloadSelected}
                    disabled={isDownloading}
                  >
                    {isDownloading
                      ? <><span className="spinner spinner-dark" /> Téléchargement...</>
                      : <>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M5 20h14v-2H5v2zm7-18L5.33 9h4.84v4h3.66V9h4.84z" />
                          </svg>
                          Télécharger ({selected.size})
                        </>
                    }
                  </button>
                )}
                <button className="btn-cmd" onClick={generateAllCommands}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-5 14H4v-4h11v4zm0-5H4V9h11v4zm5 5h-4V9h4v9z" />
                  </svg>
                  Commandes
                </button>
              </div>
            </div>
          )}
        </div>

        {videos.length > 0 ? (
          <div className="videos-section">
            <div className="section-header">
              <label className="select-all-label">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                />
                <span className="checkmark" />
                <span>{playlistInfo?.isVideo ? 'Vidéo' : 'Vidéos de la playlist'}</span>
              </label>
              {!playlistInfo?.isVideo && (
                <span>{videos.length} vidéos · {selected.size} sélectionnée{selected.size > 1 ? 's' : ''}</span>
              )}
            </div>
            {videos.map((video, i) => (
              <VideoCard
                key={video.id}
                video={video}
                checked={selected.has(video.id)}
                onToggle={() => toggleSelect(video.id)}
                onCommand={() => generateSingleCommand(i)}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <div className="big-icon">📋</div>
            <h3>Aucune vidéo chargée</h3>
            <p>
              Collez l'URL d'une vidéo ou d'une playlist YouTube<br />
              et cliquez sur <strong>Analyser</strong>
            </p>
          </div>
        )}

        {cmdOutput && (
          <div className="cmd-section" ref={cmdRef}>
            <div className="cmd-header">
              <h3>Commandes à exécuter dans votre terminal</h3>
              <button className="copy-btn" onClick={copyCommands}>📋 Copier tout</button>
            </div>
            <div className="cmd-box">{cmdOutput}</div>
          </div>
        )}
      </main>

      <Toaster toasts={toasts} onDismiss={dismiss} />
    </>
  )
}
