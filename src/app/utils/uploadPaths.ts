// ============================================
// BIT SOFTWARE — Upload path helpers
// ============================================
// Production (Dokploy/Docker): set UPLOAD_DIR=/app/uploads and mount a volume
// so ZIP files survive container restarts/redeploys.

import fs from 'fs';
import path from 'path';

export const getUploadsRoot = (): string => {
  const root = process.env.UPLOAD_DIR?.trim() || path.join(process.cwd(), 'uploads');
  return path.resolve(root);
};

export const getHostingProjectsDir = (): string => {
  const dir = path.join(getUploadsRoot(), 'hosting-projects');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};
