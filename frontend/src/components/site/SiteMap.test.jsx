import { render } from '@testing-library/react';
import SiteMap, { wrapLon } from './SiteMap.jsx';

let clickHandler;
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  CircleMarker: ({ center }) => <i data-testid="marker" data-center={center.join(',')} />,
  useMap: () => ({ flyTo: vi.fn(), getZoom: () => 9 }),
  useMapEvents: (h) => {
    clickHandler = h.click;
    return null;
  },
}));

describe('SiteMap', () => {
  it('reports clicks as lat/lon and wraps longitude into range', () => {
    const onPick = vi.fn();
    render(<SiteMap lat={23} lon={72} onPick={onPick} />);
    clickHandler({ latlng: { lat: 10.5, lng: 190 } });
    expect(onPick).toHaveBeenCalledWith(10.5, -170);
  });
  it('ignores clicks while disabled and shows no marker without valid coordinates', () => {
    const onPick = vi.fn();
    const { queryByTestId, getByText } = render(<SiteMap onPick={onPick} disabled />);
    clickHandler({ latlng: { lat: 1, lng: 1 } });
    expect(onPick).not.toHaveBeenCalled();
    expect(queryByTestId('marker')).toBeNull();
    expect(getByText(/Locked while a job is running/)).toBeInTheDocument();
  });
  it('draws the marker at the entered point', () => {
    const { getByTestId } = render(<SiteMap lat={23.0225} lon={72.5714} onPick={() => {}} />);
    expect(getByTestId('marker').dataset.center).toBe('23.0225,72.5714');
  });
  it('wrapLon handles both directions', () => {
    expect([wrapLon(190), wrapLon(-190), wrapLon(0), wrapLon(540)]).toEqual([-170, 170, 0, -180]);
  });
});
