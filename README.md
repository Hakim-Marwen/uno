# 🃏 UNO Multijoueur en ligne

Jeu UNO complet en temps réel — jusqu'à 10 joueurs depuis n'importe quel appareil.

## Structure du projet

```
uno-game/
├── server/
│   ├── index.js          ← Serveur Express + WebSocket
│   ├── gameManager.js    ← Gestion des salles en mémoire
│   └── room.js           ← Logique complète du jeu UNO
├── public/
│   ├── index.html        ← Interface principale
│   ├── css/
│   │   └── style.css     ← Design moderne responsive
│   └── js/
│       └── app.js        ← Client WebSocket + rendu UI
├── package.json
└── README.md
```

---

## 🚀 Installation & Lancement

### Prérequis
- **Node.js 16+** — https://nodejs.org

### Démarrage en local

```bash
# 1. Installer les dépendances
npm install

# 2. Lancer le serveur
npm start

# 3. Ouvrir dans le navigateur
# → http://localhost:3000
```

Pour le développement avec rechargement automatique :
```bash
npm run dev
```

---

## 🌐 Déploiement en production

### Option 1 : Render.com (Gratuit)

1. Créez un compte sur https://render.com
2. "New Web Service" → connectez votre dépôt GitHub
3. Paramètres :
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Environment** : `Node`
4. Render fournit automatiquement une URL HTTPS avec WebSocket (WSS)

### Option 2 : Railway.app (Gratuit)

```bash
# Installer Railway CLI
npm install -g @railway/cli

railway login
railway init
railway up
```

### Option 3 : Heroku

```bash
heroku create mon-jeu-uno
git push heroku main
```

Ajoutez un fichier `Procfile` :
```
web: node server/index.js
```

### Option 4 : VPS (Ubuntu/Debian)

```bash
# Installer Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Cloner et installer
git clone <votre-repo>
cd uno-game
npm install --production

# Avec PM2 (process manager)
npm install -g pm2
pm2 start server/index.js --name uno-game
pm2 startup
pm2 save

# Nginx (reverse proxy)
# Voir section ci-dessous
```

#### Configuration Nginx

```nginx
server {
    listen 80;
    server_name votre-domaine.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

> **Important** : Les WebSockets nécessitent `proxy_http_version 1.1` et les headers `Upgrade`.

#### SSL avec Let's Encrypt (HTTPS)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d votre-domaine.com
```

### Variables d'environnement

| Variable | Défaut | Description |
|----------|--------|-------------|
| `PORT`   | `3000` | Port d'écoute |
| `NODE_ENV` | `development` | Environnement |

---

## 🎮 Comment jouer

1. **Créer une partie** : entrez votre pseudo et cliquez "Créer une partie"
2. **Partager** : copiez le lien ou le code 6 lettres et envoyez-le à vos amis
3. **Rejoindre** : les autres joueurs entrent le code et leur pseudo
4. **Démarrer** : l'hôte lance la partie (min. 2 joueurs, max. 10)

### Règles UNO implémentées
- ✅ Cartes 0–9 pour chaque couleur
- ✅ Skip (passe le tour suivant)
- ✅ Reverse (inverse le sens)
- ✅ +2 (le suivant pioche 2 et passe)
- ✅ Wild (joker, choisit la couleur)
- ✅ Wild +4 (joker + le suivant pioche 4)
- ✅ Bouton UNO ! (quand il reste 1 carte)
- ✅ Règle des 2 joueurs (Reverse = Skip)
- ✅ Première carte spéciale appliquée
- ✅ Redistribution de la défausse quand la pioche est vide

---

## ⚙️ Architecture technique

- **Backend** : Node.js + Express + `ws` (WebSocket natif)
- **Frontend** : HTML/CSS/JS vanilla (aucune dépendance côté client)
- **Synchronisation** : WebSocket temps réel, état serveur autoritaire
- **Stockage** : En mémoire (RAM) — parfait pour 1 à 100 parties simultanées
- **Nettoyage** : Salles inactives supprimées après 1 heure

### Pour aller plus loin (production avancée)
- Remplacez le stockage mémoire par **Redis** pour supporter plusieurs instances
- Ajoutez une base de données pour les **statistiques et historique**
- Implémentez un **système de pénalité UNO** (piocher 2 si non crié)

---

## 📦 Dépendances

| Package | Version | Usage |
|---------|---------|-------|
| `express` | ^4.18 | Serveur HTTP + fichiers statiques |
| `ws` | ^8.16 | WebSocket serveur |
| `uuid` | ^9.0 | Identifiants uniques |
| `nodemon` | ^3.0 | Rechargement dev (devDep) |

---

## 📄 Licence

MIT — Libre d'utilisation et modification.
