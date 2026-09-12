import { servedScript, respostaScript } from '@/lib/served-script';

// O bash deste endpoint vive em served-scripts/setup-backup-runner.sh --
// arquivo .sh de verdade. Ver lib/served-script.ts pro motivo.
export async function GET() {
  return respostaScript(
    servedScript('setup-backup-runner.sh', {
      APP_URL: process.env.AUTH_TRUST_HOST || 'http://localhost:8001',
      S3_HOST: process.env.BACKUP_S3_HOST || '',
      S3_KEY: process.env.BACKUP_S3_KEY || '',
      S3_SECRET: process.env.BACKUP_S3_SECRET || '',
      S3_BUCKET: process.env.BACKUP_S3_BUCKET || 'rcaldas-backup',
      S3_REGION: process.env.BACKUP_S3_REGION || 'us-east-1',
      SNAPSHOT_ROOT: process.env.BACKUP_SNAPSHOT_ROOT || '/tank/bkp',
    })
  );
}
