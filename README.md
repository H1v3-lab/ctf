# Arène CTF — ctf.sakoi-cyber.me

Plateforme de CTF **jeopardy** de Dmod : des challenges à résoudre, un classement en direct, **sans pistage**.
Site statique (GitHub Pages) + une petite API Cloudflare Worker qui valide les flags et tient le score.

## Comment ça marche

- Le **site** (`index.html`, `scoreboard.html`, `regles.html`) est servi par GitHub Pages sur `ctf.sakoi-cyber.me`.
- Les **flags ne sont jamais dans le site**. Le navigateur envoie le flag à l'API ; c'est le **Worker** qui le valide (comparaison de hash SHA-256), attribue les points et écrit la résolution dans la base D1.
- Un joueur choisit un **pseudo** → l'API lui donne un jeton aléatoire gardé dans son navigateur. Aucune IP, aucun cookie.
- L'API vit sur le domaine principal proxifié : **`sakoi-cyber.me/api/arena/*`** (le sous-domaine `ctf` est en DNS-only pour GitHub Pages, donc il ne peut pas porter de Worker).

## Déployer l'API (une seule fois, tableau de bord Cloudflare)

1. **D1** : *Stockage et bases de données → D1 → Créer* → nom `arena`.
   Console → coller `worker/schema.sql` (une seule ligne) → **Exécuter**. `schema.sql` supprime puis recrée les tables.
2. **Worker** : *Workers & Pages → Créer → Worker* → nom `arena-api` → **Déployer** → **Modifier le code** → coller `worker/worker.js` → **Déployer**.
3. **Liaison** : Worker → *Paramètres → Liaisons → Ajouter → D1* → variable `DB`, base `arena`.
4. **Route** : Worker → *Paramètres → Domaines et routes → Ajouter → Route* → `sakoi-cyber.me/api/arena/*`.
   Cette route est plus précise que le `sakoi-cyber.me/api/*` du Worker `ctf-api` (mini-CTF) : Cloudflare envoie `/api/arena/*` à `arena-api` et tout le reste à `ctf-api`. Les deux cohabitent sans conflit.
5. Vérifier : `https://sakoi-cyber.me/api/arena/scoreboard` doit répondre `{"board":[],"solves":{}}`.

Le Worker n'accepte les soumissions que depuis `ctf.sakoi-cyber.me` et `sakoi-cyber.me` (contrôle d'origine + CORS).

## Domaine du site

`CNAME` contient `ctf.sakoi-cyber.me`. Chez Cloudflare : un **CNAME** `ctf` → `h1v3-lab.github.io`, en **DNS only** (nuage gris). GitHub → Settings → Pages → **Enforce HTTPS**.

## Ajouter un challenge

Un challenge se déclare à **deux endroits** (les métadonnées sont publiques, le flag reste secret) :

1. **`challenges.json`** — métadonnées visibles (titre, catégorie, difficulté, points, description, fichiers). **Jamais le flag.**
2. **`worker/worker.js`** — dans l'objet `CHALLENGES`, l'empreinte du flag et les points :
   ```js
   "mon-id": { hash: "<sha256 du flag>", points: 150 },
   ```
   Pour obtenir le hash : `echo -n 'SAKOI{...}' | sha256sum`.
   Puis redéploie le Worker.

Dépose les fichiers du challenge dans `files/mon-id/` et référence-les dans `challenges.json`.
Format de flag imposé : `SAKOI{...}`.

### Challenges web (VulnLab)

Une appli volontairement vulnérable ne peut pas être hébergée ici. Distribue-la comme un **dossier à lancer en local** (par ex. un `docker-compose.yml`) : le joueur la fait tourner sur sa machine, trouve le flag, le soumet. Rien de vulnérable n'est exposé sur Internet.

## Modération (console D1 → base `arena`)

```sql
SELECT handle, (SELECT COALESCE(SUM(points),0) FROM solves WHERE player_id=p.id) AS score FROM players p ORDER BY score DESC;
DELETE FROM players WHERE handle = 'pseudo-à-retirer';   -- retire aussi ses solves (clé étrangère logique)
DELETE FROM solves WHERE player_id = (SELECT id FROM players WHERE handle='x');
```

## Vie privée

Stocké : pseudo, résolutions, score, nombre d'essais. **Aucune IP, aucun cookie.** Polices auto-hébergées, aucune requête tierce (hors l'appel à l'API `sakoi-cyber.me`, même origine logique).
