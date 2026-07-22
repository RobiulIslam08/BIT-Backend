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

## C) Traefik readTimeout (বড় ZIP এর জন্য)

Default 60s → বড় upload 499/504 দেয়।

Traefik config (`web` + `websecure`):

```yaml
transport:
  respondingTimeouts:
    readTimeout: 0s
    writeTimeout: 0s
    idleTimeout: 600s
```

```bash
docker ps | grep -i traefik
docker restart <traefik-container-name>
```

Dokploy UI তে: Application → **Advanced** → **Traefik** (যদি custom config দেয়)।

---

## Checklist

1. [ ] Backend redeploy (`trust proxy` fix)
2. [ ] Advanced → Volumes → Mount Path `/app/uploads`
3. [ ] Env `UPLOAD_DIR=/app/uploads`
4. [ ] Traefik `readTimeout: 0s`
5. [ ] ZIP আবার upload (পুরোনো ফাইল volume ছাড়া হারিয়ে গেছে)
