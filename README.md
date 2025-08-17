# Amazon SP-API ile Google Sheets Fiyat Güncelleyici

Bu proje, bir Google Sheets sayfasından alınan ASIN listesi için Amazon Selling Partner API (SP-API) üzerinden dinamik olarak B2B fiyatlandırma bilgilerini çeker ve sonuçları yine aynı Google Sheets sayfasına yazar. Proje, uzaktan kontrol edilebilen bir web sunucusu olarak tasarlanmıştır ve Railway gibi modern PaaS platformlarında çalışmaya uygundur.

## ✨ Özellikler

- **Google Sheets Entegrasyonu:** Belirtilen bir sayfadan ASIN listesini okur ve sonuçları geri yazar.
- **Amazon SP-API Desteği:** Amazon'un en güncel API'si ile entegredir.
- **Uzaktan Kontrol:** Webhook (HTTP) tabanlı yapısı sayesinde tarayıcı üzerinden veya herhangi bir script ile uzaktan tetiklenebilir.
- **İş Kontrol Mekanizması:**
  - **Başlat (`/start`):** Fiyat alma işlemini başlatır.
  - **Duraklat (`/pause`):** Çalışan işlemi geçici olarak duraklatır.
  - **Devam Et (`/resume`):** Duraklatılmış işlemi devam ettirir.
  - **Durdur (`/stop`):** İşlemi tamamen sonlandırır.
  - **Durum Sorgula (`/status`):** İşlemin ilerlemesi hakkında anlık bilgi verir.
- **Güvenlik:** Tüm kontrol işlemleri, sadece sizin bildiğiniz bir güvenlik token'ı ile korunur.
- **Eşzamanlılık Koruması:** Aynı anda sadece bir işin çalışmasına izin vererek veri tutarlılığını sağlar.

## 🚀 Kurulum ve Yapılandırma

Projeyi çalıştırmak için aşağıdaki adımları izleyin.

### 1. Bağımlılıkları Yükleme

Proje kök dizininde aşağıdaki komutu çalıştırın:

```bash
npm install
```

### 2. Ortam Değişkenleri (Environment Variables)

Bu proje, hassas bilgileri güvende tutmak için ortam değişkenleri kullanır. Projenizi dağıttığınız platformda (örneğin Railway) aşağıdaki değişkenleri tanımlamanız gerekmektedir:

- **`GOOGLE_CREDENTIALS`**
  - Google Cloud projenizden indirdiğiniz `credentials.json` dosyasının **tüm içeriğini** bu değişkene yapıştırın.

- **`API_CREDENTIALS`**
  - Amazon SP-API için oluşturduğunuz LWA (Login with Amazon) kimlik bilgilerini içeren JSON yapısını bu değişkene yapıştırın. Genellikle `refresh_token`, `lwa_app_id`, ve `lwa_client_secret` alanlarını içerir.

- **`TRIGGER_TOKEN`**
  - Webhook URL'lerinizi güvende tutmak için sizin belirleyeceğiniz, tahmin edilmesi zor, rastgele bir metin. Örneğin: `aK7b_pX9-zR4vY`

## ⚙️ API Kullanımı

Sunucu çalıştırıldığında, aşağıdaki endpoint'ler (URL'ler) kullanılabilir hale gelir. Tüm istekler `GET` metodu ile yapılır ve güvenlik token'ı içermelidir.

**Temel URL Yapısı:**
`https://<PROJENIZIN_URL_U>/<ENDPOINT>?token=<SİZİN_GİZLİ_TOKENİNİZ>`

### Endpoints

- **`/start`**
  - Fiyat alma ve Google Sheets'i güncelleme işlemini başlatır.
  - **Örnek:** `.../start?token=aK7b_pX9-zR4vY`

- **`/pause`**
  - O anda çalışan işlemi duraklatır.
  - **Örnek:** `.../pause?token=aK7b_pX9-zR4vY`

- **`/resume`**
  - Duraklatılmış bir işlemi devam ettirir.
  - **Örnek:** `.../resume?token=aK7b_pX9-zR4vY`

- **`/stop`**
  - Çalışan veya duraklatılmış bir işlemi tamamen sonlandırır.
  - **Örnek:** `.../stop?token=aK7b_pX9-zR4vY`

- **`/status`**
  - İşlemin mevcut durumu hakkında JSON formatında bilgi verir.
  - **Örnek:** `.../status?token=aK7b_pX9-zR4vY`
  - **Örnek Cevap:**
    ```json
    {
      "success": true,
      "isJobRunning": true,
      "isPaused": false,
      "processedTasks": 50,
      "totalTasks": 200,
      "progress": "25%"
    }
    ```

## 🔄 Önerilen İş Akışı

1.  Güncellemek istediğiniz ASIN listesini Google Sheets'teki `EU!B2:B` aralığına yapıştırın.
2.  Tarayıcınızda yer imi olarak kaydettiğiniz `.../start` URL'sine tıklayarak işlemi başlatın.
3.  İşlemin ilerlemesini merak ederseniz `.../status` URL'sini ziyaret edin.
4.  Gerekirse `.../pause`, `.../resume` veya `.../stop` URL'lerini kullanarak süreci yönetin.
