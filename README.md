# 🃏 UNO Multijoueur en ligne

Jeu UNO temps réel — jusqu'à 10 joueurs depuis n'importe quel appareil.

## Structure du projet

```
uno-game/
├── server/
│   ├── index.js          ← Serveur Express + WebSocket (Node.js)
│   ├── gameManager.js    ← Gestion des salles en mémoire
│   └── room.js           ← Logique complète du jeu UNO
├── public/
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── package.json
└── README.md
```

---

## 🚀 Lancer en local

```bash
npm install
npm start
# → Ouvrir http://localhost:3000
```

---

## 🌐 Hébergement en ligne

> ⚠️ Ce projet utilise des **WebSockets** (connexion permanente).
> Choisissez un hébergeur qui les supporte nativement.

---

### ✅ Option 1 — Railway.app (Recommandé, gratuit)

Railway supporte les WebSockets nativement sans configuration.

1. Créez un compte sur https://railway.app
2. "New Project" → "Deploy from GitHub repo"
   - OU utilisez le CLI :
     ```bash
     npm install -g @railway/cli
     railway login
     railway init
     railway up
     ```
3. Railway détecte automatiquement Node.js et lance `npm start`
4. Votre URL sera du type `https://xxx.railway.app`

---

### ✅ Option 2 — Render.com (Gratuit, attention mise en veille)

> ⚠️ Le plan gratuit Render met le serveur en veille après 15 min d'inactivité.
> La première connexion après une veille prend ~30 secondes. Passez au plan Starter ($7/mois) pour éviter ça.

1. Créez un compte sur https://render.com
2. "New" → "Web Service" → connectez votre repo GitHub
3. Paramètres :
   - **Environment** : `Node`
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
4. Votre URL sera du type `https://xxx.onrender.com`

---

### ✅ Option 3 — Heroku

```bash
heroku create mon-uno-game
heroku config:set NODE_ENV=production
git push heroku main
```

Ajoutez un fichier `Procfile` à la racine :
```
web: node server/index.js
```

---

### ✅ Option 4 — VPS (Ubuntu/Debian) avec Nginx

```bash
# 1. Installer Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 2. Déployer l'application
git clone <votre-repo> /var/www/uno-game
cd /var/www/uno-game
npm install --production

# 3. Installer PM2 (gestionnaire de processus)
npm install -g pm2
pm2 start server/index.js --name uno-game
pm2 startup   # démarrage automatique au boot
pm2 save

# 4. Configurer Nginx
sudo nano /etc/nginx/sites-available/uno-game
```

**Configuration Nginx** (remplacez `votre-domaine.com`) :
```nginx
server {
    listen 80;
    server_name votre-domaine.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # OBLIGATOIRE pour les WebSockets
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Timeout WebSocket (important)
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/uno-game /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 5. SSL gratuit avec Let's Encrypt
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d votre-domaine.com
```

---

## Variables d'environnement

| Variable | Défaut | Description |
|----------|--------|-------------|
| `PORT` | `3000` | Port d'écoute |
| `HOST` | `0.0.0.0` | Interface réseau |
| `NODE_ENV` | `development` | Environnement |

---

## 🎮 Comment jouer

1. Ouvrez le lien du site
2. Entrez votre pseudo → **Créer une partie**
3. Partagez le lien (bouton "Copier le lien") ou le code à 6 lettres
4. Les amis ouvrent le même lien, entrent leur pseudo + le code → **Rejoindre**
5. L'hôte clique **Démarrer** (min. 2 joueurs)

---

## Dépendances

| Package | Usage |
|---------|-------|
| `express` | Serveur HTTP + fichiers statiques |
| `ws` | WebSocket serveur |
| `uuid` | Identifiants uniques |
