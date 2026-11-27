# Chillera Market — konfiguracja źródeł danych

## Zakres i zasady

Panel rozdziela:
- katalog surowców dopuszczonych do obrotu (rejestr urzędowy),
- rejestr aptek (adresy i dane placówek),
- obserwacje dostępności zgłoszone przez aptekę lub autoryzowany feed,
- oferty hurtowe przekazane przez dostawcę w kanale B2B.

Obecność surowca w rejestrze nie oznacza, że jest dostępny w hurtowni lub aptece. Dane importowane przez skrypt dostają status `unverified`; publiczny panel pokazuje wyłącznie rekordy zatwierdzone.

## Oficjalne źródła referencyjne

1. Lista Surowców Farmaceutycznych (Centrum e-Zdrowia): https://rejestry.ezdrowie.gov.pl/rpl/lsf
2. Codzienny plik XLSX LSF: https://rejestry.ezdrowie.gov.pl/api/rpl/medicinal-products/pharmaceutical-raw-materials/get-xlsx
3. Rejestr aptek (CSV/JSONLD): https://rejestry.ezdrowie.gov.pl/api/filegenerator/getcsv
4. Metadane LSF w Otwarte Dane: https://dane.gov.pl/pl/dataset/2001
5. Metadane rejestru aptek: https://dane.gov.pl/pl/dataset/1925/resource/56869

LSF jest aktualizowana codziennie i zawiera surowce dopuszczone do obrotu. Rejestr aptek identyfikuje placówki, ale nie publikuje stanów magazynowych.

## Dane o stanach aptecznych

Nie istnieje jeden publiczny, oficjalny feed obejmujący rzeczywiste stany wszystkich aptek. Dane stanów muszą pochodzić z:
- publicznego feedu apteki/sieci, jeśli warunki korzystania pozwalają na automatyczny odczyt,
- API lub pliku przekazanego przez aptekę na podstawie umowy/zgody,
- zgłoszenia apteki w panelu partnerskim.

Nie wolno traktować listy aptek, katalogu produktów ani strony informacyjnej jako dowodu stanu magazynowego. Nie omijamy logowania, CAPTCHA ani ograniczeń technicznych.

## Konfiguracja Vercel

Wymagane zmienne:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` — tylko odczyt publicznego katalogu; RLS nadal obowiązuje
- `SUPABASE_SERVICE_ROLE_KEY` — sekret serwerowy dla importera; nigdy nie dodawać z prefiksem NEXT_PUBLIC
- `CRON_SECRET` — sekret do autoryzacji wywołania Vercel Cron
- `CHILLERA_SOURCE_URLS` — tablica JSON źródeł JSON/CSV

Przykład `CHILLERA_SOURCE_URLS`:
```json
[
  {
    "name": "Apteka partnerska — przykład",
    "type": "pharmacy",
    "url": "https://example.invalid/stock-feed.json",
    "format": "json_feed",
    "enabled": false,
    "terms_reviewed": false,
    "access_method": "contract"
  }
]
```

Przykładowy rekord JSON:
```json
{
  "records": [
    {
      "canonical_name": "Nazwa zgodna z rejestrem",
      "manufacturer": "Producent",
      "product_type": "flower",
      "thc_percent": 20,
      "cbd_percent": 1,
      "pack_size_g": 10,
      "pharmacy": {
        "name": "Apteka partnerska",
        "address": "Adres",
        "city": "Miasto"
      },
      "availability": {
        "status": "available",
        "price_pln": 75,
        "quantity_g": 10,
        "expires_at": "2026-11-28T05:00:00Z"
      }
    }
  ]
}
```

Do aktywacji źródła wymagane są jednocześnie `enabled: true` i `terms_reviewed: true`. Każdy import zapisuje historię. Rekordy nie stają się automatycznie zweryfikowane.

## Codzienny harmonogram

Vercel Cron: `0 5 * * *` (05:00 UTC). Endpoint: `/api/cron/collect`.
Obecny importer obsługuje feedy JSON i CSV. Oficjalny XLSX LSF oraz duży CSV rejestru aptek wymagają osobnych adapterów parsujących ich rzeczywiste nagłówki; nie są jeszcze włączone do automatycznego importu. Stany apteczne wymagają feedów partnerskich lub uzgodnionego dostępu.

## Migracja bazy

Wykonaj plik `supabase/chillera_market.sql` w SQL Editor projektu Supabase. Tabele mają prefiks `market_`, są w schemacie `public`, mają RLS, a oferty hurtowe, źródła operacyjne i logi pozostają poza publicznym odczytem.
