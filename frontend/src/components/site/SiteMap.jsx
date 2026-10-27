import { useEffect } from 'react';
import PropTypes from 'prop-types';
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';

const DEFAULT_CENTER = [23.0225, 72.5714];

/** Leaflet lets you scroll past the date line; wrap longitude back into [-180, 180]. */
export const wrapLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

function ClickToPick({ onPick, disabled }) {
  useMapEvents({
    click(e) {
      if (!disabled) onPick(e.latlng.lat, wrapLon(e.latlng.lng));
    },
  });
  return null;
}
ClickToPick.propTypes = { onPick: PropTypes.func.isRequired, disabled: PropTypes.bool };

function Recenter({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.flyTo(position, map.getZoom(), { duration: 0.6 });
    // only re-centre when the point changes, not on every zoom
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position?.[0], position?.[1]]);
  return null;
}
Recenter.propTypes = { position: PropTypes.arrayOf(PropTypes.number) };

/** Interactive site map: click to set coordinates. The marker only shows the entered point; it does not prove a turbine exists there. */
export default function SiteMap({ lat, lon, onPick, disabled = false }) {
  const valid = Number.isFinite(lat) && Number.isFinite(lon);
  const position = valid ? [lat, lon] : null;
  return (
    <div className="map-wrap">
      <MapContainer center={position || DEFAULT_CENTER} zoom={9} scrollWheelZoom worldCopyJump aria-label="Site map">
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {position && <CircleMarker center={position} radius={8} className="site-marker" />}
        <ClickToPick onPick={onPick} disabled={disabled} />
        <Recenter position={position} />
      </MapContainer>
      <div className="map-hint">{disabled ? 'Locked while a job is running' : 'Click the map to set coordinates'}</div>
    </div>
  );
}
SiteMap.propTypes = { lat: PropTypes.number, lon: PropTypes.number, onPick: PropTypes.func.isRequired, disabled: PropTypes.bool };
