# English Mate v2 — akşam arkadaşı

Bu belge, tablet uygulamasından **fiziksel bir akşam arkadaşına** geçişi tanımlar.
Önceki plan (`WeeklyFoody:toy/PLAN.md`) ve ilk inceleme hâlâ geçerli; burada
değişen ürünün şekli.

---

## 0. Neden değişiyor

İlk sürüm bir tablet uygulaması oldu: çocuk ekrana bakıp "hangi oyunu
oynayayım" diye seçiyor. İstenen oyuncaktı — seçim yaptırmayan, köşede duran,
akşam olunca kendiliğinden başlayan bir şey.

Bu, tek tek hataların toplamı değil, şeklin yanlış olmasıydı. Yama listesi
uzadıkça şekli sorgulamak yerine semptom düzeltmeye devam edildi.

İkinci bir sorun daha vardı: ilk planın Faz 0 kapısı **"çocuk kendisi isteyecek
mi?"** idi. Bu, bir oyuncak için en kırılgan varsayım. Ritüel bu soruyu ortadan
kaldırır: kutu akşam saatinde kendiliğinden uyanır.

---

## 1. Ürün

**Ekransız bir kutu. Akşam saatinde kendiliğinden uyanır ve o akşamın
programını işletir.**

```
19:30  🔔  "İyi akşamlar Maty. Bu akşam dinozorları konuşacağız."

       ├─ Isınma      5 dk   Dinle ve yap. Konuşma yok.
       ├─ Sohbet     10-15   Akşamın konusu içinde.
       └─ Hikâye     15-20   Kutu okur, arada 3-4 basit soru.

       "Yarın uzay var. İyi geceler."
```

Çocuk hiçbir şey seçmez. Menü yok, ekran yok.

### Blok süreleri üzerine

6 yaşındaki bir başlangıç seviyesi için **30 dakika kesintisiz konuşma
gerçekçi değil** — üretim en yorucu beceridir ve 10-12 dakikada tükenir.
Buna karşılık 30 dakika *dinleme* fazlasıyla gerçekçi.

Bu yüzden varsayılan üretimi kısa, dinlemeyi uzun tutar. Ama bu bir inanç
meselesi olmasın: panel **blok başına bırakma oranını** ölçer. Çocuk sohbet
bloğunda 20. dakikada hâlâ istekliyse süre uzatılır; 8. dakikada kopuyorsa
kısaltılır. Karar veriyle verilir.

---

## 2. Konu sistemi

Ebeveyn bir **konu kümesi** ve **haftalık program** tanımlar:

```
Pzt  Hayvanlar      Sal  Uzay        Çar  Yemek
Per  Futbol         Cum  Okul        Cmt  Dinozorlar
```

Her konu paketi şunları taşır:

- **Kelime listesi** (12-20) — hem Name It hem hikâye bu listeden beslenir
- **Hikâyeler** (3-5, artan uzunlukta) — metin + önceden üretilmiş ses
- **Sohbet tohumları** — o konuda açılış soruları
- **Sınırlar** — konunun dışına çıkılmaz

Konu sınırı sadece güvenlik değil, **pedagoji**: kelime edinimi yoğunlukla
olur. Bir hafta dinozor konuşmak "big, small, teeth, eat, run, bones"
kelimelerini hem sohbette hem hikâyede tekrar tekrar karşına çıkarır.
Dağınık konular dağınık maruziyet verir.

### Üretim gece yapılır

Haftanın konuları belliyse hikâyeler ve sesleri gece toplu üretilir. Böylece
20 dakikalık dinleme bloğu **çalışma anında sıfır gecikme, sıfır maliyet,
sıfır kota**. Bu, ilk planın K1 kuralının büyük ölçekte uygulanması.

Çalışma anında model yalnızca sohbet bloğunda devrededir ve sistem prompt'una
o akşamın konusu + kelime listesi verilir.

---

## 3. Donanım

| Parça | Örnek | ~Fiyat |
|---|---|---|
| Raspberry Pi 5 (4 GB) | — | 65 € |
| USB konferans mikrofonu | mikrofon + hoparlör tek gövdede | 35 € |
| Arcade buton ×2 | yeşil = konuş, mavi = anlamadım | 5 € |
| LED halka | WS2812B, 16 px — kutunun "yüzü" | 6 € |
| microSD 32 GB | — | 8 € |
| Kutu | ahşap veya 3D baskı | 15-40 € |

**Neden Pi, neden ESP32 değil:** 30 dakikalık ses oynatma, mikrofon akışı,
saatli uyanma ve gece içerik üretimi — Linux'ta bunlar bedava, ESP32'de her
biri elle yazılır. ESP32'nin yeri ileride NFC kartlar olabilir; Pi beyin,
ESP32 gerekirse uzuv. İkisi alternatif değil.

**Ekran yok, bilerek.** Kutunun tek ifade aracı LED halka:
yavaş nefes = dinliyorum · dönüş = düşünüyorum · sıcak parlama = konuşuyorum.

---

## 4. Mimari

```
┌─ Kutu (Pi 5) ────────────┐      ┌─ Beyin (GX10) ──────────────────┐
│ seans motoru             │      │ Whisper          konuşma tanıma │
│ buton + LED              │◀────▶│ yerel LLM        sohbet         │
│ mikrofon akışı           │ LAN  │ yerel TTS        ses            │
│ önbellekten ses çalma    │      │ içerik üretici   gece, toplu    │
│ systemd zamanlayıcı      │      │ SQLite           ilerleme       │
└──────────────────────────┘      └─────────────┬───────────────────┘
                                                │
                                   Ebeveyn konsolu (web)
                                   konular · program · ilerleme
```

**Neden beyin GX10'da yerel:** şu ana kadar çarptığımız her duvar — kota,
model emekliliği, token kesilmesi, maliyet, gecikme, çocuğun sesinin evden
çıkması — yerel çalıştırmada ortadan kalkar. Ve makine zaten orada duruyor.

---

## 5. Mevcut koddan taşınanlar

Hiçbiri boşa gitmedi:

| Bugün | Yeni rolü |
|---|---|
| `curriculum/*.json`, `srs.ts` | konu paketlerinin çekirdeği |
| `speech/match.ts` | aynen — artık Whisper çıktısı üzerinde |
| `games/turns.ts` | menü öğesi değil, **seans bloğu** |
| `chat.mjs` sistem prompt'u | konu-sınırlı sohbet |
| `scripts/build-audio.mjs` | gece içerik üreticisinin ses ayağı |
| `curriculum/gaps.ts` | aynen — takılınan kelime hâlâ en iyi sinyal |
| React uygulaması | **ebeveyn konsolu** — çocuk ona bakmaz |
| Netlify fonksiyonları | emekli; her şey LAN'da |

---

## 6. Fazlar

### Faz A — Ritüel, hâlâ tarayıcıda (1 hafta)

Donanım almadan önce **seans yapısını doğrula**. Tek değişiklik: çocuk
seçmiyor, program akıyor.

- Seans motoru: bloklar, geçişler, akşam programı
- Konu sistemi + haftalık program (ebeveyn konsolu)
- Hikâye bloğu: önceden üretilmiş metin + ses, arada sorular
- Blok başına bırakma ölçümü

**Çıkış kriteri:** çocuk 5 akşam üst üste seansı **sonuna kadar** götürüyor.
Götüremiyorsa blok süreleri yanlış demektir — donanım bunu düzeltmez.

### Faz B — Beyni eve taşı (1-2 hafta)

GX10'da Whisper + yerel LLM + yerel TTS. Bulut bağımlılığı ve onunla gelen
bütün dertler biter.

### Faz C — Kutu (1-2 hafta)

Pi, mikrofon, hoparlör, buton, LED, gövde. `systemd` zamanlayıcısı.
Ekran bu noktada tamamen çıkar.

### Faz D — Karakter

NFC resimli kartlar, kutu tasarımı, çocuğun kutuya isim vermesi.

**Sıra bilinçli:** ritüel çalışmazsa donanım işe yaramaz. Faz A bugünkü
kodla bir haftada yapılır ve en riskli varsayımı en ucuza test eder.

---

## 7. Ölçüm

Faz A'dan itibaren panel şunları gösterir:

1. **Blok tamamlama** — hangi blokta kopuyor? Süre kararını bu verir.
2. **Konuşma payı** — sohbet bloğunda çocuk kaç saniye konuştu?
3. **Türkçe can simidi** — haftalar içinde düşüyor mu?
4. **Takılınan kelimeler** — ne söylemek istedi de söyleyemedi?
5. **Ritüel tutuyor mu** — kutu çağırdığında geliyor mu?

Beşincisi en önemlisi. "Kendisi ister mi" sorusunu ritüel ortadan kaldırdı;
yerine geçen soru "çağrıldığında geliyor mu".
