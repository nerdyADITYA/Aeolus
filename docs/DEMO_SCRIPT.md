# WindKraft: presentation and demo script

About **12 minutes** of demo plus questions. A **90-second version** is at the end. Numbers quoted here come from the stored run in this repository (data to 21 Oct 2026). If you prepare a new site on another day, the data window moves and the numbers shift slightly: **check them against the screen before you present** and use the screen's numbers.

The most important thing to say out loud, and the thing that makes this project credible: **the model beats simple methods, but it does not beat a professional weather service, and the app shows that openly.**

---

## Before you present

**The day before**
- [ ] Run `.\start.ps1`, open http://localhost:5173 and confirm the site status chip says *data to 2026-10-21 23:00 UTC* (a prepared site must already exist; preparing one takes about 6 minutes, so never do it live).
- [ ] In **Forecast**, run forecasts for **two or three earlier dates** (for example 3, 6 and 9 days before the latest date). Each takes about a minute. (The *latest* date works too: the comparison chart only needs two forecasts, not observations.)
- [ ] Scroll to **Model vs Open-Meteo** and confirm the chart draws both lines (it fetches Open-Meteo automatically, so this checks the internet connection).
- [ ] Read the numbers on screen and update the cheat sheet below if they differ.
- [ ] Record a short screen video of the whole flow as a backup.

**30 minutes before**
- [ ] Plug in the laptop, turn off sleep and notifications, close other tabs.
- [ ] `.\start.ps1`, wait about 10 seconds, open the page, full screen, zoom so text is readable from the back (Ctrl and +).
- [ ] Try both themes on the projector; dark is the default, light is often clearer in a bright room (button at the top right).
- [ ] Leave the turbine on the default (2023 NREL Bespoke 3.3 MW).

**Do not during the demo:** press *Replace site and re-run* (it discards the results), or *Prepare site* (6 minutes).

**If the internet fails:** the stored site, forecasts, charts, model quality, data quality and turbine curve all work offline. Only the map background and the **Model vs Open-Meteo** chart need internet; show the backup video for that part.

---

## The talk (about 12 minutes)

### 0:00 The problem (1 min)
Say: "Wind turbines should face the wind. If we can predict the next day's wind speed and direction, we can plan the nacelle heading and estimate the energy. My project builds that forecast, and, just as important, measures honestly how good it is."

Point out: runs on this PC, no login, one site.

### 1:00 Site and data (1.5 min), section **Site**
- Show the map and coordinates. "I enter a location, or click the map."
- Show the summary card: 26,328 hourly rows, 3 years, selected model LightGBM.
- Say: "Wind comes from Open-Meteo's historical archive at 100 m: hub height. It is reanalysis, a model of the atmosphere, not a measurement at the turbine. I'll come back to why that matters."
- Mention the first setup takes minutes and shows live progress (do not run it now).

### 2:30 The forecast (3 min), section **Forecast**
1. Point at the four headline numbers: about **7,768 kWh**, capacity factor **9.8%**, peak **757 kW**, mean speed **4.0 m/s**. "Low-wind site: typical for this region."
2. **Wind speed chart:** black = last 48 hours observed, cyan = the 24-hour forecast, dashed line = the turbine's cut-in speed, below which it produces nothing.
3. **Compass:** drag the **Forecast hour** slider. "The needle shows where the wind comes from. The purple marker is the *advisory* heading. Notice it does not chase every small change: a deadband of 8° avoids needless turning."
4. **Direction chart:** "Direction is an angle, so I draw dots, never lines: 359° and 1° are really 2° apart. Hollow dots are hours where the model is not confident."
5. **Confidence bars:** "Grey bars are hours the system will *not* act on: low confidence or too little wind. **15 of 24 hours** are reliable."
6. **Power and energy chart** and the **table:** click a column header to sort; click a lead such as **+9h** and watch the compass jump to that hour. Show **Export CSV**.

### 5:30 Switching turbines (1 min)
- In **Turbine and yaw**, pick **VestasV82 1.65 MW** and press **Apply**.
- "Energy changed from about 7,768 to about 982 kWh instantly: same wind prediction, different power curve and hub height (70 m, so a wind-shear correction applies). Nothing was retrained." Switch back to the default.

### 6:30 Is the model any good? (2.5 min), section **Model quality**
1. **The comparison table** (the first thing you see): every model on **596 forecasts it never saw** (May to October 2026), best first, lower is better. Speed error (RMSE over 24 hours): **LightGBM 1.14**, SARIMAX 1.29, seasonal naive 1.37, persistence 1.52 m/s. Direction error: **20.4°** vs 34.0°, 22.8°, 28.0°. Read the one-line description of each model: persistence "assumes the wind stays as it is", seasonal naive "like the same hour yesterday".
2. Say what the scores mean using the key under the table: MAE is the typical miss, RMSE punishes big misses (the square root of the MSE), direction error is in degrees and 359° versus 1° counts as 2°. "I do not quote an accuracy percentage: these are continuous numbers, so the size of the error is the honest score."
3. Press **Show detailed results** only if asked or if time allows: the winners card ("*significantly better* means a statistical test says the gain is not luck"), the success criteria (all met), the error-by-lead-time charts ("everything gets worse further ahead, but LightGBM stays below the others; SARIMAX is *worse than doing nothing* for direction at long range"), and **direction reliability** (error is small when confidence is high or the wind is strong, which is why the system only acts when it is confident).
4. If asked about energy: the **energy error (proxy)** table measures only wind-forecast error through the power curve. "We have no measured generation, so I do not claim energy accuracy."

### 9:00 Our model next to a professional forecast (2 min), section **Model vs Open-Meteo**
1. The chart appears on its own: our model (solid cyan) and the forecast Open-Meteo had issued the day before (dashed amber), for the same 24 hours as the forecast above. There is nothing to press. Hover a point to see both speeds and the difference.
2. Read the subtitle: for the newest forecast the two differ by **0.52 m/s on average**; the lines track each other closely. Say what the chart does *not* do: "This compares two forecasts with each other. It cannot say which is right: that needs observed values." (Click another stored forecast above to see another day; 16 Oct differs by 0.96 m/s.)
3. Say it plainly, from the evaluation rather than the chart: "Measured against what actually happened over 596 forecasts at 24 hours ahead, my model beats simple methods but the professional service is still closer (speed error 0.93 vs 0.83 m/s; direction 24.3° vs 15.2°). Two honest reasons: it has far more data and compute, and my 'truth' comes from the same family of models, which favours it." These head-to-head numbers are not shown on the dashboard; they come from `GET /api/site/compare` (see README, Results).
4. Optional: "One day is anecdotal; the long-period result is the one to trust."

### 11:00 Trust: data and assumptions (1 min), sections **Data and turbine**, **Assumptions**
- Data-quality checklist: no duplicates, no gaps, units checked, a test proving no future data leaks into the features.
- Power curve: verified (cut-in 3.25, rated 3,300 kW, cut-out 25 m/s).
- Assumptions panel: reanalysis not a sensor; energy is idealised; yaw is advisory; the archive lags real time, so the forecast starts from a chosen past date.

### 11:45 Close (15 s)
"Built with a tested pipeline: **337 automated tests** (72 backend, 265 frontend), no data leakage by construction, and a dashboard that reports its own weaknesses. Next step would be real turbine data and a live feed."

---

## Cheat sheet (stored run)

| Fact | Value |
|---|---|
| Data | 3 years hourly, 2023-10-21 to 2026-10-21, 26,328 rows, 100 m |
| Held-out test | 2026-05-25 to 2026-10-21, **596** forecast origins |
| Speed RMSE 1–24 h | Persistence 1.52, seasonal naive 1.37, SARIMAX 1.29, **LightGBM 1.14** m/s |
| Direction error (wind ≥ 3 m/s) | 28.0, 22.8, 34.0, **20.4** ° |
| Gain vs best baseline | speed **16.8%**, direction **10.5%** (both significant) |
| 24 h lead vs Forecast API | speed MAE 0.93 vs **0.83** m/s; direction 24.3 vs **15.2** °; API closer, +0.102 m/s (95% interval +0.025 to +0.191) |
| Forecast for 22 Oct 2026 | 7,768 kWh, capacity factor 9.8%, peak 757 kW, 15 of 24 hours reliable direction |
| Turbine | NREL Bespoke 3.3 MW, hub 100 m (Vestas V82 gives about 982 kWh) |
| Models | LightGBM: 72 models (24 hours × speed, sine, cosine), retrained every 30 days in the backtest |
| Tests | 72 backend + 265 frontend (+ 6 slow parity tests against the notebook) |

---

## Likely questions, with honest answers

**Why LightGBM and not a neural network (LSTM)?** On about three years of hourly data, boosted trees on lagged and rolling features are a strong, fast, easy-to-validate method. My earlier prototype used an LSTM; I did not evaluate one in this version, so I cannot claim it would be better or worse.

**Is LightGBM really "the best"?** It is the best of the four methods I tested, on this site and this five-month test block. It is not the best available forecast: the Forecast API beat it. Other seasons (such as the monsoon) are not covered by the test block.

**Why does the Forecast API win, and is the comparison fair?** Mostly yes, with a caveat I show on screen. Both are scored against the same observed values at matching timestamps and the API is never an input to my model. But the observed values are reanalysis from the same weather-model family as the API, which favours it. The true test would be a real anemometer.

**What is data leakage and how do you avoid it?** Leakage is using future information to predict the past, which makes results look better than they are. Features at time *t* use only data up to *t* (a test recomputes them from truncated data and fails if anything changes); each model only sees targets that were already observed at its cut-off; and I changed the future data in a test and confirmed forecasts did not change.

**What does "circular error" mean?** Directions wrap around: 359° and 1° are 2° apart, not 358°. All direction errors use the shortest angle.

**Why predict sine and cosine of the direction?** Because the angle itself jumps from 360° to 0°. Predicting the two components and recombining them avoids that, and the length of the predicted vector gives a natural confidence.

**Why 72 separate models?** One per forecast hour (24) and per quantity (speed, sine, cosine). This "direct" strategy avoids feeding predictions back into themselves, so errors do not pile up over the day.

**How accurate is the energy estimate?** Unknown against real output: there is no measured generation here. The curve is a theoretical one with no wake, availability or air-density losses. The app labels the energy error as a proxy for wind-forecast error only.

**Can it control a turbine?** No. Yaw output is advisory; no commands are sent, and a real turbine's own controller and safety systems must stay in charge.

**Why is the forecast not for "tomorrow"?** The free historical archive lags real time by about five days. You pick a past start date, and each date is predicted by a model trained only on data before it. A live sensor feed would fix this.

**What if a day of data is missing?** Gaps of up to 3 hours are interpolated and flagged; longer gaps are left empty and excluded from training and scoring rather than invented.

**What would you do with more time?** Use real turbine (SCADA) data to validate energy and direction, add prediction intervals, test other seasons and sites, and feed a live observation source.

---

## 90-second version

1. **Site** (10 s): "Enter a location; the app downloads three years of wind data."
2. **Forecast** (35 s): headline energy, the speed chart, the compass slider, the greyed-out low-confidence hours.
3. **Model quality** (20 s): "LightGBM beats three simple methods on 596 forecasts it never saw."
4. **Model vs Open-Meteo** (20 s): "Next to a professional forecast the two agree closely, and I am clear about what I can and cannot claim."
5. Close (5 s): "Tested, leak-free, and honest about its limits."
