import { useSite } from '../state/SiteContext.jsx';
import Section from '../components/layout/Section.jsx';
import ErrorBanner from '../components/common/ErrorBanner.jsx';
import Skeleton from '../components/common/Skeleton.jsx';
import SitePanel from '../components/site/SitePanel.jsx';
import JobProgress from '../components/site/JobProgress.jsx';
import SiteSummary from '../components/site/SiteSummary.jsx';
import ForecastControls from '../components/site/ForecastControls.jsx';
import YawSettings from '../components/site/YawSettings.jsx';
import ForecastView from '../components/forecast/ForecastView.jsx';
import ModelQuality from '../components/models/ModelQuality.jsx';
import ApiComparison from '../components/comparison/ApiComparison.jsx';
import DataQuality from '../components/data/DataQuality.jsx';
import TurbinePanel from '../components/turbine/TurbinePanel.jsx';
import AssumptionsPanel from '../components/layout/AssumptionsPanel.jsx';
import SectionNav from '../components/layout/SectionNav.jsx';
import { ReportsProvider } from '../state/ReportsContext.jsx';

export default function Dashboard() {
  const { site, error, loading, reload, jobId } = useSite();
  const ready = site?.status === 'ready';
  if (error) {
    return (
      <div className="stack" style={{ marginTop: 24 }}>
        <ErrorBanner error={error} />
        <div><button type="button" className="btn" onClick={reload}>Retry</button></div>
      </div>
    );
  }
  return (
    <>
      {ready && <SectionNav />}
      <Section title="Site" id="site">
        {loading && !site ? <div className="card"><Skeleton height={360} /></div> : <SitePanel />}
      </Section>

      {(jobId || site?.configured) && (
        <div className="grid g-2" style={{ marginTop: 16 }}>
          <div className="stack">
            <JobProgress />
            <SiteSummary />
          </div>
          {ready && <YawSettings />}
        </div>
      )}

      {ready && (
        <ReportsProvider>
          <Section title="Data and turbine" id="data-turbine">
            <div className="grid g-2" style={{ alignItems: 'start' }}>
              <DataQuality />
              <TurbinePanel />
            </div>
          </Section>
          <Section title="Forecast" id="forecast">
            <div className="stack" style={{ gap: 16 }}>
              <ForecastControls />
              <ForecastView />
            </div>
          </Section>
          <Section title="Model quality" id="model-quality"><ModelQuality /></Section>
          <Section title="Model vs Open-Meteo" id="open-meteo-comparison"><ApiComparison /></Section>
          <Section title="Assumptions and limitations" id="assumptions"><AssumptionsPanel /></Section>
        </ReportsProvider>
      )}
    </>
  );
}
