# Model-selection report
Site 23.0225, 72.5714 | data 2023-10-21 00:00:00 to 2026-10-21 23:00:00 UTC (26328 hourly rows, wind @100 m)
Tuning (validation): 90 days. Held-out rolling backtest: 150 days, 596 forecast origins every 6 h, leads 1-24 h, ML retrained every 30 days.

## Winners
- Speed: **LightGBM** (mean RMSE 1-24 h 1.143 m/s vs Seasonal naive (24h) 1.373; 16.8% better; 95% CI of error difference [-0.201, -0.108]).
- Direction: **LightGBM** (circular MAE, obs speed >= 3.0 m/s, 20.4 deg vs Seasonal naive (24h) 22.8 deg; 10.5% better; CI [-4.683, -0.178]).
- SARIMAX settings chosen on validation: speed (1,0,1)x(1,0,1,24) [orig]; direction (1,0,1)x(1,0,1,24) [orig].
- LightGBM settings chosen on validation: speed medium (delta target=False); direction medium.

## Held-out metrics
```
                      MAE@1h  MAE@6h  MAE@12h  MAE@24h  RMSE@1h  RMSE@6h  RMSE@12h  RMSE@24h  MAE_1-24h  RMSE_1-24h  dirMAE_fast@1h  dirMAE_fast@6h  dirMAE_fast@12h  dirMAE_fast@24h  dirMAE_all_1-24h  dirMAE_fast_1-24h
model                                                                                                                                                                                                                     
Persistence            0.558   1.241    1.242    1.041    0.841    1.565     1.582     1.398      1.184       1.520          10.418          29.349           32.479           24.574            32.751             27.964
Seasonal naive (24h)   0.973   1.038    1.039    1.041    1.290    1.396     1.396     1.398      1.040       1.373          22.152          24.366           24.379           24.574            28.156             22.840
SARIMAX                0.570   1.012    1.049    1.079    0.835    1.287     1.353     1.385      0.994       1.290          10.225          29.414           35.531           46.561            36.882             33.970
LightGBM               0.510   0.905    0.897    0.931    0.727    1.190     1.173     1.209      0.885       1.143           8.917          20.477           21.589           24.322            25.426             20.448
```

Metrics are computed against ERA5-type reanalysis values, not site anemometer data.
