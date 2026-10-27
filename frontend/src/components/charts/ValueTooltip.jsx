import PropTypes from 'prop-types';

/** Tooltip for charts whose x value is not a time (lead hours, bins, wind speed). `title(label)` builds the heading. */
export default function ValueTooltip({ active, payload, label, title, format, extra }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value !== null && p.value !== undefined);
  if (!rows.length) return null;
  return (
    <div className="tip">
      <div className="tip-title mono">{title ? title(label, payload[0].payload) : label}</div>
      {rows.map((p) => (
        <div key={p.dataKey ?? p.name} className="tip-row">
          <span>
            <i style={{ background: p.color || p.stroke || p.fill }} aria-hidden="true" />
            {p.name}
          </span>
          <span className="mono">{format ? format(p.value, p) : p.value}</span>
        </div>
      ))}
      {extra && <div className="tip-title" style={{ marginTop: 4 }}>{extra(payload[0].payload)}</div>}
    </div>
  );
}
ValueTooltip.propTypes = {
  active: PropTypes.bool, payload: PropTypes.array, label: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  title: PropTypes.func, format: PropTypes.func, extra: PropTypes.func,
};
