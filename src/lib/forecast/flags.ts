/**
 * Forecast giriş kanalı bayrağı.
 *
 * `true` iken `/forecast-input` sayfası salt-okunur özet ekranıdır; forecast
 * yalnızca Haftalık Detay Formu'ndan girilir. Geri dönmek için tek yapılması
 * gereken bunu `false` yapmak — eski sayfanın yazma fonksiyonları silinmedi,
 * yalnızca bu bayrakla kapatıldı.
 */
export const FORECAST_INPUT_READ_ONLY = true;

/** Eski kanaldan yazma denemesini reddeder. */
export function assertForecastEntryChannel() {
  if (FORECAST_INPUT_READ_ONLY) {
    throw new Error(
      "Forecast girişi artık Haftalık Detay Formu üzerinden yapılıyor. Bu sayfa özet ve geçmiş görünümüdür.",
    );
  }
}
