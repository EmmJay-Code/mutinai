# Hardware data plan

Hardware facts split into **stable specifications** and **dynamic market data**. They have different sources, update
rates and legal constraints, so they are stored differently.

## Current model
- **Devices:** `ecosystem.hardware_device` holds memory kind and size, memory type and bandwidth, backends, TDP,
  release date and `launch_price_usd`.
- **Configurations:** `ecosystem.hardware_configuration` holds reference systems with `approx_price_usd`.
- **Seed data:** values are editorial fixtures. Prices have no source or date attached.
- **New:** `ecosystem.price_observation` (migration 0004) holds dated, sourced prices:
  - `price_kind`: `launch_msrp`, `retail_new`, `used` or `editorial_estimate`
  - amount, ISO 4217 currency, region (ISO 3166-1 alpha-2), `observed_at`, source name/URL, optional source record
  - validation (`validatePriceObservation`) rejects non-hardware subjects and bad codes
  - retail and used prices must cite a URL and a region
  - freshness: launch MSRPs are historical; retail goes stale after 7 days, used after 14, estimates after 180
  - `catalog.listLatestPrices` returns the latest per kind, currency and region
  - the UI still reads the legacy columns

## Stable specifications
| Source | Use | Notes |
|---|---|---|
| Manufacturer spec pages (NVIDIA, AMD, Apple, Intel) | VRAM/unified memory, bandwidth, TDP, launch dates, launch MSRP (from launch announcements) | No APIs. Editor-entered records, each with a citation URL, as editorial assertions (priority 100) |
| TechPowerUp GPU database | Broad coverage and cross-checking | Commercial licensing negotiated case by case; its free tier is not for redistribution |
| Open datasets (dbgpu, RightNow GPU Database) | Reference only | Code is MIT/Apache, but the data is scraped from TechPowerUp, so the licence does not settle data rights |

**Recommendation:** keep specifications editorial. Add an editorial source with citation URLs per field (field
assertions already support this), starting with the devices in What Can I Run. Specs change rarely, so manual
curation is cheap and defensible.

## Dynamic market data
| Source | Access | Constraints |
|---|---|---|
| Amazon Creators API (PA-API 5 is retired) | Associates account with 10 qualifying sales in 30 days | Cache ≤ 24 h. Show a timestamp and disclaimer when refreshed less often than hourly. Price tracking/alerting needs Amazon's approval |
| Best Buy Developer API | Free key, 50,000 calls/day | Cache ≤ 72 h, attribution required, no competitive price analysis. US only |
| eBay Browse API (used prices) | eBay Partner Network application | Many Buy APIs are limited release; caching terms unverified |
| Keepa | Paid (from about €49/month) | Amazon price history |
| Newegg, PCPartPicker | No public price API | Scraping is out of scope |

**Recommendation:** don't show current retail or used prices until a source is contracted.
- Launch MSRPs with citations are safe now.
- Current prices need an agreement (Best Buy is the most accessible) and must respect the source's caching window.
  Each observation is a `retail_new`/`used` row with its region and timestamp.
- Displayed prices must show "as of <time>, <source>" and disappear once stale.
- Never infer a price from listings, forums or model output.

## Open questions
- **Markets:** which to cover first (US only, or EU/UK too, with currencies kept unconverted)?
- **Legacy columns:** whether `launch_price_usd`/`approx_price_usd` migrate into `price_observation` as
  `launch_msrp`/`editorial_estimate` rows with citations, and when the UI switches.
- **Used prices:** worth the affiliate/partner dependency, or should used prices be community-submitted with
  moderation?
- **Configuration prices:** computed from component observations, or editorial estimates only?
