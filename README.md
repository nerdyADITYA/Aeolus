# Aeolus: 24-hour wind forecasting, yaw advice and energy estimate for a wind turbine

> A complete guide to the project, written so that you can explain **every part of it** and answer questions about it.
> Part 1 explains the idea in plain language. Part 2 is the heart of the project, the **prediction pipeline**, step by step.
> Later parts cover the results, the software, how to run it, the design decisions, the limitations, and a long list of
> **questions an examiner might ask, with answers** (Part 11).

## Contents

1. [The project in one page](#1-the-project-in-one-page)
2. [Words you need (glossary)](#2-words-you-need-glossary)
3. [The big picture](#3-the-big-picture)
4. [The prediction pipeline, step by step](#4-the-prediction-pipeline-step-by-step) **(the main part)**
5. [A worked example: one forecast from start to finish](#5-a-worked-example-one-forecast-from-start-to-finish)
6. [Results and how to read them](#6-results-and-how-to-read-them)
7. [The software: backend, frontend, data storage](#7-the-software-backend-frontend-data-storage)
8. [Running it](#8-running-it)
9. [Testing: how we know it is correct](#9-testing-how-we-know-it-is-correct)
10. [Design decisions and why](#10-design-decisions-and-why)
11. [Questions an examiner might ask (with answers)](#11-questions-an-examiner-might-ask-with-answers)
12. [Limitations and future work](#12-limitations-and-future-work)
13. [Project files, configuration, API, troubleshooting](#13-project-files-configuration-api-troubleshooting)

---

## 1. The project in one page

### The problem

A wind turbine makes electricity from wind. Three things about the **next 24 hours** matter to the people who run it:

1. **How fast will the wind blow?** Too little wind and the turbine makes nothing. Moderate wind gives real power. Very strong wind and the turbine must shut down for safety.
2. **Which way will it blow from?** A turbine works best when it faces the wind. If the wind direction changes, the turbine head (the *nacelle*) has to turn. This turning is called **yaw**.
3. **How much electricity will that make?** Operators use this to plan.

### What WindKraft does

WindKraft is a web app that runs on your own PC. You give it a location (latitude and longitude). It then:

1. Downloads **three years** of hourly wind history for that spot.
2. Checks and cleans the data.
3. **Teaches several forecasting methods** using the history, and tests each one honestly on data it has never seen.
4. Picks the best one and uses it to **forecast the next 24 hours** of wind speed and direction.
5. Says **how much it trusts each hour's wind direction**, and recommends a **turbine heading** only when the direction is trustworthy.
6. Converts the forecast wind speed into **power and energy** using the official power curve of a real turbine design (from the US National Renewable Energy Laboratory, NREL).
7. Shows everything in a dashboard: charts, a compass, tables, and an honest report card of how good the forecast is.
8. Compares our forecast with the forecast of a professional weather service (Open-Meteo).

### The honest headline

On five months of test data (596 separate forecasts), our best model (**LightGBM**, a machine-learning method) is clearly better than simple methods and a classic statistical method (SARIMAX). It is **not** as good as the professional weather service. The project reports both facts, because an honest evaluation matters more than a flattering one.

### What is *not* claimed

- The "truth" we score against is **reanalysis** data (a very good computer reconstruction of past weather), not a sensor on a real turbine.
- Power and energy come from a **theoretical** curve. Real turbines lose some output to wake effects, maintenance, icing, and so on.
- The yaw output is **advice only**. Nothing is ever sent to a turbine.

---

## 2. Words you need (glossary)

| Term | Plain meaning |
|---|---|
| **Wind speed** | How fast the air moves, in metres per second (m/s). 1 m/s is about 3.6 km/h. |
| **Wind direction** | We always use the **"wind-from"** angle: 0° = wind coming from the north, 90° = from the east, 180° = from the south, 270° = from the west. |
| **Hub height / 100 m** | The height of the turbine's centre. Our wind data is for 100 m above ground, which is close to a modern turbine's hub. |
| **Nacelle** | The "head" of the turbine that holds the generator and rotor. It rotates to face the wind. |
| **Yaw** | Turning the nacelle to face the wind. |
| **Cut-in speed** | Below this wind speed the turbine makes no power (default turbine: 3.25 m/s). |
| **Rated power / rated speed** | The maximum the generator can produce (default turbine: 3,300 kW = 3.3 MW). |
| **Cut-out speed** | At or above this the turbine shuts down for safety (default: 25 m/s). |
| **Power curve** | A graph of "power produced" against "wind speed" for one turbine design. |
| **Capacity factor** | Energy actually made divided by the energy it would make running at full rated power all the time. |
| **Time series** | A list of values over time, here one value per hour. |
| **Forecast origin** | The moment the forecast is made from: "now" for that forecast. Only data up to this moment may be used. |
| **Lead time (lead hours)** | How far ahead a forecast looks. "Lead 6" = predicted 6 hours after the origin. Our forecasts cover leads 1 to 24. |
| **Training data** | Data the model learns from. |
| **Validation data** | A separate block used to choose settings (tuning). |
| **Test data / held-out data** | A final block the model never learned from or tuned on. It is used once to score honestly. |
| **Data leakage** | Accidentally letting the model see the future (or the answer) while learning. It makes results look great and worthless. The project is built to prevent it. |
| **Baseline** | A deliberately simple method. A fancy model has to beat the baselines to be worth using. |
| **Backtest** | Pretending to forecast at many past moments and scoring each against what really happened. |
| **MAE** | Mean absolute error: the average size of the mistake. Easy to understand: "off by 0.9 m/s on average". |
| **RMSE** | Root mean squared error: like MAE but big mistakes count extra. |
| **Circular error** | Error for angles. 359° and 1° are only 2° apart, not 358°. |
| **Reanalysis** | A reconstruction of past weather by feeding all historical observations into a modern weather model. Very good, but it is a model product, not a direct measurement. |
| **Open-Meteo** | A free weather data service. We use its historical archive for training data and its Previous Runs service for the comparison forecast. |
| **NREL** | US National Renewable Energy Laboratory. Its `turbine-models` package gives official power curves. |
| **Hysteresis / deadband** | A rule to avoid fidgeting: ignore changes smaller than a threshold (default 8°). |

---

## 3. The big picture

```
 1. DOWNLOAD            Open-Meteo historical archive: 3 years, hourly, 100 m, UTC
        |
 2. VALIDATE + CLEAN    check units, duplicates, gaps, ranges. Raw file is kept unchanged;
        |               cleaning makes a separate dataset
        |
 3. FEATURES            turn history into 47 clues per hour (recent speeds, trends, time of day, ...)
        |
 4. SPLIT IN TIME       train (oldest) | validation (next 90 days) | test (latest 150 days)
        |
 5. COMPETING MODELS    Persistence | Seasonal naive | SARIMAX | LightGBM (72 small models)
        |
 6. TUNE                choose each model's settings using VALIDATION only
        |
 7. ROLLING BACKTEST    596 pretend forecasts over the TEST block; retrain every 30 days
        |
 8. SCORE + SELECT      MAE/RMSE/circular error per lead; winner picked on test; significance checked
        |
 9. DIRECTION TRUST     confidence R and the thresholds R >= 0.75, speed >= 3 m/s
        |
10. FINAL FORECAST      train with data up to the chosen origin only, predict the next 24 hours
        |
11. YAW ADVICE          follow the direction only when trusted; ignore changes under 8 degrees
        |
12. POWER + ENERGY      NREL power curve: speed -> kW -> kWh
        |
13. DASHBOARD           charts, compass, tables, model report, comparison with Open-Meteo forecast
```

Steps 1-8 happen **once** when you "Prepare site" (about 20 minutes: every site gets the full tuning search). Step 10 happens each time you ask for a forecast on a date. Steps 11-12 are instant and re-run whenever you change the turbine or yaw settings, without retraining.

---

## 4. The prediction pipeline, step by step

This is the most important part. Every step answers four questions: **What does it do? Why is it needed? How exactly is it done? What could go wrong?** The code location is given so you can point to it.

### A plain-language story first

Imagine you must predict tomorrow's wind at a farm, and you have three years of hourly diaries.

- A **lazy forecaster** says "tomorrow will be like right now" (Persistence), or "tomorrow will be like the same hour yesterday" (Seasonal naive).
- A **statistician** fits a formula describing how the wind's recent past predicts its near future (SARIMAX).
- A **pattern learner** (LightGBM) looks at many clues at once (the last few hours, the trend, the time of day, the season, temperature, pressure, humidity, cloud) and learns from three years of diaries which combinations lead to which wind a few hours later.

To decide who is best, you do not ask them about the past they studied. You hide the most recent five months, ask each forecaster to predict from a series of "today" moments inside that hidden period, and compare with what really happened. That is the whole idea of the pipeline. Everything below is making it rigorous and fair.

---

### Step 1. Get the data

**What:** Download hourly weather history for the site from the Open-Meteo **archive API**.
**Code:** `backend/app/services/data_service.py` (`fetch_raw`).

**How:**
- The request asks for 3 years of history (`historical_years = 3`), ending **5 days before today** (`archive_safety_days = 5`), because the archive lags real time by several days.
- Variables downloaded: wind speed at 100 m and 10 m, wind direction at 100 m and 10 m, temperature at 2 m, surface pressure, relative humidity, cloud cover.
- Units: wind in **m/s**, time in **UTC**.
- If the download fails it retries 3 times, waiting 1, 2, then 4 seconds.

**Why 100 m?** It is close to a modern turbine's hub height, so no big height conversion is needed.

**Important rule:** this step only ever calls the **archive** (history). It **never** calls the forecast API, so the model can never "cheat" by looking at a professional forecast. A test enforces this.

**Result for the stored run:** 26,328 hourly rows, 2023-10-21 to 2026-10-21.

---

### Step 2. Validate the raw data

**What:** Inspect the data and write a report. **Never change the raw data.**
**Code:** `data_service.py` (`validate_raw`). Shown in the dashboard under *Data and turbine → Data quality*.

**Checks:**

| Check | Why it matters |
|---|---|
| Units are m/s and degrees | A wrong unit (for example km/h) would silently ruin everything. The run stops with an error if units are unexpected. |
| Duplicate timestamps | Two rows for the same hour would confuse time-based features. |
| Timestamps in order | Features such as "value 3 hours ago" assume correct order. |
| Missing hours | Gaps break the regular hourly grid. |
| Off-the-hour timestamps | Everything assumes whole hours. |
| Missing values | Counted per column. |
| Speed range | Negative speeds or speeds above 60 m/s are impossible. Direction must be 0-360°. |
| Measurement height | We compute the **shear exponent** between 10 m and 100 m (how fast wind increases with height). A plausible value is 0.1-0.5. Ours is 0.24, so the 100 m data behaves like real 100 m wind. |
| Grid cell offset | The archive gives a grid cell, not your exact point. We report the distance between them (3.11 km for the default site). |
| Data age | How old the newest valid hour is, so you know the data is not stale. |

The raw data is saved as `raw.csv` **exactly as received**, so you can always prove what the source said.

---

### Step 3. Clean the data

**What:** Produce a separate, tidy dataset for modelling.
**Code:** `data_service.py` (`clean_history`, `fill_short_gaps`).

**What the cleaning does:**
1. Remove duplicate hours and sort by time, then lay the data on a perfect hourly grid.
2. Cut off any not-yet-available hours at the end.
3. Treat impossible speeds (below 0 or above 60 m/s) as missing.
4. Turn direction 360° into 0°.
5. **Fill only short gaps**: a missing run of up to **3 hours** is filled by drawing a straight line between the values on either side. **Longer gaps are left empty** on purpose, because inventing many hours of weather would be dishonest. (In the stored run there were no gaps at all.)
6. Mark which hours were filled (`was_interpolated`).

**Why separate raw and clean?** So that every number can be traced back to the unmodified source.

---

### Step 4. Encode wind direction as sine and cosine

**What:** Replace the angle by two numbers, `sin(direction)` and `cos(direction)`.
**Code:** `data_service.py` (`clean_history`), `core/circular.py`.

**Why this is necessary (a favourite examiner question):**
Angles wrap around. 359° and 1° are neighbours, but as plain numbers they look 358 apart. If a model learned from raw angles it would get confused near north. Using the point on a circle `(sin, cos)` removes the jump: 359° and 1° become almost the same point.

**How we get back to degrees:** `direction = atan2(sin, cos)`, wrapped into 0-360°.

**Bonus: confidence.** If the model predicts `sin` and `cos`, the length of that arrow, `R = sqrt(sin² + cos²)` (capped at 1), tells us how sure it is. A long arrow (R near 1) means a clear direction. A very short arrow (R near 0) means the model is torn between directions, so the angle is basically meaningless. We use this in Step 12.

---

### Step 5. Build features (the "clues")

**What:** For every hour, compute **47 numbers** describing the recent situation. The model predicts the future from these.
**Code:** `backend/app/services/feature_service.py` (`build_features`).

**The clue families:**

| Family | Examples | Why it helps |
|---|---|---|
| **Lags** (what it was 0, 1, 3, 6, 12, 24 hours ago) | speed, sin, cos at each lag | Wind is "sticky": the recent past is the best clue. 24 h ago captures the daily cycle. |
| **Rolling averages and spread** over 3, 6, 12, 24 h | mean speed, speed variability, mean direction | Smooths noise; shows whether wind is calm or gusty. |
| **Direction steadiness** (24 h) | length of the average direction arrow | 1 = direction has been steady, near 0 = it has been swinging around. |
| **Trend** | change in speed over 1 h and 3 h; maximum speed in last 24 h | Is wind rising or falling? |
| **Time of day and season** (cyclic) | `sin/cos` of hour of day (local time) and of day of year | Wind has a daily rhythm (for example stronger in the afternoon) and a seasonal one (monsoon). Encoded as circles so 23:00 is next to 00:00. |
| **Other weather** | 10 m wind speed, ratio of 100 m to 10 m speed, temperature and its 24 h change, pressure and its 3 h and 24 h change, humidity, cloud cover | Pressure changes and temperature often signal approaching weather. |

**The golden rule: no peeking at the future.** Every clue for hour *t* uses only data from hour *t* or earlier. The project proves this:
`check_no_lookahead` picks random hours, recomputes the clues using only the data up to that hour, and checks they are **identical** to the clues computed from the full history. If a single clue changed, the run would fail. This test runs on every site setup and in the automated tests.

---

### Step 6. Split the history in time (train / validation / test)

**What:** Divide the three years into three consecutive blocks.
**Code:** `backend/app/services/eval_data.py` (`EvalData.build`).

```
|<------------- training ------------->|<- validation ->|<-- test (held out) -->|
2023-10-21                    2026-02-23  2026-02-24      2026-05-24  2026-05-25     2026-10-21
   about 2.3 years                          90 days                    150 days
```

- **Training:** what models learn from.
- **Validation (90 days):** used to **choose settings** (like how big the model should be).
- **Test (150 days):** the final, honest exam. It is touched **only to score**, never to tune.

**Why in time order and not random?** In the real world you forecast the future from the past. A random shuffle would let the model train on days after the day it is being tested on, leaking information. Time order is the only honest way.

**Why separate validation and test?** If you tune settings on the same data you score on, you are marking your own homework. Choosing on validation and scoring on test means the test score is not inflated by the tuning.

---

### Step 7. Forecast origins and lead times

**What:** Define the many "pretend now" moments at which forecasts are made and scored.
**Code:** `eval_data.py` (`origin_set`).

- A **forecast origin** is a moment *t*. A forecast uses data up to *t* and predicts hours *t+1 … t+24*.
- Origins are placed **every 6 hours** (`origin_step_h = 6`) through each block. That gives **356 origins in validation and 596 in test**.
- Each origin produces **24 predictions** (leads 1 to 24), so the test block contains roughly 14,000 scored predictions per model.
- All models are scored on **exactly the same origins**, so the comparison is fair.
- An origin is only used if all inputs and all 24 true outcomes exist (no gaps).
- Validation targets stay **inside** the validation block, so validation never peeks at the test block.

The report shows accuracy at leads **1, 6, 12 and 24 hours**, plus the average over all 24.

---

### Step 8. The baselines (simple methods to beat)

**Code:** `backend/app/services/baseline_service.py`.

| Method | Rule | Why it is a fair opponent |
|---|---|---|
| **Persistence** | "Every future hour will be like the latest hour." | Hard to beat at 1 hour ahead because wind changes slowly. |
| **Seasonal naive (24 h)** | "Hour *t+h* will equal the value 24 hours earlier." | Captures the daily cycle with zero learning. |

**Why have baselines at all?** A complicated model with a "good-looking" error means nothing unless it beats something trivial. If a model cannot beat "same as yesterday", it is not useful. (A project success criterion checks exactly this.)

---

### Step 9. SARIMAX (the classic statistical method)

**Code:** `backend/app/services/sarimax_service.py`.

**Plain meaning:** SARIMAX is a classic time-series model. It describes the next value as a blend of (a) recent values (the "AR" part), (b) recent surprises or errors (the "MA" part), and (c) the same hour on previous days (the "seasonal" part with a 24-hour period).

**How we use it fairly:**
- Separate SARIMAX models for speed, `sin` and `cos`.
- The parameters are **estimated once** on data that ends **before** the block being scored, using the latest 180 days.
- At each forecast origin the fitted model is only **updated with the recent 14 days of observations** (using statsmodels' `apply`, which does not refit) and then forecasts 24 hours.
- The best of the candidate settings is picked on the validation block. (All 8 candidate settings are tried.)
- Predictions are clipped to valid ranges (speed ≥ 0, sin/cos within -1..1).

**Why include it?** It is the textbook method and what many courses expect. Seeing it lose to a machine-learning model is a meaningful result.

**Why does it do poorly at direction?** At 24 hours its direction error is 46.6°. Likely reasons: it models `sin` and `cos` separately without knowing they are tied together on a circle, and its forecasts fade towards the average at long leads. (This is our interpretation, not something the tests prove.)

---

### Step 10. LightGBM (the main model) and "direct multi-step" forecasting

**Code:** `backend/app/services/gbm_service.py`.

**What LightGBM is:** a *gradient-boosted decision tree* method. Simple picture: it builds hundreds of small "if-then" trees one after another, where each new tree is trained to fix the mistakes the previous trees still make. Added together they give a strong prediction. It works very well on tables of clues like ours, is fast, and needs no special scaling of inputs. (If LightGBM cannot be installed the app falls back to XGBoost or scikit-learn's version automatically.)

**The key design choice: one model per lead hour, per target.**
We need 24 future hours of speed, of `sin` and of `cos`. We train a **separate small model for each**:

```
targets: speed, sin, cos   x   leads: 1 ... 24   =   72 models
```

Each model answers one narrow question, for example "given the clues now, what will the wind speed be exactly 7 hours from now?". This is called **direct multi-step forecasting**.

**The alternative and why we did not use it:** *recursive* forecasting predicts hour 1, feeds it back as an input to predict hour 2, and so on. Small mistakes then pile up and snowball by hour 24. Direct forecasting avoids that.

**What each model trains on (and the leakage rule):**
A model for lead *h* with knowledge up to a cutoff *c* trains only on rows where `origin + h <= c`. In words: **the answer it learns from must already have happened by the cutoff.** This prevents the subtle leak where a training row's "answer" lies in the future relative to the forecast moment.

**Settings (hyperparameters).** Three sizes are available (small, medium, large), differing in number of trees, learning rate, tree size and minimum leaf size. The model also uses sampling of rows (80%) and of columns (80%) and a small regularisation (`reg_lambda = 1`) to resist over-fitting. A fixed random seed (42) makes results repeatable.

**An option we tested:** predicting the *change* from the current speed instead of the speed itself ("delta target"). In our run it was slightly worse on validation, so the plain speed target was used.

---

### Step 11. Tuning on validation only

**Code:** `gbm_service.py` (`tune_gbm`), `sarimax_service.py` (`tune_sarimax`).

For each candidate setting we train on data **before** the validation block, forecast the validation origins, and record the error. The setting with the smallest error wins:

- Speed: the setting with the lowest validation RMSE.
- Direction: the setting with the lowest circular error on hours where the wind was at least 3 m/s.

For the stored run (made earlier with a reduced search of two LightGBM sizes; the app now always tries all three) the **medium** size won for both speed and direction (validation speed RMSE 1.258 vs 1.270 for small; direction error 24.07° vs 24.38°). Speed and direction can pick different sizes, and are tuned separately.

**Why only validation?** So that the test result stays an unbiased exam.

---

### Step 12. The rolling backtest (the honest exam)

**Code:** `gbm_service.py` (`rolling_backtest_gbm`).

The test block is 150 days. A real forecaster would keep learning as new days arrive, so the backtest does too:

1. Split the test block into 30-day chunks (`refit_days = 30`).
2. At the start of each chunk, **retrain all 72 models** on everything observed up to that moment.
3. Use those models for all forecast origins inside that chunk.
4. Move to the next chunk and repeat (5 retrainings in the stored run: trained through 25 May, 24 Jun, 24 Jul, 23 Aug, 22 Sep).

Each model only ever predicts moments **after** its training cutoff. The result is a set of **596 genuine out-of-sample forecasts** for every method.

---

### Step 13. Scoring: how we measure "good"

**Code:** `backend/app/core/metrics.py`, `backend/app/core/circular.py`.

| Metric | Formula in words | Reading it |
|---|---|---|
| **Speed MAE** | average of \|predicted − actual\| in m/s | "Off by about 0.9 m/s on average." Lower is better. |
| **Speed RMSE** | square root of the average squared error | Punishes big misses more. Always ≥ MAE. |
| **Direction error (circular MAE)** | average of the shortest angle between predicted and actual direction, 0 to 180° | "Off by about 20°." Lower is better. |
| **Direction error on "fast" hours** | the same, only for hours where the actual wind was ≥ 3 m/s | In near-calm air the direction is almost random, so judging direction there is unfair to everybody. |

Everything is reported per lead (1 to 24) and averaged.

**Why circular error?** Plain subtraction gives 358° for the difference between 359° and 1°. The circular formula `|((pred − true + 180) mod 360) − 180|` gives 2°.

---

### Step 14. Choose the winner and test it for real

**Code:** `backend/app/services/selection_service.py`.

- **Speed winner:** lowest RMSE averaged over leads 1 to 24 on the **test** block.
- **Direction winner:** lowest circular MAE (fast hours) averaged over leads 1 to 24.

**Is the win real or luck?** With only 596 forecasts a small lead might be chance. We use a **block bootstrap**: resample the per-forecast error differences thousands of times (2,000), in small blocks of 4 consecutive origins (because neighbouring forecasts are related, so shuffling single ones would exaggerate confidence), and compute a 95% interval for the **difference** between the winner and the best baseline.

- If the whole interval is below zero, the winner is **statistically significantly** better.
- Stored run: speed difference interval **[−0.201, −0.108]**, direction **[−4.683, −0.178]**: both entirely below zero, so both wins are significant.

**Success checklist** (all 11 met): the winner beats both baselines at leads 1, 6, 12 and 24 h for both speed and direction (8 checks); more than 100 origins were scored (596); direction used circular statistics; the model never used the forecast API.

---

### Step 15. How much to trust the predicted direction

**Code:** `backend/app/services/direction_service.py`.

Direction is only meaningful if (a) the model is confident, and (b) there is enough wind. So two gates:

- **Confidence R ≥ 0.75** (the length of the predicted `(sin, cos)` arrow).
- **Predicted speed ≥ 3 m/s.**

**Where does 0.75 come from?** It is **chosen from the validation block**: the smallest R such that the hours kept have direction error at most 80% of the overall error while still keeping at least half of all hours. It is *not* tuned on the test block.

**Does it work?** On the test block (average circular error):

| Hours included | Direction error |
|---|---|
| All hours | 25.4° |
| Only actual speed ≥ 3 m/s | 20.5° |
| Only R ≥ 0.75 | 19.3° |
| **Both** | **17.3°** |

The correlation between R and error is **−0.46**: more confident means smaller error. So R is a meaningful trust signal. (The dashboard shows this in the "Direction reliability" charts.)

---

### Step 16. The final 24-hour forecast

**Code:** `backend/app/services/forecast_service.py`.

When you choose a **forecast date D**:

1. **Origin = 23:00 UTC on day D−1** (the last observed hour before day D). For example, "22 Oct" means forecast the UTC day 22 Oct from origin 21 Oct 23:00.
2. **Train the 72 models with cutoff = the origin.** So the models know nothing after that moment: the forecast is always **out-of-sample** for the hours it predicts (even for past dates).
3. Compute the 47 clues from data **truncated at the origin** (it physically cannot see further).
4. Each of the 72 models gives one number: speed, `sin` or `cos` for one lead. Speed is clipped to ≥ 0.
5. Combine `sin` and `cos` into **direction in degrees** and **confidence R**.
6. Attach timestamps in UTC and local time (the default site is Asia/Kolkata, UTC+5:30).

A date needs at least **one year of history** before it (a safeguard so models have enough to learn from).

**Why train again for each forecast?** Because "trained with data up to the origin" is what makes a past-date forecast honest. It takes a short while (72 models are trained) and the result is cached in the database.

---

### Step 17. Yaw (turbine heading) advice

**Code:** `backend/app/services/yaw_service.py`. Plain-language legend shown on the dashboard.

Conventional turbines face **into** the wind, so the recommended heading equals the wind-from direction. The rules, hour by hour:

```
Is the hour reliable?   (confidence >= 0.75  AND  predicted speed >= 3 m/s)
   NO  -> "Hold": keep the current heading (low confidence or little wind)
   YES -> is the predicted direction more than 8 degrees away from the current heading?
              YES -> "Track": turn to the predicted direction
              NO  -> "Hold within deadband": stay put (change too small to be worth it)
```

**Why the deadband (8°)?** Without it the recommendation would twitch every hour with tiny changes. Real turbines do not yaw for small errors because each move costs wear and a little energy. The deadband (also called hysteresis) keeps the plan calm.

**Why hold when unreliable?** Turning toward a guess is worse than staying put.

The page colours each hour: **blue/green = track**, **yellow = hold within deadband**, **grey = hold (unreliable)**. The yaw plan is **advisory**: no command is sent anywhere.

---

### Step 18. From wind speed to power and energy

**Code:** `backend/app/services/turbine_service.py`.

1. **The turbine.** The `turbine-models` package (from NREL) holds official power curves for many designs. The app offers **19 verified onshore turbines**; default is `2023NREL_Bespoke_3.3MW_148` (3.3 MW rated, 100 m hub, cut-in 3.25 m/s, cut-out 25 m/s).
2. **Curve verification** before use: wind speeds strictly increasing; power never negative; peak equals the rated power (within 1%); curve starts near the cut-in speed; hub height is known. A turbine that fails is marked unusable.
3. **Height adjustment.** The forecast is for 100 m. If the turbine's hub height differs by more than 5 m, speed is converted with the *power law* `v_hub = v_100 × (hub/100)^α`, with α measured from the site data (0.24 for the default site).
4. **Power.** Interpolate the curve at the hourly speed. Force power to **0 below cut-in and at or above cut-out** (plain interpolation would otherwise keep the end values).
5. **Energy.** Hourly power (kW) × 1 hour = energy (kWh). Add up the 24 hours. Also: **capacity factor** = total energy ÷ (rated power × 24 h).

This explains why some hours show **no power bar**: the predicted speed was below the cut-in speed, so output is exactly zero (the chart shades those hours and says so).

**Switching turbines** reruns only steps 17-18 (instant), not the forecast or training.

**Energy error proxy.** There is no measured generation here, so we cannot say how right the energy numbers are. Instead we compute "energy from predicted wind" vs "energy from actual wind (reanalysis)", which isolates the effect of the **wind forecast** error only. It is labelled as a proxy.

---

### Step 19. The comparison with Open-Meteo's own forecast

**Code:** `backend/app/services/compare_service.py`; endpoint `GET /api/site/api-comparison`.

There are two different things here.

**(a) The dashboard chart "Model vs Open-Meteo"** simply plots our 24-hour speed forecast against **the forecast Open-Meteo issued the day before** for the same hours, from the **Previous Runs API** (`wind_speed_100m_previous_day1`). It needs no observations, so it works even for the newest date. It shows how different the two forecasts are; it does not claim which is right. (Mean difference for 22 Oct 2026: 0.52 m/s.)

**(b) The accuracy verdict** (`GET /api/site/compare`, also in the research notebook): over the held-out test, compare **our model, the Open-Meteo forecast, and persistence** against what actually happened at 24 hours ahead:

| | Our model | Open-Meteo |
|---|---|---|
| Speed MAE at 24 h | 0.93 m/s | **0.83 m/s** |
| Direction error at 24 h | 24.3° | **15.2°** |

Open-Meteo wins, and the difference is statistically significant.

**Why we used the *Previous Runs* API and not the ordinary forecast API:** for past dates the ordinary API returns the model's *analysis* (essentially what happened), which would look like a perfect forecast and give a meaningless comparison. Previous Runs stores the forecast as it was really issued the day before.

**Why the comparison favours Open-Meteo (a fairness note):** our "truth" is reanalysis from the same family of weather models that produce Open-Meteo's forecasts, so its numbers are naturally close to the truth. A site sensor would be fairer. Also, Open-Meteo has global weather physics and vastly more data and computing power than a 3-year statistical model of a single site.

**The key rule:** the forecast API is **never an input to our model**. It is used for the comparison only.

---

## 5. A worked example: one forecast from start to finish

The default site is Ahmedabad (23.0225° N, 72.5714° E). The newest data ends **21 Oct 2026 23:00 UTC**. We ask for the forecast of **22 Oct 2026**.

1. **Origin:** 21 Oct 23:00 UTC (= 22 Oct 04:30 local). Training data used: everything up to that hour (about 26,300 hours).
2. **Clues** are computed from the last 24+ hours at the origin: for example, the latest speed, speeds 1/3/6/12/24 h ago, the 24-hour averages, the clock position of the origin, the pressure change.
3. **72 models** each give one number. For lead 1 (00:00 UTC = 05:30 local) they give speed **5.22 m/s** and direction **58°** with confidence **1.00**.
4. **Yaw advice** (current heading unknown, so the first reliable hour sets it):
   - Hour 1: reliable → *track* → heading **58.2°**.
   - Hours 2-4: predicted 61°, 64°, 65° are within 8° of 58.2° → *hold within deadband* (stay at 58.2°).
   - Hour 5: predicted 67.3° is now 9.1° from 58.2° → *track* → turn to **67.3°**.
   - Hour 14: confidence **0.70 < 0.75** → *hold (unreliable)*.
5. **Power** with the default turbine:
   - 5.22 m/s → **709 kW**, 5.33 m/s → **757 kW** (the day's peak).
   - 3.21 m/s is below the cut-in speed 3.25 → **0 kW**.
6. **Totals for the day:** mean speed **4.04 m/s**, energy **7,768 kWh**, capacity factor **9.8%**, **15 of 24** hours with a trustworthy direction.
7. **Comparison:** the Open-Meteo day-ahead forecast for the same 24 hours differs from ours by 0.52 m/s on average.

A low capacity factor (9.8%) is realistic for a calm day: the winds here are mostly 3-5 m/s while the turbine's full output needs roughly 11-12 m/s.

---

## 6. Results and how to read them

Stored run: Ahmedabad, made with an earlier **reduced search** (2 SARIMAX configs, 2 LightGBM sizes). The app now always runs the full search (8 SARIMAX configs, 3 LightGBM sizes), so a fresh run may differ slightly. Test block 25 May to 21 Oct 2026, 596 forecast origins, leads 1 to 24 h. Errors are against reanalysis, not a site sensor.

**Speed** (lower is better):

| Model | MAE 1 h | MAE 6 h | MAE 12 h | MAE 24 h | MAE avg 1-24 h | RMSE avg 1-24 h |
|---|---|---|---|---|---|---|
| Persistence | 0.56 | 1.24 | 1.24 | 1.04 | 1.18 | 1.52 |
| Seasonal naive (24 h) | 0.97 | 1.04 | 1.04 | 1.04 | 1.04 | 1.37 |
| SARIMAX | 0.57 | 1.01 | 1.05 | 1.08 | 0.99 | 1.29 |
| **LightGBM** | **0.51** | **0.91** | **0.90** | **0.93** | **0.89** | **1.14** |

**Direction, hours with wind ≥ 3 m/s** (circular error in degrees):

| Model | 1 h | 6 h | 12 h | 24 h | avg 1-24 h |
|---|---|---|---|---|---|
| Persistence | 10.4 | 29.3 | 32.5 | 24.6 | 28.0 |
| Seasonal naive (24 h) | 22.2 | 24.4 | 24.4 | 24.6 | 22.8 |
| SARIMAX | 10.2 | 29.4 | 35.5 | 46.6 | 34.0 |
| **LightGBM** | **8.9** | **20.5** | **21.6** | **24.3** | **20.4** |

**How to read these tables (things worth pointing out):**

- **Persistence is strong at 1 hour** (wind rarely changes in an hour) but collapses by 6 hours. Seasonal naive is poor at 1 hour but flat across leads. LightGBM beats both at **every reported lead (1, 6, 12 and 24 h)**, which is the point of using it.
- LightGBM is **16.8% better on speed** and **10.5% better on direction** than the best baseline (seasonal naive), and both gains are statistically significant.
- Errors grow from 1 to 6 hours and then flatten: after about half a day the model is mostly using climate and daily-cycle information rather than the current state.
- At 24 hours the direction error of LightGBM (24.3°) is similar to the baselines (24.6°), which is why the improvement overall comes from the shorter leads.
- A speed error of about 0.9 m/s sounds small, but at the steep part of the power curve (around 5-9 m/s) it still swings power a lot, because power rises roughly with the **cube** of speed. This is why energy forecasts are harder than speed forecasts.

**Against Open-Meteo at 24 h:** Open-Meteo is closer (0.83 vs 0.93 m/s; 15.2° vs 24.3°), significantly. Be upfront about this in the viva: the honest conclusion is "good, clearly better than simple methods, but a national-scale service is better still", with the reasons given in Step 19.

Numbers shift slightly when you prepare a site on a later date because the data window moves. **Full** profile (8 SARIMAX configs, 3 LightGBM sizes) takes about 20 minutes and searches more thoroughly.

---

## 7. The software: backend, frontend, data storage

### Architecture

```
 Browser (React dashboard)  <--- HTTP/JSON --->  FastAPI backend (Python)  ---> SQLite database + files
      localhost:5173                                  127.0.0.1:8000             backend/data, backend/models
                                                           |
                                                           +--> Open-Meteo (archive, previous runs), NREL turbine package
```

Everything runs on **your PC only**. There is no login, no cloud, no deployment. The backend listens on `127.0.0.1` (this machine only).

### Backend (Python, FastAPI)

| Folder | Role |
|---|---|
| `app/api/` | HTTP routes: site, jobs, forecast, reports, turbines, health. |
| `app/services/` | All the forecasting logic (data, features, baselines, SARIMAX, LightGBM, evaluation, selection, direction, yaw, turbine/energy, forecast, comparison, pipeline). |
| `app/core/` | Shared tools: circular maths, metrics, model storage, job runner, rate limiter, artifact files. |
| `app/db/` | SQLAlchemy models and sessions (SQLite). |
| `app/schemas/` | Request/response validation (Pydantic). |
| `app/config.py` | Defaults; override with `WINDKRAFT_` environment variables. |

**Key ideas**

- **Single site.** The app manages one site at a time (a design decision for simplicity).
- **Jobs.** Setup, forecasting for a date, and data refresh take minutes, so they run as **background jobs** in one worker thread. The request returns immediately with a job id (HTTP 202); the page polls the job for a progress bar. If you reload the page, it picks the running job up again.
- **Storage.** A SQLite database (`windkraft.db`) holds the site settings, dataset versions, model versions, stored forecasts and jobs. Files hold the raw CSV, the cleaned dataset (Parquet), JSON reports (`evaluation.json`, `direction.json`, `quality.json`), the backtest arrays, and trained model bundles.
- **Safe model loading.** Trained models are saved with joblib and can only be loaded from the app's own models folder (loading arbitrary pickle files is a security risk). Only the latest 3 are kept.
- **Rate limiting and CORS.** A per-IP limit protects write operations (default 60 per minute). Only the local frontend origin is allowed by CORS.
- **Switching turbine or yaw settings** is a `PATCH /api/site` call that recalculates power and yaw from the stored base forecast **without retraining**.

### Frontend (React, JavaScript/JSX only, no TypeScript)

- **React 18 + Vite**. Charts with **Recharts**; the map with **react-leaflet** (OpenStreetMap tiles).
- **State/hooks:** `useApi` (fetch with loading/error), `useJob` (poll a background job), `useTheme` (dark/light), `useChartColors`; contexts `SiteContext` and `ReportsContext`.
- **3D turbine page** (menu item "3D turbine", address `#/turbine`; the dashboard's Forecast section has an "Open the 3D view" link): a large three.js scene (react-three-fiber) built from simple shapes. For the chosen forecast hour the nacelle turns to the advised heading, a purple ball marks that heading on the ground ring, the parts are colour-coded (blades, hub, nacelle, yaw system, tower) with a colour legend over the scene and a plain-words key underneath (pointing at an entry makes that part glow), an arrow shows where the wind blows from (faded grey when the direction is not trusted), and the blades turn at an *illustrative* speed that rises with the forecast power (still below cut-in and at cut-out). The slider, Play button, compass and table all share the same selected hour; tower height and rotor size follow the selected turbine. It is lazy-loaded, respects reduced-motion, and falls back to the numbers when the browser has no WebGL. The scene logic (states, rotor speed, geometry) is in `utils/turbine3d.js` and is unit-tested; the rendering is in `components/turbine3d/`.
- **Two pages, no router library:** the address hash chooses between the dashboard and the 3D page. The dashboard is a single page with these sections, in order: Site, Data and turbine, Forecast, Model quality, Model vs Open-Meteo, Assumptions. Each chart has an *About this chart* panel (what it shows, what it is for, how to read it).
- **Design:** modern, minimal, dark by default with a light option; tokens in CSS variables; smooth open/close and entrance animations (switched off if your system asks for reduced motion).
- **Honest UI:** the page always shows data quality, assumptions and limits, and explains terms (for example the yaw legend, the "zero power" shading).

### API

Interactive documentation of every route: **http://127.0.0.1:8000/docs** while the backend runs. Main routes: `PUT/GET/PATCH /api/site`, `GET/POST /api/site/forecast`, `GET /api/site/export`, `GET /api/site/models/report`, `GET /api/site/models/direction`, `GET /api/site/data/quality`, `GET /api/site/compare`, `GET /api/site/api-comparison`, `GET /api/turbines`, `GET /api/jobs/{id}`.

---

## 8. Running it

**You need:** Python 3.12+ (developed on 3.13), Node.js 18+ (developed on 24), internet access (data download, map tiles).

```powershell
cd backend
python -m pip install -r requirements.txt
cd ..\frontend
npm install
cd ..
.\start.ps1
```

Open **http://localhost:5173**. Stop with `Ctrl+C` or `.\stop.ps1`. If PowerShell refuses to run the script: `powershell -ExecutionPolicy Bypass -File .\start.ps1`. Two-terminal alternative: backend `cd backend; python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`, frontend `cd frontend; npm run dev`. The exact versions used in development are in `backend/requirements-tested.txt`.

**First use:** press **Prepare site** (default coordinates are Ahmedabad; click the map or type others). Setup takes about 20 minutes because every site gets the full tuning search. Progress is shown live. When finished, the page fills with the forecast and reports, and everything is stored so the next start is instant.

**Export the Open-Meteo forecast to Excel:** `python export_openmeteo_forecast.py` asks for a date and coordinates and writes an `.xlsx` (hourly speed, direction, compass point) using the same Previous Runs source as the comparison chart. Needs `requests`, `pandas`, `openpyxl`.

---

## 9. Testing: how we know it is correct

```powershell
cd backend ; python -m pytest                # 72 fast tests (about 90 s)
python -m pytest -m slow -s                  # 6 slow "parity" tests (about 11 min)
cd ..\frontend ; npm test                    # 265 tests
npm run lint ; npm run build
```

What the tests prove (these make good answers to "how do you know it works?"):

- **No future data:** features are recomputed from truncated data and must be identical (leakage test).
- **Notebook parity:** the slow tests re-run the whole evaluation and require the backend's metrics, chosen settings, model selection and the 22 Oct forecast (yaw, power, energy) to **match the original research notebook's saved results**.
- **Mutation checks:** during development we deliberately broke the code (for example flipped a sign, removed a safeguard) and confirmed that the tests failed, to be sure the tests really catch mistakes.
- **API tests:** every route, error codes (404, 422, 502), rate limit, job lifecycle.
- **Frontend tests:** every chart and section, with real response data as fixtures; tooltips; the missing-data cases; an ESLint check that no TypeScript is used.
- **The forecast API is never used by the model:** a test enforces it.

---

## 10. Design decisions and why

| Decision | Reason |
|---|---|
| Time-ordered train / validation / test | The future must never inform the past; random splits would leak. |
| Tune on validation, score once on test | Keeps the final score unbiased. |
| Direct multi-step (72 models) | No error snowballing across the 24 hours; each lead optimised on its own. |
| Direction as sine and cosine | Removes the 359°/1° wrap-around problem; gives a confidence measure for free. |
| Circular error for direction | The only correct way to measure angle differences. |
| Direction scored on wind ≥ 3 m/s hours | In near-calm wind the direction is meaningless; this is fair to all models. |
| Baselines (persistence, seasonal naive) | A model that cannot beat them is not useful. |
| Rolling retraining every 30 days in the backtest | Mimics real use, where a model is refreshed with new data. |
| Block bootstrap | Neighbouring forecasts are correlated; a plain bootstrap would claim too much certainty. |
| Raw data kept unchanged; cleaning is separate | Traceability and honesty. |
| Only gaps ≤ 3 h are filled | Inventing long stretches of weather would be dishonest. |
| Open-Meteo archive for training; Previous Runs for comparison only | Keeps the comparison fair; the forecast service can never leak into the model. |
| Yaw deadband (8°) and reliability gates | Avoid pointless turning and avoid acting on guesses. |
| Power from a verified NREL curve | Official, reproducible, switchable between 19 turbines. |
| Single site, local only, no login | A college project on one PC; keeps scope focused and secure by being unreachable from outside. |
| Background jobs with progress | Setup takes minutes; the UI must stay responsive. |
| Reanalysis as truth, stated openly | No site sensor was available; the limitation is shown on the page. |

---

## 11. Questions an examiner might ask (with answers)

### A. The problem and the idea

**Q1. What problem does your project solve?**
It forecasts the next 24 hours of wind speed and direction at a turbine site, turns that into a recommended turbine heading and an energy estimate, and reports honestly how reliable the forecast is.

**Q2. Why does wind forecasting matter?**
Wind power is variable. Operators need to know how much energy to expect for planning, and which way to face the turbine to capture it, and when it will not be worth turning.

**Q3. Who would use this?**
A wind-farm operator or analyst, or a student studying forecasting. It is a decision-support tool (advice only), not a controller.

**Q4. What is new or different in your approach compared with a basic "train a model" project?**
The rigour: strict time-based splitting, leakage checks, simple baselines, a rolling backtest, significance testing, circular statistics for direction, a confidence measure with reliability gates, and an honest comparison with a professional forecast, including admitting that it wins.

### B. Data

**Q5. Where does the data come from?**
Open-Meteo historical archive (a free service built on reanalysis such as ERA5): hourly wind speed and direction at 100 m, and temperature, pressure, humidity, cloud cover. About 3 years per site.

**Q6. Is this real measured data from a turbine?**
No. It is reanalysis: a computer reconstruction of past weather combining observations and a weather model on a grid (about 9-25 km). I state this as a limitation. Scores measure agreement with this dataset.

**Q7. Why 100 m?**
It is close to modern hub heights, so the wind at 100 m is what the turbine actually experiences. If the hub height differs by more than 5 m, I convert with the power law and the shear exponent measured from the site.

**Q8. How did you check the data quality?**
Units, duplicates, ordering, missing hours, off-the-hour timestamps, missing values, ranges, shear exponent, grid-cell offset and data age. The raw file is stored untouched; cleaning is a separate dataset. For the stored run there were no gaps, duplicates or out-of-range values.

**Q9. How did you handle missing values?**
Only gaps of up to 3 hours are linearly interpolated; longer gaps stay missing and the affected forecast origins are skipped. No invented data beyond that.

**Q10. Why 3 years?**
It covers three full annual cycles (seasonal patterns such as the monsoon) while keeping downloads and training fast. It is configurable (`HISTORICAL_YEARS`).

**Q11. Why does the archive end 5 days before today?**
The archive is published with a delay. So forecast dates are in the recent past, not "tomorrow". A live feed is the natural future step.

### C. The pipeline and modelling

**Q12. Explain the pipeline in one minute.**
Download 3 years of hourly data, validate and clean it, create 47 clues per hour, split by time into train, validation and test, train baselines, SARIMAX and LightGBM, tune settings on validation, run a rolling backtest of 596 forecasts on the test block, score with MAE/RMSE/circular error, pick the winner and check significance, decide how far to trust the direction, then for a chosen date train with data up to that moment, predict 24 hours, add yaw advice and power/energy.

**Q13. What is a forecast origin and lead time?**
The origin is the moment the forecast is made (only earlier data is allowed). Lead time is how many hours after the origin a prediction applies, here 1 to 24.

**Q14. What is data leakage and how did you prevent it?**
Leakage is letting the model see information from the future. I prevent it by (a) only using lags and trailing windows in the features, proven by a truncation test, (b) training each forecast with a cutoff at its origin, (c) training rows only when the answer was already observed by the cutoff, (d) time-ordered splits, (e) tuning only on validation, and (f) never feeding forecast-API data into the model.

**Q15. Why not split the data randomly?**
Random splitting puts days after the test day into training, so the model would "know" the future weather regime. Time order mimics real use.

**Q16. Why separate validation and test?**
Validation is for choosing settings; test is the final exam. If I tuned on the test set the final score would be optimistically biased.

**Q17. What are the 47 features?**
Lags (0, 1, 3, 6, 12, 24 h) of speed, sin, cos; rolling means/standard deviations of speed over 3-24 h; rolling mean direction components; direction steadiness; 1 h and 3 h speed changes; 24 h maximum; cyclic hour of day and day of year; 10 m speed and the 100/10 m ratio; temperature and its 24 h change; pressure and its 3 h and 24 h change; humidity; cloud cover.

**Q18. Why use sine and cosine for direction?**
Angles wrap around, so 359° and 1° are close but look far apart numerically. Sine/cosine put angles on a circle where neighbours stay neighbours. Also the length of the predicted vector gives a confidence.

**Q19. How do you convert sine and cosine back to an angle?**
`atan2(sin, cos)`, converted to degrees and wrapped into 0-360°.

**Q20. What is "direct multi-step forecasting" and why use it?**
One separate model per lead hour and target (72 total) predicts that hour straight from the clues at the origin. The alternative, recursive forecasting, feeds predictions back as inputs, so errors accumulate. Direct avoids that at the cost of training more models.

**Q21. Why LightGBM?**
It handles tables of mixed clues very well, captures non-linear relationships and interactions, trains fast, and needs no feature scaling. It also won clearly in the held-out evaluation.

**Q22. How does gradient boosting work, simply?**
It builds many small decision trees in sequence; each new tree focuses on what the combined earlier trees still get wrong. Their weighted sum is the prediction.

**Q23. What is SARIMAX and why include it?**
A classic statistical time-series model: it predicts from recent values, recent errors and the same hour on previous days. It is the standard benchmark, so beating it is meaningful. It was weak for direction at long leads (46.6° at 24 h).

**Q24. What are persistence and seasonal naive, and why include them?**
Persistence repeats the latest value. Seasonal naive repeats the value from 24 hours earlier. They need no learning; any real model must beat them.

**Q25. How did you choose the model settings?**
On the validation block only: LightGBM sizes (small, medium, large) and SARIMAX orders; speed by lowest RMSE, direction by lowest circular error. The stored run chose "medium" for both.

**Q26. What is overfitting and how do you guard against it?**
Overfitting is memorising the training data so that new data predicts badly. Guards: held-out test scoring, row and column subsampling, regularisation, a minimum leaf size, modest model sizes, and tuning on a separate validation block.

**Q27. What is the rolling backtest?**
Pretend forecasts at 596 moments across the 150-day test block. Models are retrained every 30 days on everything observed to that point and used only for later origins. It gives many independent out-of-sample scores rather than a single lucky one.

**Q28. Why retrain every 30 days in the backtest?**
It mimics operation, where the model is refreshed regularly as new data arrives, and it avoids one stale model being tested for months.

**Q29. Why origins every 6 hours?**
Frequent enough to get hundreds of origins (596 in test) and to cover all times of day; not every hour, because adjacent hours give nearly identical forecasts and would just multiply the computation.

**Q30. How is the final forecast different from the backtest?**
The backtest evaluates quality; the final forecast uses the chosen settings, trains with cutoff at the requested origin, and predicts the next 24 hours.

**Q31. Why train again for every forecast date?**
So that a forecast for a past date is genuinely out-of-sample: the models have never seen the day they predict. It takes a short while and the result is cached.

**Q32. What if the data has a gap near the forecast origin?**
The origin is rejected with a clear message ("No valid observation at origin"), because the clues would be unreliable.

### D. Evaluation

**Q33. Which metrics do you use and why?**
Speed: MAE (intuitive average error) and RMSE (penalises large misses). Direction: circular MAE in degrees. All per lead and averaged.

**Q34. What is circular error and why do you need it?**
The shortest angle between two directions: `|((a − b + 180) mod 360) − 180|`. It avoids calling 359° vs 1° a 358° error.

**Q35. Why score direction only when speed ≥ 3 m/s?**
In almost calm air the direction is random and unimportant (a turbine is not producing). Including it would add noise and penalise all models equally for something nobody cares about. I report "all hours" as well.

**Q36. What do the results say?**
LightGBM beats all baselines and SARIMAX at every reported lead (1, 6, 12, 24 h) on both targets, by 16.8% on speed and 10.5% on direction versus the best baseline, and the improvements are significant. It does not beat Open-Meteo's own forecast.

**Q37. Is the improvement statistically significant?**
Yes. A 95% block-bootstrap interval of the error difference is [−0.201, −0.108] for speed and [−4.683, −0.178] for direction; both are entirely below zero.

**Q38. What is the block bootstrap and why blocks?**
Resample the per-forecast error differences many times (2,000) to see how much the average difference would vary by chance. I resample blocks of 4 consecutive origins because neighbouring forecasts are related; resampling single points would overstate certainty.

**Q39. Why is persistence good at 1 hour but bad later?**
Wind changes slowly over an hour, so "same as now" is nearly right. Over 6+ hours the weather evolves.

**Q40. Why does the error stop growing after about 6 hours?**
Beyond a few hours the current state tells little; the model leans on the daily cycle and seasonal climate, which give a roughly constant level of skill.

**Q41. Why is the direction error at 24 h almost the same as the baselines?**
At long leads, direction depends on the next day's weather pattern, which local history cannot know. The gain shows up at shorter leads.

**Q42. Your model loses to Open-Meteo. Is the project a failure?**
No. The goal was to build and honestly evaluate a forecasting pipeline. A professional forecast uses global physical models and far more data and computing, so it is expected to win. Reporting that honestly is a strength. Moreover the comparison is slightly tilted toward Open-Meteo because the "truth" is reanalysis from the same model family.

**Q43. Why did you use the Previous Runs API for the comparison?**
For past dates the ordinary forecast API returns the model's analysis (what happened), which would look like a perfect forecast. Previous Runs keeps the forecast as it was actually issued the day before, giving a genuine day-ahead comparison.

**Q44. What does the "Model vs Open-Meteo" chart show, and what does it not?**
It plots our forecast and Open-Meteo's day-ahead forecast for the same 24 hours and their average difference. It does not say which is correct; that needs observed values (the held-out comparison does that).

**Q45. How do you know the evaluation is not fooling you?**
Leakage test, time-ordered splits, held-out scoring, baselines, notebook-parity tests, significance testing, and the fact that the result includes an unflattering comparison. Also the metrics are computed against reanalysis and I say so.

**Q46. Why is energy accuracy not reported against reality?**
There is no measured generation data. I provide an energy error *proxy* that isolates wind-forecast error through the power curve, and label it as such.

### E. Direction trust and yaw

**Q47. What is direction confidence R?**
The length of the predicted `(sin, cos)` vector, capped at 1. Near 1 means the model is decisive; near 0 means its components cancel and the angle is ill-defined.

**Q48. How did you choose R ≥ 0.75?**
From the validation block: the smallest R whose retained hours have an error at most 80% of the overall error while keeping at least half of all hours. It was not tuned on the test block.

**Q49. Does R really indicate accuracy?**
On the test block, the correlation between R and error is −0.46, and error falls from 25.4° (all hours) to 17.3° when both gates (speed ≥ 3, R ≥ 0.75) apply.

**Q50. What is yaw and why does a turbine need it?**
Yaw is rotating the nacelle to face the wind. A misaligned turbine captures less energy and is more stressed.

**Q51. Explain your yaw logic.**
If the hour is reliable (R ≥ 0.75 and speed ≥ 3 m/s) and the predicted direction differs from the current heading by more than 8°, turn to it; otherwise hold. Unreliable hours always hold.

**Q52. What is the deadband and why 8°?**
A tolerance below which no turning is advised, to stop the advice twitching and to avoid needless wear. 8° is a reasonable default and configurable (`YAW_DEADBAND_DEG`); small misalignment costs little energy (roughly the cosine of the error squared).

**Q53. Does the app control the turbine?**
No. The output is advisory only; nothing is sent to any turbine.

### F. Power and energy

**Q54. How do you compute power?**
Interpolate the verified NREL power curve at the predicted wind speed (after a height correction if needed); zero below cut-in and at or above cut-out. Energy (kWh) = power (kW) × 1 h; total is the sum over 24 h.

**Q55. Why are there hours with zero power?**
The predicted speed is below cut-in (3.25 m/s for the default turbine), so the turbine produces nothing.

**Q56. Why does power rise so steeply with wind speed?**
The power in wind scales with the cube of speed (doubling speed gives eight times the power), until the turbine reaches its rated power, where it is held flat.

**Q57. What is capacity factor and what does 9.8% mean?**
Energy made divided by what the turbine would make at full rated power the whole time. 9.8% on 22 Oct reflects a light-wind day (mean 4.0 m/s, while this turbine needs roughly 11-12 m/s for full output).

**Q58. How accurate is the energy estimate?**
It is theoretical: no wake effects, downtime, curtailment, turbulence, icing or air-density corrections, and no measured output to check against. Treat it as an idealised estimate.

**Q59. How do you verify the turbine curves?**
Strictly increasing speeds, non-negative power, peak equals rated power within 1%, curve starts near cut-in, hub height known. Failing turbines are flagged as unusable (19 pass).

**Q60. What happens when you change the turbine?**
Only the power/energy and yaw steps are recalculated from the stored base forecast; no retraining.

### G. Software engineering

**Q61. Describe the architecture.**
A React single-page dashboard talks over HTTP/JSON to a FastAPI backend, which keeps data in SQLite and files, and calls Open-Meteo and the NREL package. All local.

**Q62. Why FastAPI and React?**
FastAPI gives typed validation, automatic interactive docs and good performance with little code. React gives a component-based, responsive UI with a large charting ecosystem. (The project requirement was React with JS/JSX only, no TypeScript.)

**Q63. How do long tasks work without freezing the page?**
They are background jobs (one worker thread). The API returns 202 with a job id; the page polls the job for progress and can resume after a reload.

**Q64. How is the app secured, given there is no login?**
It is designed for local use: it binds to `127.0.0.1`, CORS allows only the local frontend, writes are rate-limited per IP, trained models load only from the app's own folder, and inputs are validated.

**Q65. Where is data stored?**
`backend/data` (SQLite database, raw CSV, clean Parquet, JSON reports, backtest arrays) and `backend/models` (latest 3 trained bundles).

**Q66. How are results reproducible?**
Fixed random seed (42), pinned tested versions, stored raw data, and parity tests against the notebook.

**Q67. How do you test it?**
72 fast backend tests, 6 slow parity tests, 265 frontend tests, lint, and mutation checks (deliberately breaking the code to prove the tests notice).

**Q68. What happens if Open-Meteo is down?**
Setup fails at the download step with a clear message; already-prepared sites still work. The comparison chart shows an error with "Try again".

**Q69. What if LightGBM cannot be installed?**
The code falls back to XGBoost or scikit-learn's histogram gradient boosting; results differ slightly.

### H. Limitations and "what if" questions

**Q70. What are the main limitations?**
Reanalysis instead of a site sensor; archive delay (forecasts start from a past date); theoretical energy; advisory-only yaw; point forecasts without uncertainty intervals; a roughly five-month backtest; single site.

**Q71. Why is the backtest only 5 months?** Is that enough?**
It gives 596 origins and a significant result, but it covers only part of the year; performance in other seasons (for example the strong monsoon winds) may differ. A longer backtest is a future improvement.

**Q72. How would you improve the model?**
Use measured site data; add numerical-weather-prediction inputs (such as the forecast itself) as features in a *separate, clearly labelled* model; add uncertainty intervals (quantile regression); ensembles; more sites; a live data feed.

**Q73. Could you use the Open-Meteo forecast as an input to improve accuracy?**
Yes, and it would probably improve accuracy a lot, but then the project would be a correction layer on top of someone else's forecast instead of an independent forecaster, and the comparison would no longer be fair. I kept it as a separate benchmark by design.

**Q74. Would it work at another location?**
Yes: enter other coordinates. It downloads that site's data and repeats the evaluation. Results will differ by climate.

**Q75. What would you do with a real turbine's measurements?**
Replace reanalysis as the "truth", train and score against it, add the turbine's actual output to calibrate the power curve, and measure real energy accuracy.

**Q76. Is a 24-hour forecast long enough?**
It matches day-ahead planning. Accuracy at longer horizons falls toward climate, so beyond a couple of days a physical weather model is required.

**Q77. How does this relate to machine-learning topics such as bias and variance?**
SARIMAX is a low-capacity model (higher bias at long leads); LightGBM is higher capacity and needs regularisation and validation to control variance. The validation block selects the balance.

**Q78. Why not deep learning (LSTM, transformers)?**
With one site and about 26,000 hourly rows, gradient boosting is hard to beat on tabular clues, is faster, easier to explain and to test for leakage. Deep learning is a reasonable future comparison.

**Q79. Why predict speed directly and not the change in speed?**
I tested both on validation; the plain speed target was slightly better (RMSE 1.258 vs 1.266 for the medium size), so it was chosen automatically.

**Q80. A model's speed error is 0.9 m/s. Is that good?**
It is about 22% of the 4 m/s mean wind and about 15% better, on average over 24 h, than predicting "same as yesterday" (0.89 vs 1.04). Compared with Open-Meteo it is 0.10 m/s worse. Its practical effect depends on where on the power curve the wind sits, because power is very sensitive around 5-9 m/s.

---

## 12. Limitations and future work

**Limitations (all also shown in the app):**

- Reanalysis data, not site measurements; accuracy figures measure agreement with that dataset.
- The archive lags real time by about 5 days, so forecasts begin from a chosen past date.
- Theoretical power curve; no wake, availability, curtailment, turbulence, icing or air-density effects; no measured generation to validate energy.
- Yaw is advisory only.
- Point forecasts only; no prediction intervals; about five months of backtest.
- One site at a time.

**Future work:** a live sensor feed; measured turbine data; uncertainty intervals; seasonal evaluation over a full year; ensemble or hybrid models that use numerical weather forecasts as labelled inputs; a deep-learning comparison; multiple sites; automatic daily refresh and retraining.

---

## 13. Project files, configuration, API, troubleshooting

### Layout

```
backend/            FastAPI service, forecasting code, tests
  app/api/          REST routes
  app/services/     data, features, baselines, SARIMAX, LightGBM, backtest, selection,
                    direction, yaw, turbine/energy, forecast, comparison, pipeline
  app/core/         circular math, metrics, model registry, job runner, rate limit
  app/db/           SQLAlchemy models and sessions
  tests/            72 fast tests + 6 slow notebook-parity tests
frontend/           React app (JavaScript/JSX only), Vite, tests
docs/               PROJECT_PLAN.md, DEMO_SCRIPT.md, design/ (HTML templates), legacy/
outputs/            Notebook exports and sample data (used by the parity tests)
wind_prediction_engine.ipynb   The research notebook the backend was ported from
export_openmeteo_forecast.py   Exports the Open-Meteo day-ahead forecast to Excel
start.ps1, stop.ps1            Start / stop both servers
wind_pipeline.py, wind*.ipynb  Earlier prototype pipelines (not used by the app)
```

Where is each pipeline step? Download/validate/clean: `data_service.py`. Features: `feature_service.py`. Splits and origins: `eval_data.py`. Baselines: `baseline_service.py`. SARIMAX: `sarimax_service.py`. LightGBM, tuning, backtest: `gbm_service.py`. Orchestration: `evaluation_service.py`, `pipeline_service.py`. Metrics and bootstrap: `core/metrics.py`. Selection: `selection_service.py`. Direction trust: `direction_service.py`. Final forecast: `forecast_service.py`. Yaw: `yaw_service.py`. Power/energy: `turbine_service.py`. Open-Meteo comparison: `compare_service.py`.

### Configuration

Defaults are in `backend/app/config.py`; override with environment variables prefixed `WINDKRAFT_`:

```powershell
$env:WINDKRAFT_RATE_LIMIT_PER_MIN = "120"
$env:WINDKRAFT_DATA_DIR = "D:\windkraft-data"
$env:WINDKRAFT_TURBINE_NAME = "BAR_HighSP_5.0MW_134.9"
.\start.ps1
```

| Setting | Default | Meaning |
|---|---|---|
| `HISTORICAL_YEARS` | 3 | Years of history downloaded |
| `FORECAST_HOURS` | 24 | Forecast horizon |
| `VAL_DAYS` / `TEST_DAYS` | 90 / 150 | Validation and test block lengths |
| `ORIGIN_STEP_H` | 6 | Hours between forecast origins |
| `REFIT_DAYS` | 30 | Retraining interval in the backtest |
| `DIR_MIN_SPEED` | 3.0 | Minimum speed (m/s) for direction to count |
| `MAX_INTERP_GAP_H` | 3 | Longest gap that is filled |
| `YAW_DEADBAND_DEG` | 8 | Yaw deadband |
| `MIN_HISTORY_HOURS` | 8760 | History needed before a forecast date |
| `RANDOM_SEED` | 42 | Reproducibility |
| `LOCAL_TZ` | Asia/Kolkata | Local time shown |

### Troubleshooting

| Symptom | Cause and fix |
|---|---|
| "Cannot reach the backend" in the first seconds | The backend needs about 8 seconds to start. Wait, then press Retry. |
| "Port 8000/5173 is already in use" | A previous run is still going. Run `.\stop.ps1`. |
| Blank map | Map tiles need internet. Everything else still works. |
| Setup fails at the download step | Open-Meteo unreachable or rate-limited. Check internet and press Replace site again. |
| Model vs Open-Meteo shows an error | The Previous Runs API is unreachable. Press **Try again**. After updating the code, restart the backend (`.\stop.ps1`, then `.\start.ps1`) so it has the newest route. |
| Setup is slow | Normal: the full tuning search takes about 20 minutes. Progress is shown; you may close and reopen the page. |
| Want a fresh start | Stop the servers, delete `backend/data` and `backend/models`, start again. |
| LightGBM will not install | The backend falls back to another gradient-boosting library automatically. |

### More documentation

- `docs/PROJECT_PLAN.md`: architecture, decisions and as-built notes for each phase.
- `docs/DEMO_SCRIPT.md`: a presentation script with talking points.
- `docs/design/`: HTML design templates the dashboard was built from.
- `docs/legacy/README_old_pipelines.md`: documentation of the earlier prototype scripts.

Data: Open-Meteo (open-meteo.com) historical and Previous Runs APIs, and the NREL `turbine-models` package for power curves. Map tiles: OpenStreetMap contributors.
