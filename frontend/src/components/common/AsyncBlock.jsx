import PropTypes from 'prop-types';
import EmptyState from './EmptyState.jsx';
import ErrorBanner from './ErrorBanner.jsx';
import Skeleton from './Skeleton.jsx';

/** Standard loading / not-found / error handling around a useApi() result. `children(data)` renders the loaded state. */
export default function AsyncBlock({ state, height = 160, emptyTitle = 'Nothing to show yet', children }) {
  const { data, error, loading } = state;
  if (loading && !data) return <div className="card"><Skeleton height={height} /></div>;
  if (error?.status === 404) return <div className="card"><EmptyState title={emptyTitle}>{error.hint || error.detail}</EmptyState></div>;
  if (error) return <ErrorBanner error={error} />;
  if (!data) return null;
  return children(data);
}
AsyncBlock.propTypes = {
  state: PropTypes.shape({ data: PropTypes.any, error: PropTypes.object, loading: PropTypes.bool }).isRequired,
  height: PropTypes.number, emptyTitle: PropTypes.string, children: PropTypes.func.isRequired,
};
