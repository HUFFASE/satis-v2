/** next.config.ts serverActions.bodySizeLimit ile uyumlu */
export const MAX_CRM_FILE_SIZE_BYTES = 15 * 1024 * 1024;
export const MAX_CRM_FILE_SIZE_MB = 15;

export function getServerActionErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;

  const message = error.message;
  if (/unexpected response was received from the server/i.test(message)) {
    return `Sunucu beklenmeyen yanıt döndürdü. CRM dosyası ${MAX_CRM_FILE_SIZE_MB} MB'dan büyük olabilir, Excel şifreli/korumalı olabilir veya dev sunucunun yeniden başlatılması gerekebilir.`;
  }
  if (/Body exceeded/i.test(message)) {
    return `Dosya boyutu sunucu limitini (${MAX_CRM_FILE_SIZE_MB} MB) aşıyor.`;
  }
  return message;
}

export function validateCrmFileSize(file: File): string | null {
  if (file.size > MAX_CRM_FILE_SIZE_BYTES) {
    return `CRM dosyası en fazla ${MAX_CRM_FILE_SIZE_MB} MB olabilir. Seçilen dosya: ${(file.size / (1024 * 1024)).toFixed(1)} MB.`;
  }
  if (!file.name.match(/\.(xls|xlsx|xlsb)$/i)) {
    return "Lütfen .xls, .xlsx veya .xlsb uzantılı bir dosya seçin.";
  }
  return null;
}
