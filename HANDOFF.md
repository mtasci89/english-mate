# Faz 0.5 — kalan iş listesi (uygulayıcı için)

Bu dal (`claude/child-language-toy-project-u5tjcm`) Faz 0.5'in mimari kısmını
zaten içeriyor. Aşağıdaki 8 madde kalan mekanik iştir. Sırayla yap, sonunda
`npm run lint && npm run build` temiz geçmeli.

Tasarım gerekçeleri `WeeklyFoody` reposundaki `toy/PLAN.md` ve
`toy/REVIEW-english-mate.md` dosyalarında. Özet kural seti:

- **K1** LLM sıcak yolda olmaz. Yapılandırılmış oyunlar (`move`, `nameit`) hiçbir
  koşulda ağ çağrısı yapmaz. Sadece `chat` modu Gemini'ye gider.
- **K2** Serbest transkripsiyon değil, aday listesine karşı eşleştirme.
- **K3** Bas-konuş; turu çocuk bitirir, motor değil.
- **K4** Üç kademeli geri bildirim, dördüncü kademe (yani "yanlış") yok.
- **K5** Türkçe turu asla bitirmez; ardından hep İngilizce tekrar gelir ve sayaca yazılır.

Bunlardan hiçbirini gevşetme. Bir madde bu kurallardan biriyle çelişiyorsa
maddeyi değil kuralı esas al ve durumu bildir.

---

## Yapılmış olanlar (dokunma, sadece referans)

| Dosya | Rolü |
|-------|------|
| `src/types.ts` | `Turn`, `Attempt`, `Speakable` sözleşmeleri |
| `src/speech/match.ts` | Kısıtlı eşleştirme (K2): katlama + Levenshtein + uzunluğa duyarlı tolerans |
| `src/speech/recognition.ts` | Bas-konuş sarmalayıcı (K3); sessizlik hata değil, boş sonuç |
| `src/audio/player.ts` | Önbellek öncelikli oynatma (K1); dosya yoksa `speechSynthesis` |
| `src/curriculum/*.json` | 16 komut, 20 kelime, ortak replikler |
| `src/curriculum/index.ts` | JSON'a tip + türetilmiş ses anahtarları |
| `src/curriculum/srs.ts` | Leitner kutuları, `localStorage` |
| `src/games/turns.ts` | Tur üretimi + üç kademeli geri bildirim (K4) + can simidi (K5) |
| `src/telemetry.ts` | Deneme kaydı + haftalık özet |
| `src/components/*.tsx` | Home / Game / Chat / Parent ekranları |
| `netlify/functions/attempts.mjs` | Netlify Blobs'a deneme yazma ve okuma |
| `netlify/functions/chat.mjs` | Dil tespiti ve kesilme hataları düzeltildi |

---

## 1. Ölü CSS kurallarını sil

`src/styles.css` sonundaki iki medya sorgusu artık var olmayan sınıflara
(`.conversation-panel`, `.history-panel`) ve `.app-shell` üzerinde kaldırılmış
grid'e atıf yapıyor.

- `@media (max-width: 900px)` bloğunun tamamını sil.
- `@media (max-width: 620px)` bloğunda sadece şunları bırak: `.app-shell`in
  `width`/`padding` daralması ve `.primary-talk { min-height: 132px; }`.
  `.conversation-panel`, `.history-panel`, `.session-header`, `.control-row`,
  `.secondary-actions`, `.live-text` kurallarını sil.
- Dosyanın en sonundaki yeni bölüm (`Home, game and progress screens`) kalsın.

Ayrıca artık kullanılmayan `.prompt-box`, `.voice-controls`, `.live-text`,
`.secondary-actions`, `.control-row`, `.history-panel*` kurallarını da sil —
`grep -r "className" src/` ile kullanılan sınıfları doğrula, kullanılmayanı at.

## 2. `@netlify/blobs` bağımlılığını ekle

`package.json` → `dependencies` içine `"@netlify/blobs": "^8.1.0"` (veya güncel
majör). `npm install` çalıştır, `package-lock.json` güncellensin.

## 3. `/api/attempts` yönlendirmesi

`netlify.toml` içindeki mevcut `/api/chat` redirect'inin yanına ekle:

```toml
[[redirects]]
  from = "/api/attempts"
  to = "/.netlify/functions/attempts"
  status = 200
```

## 4. `public/audio/manifest.json`

İçeriği tam olarak `[]` olan bir dosya oluştur. `src/audio/player.ts` bunu
açılışta okur; dosya yoksa da çalışır ama 404 gürültüsü olur.

## 5. `scripts/build-audio.mjs` — ses önbelleği üretici

Bu, K1'i gerçekten hayata geçiren parça. Sabit replikleri bir kez seslendirip
`public/audio/<key>.mp3` olarak yazar; uygulama çalışırken sentez yapmaz.

**Girdi:** `src/curriculum/commands.json`, `words.json`, `lines.json`.

**Üretilecek anahtar listesi** (`src/curriculum/index.ts` içindeki
`audioKeys` ile birebir aynı olmalı — oradan kopyala, yeniden türetme):

| Anahtar | Metin | Dil |
|---------|-------|-----|
| `lines.json` içindeki her `key` | ilgili `text` | en |
| `cmd-<key>-en` | komutun `en` alanı | en |
| `cmd-<key>-tr` | komutun `tr` alanı | tr |
| `word-<key>-en` | kelimenin `en` alanı | en |
| `word-<key>-tr` | `Bu bir <tr>. İngilizcesi: <en>.` — `unit === "colors"` ise `Bu renk <tr>. İngilizcesi: <en>.` | tr |
| `word-<key>-say-en` | `Say: <en>.` | en |

Türkçe cümle kalıbı `src/curriculum/index.ts` içindeki `turkishHelpFor()` ile
aynı olmalı; ikisi ayrışırsa çocuk yanlış cümleyi duyar.

**Davranış:**
- `GEMINI_API_KEY` ortam değişkeni ile Google AI Studio TTS'i kullan
  (`gemini-2.5-flash-preview-tts`, `responseModalities: ["AUDIO"]`). Model adı
  değişmiş olabilir — çağrı 404 dönerse hata mesajını olduğu gibi bas ve dur,
  sessizce başka modele düşme.
- Dönen PCM/base64 sesi `.mp3` olarak yaz. Dönüşüm gerekiyorsa `ffmpeg` varsa
  kullan, yoksa `.wav` yaz ve `player.ts`'teki uzantıyı buna göre güncelle
  (tek yerde, `elementFor()` içinde).
- İngilizce replikler için tek bir çocuk dostu ses, Türkçe için başka bir ses
  seç; **oturumlar arası tutarlı olsun** — karakterin sesi değişmemeli.
- Zaten var olan dosyayı yeniden üretme (idempotent olsun); `--force` bayrağı
  ile üzerine yazsın.
- Sonunda üretilen tüm anahtarları `public/audio/manifest.json` içine JSON dizi
  olarak yaz.
- Anahtar başına hata olursa o anahtarı atla, sonda özet bas: kaç üretildi, kaç
  atlandı, hangileri. Tek bir başarısızlık script'i öldürmesin.

`package.json` scripts'e ekle: `"build:audio": "node scripts/build-audio.mjs"`.

**Bu script'i CI/build zincirine BAĞLAMA.** Netlify build'i sırasında
çalışmamalı — ses dosyaları repoya commit'lenir, deploy'da üretilmez.

## 6. `src/speech/match.ts` için testler

`vitest` ve `@vitejs/plugin-react` zaten uyumlu; `vitest` devDependency olarak
ekle, `"test": "vitest run"` script'i ve minimal `vitest.config.ts` (environment
`node`) yaz.

`src/speech/match.test.ts` içinde en az şu durumlar:

- `matchAnswer("cat", "cat", [...])` → `accepted: true`, `score === 1`
- `matchAnswer("it's a cat", "cat", [...])` → `accepted: true` (cümle içinde geçen hedef)
- `matchAnswer("dog", "cat", ["dog","cow","duck"])` → `accepted: false`, `matched === "dog"`
- `matchAnswer("", "cat", [])` → `silent: true`, `accepted: false`
- `matchAnswer("tree", "three", [])` → `accepted: true` (th→t katlaması)
- `matchAnswer("vater", "water", [])` → `accepted: true` (w→v katlaması)
- `matchAnswer("ship", "sheep", ["ship"])` → `accepted: false` (çeldirici hedefi yenmeli)
- `matchAnswer("horse", "house", ["horse"])` → `accepted: false`

Son iki vaka geçmezse **eşiği gevşetme** — çeldirici mantığında hata var
demektir, `scoreCandidate`/`beatsDistractors` tarafını düzelt. Eşiği gevşetmek
K4'e karşı güvenliyi bozar (yanlış kabul, yanlış ret'ten daha zararsızdır ama
farklı bir kelimeyi kabul etmek çocuğa yanlış öğretir).

## 7. README'yi güncelle

Mevcut README hâlâ "tek ekran serbest sohbet" ürününü anlatıyor. Şunları yaz:

- Üç mod ve **neden bu sırada** olduğu (merdiven: Move With Me → Name It → Talk With Me).
- Ses önbelleği akışı: `npm run build:audio` ne zaman çalıştırılır, çıktı nereye
  gider, dosya yoksa ne olur.
- `GEMINI_API_KEY`in iki ayrı yerde kullanıldığı: çalışma anında `chat` modu için
  Netlify Function'da, bir de yerelde ses üretiminde.
- **Gizlilik notu, açıkça:** tarayıcının konuşma tanıma API'si çocuğun ses
  kaydını tarayıcı satıcısının sunucularına gönderir; `attempts` kaydı çocuğun
  çözümlenmiş metnini Netlify Blobs'a yazar. Bu bilinçli bir Faz 0.5 ödünüdür ve
  Faz 1'de yerel modele geçiş bunu ortadan kaldırmak içindir.
- Ebeveyn panelindeki dört sayının Faz 0 çıkış kriterine nasıl bağlandığı.

## 8. Doğrula, commit'le, push'la

```
npm run lint      # tsc --noEmit && node --check
npm run test
npm run build
```

Üçü de temiz geçmeden commit etme. Sonra `claude/child-language-toy-project-u5tjcm`
dalına push'la.

---

## Elle test edilmesi gerekenler (bunları ben doğrulayamam)

Tarayıcı konuşma API'si ve ses oynatma headless ortamda çalışmıyor. Push'tan
sonra gerçek bir tablette şunları kontrol et ve sonucu bildir:

1. **Bas-konuş gerçekten basılı tutmayla mı çalışıyor?** Parmağını kaldırmadan 3
   saniye sessiz kal — tanıma kesilmemeli.
2. **Sessizlik cezalandırılmıyor mu?** Butona bas, hiçbir şey söyleme, bırak.
   Beklenen: "I'm listening. Take your time." Beklenmeyen: herhangi bir hata sesi.
3. **Üç kademe çalışıyor mu?** Kasten yanlış bir kelime söyle üç kez. Sırayla:
   "So close" → model ("Listen. cat. Now you.") → "Good trying, let's look at
   another one" ve yeni kelime. Hiçbir aşamada "wrong" duyulmamalı.
4. **Can simidi merdiveni:** "Anlamadım"a bas. Türkçe açıklama gelmeli, **hemen
   ardından** İngilizce tekrar gelmeli, tur hâlâ İngilizce cevap beklemeli.
5. **Gecikme:** `build:audio` çalıştırıldıktan sonra parmağını kaldırmanla sesin
   başlaması arasındaki süre. Hedef 1 saniyenin altı. Üstündeyse Chrome
   DevTools Network sekmesinde `.mp3`lerin önbellekten mi geldiğine bak.
