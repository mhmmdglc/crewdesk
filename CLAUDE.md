# crewdesk — Claude Notları

Claude Code oturumlarını izleyen lokal dashboard. Sıfır bağımlılık, Node 20+, derleme adımı yok.
Repo: https://github.com/mhmmdglc/crewdesk (public, MIT).

## Çalıştırma

- `node bin/crewdesk.mjs` → http://127.0.0.1:4600 (gerçek `~/.claude` okunur)
- `node bin/crewdesk.mjs demo --port 4610` → uydurma veri, gerçek veri okunmaz (`--demo`/`-d` de aynı şey). Demo verisi 30 sn'de bir yeniden yazılır, yoksa 90 sn sonra ekran sönüyor.
- `npm run check` → tek doğrulama aracı: repodaki **her** `.js`/`.mjs` dosyasına tek tek `node --check`. Otomatik test **yok**. Tek çağrıya birden çok dosya verme: `node --check` yalnızca ilkine bakar.

Sunucuyu yeniden başlatmadan `src/` değişikliği etkili olmaz; `public/` için sayfa yenilemek yeter.

## Dizin

| Dosya | Sorumluluk |
|---|---|
| `bin/crewdesk.mjs` | CLI çözümleyici (bilinmeyen argüman = hata), `demo` alt komutu + periyodik tazeleme, bağlanma hatalarının açıklanması, loopback dışı bind uyarısı, eski veri dizini taşıma |
| `src/server.mjs` | HTTP + API, CSP, CSRF/Host doğrulama, statik sunum |
| `src/sources.mjs` | `~/.claude`'u okuyan **tek** dosya (proje, oturum, alt-ajan, token, ajan kadrosu) |
| `src/events.mjs` | Devir teslim kütüğü + oda türetme kuralları |
| `src/board.mjs` | Aşama/sahip overlay'i, anahtar doğrulama, atomik yazım |
| `public/app.js` | Arayüz mantığı, uyarılar |
| `public/office.js` | Canvas pixel ofis |
| `public/i18n.js` | 6 dil (en varsayılan) |
| `src/nudge.mjs` | Dürtme kuyruğu — `~/.crewdesk/nudges/` altına yazar, bekleyenleri okur |
| `hooks/crewdesk-nudge.mjs` | Claude Code Stop kancası: dürtmeyi tüketip oturuma verir |
| `demo/seed.mjs` | Uydurma `~/.claude` ağacı; `seed({ refresh: true })` zaman damgalarını tazeler, `.crewdesk-demo` işaretçisi olmayan dizini silmez |

## Bozulmaması gereken kurallar

1. **`~/.claude`'a asla yazma.** Kendi durumumuz `~/.crewdesk/` altında. Tek istisna
   `crewdesk install-hook`: kullanıcının kendi yazdığı, onay soran, kancayı `settings.json`'a
   ekleyen komut. Sunucu ve arayüz bu dizine hiçbir koşulda yazmaz.
2. **Sakla değil, türet.** Oda, kuyruk, test turu — hepsi `events.jsonl`'den hesaplanır. Elle senkron tutulan alan ekleme.
3. **Ekran gerçeği söylesin.** Koşmayan ajan çalışma odasına girmez. Gözlemlemediğin aktiviteyi çizme.
4. **Runtime bağımlılığı yok.** `dependencies` boş kalacak.
5. **Dışarı istek yok.** Telemetri, sürüm kontrolü, hiçbiri.
6. Arayüzde kullanıcı/model üretimi her değer `esc()` ile kaçışlanır (task başlığı, ajan adı, owner, soru metni).

## Bilinen açık maddeler

- **npm'e yayınlanmadı, bilinçli.** Dağıtım doğrudan GitHub'dan: `npx github:mhmmdglc/crewdesk`. Test edildi, demo ve gerçek mod ikisi de çalışıyor. İleride npm istenirse `npm publish` için hesapta 2FA + OTP (ya da bypass'lı granular token) gerekiyor.
- **Otomatik test yok.** Bulgular elle doğrulandı. `test/` altına fixture tabanlı birkaç senaryo en değerli katkı olur.
- QA raporundan bilinçli kapatılmayanlar: 5 saatlik pencere gerçekte ~4.x saati kapsıyor (GUIDE'da yazılı), token dosyası senkron okunuyor, `/api/assign` iki ayrı yazım yapıyor (atomik değil), aynı atamayı tekrarlamak kütüğe kopya satır ekliyor.
- Yalnızca macOS'ta denendi.

## Doğrulanmışlar (temiz dizine kurup test edildi)

Paketleyip boş dizine kurma, gerçek veriyle açılış, kart taşıma → atama → testten geri çekme, **sunucu yeniden başlatıldıktan sonra kalıcılık**, 6 dil, ofis canvas'ı, konsol hatasız. Güvenlik: `__proto__` 400, çapraz-origin 403, `text/plain` 415, sahte Host 403, path traversal 404, CSP var. `/api/state` ~20 ms.
