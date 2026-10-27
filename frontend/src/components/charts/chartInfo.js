// Plain-language explanation shown on every chart card ("About this chart").
//   shows: what the picture represents      use: what decision or question it helps with      read: how to read it / what to watch out for
// Keep the wording general (no numbers that depend on the site or the run): the live numbers are already on the card.

export const CHART_INFO = {
  speed: {
    shows:
      'Wind speed at 100 m (the turbine\'s hub height) over the last 48 hours (white line, observed values from the reanalysis dataset) and the ' +
      'model\'s forecast for the next 24 hours (cyan). The dotted vertical line is the forecast origin: the moment the model\'s knowledge stops.',
    use:
      'See how much wind is coming and when it will be too light to generate. Hours where the forecast sits below the dashed cut-in line produce ' +
      'no power. Comparing the forecast with the recent past shows whether it expects a normal pattern or a sudden change.',
    read:
      'The forecast is one best estimate, not a range, and it becomes less certain further from the origin (see Model quality for how much).',
  },
  compass: {
    shows:
      'The wind direction and the advisory nacelle heading for one forecast hour, chosen with the slider or by clicking a lead in the table. ' +
      'The needle points to where the wind comes from; the purple marker on the ring is the heading the nacelle should face.',
    use:
      'Plan yaw. A conventional upwind turbine faces into the wind. The heading only moves when the prediction is reliable and differs from the ' +
      'current heading by more than the deadband, so it does not chase small or doubtful changes.',
    read: 'A grey needle means the direction is not trusted for that hour (low confidence or light wind), so the heading is simply held.',
  },
  direction: {
    shows:
      'Wind direction by hour: white dots are observed over the last 48 hours, purple dots are forecast hours the model is confident about, ' +
      'and hollow grey dots are forecast hours it is not confident about. Direction is measured clockwise from north, as the direction the wind comes from.',
    use:
      'See how steady the wind direction is, and so whether the turbine would need to turn during the day. A steady line of dots means little yaw movement; ' +
      'a wide scatter means the wind is shifting.',
    read:
      'Direction is an angle, so points are never joined by lines: 359° and 1° are almost the same direction even though they sit at opposite edges of the chart ' +
      '(the top and bottom edges, both marked N, are the same place).',
  },
  confidence: {
    shows:
      'How sure the model is about the direction in each forecast hour. Bar height is R, the length of the predicted direction vector: 1 means a clear direction, ' +
      'close to 0 means the model cannot tell. Cyan bars passed both reliability checks; grey bars failed at least one (hover a bar to see which, with the exact values).',
    use:
      'Decide which hours of the yaw advice to trust. An hour is acted on only when R reaches the threshold (dashed line) and the wind speed is at least the usable minimum, ' +
      'because direction is unreliable in light or variable wind.',
    read: 'The threshold was chosen on validation data, not on the test data. The evidence behind it is in Model quality, under direction reliability.',
  },
  power: {
    shows:
      'Hourly power the selected turbine would produce at the forecast wind (bars, left axis), taken from the NREL power curve, and the running total of energy ' +
      '(line, right axis). Over a one-hour step, kW and kWh are the same number.',
    use:
      'Estimate how much energy to expect and when it arrives, for planning or for comparing turbines (change the turbine under Turbine and yaw and this updates instantly). ' +
      'The dashed line is the rated power, the most this turbine can produce.',
    read:
      'A gap with no bar is not missing data: it is an hour of zero power, because the forecast wind is below the cut-in speed of the turbine (shaded on the chart), so the ' +
      'energy line stays flat there. The estimate is idealised: it ignores wakes, outages, curtailment, turbulence, icing and air density, so real output is usually lower, ' +
      'and there is no measured generation here to check it against.',
  },
  leadSpeedMae: {
    shows:
      'The typical size of the wind-speed error (mean absolute error, in m/s) for each forecast lead time from 1 to 24 hours ahead, measured on forecasts the models never ' +
      'saw (the held-out test). One line per model.',
    use:
      'Compare models fairly and see how quickly accuracy fades with lead time. Lower is better. A model is only worth using if it stays below the simple baselines ' +
      '(grey persistence, amber seasonal naive).',
    read: 'The faint vertical lines mark the 1, 6, 12 and 24-hour leads that the tables report.',
  },
  leadSpeedRmse: {
    shows:
      'The same comparison as the MAE chart, but errors are squared before averaging (root-mean-square error, m/s), so large misses count more than small ones.',
    use:
      'Reveal whether a model makes occasional big mistakes. A model can have a good typical error and still a poor RMSE if it sometimes misses badly. ' +
      'That matters for energy, because power rises steeply with wind speed.',
    read: 'If RMSE is much larger than MAE for a model, its errors are uneven: mostly small, with some large ones.',
  },
  leadDirection: {
    shows:
      'The average direction error, in degrees, for each lead time, counting only hours when the observed wind was strong enough for direction to matter. ' +
      'The error is circular: 359° versus 1° counts as 2°, not 358°.',
    use:
      'See how far off the predicted direction is on average, and so how much to trust the yaw advice at each lead time.',
    read:
      'A line above the persistence line means the model is no better than assuming the wind direction does not change, so it adds nothing at that lead time.',
  },
  errorByConfidence: {
    shows:
      'The average direction error (degrees) for groups of forecast hours with similar predicted confidence R, on held-out data.',
    use:
      'Check that confidence means something. If the bars fall as R rises, the model\'s own confidence is a trustworthy guide to when its direction can be believed. ' +
      'This is the evidence behind the rule for acting on the yaw advice.',
    read: 'Each bar is an average over many hours; hover for the median and the number of hours in the group.',
  },
  errorBySpeed: {
    shows:
      'The average direction error (degrees) grouped by how strong the wind actually was in that hour, on held-out data.',
    use:
      'Explain why light-wind hours are not acted on. Direction is erratic when the wind is weak, so the same model is much less accurate there. ' +
      'This is what sets the minimum wind speed for yaw advice.',
    read: 'Grouping is by observed speed (what really happened), so it shows the real cost of trusting direction in light wind.',
  },
  curve: {
    shows:
      'The electrical power the selected turbine produces at each wind speed (from the NREL turbine-models package). The green dashed line is the cut-in speed, ' +
      'the red one the cut-out speed, and the grey one the rated power.',
    use:
      'This is the conversion from forecast wind speed to power used for the energy estimate. Below cut-in the turbine produces nothing; power then rises steeply, ' +
      'stays flat at the rated value, and the turbine shuts down at cut-out to protect itself.',
    read: 'The curve is verified before use (checks are listed below it). If the turbine hub is not at 100 m, the wind speed is adjusted for height first.',
  },
  modelVsApi: {
    shows:
      'Two predictions of the wind speed at 100 m for the same 24 hours: the one made by our model (cyan) and the one Open-Meteo had issued the day before ' +
      '(amber dashed). The cyan line is the same forecast shown in the Forecast section.',
    use:
      'See at a glance whether two independent forecasts agree. When the lines sit close together the forecast is more believable; when they pull apart, ' +
      'treat that day with more caution.',
    read:
      'This compares two forecasts with each other. It does not say which one is right: that can only be checked later, against what was actually observed. ' +
      'The Open-Meteo forecast is never an input to our model.',
  },
};
