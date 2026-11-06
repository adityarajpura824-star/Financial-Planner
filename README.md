# Financial Planner

A fast, client-side calculator for live client consultations. Type a number and every result updates in the same frame: no server, no spinner, no build step. It works offline once loaded.

**Three modes** (keys `1` `2` `3`):

| Mode | What it answers |
|---|---|
| **Plan & Compare** | Lump sum + monthly SIP (with yearly step-up) in a security vs a bank FD. Shows pre-tax, after-tax and after-tax-and-inflation corpus, real return p.a., a growth chart and a year-by-year table. |
| **CAGR** | Solve for any one of CAGR, end value, start value or time, given the other three. Compares the result to the FD yield and projects ahead. |
| **Goal** | The monthly SIP needed to reach a target (optionally in today's money, inflated), side by side for the security and an FD. Also shows the one-off top-up that would do the same job. |

Made for a tablet or desktop on the table between planner and client: large headline numbers, dark and light themes, a compact results strip on phones, and a **Copy summary** button that puts the numbers and assumptions on the clipboard.

## Run it

No install is needed. It is plain HTML, CSS and JavaScript.

```bash
# any static server works
python3 -m http.server 8000      # then open http://localhost:8000
# or
npx serve .
```

You can also open `index.html` directly. Everything works from `file://`, except that the background refresh of `data/rates.json` is skipped and the built-in rates are used.

## Deploy

**Vercel (about two minutes)**
1. Go to [vercel.com/new](https://vercel.com/new) and import this repository.
2. Framework preset: **Other**. Leave the build command and output directory empty.
3. Click **Deploy**. Every `git push` to `main` redeploys.

CLI alternative: `npx vercel --prod` from this folder.

**GitHub Pages**: Settings → Pages → Deploy from branch → `main` / root.

## Install it on a phone

There are two ways, and you can use either or both.

**1. As a web app (no APK).** Deploy it first (above), then open the site's address on the phone:
- **Android (Chrome):** menu `⋮` → **Install app** (or *Add to Home screen*).
- **iPhone (Safari):** Share → **Add to Home Screen**.

It then has its own icon, opens full screen, and works offline. Updates arrive by themselves the next time it is opened with a connection.

**2. As an Android APK, like a normal app.** The **Build Android APK** workflow (`.github/workflows/build-apk.yml`) builds it on every push to `main`, or on demand from the **Actions** tab (*Run workflow*). Get the file from either place:
- **Releases → `apk-latest` → `FinancialPlanner.apk`**: a fixed link you can open straight on the phone: <https://github.com/adityarajpura824-star/Financial-Planner/releases/tag/apk-latest>
- **Actions → the latest run → Artifacts** (a zip containing the same APK).

Open the file on the phone and allow *Install unknown apps* for the browser or file manager when asked. The APK is debug-signed, which is fine for your own devices but not for the Play Store.

The APK carries its own copy of the app, including `data/rates.json` as it was at build time, so a rate change in the repo reaches the APK only after the next build and reinstall. Rates edited inside the app stay on the device either way.

## Keeping bank rates current

Benchmarks live in [`data/rates.json`](data/rates.json). Edit the numbers, commit and push, and the deployed app picks them up on the next load. Inside the app, **Bank benchmarks** lets the planner override any rate on that device mid-meeting, and **Use** copies a rate into the FD field.

The shipped rates are **indicative**: SBI's general-public card rates as shown on BankBazaar (page dated 12 Oct 2026, rates stated as effective from 15 Dec 2025). The savings-account row is an unverified placeholder. Confirm with the bank before quoting a client.

There is deliberately no live rate feed. Bank sites have no public API, and a network call would break the zero-latency promise. The app always starts from built-in rates, then quietly refreshes from `rates.json` if it can.

## How the numbers are worked out

- **Security return** is an effective annual rate, applied month by month as `(1 + r)^(1/12)`.
- **Bank FD** uses a nominal rate compounded quarterly by default (changeable). Interest is taxed **every year** at the slab rate, on an accrual basis.
- **SIP** goes in at the start of each month by default (changeable) and steps up on each anniversary.
- **Security tax** (default: equity) is LTCG at 12.5% on the total gain above a ₹1,25,000 exemption, taken once at the end. Alternatives: slab rate on the whole gain, or no tax.
- **After tax and inflation** deflates the after-tax value by the inflation rate. The *Invested* line on the chart stays in actual rupees paid.
- **Return p.a.** is the IRR of the actual cash flows, so it is comparable across lump sum and SIP.
- **CAGR** is `(end ÷ start)^(1 ÷ years) − 1`.

**Simplifications to say out loud to clients:** no health and education cess or surcharge, no expense ratio or exit load, and short-term capital gains on units held under 12 months are not modelled. The LTCG exemption is applied once rather than harvested yearly. Tax rates and exemptions are editable under **Tax & timing assumptions**. Projections are illustrations, not guarantees or advice.

## Develop

```bash
npm test      # 26 unit tests on the calculation engine (Node 18+, no dependencies)
```

```
index.html        page shell
css/styles.css    theme tokens, layout, components
js/calc.js        pure financial maths (no DOM); the part that is unit-tested
js/rates.js       bank benchmark rates with offline fallback
js/app.js         inputs, rendering, chart, persistence
data/rates.json   bank benchmark rates
tests/            engine tests
sw.js             offline support (service worker)
manifest.webmanifest, icons/   what makes it installable as a web app
capacitor.config.json, android/, scripts/build-web.js, assets/   the Android APK wrapper (Capacitor) and its icon sources
.github/workflows/build-apk.yml   builds the APK in the cloud
```

To build the APK on your own machine instead, install Android Studio, then `npm install`, `npm run apk:sync` and `npx cap open android`. The web app itself never needs a build step.

Inputs are remembered in the browser (`localStorage`) between visits, per device. **Reset** clears them to the defaults.

### Shortcuts

| Key | Action |
|---|---|
| `1` `2` `3` | Switch mode (when not typing in a box) |
| `↑` `↓` in a number box | Nudge the value (hold `Shift` for 10×) |
| `5l`, `2.5cr`, `50k` in a rupee box | Expands to 5,00,000 / 2,50,00,000 / 50,000 |
