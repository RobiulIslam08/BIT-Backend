# Dokploy + Hostinger VPS — Large ZIP Upload / Download Fix

## A) Fix: `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`

Already fixed in code with `app.set('trust proxy', 1)`. Redeploy backend after pulling latest code.

---

## B) Volume mount কোথায় পাবেন (Dokploy UI)

Dokploy → আপনার **Backend Application** খুলুন → **Advanced** ট্যাব → **Volumes / Mounts** → **Add Mount**

### Option 1 — Volume Mount (সুপারিশ)

| Field | Value |
|--------|--------|
| Type | **Volume** |
| Volume Name | `hosting_uploads` (যেকোনো নাম) |
| Mount Path | `/app/uploads` |

তারপর **Environment** ট্যাবে যোগ করুন:

```
UPLOAD_DIR=/app/uploads
```

Save → **Redeploy**

### Option 2 — Bind Mount

| Field | Value |
|--------|--------|
| Type | **Bind** |
| Host Path | `/etc/dokploy/data/bit-hosting-uploads` (VPS-এ আগে folder তৈরি করুন) |
| Mount Path | `/app/uploads` |

Host path তৈরি (SSH):

```bash
sudo mkdir -p /etc/dokploy/data/bit-hosting-uploads
sudo chmod 755 /etc/dokploy/data/bit-hosting-uploads
```

### Compose দিয়ে deploy করলে

`docker-compose.yml`-এ আগে থেকেই আছে:

```yaml
volumes:
  - hosting_uploads:/app/uploads
environment:
  UPLOAD_DIR: /app/uploads
```

Compose service হলে Dokploy Advanced → Mounts দিয়ে আলাদা mount না করে compose volume ব্যবহার করুন।

---

## C) Traefik timeout — UI-তে নেই, VPS SSH দিয়ে করতে হবে

Dokploy Application → Advanced → Traefik শুধু domain/router দেখায়।  
**readTimeout** static config-এ থাকে — file:

`/etc/dokploy/traefik/traefik.yml`

### SSH দিয়ে fix (Hostinger VPS)

```bash
# 1) SSH করে VPS-এ ঢুকুন, তারপর:
sudo nano /etc/dokploy/traefik/traefik.yml
```

`entryPoints:` অংশে `web` এবং `websecure`-এর ভিতরে এভাবে `transport` যোগ করুন (আগের settings মুছবেন না):

```yaml
entryPoints:
  web:
    address: ":80"
    transport:
      respondingTimeouts:
        readTimeout: 0s
        writeTimeout: 0s
        idleTimeout: 600s
  websecure:
    address: ":443"
    transport:
      respondingTimeouts:
        readTimeout: 0s
        writeTimeout: 0s
        idleTimeout: 600s
    http:
      tls:
        certResolver: letsencrypt
```

Save (`Ctrl+O`, Enter, `Ctrl+X`), তারপর:

```bash
docker restart dokploy-traefik
```

চেক:

```bash
docker ps | grep traefik
docker logs dokploy-traefik --tail 30
```

### Dokploy UI-তে Traefik editor থাকলে

কিছু version-এ: বাম সাইডবার → **Settings** / **Web Server** / **Traefik** → `traefik.yml` edit।  
Application-এর ভিতরে Advanced → Traefik **নয়** — সেখানে timeout পাবেন না।

---

## Checklist

1. [ ] Backend redeploy (`trust proxy` fix)
2. [ ] Advanced → Volumes → Mount Path `/app/uploads`
3. [ ] Env `UPLOAD_DIR=/app/uploads`
4. [ ] Traefik `readTimeout: 0s`
5. [ ] ZIP আবার upload (পুরোনো ফাইল volume ছাড়া হারিয়ে গেছে)
