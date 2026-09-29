const BADGE_CLASS = {
  waiting: 'status-badge badge-waiting',
  downloading: 'status-badge badge-downloading pulsing',
  done: 'status-badge badge-done',
  error: 'status-badge badge-error',
}

export default function VideoCard({ video, checked, onToggle, onCommand }) {
  const isActive = video.status === 'downloading' || video.status === 'done'
  const isDone = video.status === 'done'

  const badgeText = video.status === 'downloading'
    ? `${Math.round(video.progress)}%`
    : { waiting: 'En attente', done: '✓ Terminé', error: 'Erreur' }[video.status]

  return (
    <div className={`video-card${checked ? ' selected' : ''}${isDone ? ' done-card' : ''}`}>
      <div className="video-card-inner">
        <label className="video-checkbox" onClick={e => e.stopPropagation()}>
          <input type="checkbox" checked={checked} onChange={onToggle} />
          <span className="checkmark" />
        </label>
        <div className="thumb-placeholder">
          <svg viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" />
          </svg>
        </div>
        <div className="video-info">
          <div className="video-title" title={video.title}>
            <span style={{ color: 'var(--muted)', marginRight: '8px', fontFamily: "'Space Mono', monospace", fontSize: '11px' }}>
              {String(video.index).padStart(2, '0')}.
            </span>
            {video.title}
          </div>
          <div className="video-meta">
            {video.duration}&nbsp;·&nbsp;{video.url.slice(0, 55)}…
          </div>
        </div>
        <div className="video-status">
          <span className={BADGE_CLASS[video.status]}>{badgeText}</span>
          <button className="btn-dl-single" onClick={onCommand} title="Générer la commande">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-5 14H4v-4h11v4zm0-5H4V9h11v4zm5 5h-4V9h4v9z" />
            </svg>
          </button>
        </div>
      </div>
      <div className={`progress-bar-wrap${isActive ? ' active' : ''}${isDone ? ' done' : ''}`}>
        <div className="progress-bar-fill" style={{ width: `${video.progress}%` }} />
      </div>
      {video.status === 'error' && video.errorMsg && (
        <div className="error-msg">{video.errorMsg}</div>
      )}
    </div>
  )
}
