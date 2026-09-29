# YT Downloader

Application web locale pour télécharger des vidéos YouTube depuis une playlist, directement depuis le navigateur, avec progression en temps réel.

> **Usage privé uniquement.** Respectez les conditions d'utilisation de YouTube et le droit d'auteur.

---

## Fonctionnalités

- Analyse une playlist YouTube et affiche toutes ses vidéos
- Sélection individuelle ou globale des vidéos à télécharger
- Téléchargement direct depuis l'interface (pas de copier-coller de commandes)
- Barre de progression en temps réel par vidéo (via Server-Sent Events)
- Notifications toast en fin de téléchargement
- Choix de la qualité (4K / 1080p / 720p / 480p / audio seul)
- Choix du format de sortie (MP4, MKV, WebM, MP3)
- Dossier de destination configurable
- Indicateur visuel : carte verte quand le téléchargement est terminé

---

## Prérequis

### Avec Docker (recommandé)

| Outil | Installation |
|-------|-------------|
| **Docker Desktop** | [docker.com](https://www.docker.com/products/docker-desktop) |

### Sans Docker

| Outil | Installation |
|-------|-------------|
| **Node.js** ≥ 18 | [nodejs.org](https://nodejs.org) |
| **yt-dlp** | `pip install yt-dlp` ou [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases) |
| **ffmpeg** | `brew install ffmpeg` (macOS) · `sudo apt install ffmpeg` (Linux) · [ffmpeg.org](https://ffmpeg.org/download.html) (Windows) |

---

## Démarrage avec Docker

1. Copiez le fichier d'environnement et ajustez le dossier de destination :
   ```bash
   cp .env.example .env
   # Éditez HOST_DOWNLOAD_DIR dans .env
   ```

2. Lancez les conteneurs :
   ```bash
   docker compose up
   ```

3. Ouvrez [http://localhost:5173](http://localhost:5173) dans le navigateur.

> Le dossier `HOST_DOWNLOAD_DIR` défini dans `.env` est monté dans les conteneurs sous `/downloads`. Les fichiers téléchargés apparaissent directement sur votre machine.

---

## Démarrage sans Docker

Installez les dépendances dans chaque dossier, puis lancez les deux processus :

```bash
# Terminal 1 — Backend Express (port 3001)
cd backend
npm install
npm run dev

# Terminal 2 — Frontend Vite (port 5173)
cd frontend
npm install
npm run dev
```

Ouvrez ensuite [http://localhost:5173](http://localhost:5173) dans le navigateur.

---

## Authentification

L'accès à l'application est protégé par un système de connexion :
- **Nom d'utilisateur** : `mmorir`
- **Mot de passe** : `CCI6624`

> Ces identifiants peuvent être modifiés via les variables d'environnement `AUTH_USERNAME` et `AUTH_PASSWORD`.

---

## Utilisation

1. Collez l'URL d'une playlist YouTube dans le champ en haut
1. Ouvrez l'application et connectez-vous avec vos identifiants (`mmorir` / `CCI6624`)
2. Collez l'URL d'une playlist ou d'une vidéo YouTube dans le champ en haut
   ```
   https://www.youtube.com/playlist?list=PLxxxx...
   ```
2. Cliquez sur **Analyser** — la liste des vidéos s'affiche
3. Cochez les vidéos à télécharger (ou utilisez **Tout sélectionner**)
4. Choisissez la qualité, le format et le dossier de destination
5. Cliquez sur **Télécharger (N)** — la progression s'affiche en temps réel
3. Cliquez sur **Analyser** — la liste des vidéos s'affiche
4. Cochez les vidéos à télécharger (ou utilisez **Tout sélectionner**)
5. Choisissez la qualité, le format et le dossier de destination
6. Cliquez sur **Télécharger (N)** — la progression s'affiche en temps réel

Quand un téléchargement est terminé, la carte passe en vert et une notification apparaît.
Vous pouvez vous déconnecter à tout moment via le bouton **Déconnexion** dans l'en-tête.

---

## Architecture

```
ytDownloader/
├── docker-compose.yml
├── .env                        # HOST_DOWNLOAD_DIR (dossier hôte des téléchargements)
├── downloads/                  # Dossier par défaut si HOST_DOWNLOAD_DIR non défini
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   └── server.js               # API Express — playlist + téléchargement SSE
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── vite.config.js           # Proxy /api → backend:3001
    ├── index.html
    └── src/
        ├── main.jsx
        ├── index.css
        ├── App.jsx              # Logique principale, état, téléchargements
        └── components/
            ├── VideoCard.jsx    # Carte vidéo avec checkbox et barre de progression
            └── Toast.jsx        # Notifications
```

### API Backend

| Endpoint | Description |
|----------|-------------|
| `GET /api/playlist?url=` | Analyse la playlist via `yt-dlp --flat-playlist` |
| `GET /api/download?url=&quality=&format=&dir=` | Télécharge une vidéo, stream SSE de progression |

Événements SSE du endpoint `/api/download` :

```json
{ "type": "progress", "percent": 42.5 }
{ "type": "done" }
{ "type": "error", "message": "..." }
```

---

## Stack technique

- **Frontend** : React 18 + Vite
- **Backend** : Node.js + Express 5
- **Téléchargement** : yt-dlp (spawn) + ffmpeg (fusion audio/vidéo)
- **Streaming** : Server-Sent Events (SSE)
- **Conteneurisation** : Docker + Docker Compose
