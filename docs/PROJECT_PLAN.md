# WindKraft: Wind Prediction Dashboard, End-to-End Project Plan

Status: **backend Phases 0-4 built** (see section 10 for the as-built notes); frontend not started. **Decisions confirmed:** one site only; runs locally on the developer's PC (college project); default turbine NREL 3.3 MW with user-switchable turbines; forecast starts from a user-picked past date (Option A, section 3.5); Forecast API comparison stays in v1 and uses the Previous Runs API (section 3.8). Source of truth for the model today is `wind_prediction_engine.ipynb` (validated: LightGBM beats persistence, seasonal naive and SARIMAX on held-out rolling backtest).

---

## 1. Goal and scope

**Goal.** A single-page dashboard where a user enters turbine coordinates, sees the site on a map, and gets:
- the next 24 h wind speed and direction forecast (ML model only),
- direction confidence and a yaw (nacelle heading) recommendation,
- hourly power and total energy from an NREL turbine curve,
- model-quality evidence (baseline vs SARIMAX vs LightGBM, error by lead time),
- downloadable CSV/JSON.

**In scope:** React dashboard (JS/JSX only), Python API, forecasting pipeline, scheduler, local storage.
**Out of scope (v1):** login/auth/users, sending commands to turbines, multiple sites, cloud hosting/Docker, live sensor feeds, probabilistic intervals, mobile app.
**Hard constraints from the brief:** no authentication of any kind; frontend is React with `.js`/`.jsx` only (no TypeScript); modern, futuristic yet minimal design; charts and tables for all outputs.

---

## 2. System architecture

```
 ┌──────────────────────────── Browser ────────────────────────────┐
 │  React SPA (Vite, JS/JSX)                                        │
 │  Site panel · Map · KPI cards · Charts · Tables · Export         │
 └───────────────▲──────────────────────────────────────────────────┘
                 │ HTTPS JSON (REST, polling for job status)
 ┌───────────────┴────────────── Backend (FastAPI) ─────────────────┐
 │  API layer  →  Service layer  →  Forecast engine (pure Python)   │
 │                                                                  │
 │  Job runner (train / refresh)   Scheduler (hourly refresh)       │
 └───────┬───────────────┬──────────────────┬───────────────────────┘
         │               │                  │
   SQLite (metadata,  File store           External
   runs, forecasts)   (parquet data,       Open-Meteo Archive API  → model training/inference data
                       joblib models,      Open-Meteo Previous Runs API → comparison ONLY (day-ahead forecasts)
                       reports)            NREL turbine-models pkg → local power curves

 All of it runs on one PC: `uvicorn` (backend, port 8100) + `vite` (frontend, port 5200).
```

Key rules carried over from the notebook:
1. The Forecast API is only ever used by the *comparison* service, never by training, features or inference.
2. Raw data is stored unchanged; the cleaned dataset is a separate artifact.
3. All training uses information available at the cutoff (no look-ahead).
4. Direction is always handled as sine/cosine and reported with circular statistics.

---

## 3. Backend

### 3.1 Stack
- Python 3.12+, **FastAPI** + Uvicorn, Pydantic models for responses.
- A single-worker **job runner** (thread pool, progress stored in SQLite) for long operations. Setup takes about 20 min because every site gets the full search (a smaller 'quick' profile existed at first and was later removed). No scheduler in v1: data refresh is a button (`POST /api/site/data/refresh`).
- **SQLite** (SQLAlchemy) for the site, runs and forecast rows; **Parquet** for datasets; **joblib** for model files.
- LightGBM, statsmodels, pandas, numpy, scikit-learn, turbine-models (already validated).
- Run locally with two commands (`uvicorn app.main:app`, `npm run dev`); optional `start.ps1` launches both. pytest for tests. No Docker needed.

### 3.2 Folder layout
```
backend/
  app/
    main.py                  # FastAPI app, CORS, routers, startup (scheduler)
    config.py                # settings (env), defaults from notebook config
    api/
      site.py  forecasts.py  models.py  turbines.py  exports.py  compare.py  jobs.py  health.py
    schemas/                 # Pydantic request/response models
    services/
      data_service.py        # fetch / validate / clean (notebook sections 4-5)
      feature_service.py     # build_features + leakage test (section 7)
      baseline_service.py    # persistence, seasonal naive
      sarimax_service.py     # tuned SARIMAX benchmark
      gbm_service.py         # direct multi-step LightGBM (24 horizons x speed/sin/cos)
      backtest_service.py    # rolling backtest + metrics by lead
      selection_service.py   # model selection report, bootstrap CI
      direction_service.py   # circular error, confidence R, thresholds
      yaw_service.py         # hysteresis/deadband heading plan
      turbine_service.py     # NREL curve load + verification + power/energy
      compare_service.py     # Forecast API comparison (isolated)
    core/
      metrics.py  circular.py  io.py  registry.py  jobs.py  scheduler.py
    db/                      # models.py, session.py, migrations (alembic optional)
  tests/                     # unit + leakage + golden-file tests
  data/ models/ reports/     # runtime artifacts (git-ignored)
  pyproject.toml  start.ps1
```
The notebook stays as the research/QA record; each backend service is a direct port of the matching notebook section, and a golden test checks that the backend reproduces the notebook's metrics on a fixed cached dataset.

### 3.3 Data model (SQLite)
| Table | Key fields |
|---|---|
| `site` | single row (v1): lat, lon, name, local_tz, turbine_name, nacelle_heading, created_at |
| `dataset_version` | id, site_id, start, end, rows, interpolated_hours, missing_hours, raw_path, clean_path, fetched_at, validation_json |
| `model_version` | id, site_id, dataset_id, backend, configs_json, trained_through, metrics_json, selection_json, path, status |
| `forecast_run` | id, site_id, model_id, origin_utc, created_at, total_kwh, capacity_factor, meta_json |
| `forecast_run` (as built) | stores the model-only hourly forecast as one JSON document; yaw, power and energy are recomputed on read so switching turbine needs no retraining |
| `job` | id, type, site_id, status, progress, message, started_at, finished_at |

### 3.4 REST API (no auth; JSON)
| Method + path | Purpose |
|---|---|
| `GET /api/health` | liveness, versions, last refresh |
| `PUT /api/site` `{lat, lon, name?, turbine?}` | set/replace the single site; starts data fetch + initial training job; returns `{site, job}` |
| `GET /api/site` | site details, data coverage, selectable forecast-date range |
| `GET /api/jobs/{id}` | job status/progress (frontend polls every 2 s) |
| `GET /api/site/data/quality` | validation report (gaps, duplicates, units, height, freshness) |
| `GET /api/site/data/history?days=30` | recent cleaned series for charts |
| `GET /api/site/forecast?origin=YYYY-MM-DD` | 24 h forecast + yaw + energy for the chosen start date (default = latest available). Cached per date |
| `POST /api/site/forecast` `{origin}` | run it now: trains with cutoff = that origin, so the result is always out-of-sample for that date (job, about 1 min) |
| `GET /api/site/models/report` | backtest metrics (overall and by lead), selection, success criteria |
| `GET /api/site/models/direction` | error by confidence/speed bins, threshold sweep |
| `GET /api/turbines` / `GET /api/turbines/{name}/curve` | available NREL turbines, verified curve + spec |
| `PATCH /api/site` | change turbine, current nacelle heading, deadband |
| `GET /api/site/compare?date=YYYY-MM-DD` or `?from=&to=` | model vs Forecast API vs observed, matched timestamps, metrics + hourly rows (section 3.8) |
| `GET /api/site/export?format=csv\|json&origin=` | export the selected forecast |

Response shape for the main call (`forecast/latest`):
```json
{ "origin_utc": "2026-10-21T23:00:00Z", "model": "LightGBM",
  "summary": {"total_kwh": 7768, "capacity_factor": 0.098, "reliable_hours": 24},
  "hours": [{"ts_utc": "...", "ts_local": "...", "lead_h": 1, "speed": 5.2, "direction": 58,
             "confidence": 0.99, "reliable": true, "heading": 58, "yaw_note": "...",
             "power_kw": 709, "energy_kwh": 709}],
  "limitations": ["reanalysis data, not site sensor", "..."] }
```

### 3.5 Forecast start date (Option A) and lifecycle
The archive lags real time by about 5 days, so v1 does **not** claim to forecast "tomorrow". The user picks a **forecast start date** (default = the latest available hour; earlier dates allowed). The model predicts the 24 h after that origin using only data up to the origin.
1. **Set site** -> fetch 3 y history -> validate/clean -> backtest + tune -> select -> store held-out results.
2. **Forecast for a date** -> train the final models with cutoff = that origin (about 1 min, cached) -> predict -> yaw/energy -> store. Because the cutoff equals the origin, no result is ever in-sample for its own date.
3. **Refresh data** (button, optional daily timer) pulls newer archive hours so the latest selectable date advances.
4. Failures are recorded on the job; the last good forecast stays visible with a "stale" badge.
5. A live sensor feed (SCADA/mast) is a documented future extension, not part of v1.

### 3.6 Known issues to fix while porting
- **Direction confidence can slightly exceed 1** (sin and cos are clipped separately). Normalize `R = min(1, hypot(sin, cos))`.
- **Training time is about 20 min** for a new site (SARIMAX grid ~8 min, LightGBM grid ~5 min). Plan: cache per-site results; run the SARIMAX grid only in an optional "full evaluation" job; parallelize with joblib; reduce the default LightGBM grid.
- **Data lag:** the archive is about 5 days behind real time. Needs a decision (see section 9) before the forecast is operationally meaningful.
- Add prediction intervals (quantile LightGBM) as a v2 item.

### 3.8 Forecast API comparison (isolated, fair)
**The notebook's current comparison is not a valid accuracy test.** For past dates the Forecast API and the Historical Forecast API return values identical to the archive (measured error 0.000), because the archive's recent 100 m values come from that same model's analysis. The comparison therefore uses the **Previous Runs API** (`wind_speed_100m_previous_day1`, `wind_direction_100m_previous_day1`), which stores the forecast actually issued the day before.

Rules:
- Match by UTC timestamp (inner join); report how many hours matched.
- Three series per date: **observed** (archive), **ML model** (out-of-sample), **Forecast API** (previous-day forecast). Errors are always computed against observed, never model-vs-API.
- Metrics: speed MAE/RMSE and direction circular MAE (overall and above the wind-speed threshold), by lead where possible. For a like-for-like lead, also report **lead 24 h only** (model origin T-24 h vs the API's previous-day forecast for hour T). Over the 150-day held-out block this is about 3,600 matched hours, far stronger than one date.
- The Forecast API never enters training, features or inference; the comparison service is the only code that calls it.

**Limitations shown beside the results:**
- "Observed" is reanalysis from the same family of weather models as the API, which structurally favours the API. A first single-date check (22 Oct 2026) had the API closer: speed MAE 0.74 vs 0.84 m/s, direction 8.8 vs 17.5 deg. This is reported honestly, not tuned away.
- One date is anecdotal; use the multi-day option for conclusions.
- Real accuracy needs on-site measurements.

### 3.7 Security without auth
No login does not mean no safeguards: CORS limited to the frontend origin, per-IP rate limiting on `POST` routes, input validation (lat/lon ranges, date ranges), job concurrency cap, no secrets in the client. Running on localhost only (bound to `127.0.0.1`) is the v1 deployment, so the open API is not exposed beyond the PC.

---

## 4. Frontend (React, JS/JSX only)

### 4.1 Stack
- **React 18 + Vite**, files `.jsx` / `.js` only; `jsconfig.json` for path aliases; ESLint with `react-hooks` rules and PropTypes for component contracts. No TypeScript, no `.ts/.tsx` anywhere.
- **Recharts** for charts (line/area/bar/radial/scatter) and a small custom SVG compass.
- **react-leaflet** + OpenStreetMap tiles for the map (click to pick coordinates).
- **TanStack Table** (or plain sortable tables) for tables; **plain CSS** with design tokens (CSS variables), no UI framework, to keep it minimal and fast.
- Data fetching: small custom hooks (`useApi`, `useJob`) with `fetch`; no global store needed (React context for the active site only).

### 4.2 Folder layout
```
frontend/
  index.html  vite.config.js  jsconfig.json  package.json
  src/
    main.jsx  App.jsx
    api/client.js  api/endpoints.js
    hooks/useApi.js  useJob.js  useSite.js
    styles/tokens.css  base.css  components.css
    components/
      layout/   TopBar.jsx  Section.jsx  Footer.jsx
      site/     CoordinateForm.jsx  SiteMap.jsx  SiteSummary.jsx  JobProgress.jsx
      kpi/      KpiCard.jsx  KpiRow.jsx
      charts/   SpeedChart.jsx  DirectionChart.jsx  ConfidenceBars.jsx  PowerEnergyChart.jsx
                ModelLeadChart.jsx  ErrorByBinChart.jsx  PowerCurveChart.jsx  Compass.jsx
      tables/   ForecastTable.jsx  ModelMetricsTable.jsx  QualityTable.jsx  DataTable.jsx
      common/   Badge.jsx  Skeleton.jsx  EmptyState.jsx  InfoTip.jsx  ExportButtons.jsx
    pages/      Dashboard.jsx
    utils/      format.js  angles.js  csv.js
```

### 4.3 Single-page layout (no routing needed; section anchors only)
1. **Top bar:** logo, site name, last-updated, status dot, light/dark toggle.
2. **Site panel:** latitude/longitude inputs + interactive map (click to set) + turbine selector (switchable any time; energy recalculates without retraining) + forecast start-date picker + "Run forecast". Shows job progress when training.
3. **KPI row:** expected energy (kWh), capacity factor, peak power, mean speed, reliable-direction hours, best model.
4. **Forecast charts:** speed line with observed last 48 h, direction chart, confidence bars, hourly power/energy bars, compass with next recommended heading.
5. **Forecast table:** 24 rows with lead, local time, speed, direction, confidence, heading, yaw note, power, energy; sortable, exportable.
6. **Model quality:** metrics table (baselines, SARIMAX, LightGBM), error-by-lead line charts (speed MAE/RMSE, direction circular MAE), direction error by confidence and by wind speed, success-criteria checklist.
7. **Data quality:** validation table (rows, gaps, duplicates, freshness, units, height) and cleaning summary.
8. **Turbine:** power curve chart with cut-in/rated/cut-out, spec table.
9. **Accuracy check:** date picker (single date / last 7 days / full held-out period) -> observed vs ML model vs Forecast API line chart, a who-was-closer metrics table, and an hourly detail table, labelled with the fairness rules in section 3.8.
10. **Assumptions and limitations** (collapsible), always reachable from the footer.

### 4.4 UX rules
- Every chart has a matching table or tooltip values; every table has CSV export.
- Loading skeletons, empty states, and a visible "stale data" badge.
- Responsive: 12-col grid on desktop, single column on mobile; charts resize.
- Accessibility: colour is never the only signal; keyboard-focus rings; AA contrast in both themes.

---

## 5. Design system (modern, futuristic, minimal)

**Principles:** dark-first, lots of space, one accent colour, thin lines, numbers as heroes, motion only to explain state.

| Token | Dark | Light |
|---|---|---|
| Background | `#0A0E14` | `#F6F8FB` |
| Surface | `#111823` | `#FFFFFF` |
| Border | `#1E2A3A` | `#E3E8EF` |
| Text / muted | `#E6EDF5` / `#8A99AD` | `#0E1726` / `#5B6B80` |
| Accent (cyan) | `#22D3EE` | `#0891B2` |
| Secondary (violet) | `#A78BFA` | `#7C3AED` |
| Good / warn / bad | `#34D399` / `#FBBF24` / `#F87171` | darker equivalents |

- **Type:** Inter (UI) and JetBrains Mono (numbers, tables). Large light-weight KPI numerals.
- **Shapes:** 14 px card radius, 1 px borders, faint glow on the accent only, subtle grid lines in charts.
- **Motion:** 150-250 ms fades and a soft pulse on the "live" dot; reduced-motion respected.
- **Series colours:** model = cyan, observed = text colour, persistence = grey, seasonal naive = amber, SARIMAX = violet. Same mapping in every chart.

Templates are in `docs/design/`:
- `dashboard.html`: main dashboard layout with real sample data (forecast, backtest metrics, and an observed / model / Previous-Runs-API accuracy check for 22 Oct 2026).
- `site-setup.html`: coordinate entry, map and training-progress state.

---

## 6. Delivery phases

| Phase | Deliverable | Acceptance check |
|---|---|---|
| 0. Foundations | Repo layout, local run scripts, lint, env config | `start.ps1` serves backend health and empty frontend |
| 1. Backend core | Port data fetch/validation/clean + features + leakage test | Backend reproduces notebook's quality report and clean dataset |
| 2. Models | Baselines, SARIMAX, LightGBM, backtest, selection services; model saving | Golden test: metrics within tolerance of notebook table |
| 3. Inference + turbine | Forecast service, direction/yaw, NREL curve, energy, exports | `forecast/latest` matches notebook output for same cutoff |
| 4. API + jobs | All endpoints, job runner, SQLite, Previous-Runs comparison service | OpenAPI docs complete; date-picker forecast and comparison work end to end |
| 5. Frontend shell | Vite app, design tokens, layout, site panel + map, API client | Can create a site and watch job progress |
| 6. Dashboard | KPI cards, forecast charts and table, compass | Matches design template; both themes |
| 7. Model and data views | Metrics, lead charts, direction analysis, quality, turbine curve, accuracy check | Every output has chart and table |
| 8. Hardening | Rate limiting, error states, stale badges, tests, docs, performance pass | Lighthouse a11y ≥ 90; backend tests green |
| 9. Release | Run instructions, README, demo script for the project presentation | Fresh-PC setup in < 30 min |

Rough effort for one developer: backend phases 1-4 about 2-3 weeks, frontend phases 5-7 about 2 weeks (parallelizable once the API contract in 3.4 is frozen), hardening/release about 1 week.

---

## 7. Testing strategy
- **Backend:** unit tests (circular math, features, curve interpolation incl. cut-in/out), a *leakage* test (features/training never use rows after the cutoff), golden-file regression against the notebook, API contract tests, a recorded-response fixture so tests don't hit Open-Meteo.
- **Frontend:** component tests (Vitest + Testing Library, JS only), a mocked-API smoke test of the whole dashboard, visual check of both themes at desktop and phone widths.
- **End to end:** one scripted scenario: create site -> job completes -> dashboard renders 24 rows, charts, exports download.

## 8. Risks and mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Archive lags about 5 days | Cannot forecast "tomorrow" | Option A: user picks a past start date; origin shown prominently; live feed is future work |
| Observation = reanalysis from the same model family as the Forecast API | Comparison structurally favours the API | State it beside every comparison; prefer multi-day results |
| Accuracy measured against reanalysis only | Over-optimism | Ingest site/SCADA data when available; label metrics clearly |
| Long training time per new site | Poor first-use experience | Cache, parallelize, reduced default grid, progress UI |
| Open API with no auth | Abuse | Rate limits, caps, private network deployment |
| Open-Meteo availability/limits | Failed refreshes | Retries, cached last good run, stale badge |
| Direction unreliable at low wind | Bad yaw advice | Confidence/speed gating (already designed) |

## 9. Decisions (resolved) and remaining items
Resolved: live data = Option A (past start-date picker); single site; local PC only; default NREL 3.3 MW turbine, user-switchable; Forecast API comparison in v1 via the Previous Runs API.

Still open (small):
1. Which dates the picker allows. Default in the plan: any date with at least 1 year of history before it (each is re-trained with that cutoff, so it is slower but fair).
2. Whether to update the notebook's comparison cell (section 20) to the Previous Runs method so the notebook and the app agree. Recommended: yes.

---

## 10. As-built notes (backend, Phases 0-4)

**Layout.** `backend/app/` has `api/` (site, jobs, forecast, reports, turbines, health), `services/` (data, features, eval_data, baseline, sarimax, gbm, selection, evaluation, direction, yaw, turbine, forecast, pipeline, compare), `core/` (circular, metrics, registry, jobs, ratelimit, artifacts), `db/` (SQLAlchemy models/session), `schemas/`. Run with `start.ps1`; interactive docs at `http://127.0.0.1:8100/docs`.

**Differences from the plan above**
- Forecast hours are one JSON document per run, not a `forecast_hour` table (they are always read whole; energy is recomputed on read).
- No in-process scheduler; refresh is manual. `PATCH /api/site` changes turbine, nacelle heading and yaw deadband without retraining.
- `PUT /api/site` no longer has a `profile` field (the quick option was removed; every site gets the full search). Only one job may run at a time (HTTP 409 otherwise).
- Forecast bundles (joblib) are kept for the 3 most recent runs and can only be loaded from the app's models folder (pickle safety).
- Rate limit: 60 state-changing requests per minute per IP (configurable; reads are never limited).

**Endpoints (all JSON, no authentication)**
`PUT/GET/PATCH /api/site`, `POST /api/site/data/refresh`, `GET /api/jobs[/{id}]`, `GET/POST /api/site/forecast`, `GET /api/site/export?format=csv|json`, `GET /api/site/data/quality`, `GET /api/site/data/history`, `GET /api/site/models/report`, `GET /api/site/models/direction`, `GET /api/site/compare`, `GET /api/turbines[/{name}/curve]`, `GET /api/health`.

**Verification.** 58 fast tests (unit, leakage, API flow with a fake data source and fake Previous Runs API) and 6 slow parity tests that reproduce the notebook's backtest metrics, selection and 22 Oct forecast. A live smoke test runs the real download, the quick profile and the real Previous Runs comparison.

**Issues found and fixed while building**
- Direction confidence could exceed 1 in the notebook; now capped at 1.
- The notebook's turbine check ("curve starts at zero power") rejected many valid NREL turbines; replaced by a start-near-cut-in check, with tiny negative standby values tolerated.
- Backtest origins stored as integers were read back as 1970 dates under pandas 3; now stored as ISO text (regression test added).
- Reading the saved clean CSV with the default float parser changed LightGBM results by about 1%; tests read with exact round-trip parsing.

## 11. As-built notes (frontend, Phase 5)

**Stack.** React 18.3 + Vite, JavaScript/JSX only (a test fails if any `.ts/.tsx` file or TypeScript dependency appears), plain CSS with design tokens, react-leaflet for the map, ESLint 9 (pinned: `eslint-plugin-react` does not support ESLint 10 yet), Vitest + Testing Library. Run with `start.ps1` (backend :8100 + `npm run dev` :5200; the dev server proxies `/api`).

**Built:** design tokens (dark default, light option, remembered), layout (sticky top bar with live status chip), interactive site map (click to set coordinates, dark-styled tiles), coordinate form with validation and a quick/full model-search choice, job progress (polls `GET /api/jobs/{id}` every 2 s, survives page reloads and brief backend outages), site summary, forecast-date picker (range from the backend, stored-forecast chips), turbine and yaw settings (apply instantly, no retraining), headline KPI cards, friendly errors with the backend's hints.

**Phase 7 (below) completes the dashboard.**

**Verification.** 36 frontend tests (API client, polling hook, map, full-screen flows against a mocked backend, JavaScript-only guard); lint and production build are clean. A live run against the real backend prepared a site through the UI, showed the notebook's numbers (7,768 kWh, 9.8%, 757 kW), and switched turbines instantly.

## 12. As-built notes (frontend, Phase 6)

**Built:** one forecast view (one fetch) with headline KPIs, observed-vs-forecast speed chart (cut-in line, origin marker), wind-direction dot chart (never a line; hollow dots = low confidence), direction-confidence bars with the validation-chosen threshold, hourly power bars with cumulative-energy line, an interactive compass (needle = wind-from direction, marker = advisory heading, hour slider), a sortable 24-hour table (click a lead to move the compass), and CSV/JSON export links. Charts use Recharts, colours come from the theme tokens (they follow the dark/light toggle), axes are hour-aligned UTC with the date at midnight, and every chart has a text description for screen readers.

**Decisions.** Charts use UTC while the table also shows local time. Direction is drawn as dots because 359 deg and 1 deg must not be joined across the chart. Energy per hour equals power in kW (one-hour step).

**Verification.** 72 frontend tests (data builders, table sorting/selection, compass behaviour, chart rendering, tooltip, export links, theme colours, full-screen flows). Mutation checks on tick spacing and compass-marker rotation exposed one missing test, which was added. Live check against the real forecast: all five charts and 24 table rows render, and both themes look right.

## 13. As-built notes (frontend, Phase 7: the dashboard is complete)

**Sections (jump links at the top):** Site, Forecast, Model quality, Accuracy check, Data and turbine, Assumptions and limitations.

- **Model quality:** speed and direction winners with improvement and bootstrap interval, success-criteria checklist (held-out scope stated), per-model metrics table (speed / direction views, best value per column highlighted), speed MAE, speed RMSE and direction error by lead time (same colour per model everywhere), direction reliability (error by confidence and by wind speed, threshold trade-off table), energy-error proxy table (labelled as NOT accuracy against measured generation).
- **Accuracy check:** held-out period (lead 24 h), date range, or a single stored forecast. Runs only when asked, because it sends the site coordinates and dates to Open-Meteo. Shows who was closer per metric, a significance verdict over many hours, the daily error chart (lines for long periods), an hourly table, and the fairness notes (observed values come from the API's own model family, which favours the API).
- **Data and turbine:** data-quality checklist (duplicates, gaps, units, ranges, height, grid offset, freshness, interpolation, look-ahead test) and the selected NREL turbine's power curve, spec and curve-verification checks, with a note when a shear correction applies.
- **Assumptions:** always open: backend-supplied limitations plus fixed conventions (wind-from degrees, UTC, 100 m, point forecasts only).

**Backend change in this phase:** the direction-threshold sweep now always contains the chosen threshold (test added). A site prepared before this change shows the sweep without the highlighted row until its evaluation is re-run.

**Verification.** 116 frontend tests, built on real backend payloads captured from a live run and stored as fixtures. A mutation check (7 deliberate breakages) exposed three missing assertions, now added; all 7 are caught. A live run against the real backend showed every section, and the comparison against the real Previous Runs API returned the same numbers as the notebook (API closer by +0.102 m/s, 596 hours).

## 14. As-built notes (Model vs Open-Meteo chart)

The three-mode Accuracy check section was replaced by **one chart with no inputs**: our model's forecast next to Open-Meteo's forecast for the **same 24 hours** as the selected forecast. It fetches automatically and follows the forecast date chosen in the Forecast section.

- **Backend:** new `GET /api/site/api-comparison?origin=` returns the stored forecast's hours with Open-Meteo's *Previous Runs* forecast (issued the day before) for the same timestamps, matched by clock time. It needs no observations, so it works for the newest date. Missing Open-Meteo hours are left empty (never zero); the endpoint reports the mean absolute difference over the hours both have. Network failures return 502.
- **Why Previous Runs:** for past dates the regular Forecast API returns the model analysis (what happened), not a forecast.
- **What it says and does not say:** it shows how far apart two forecasts are. It is not an accuracy score; that needs observations. The older `GET /api/site/compare` (model vs API vs observed, with a significance test) is unchanged and still available, but the dashboard no longer shows it, so the head-to-head result (API closer by +0.10 m/s at 24 h lead) now lives in the README and the API.
- **Dev convenience:** `VITE_PORT` and `VITE_API_TARGET` let a second frontend run against a second backend without touching the default ports.
- **Verification:** 12 backend tests (matching by clock time, gaps, duplicates, errors, newest date) and 40 frontend tests for the chart, helpers and section states; a live run against the real Open-Meteo service returned all 24 hours for 22 Oct 2026 (mean difference 0.52 m/s) and for 16 Oct (0.96 m/s).

## 15. As-built notes (3D turbine view)

An interactive 3D turbine was added (first inside the Forecast section; it was then moved to its own full-width page at `#/turbine`, reached from a new top menu and from a link in the Forecast section, because the in-page card was too small). A hash-based route chooses the page, with no router library. The page keeps the date of the dashboard (and lets you pick any stored forecast), and the readout floats over the large scene. It was added so the machine-learning output can be seen as the machine would live it.

- **Scene:** built from basic shapes with three.js through react-three-fiber and drei (no model files). Tower height and rotor size come from the selected turbine's hub height and rotor diameter (typical sizes, flagged as estimated, if missing).
- **Driven by the forecast hour:** nacelle turns (slowly, shortest way round) to the advised heading; a purple marker shows that heading on a compass ring; an arrow shows where the wind blows from (faded when the direction is unreliable); blade speed rises with forecast power (5-12 rpm, illustrative), and stops when idle (below cut-in) or shut down (at or above cut-out).
- **Interaction:** hour slider, Play day, Reset view, orbit and zoom. The hour is shared with the compass and the table. No backend change was needed.
- **Safeguards:** lazy-loaded chunk (about 220 KB gzipped) so the page loads as before; reduced motion keeps the pose static; no WebGL shows the numbers and a note; the camera starts 40 degrees off the rotor axis so the rotor is seen from the front-side.
- **Testing:** the logic is tested without graphics (23 tests); the view is tested with the scene mocked (14 tests); mutation checks on states, boundaries, compass orientation, Play and the shared hour; verified by eye in the browser (idle rotor is still, producing rotor spins, slider moves the turbine).
- **Honest limit:** an illustration of the forecast, not a physical simulation.
