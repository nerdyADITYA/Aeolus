"""The model's forecast next to the Open-Meteo forecast for the same hours (no observations needed)."""
import numpy as np
import pandas as pd
import pytest

from app.services import compare_service as cs


def base_forecast(start="2026-10-21 22:00", hours=24, speeds=None):
    idx = pd.date_range(start, periods=hours, freq="h", name="timestamp_utc")
    fc = pd.DataFrame({"lead_h": np.arange(1, hours + 1),
                       "pred_speed_100m_ms": speeds if speeds is not None else np.linspace(4.0, 6.0, hours)}, index=idx)
    fc.attrs["origin_utc"] = str(idx[0] - pd.Timedelta(hours=1))
    return fc


def api_frame(index, speeds):
    return pd.DataFrame({"api_speed": speeds, "api_dir": 60.0}, index=pd.DatetimeIndex(index, name="timestamp_utc"))


def test_rows_line_up_by_timestamp_and_difference_is_averaged():
    fc = base_forecast(speeds=[5.0] * 24)
    api = api_frame(fc.index, [4.0, 6.0] * 12)                                   # always 1 m/s away from the model
    out = cs.forecast_vs_api(fc, 23.0, 72.5, fetch=lambda *a, **k: api)
    assert len(out["hours"]) == 24 and out["matched_hours"] == 24
    assert out["hours"][0] == {"timestamp_utc": "2026-10-21T22:00:00Z", "lead_h": 1, "model_speed": 5.0, "api_speed": 4.0}
    assert out["hours"][1]["api_speed"] == 6.0
    assert out["mean_abs_difference_ms"] == pytest.approx(1.0)
    assert "message" not in out
    assert "Previous Runs" in out["api_source"] and out["origin_utc"] == "2026-10-21 21:00:00"


def test_works_without_any_observations_and_asks_only_for_the_forecast_dates():
    calls = []
    fc = base_forecast(start="2026-10-21 22:00")                                  # crosses midnight: two dates
    cs.forecast_vs_api(fc, 23.0, 72.5, fetch=lambda lat, lon, start, end: calls.append((lat, lon, start, end)) or api_frame(fc.index, 5.0))
    assert calls == [(23.0, 72.5, "2026-10-21", "2026-10-22")]                    # the same dates as the forecast, nothing else


def test_hours_the_api_does_not_have_are_empty_and_not_counted():
    fc = base_forecast(speeds=[5.0] * 24)
    have = fc.index[:6]
    api = api_frame(have, [3.0] * 6)
    out = cs.forecast_vs_api(fc, 0, 0, fetch=lambda *a, **k: api)
    assert out["matched_hours"] == 6
    assert [h["api_speed"] for h in out["hours"][:6]] == [3.0] * 6
    assert all(h["api_speed"] is None for h in out["hours"][6:])                  # a gap, not a made-up value
    assert out["mean_abs_difference_ms"] == pytest.approx(2.0)                   # averaged over the 6 hours that exist
    assert all(h["model_speed"] == 5.0 for h in out["hours"])                    # the model line is always complete


def test_api_nan_values_count_as_missing():
    fc = base_forecast(speeds=[5.0] * 24)
    api = api_frame(fc.index, [np.nan] * 23 + [4.0])
    out = cs.forecast_vs_api(fc, 0, 0, fetch=lambda *a, **k: api)
    assert out["matched_hours"] == 1 and out["hours"][0]["api_speed"] is None and out["hours"][-1]["api_speed"] == 4.0


def test_no_api_data_gives_a_clear_message_and_no_number():
    fc = base_forecast()
    out = cs.forecast_vs_api(fc, 0, 0, fetch=lambda *a, **k: api_frame([], []))
    assert out["matched_hours"] == 0 and out["mean_abs_difference_ms"] is None
    assert "no forecast stored" in out["message"]
    assert len(out["hours"]) == 24 and all(h["api_speed"] is None for h in out["hours"])


def test_duplicate_api_timestamps_do_not_break_it():
    fc = base_forecast(speeds=[5.0] * 24)
    idx = list(fc.index) + [fc.index[0]]
    api = api_frame(idx, [4.0] * 24 + [9.0])
    out = cs.forecast_vs_api(fc, 0, 0, fetch=lambda *a, **k: api)
    assert out["hours"][0]["api_speed"] == 4.0 and out["matched_hours"] == 24      # first value wins


def test_says_plainly_that_it_is_not_an_accuracy_score():
    out = cs.forecast_vs_api(base_forecast(), 0, 0, fetch=lambda *a, **k: api_frame(base_forecast().index, 5.0))
    text = " ".join(out["notes"])
    assert "does not say which one is right" in text and "observed values" in text
    assert "never uses it as an input" in text


def test_matches_by_clock_time_when_the_api_returns_whole_calendar_days():
    """Open-Meteo returns full days (00:00 onwards); a forecast starting at 22:00 must still pick the right hours, not the first 24 rows."""
    fc = base_forecast(start="2026-10-21 22:00", speeds=[5.0] * 24)               # 21 Oct 22:00 to 22 Oct 21:00
    days = pd.date_range("2026-10-21 00:00", "2026-10-22 23:00", freq="h")        # the API's two full days
    api = api_frame(days, [float(h.day * 100 + h.hour) for h in days])            # value encodes day and hour, e.g. 2122 = 21st, 22:00
    out = cs.forecast_vs_api(fc, 0, 0, fetch=lambda *a, **k: api)
    assert out["hours"][0]["timestamp_utc"] == "2026-10-21T22:00:00Z" and out["hours"][0]["api_speed"] == 2122.0
    assert out["hours"][1]["api_speed"] == 2123.0                                 # 23:00 on the 21st
    assert out["hours"][2]["api_speed"] == 2200.0                                 # rolls over to 00:00 on the 22nd
    assert out["hours"][-1]["api_speed"] == 2221.0                                # 21:00 on the 22nd, not 23:00
    assert out["matched_hours"] == 24


def test_api_rows_in_a_different_order_still_match_by_time():
    fc = base_forecast(speeds=[5.0] * 24)
    api = api_frame(fc.index[::-1], list(range(24)))                              # reversed: the last hour first
    out = cs.forecast_vs_api(fc, 0, 0, fetch=lambda *a, **k: api)
    assert out["hours"][0]["api_speed"] == 23.0 and out["hours"][-1]["api_speed"] == 0.0
