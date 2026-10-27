import { SiteProvider } from './state/SiteContext.jsx';
import { useTheme } from './hooks/useTheme.js';
import TopBar from './components/layout/TopBar.jsx';
import Footer from './components/layout/Footer.jsx';
import Dashboard from './pages/Dashboard.jsx';
import TurbinePage from './pages/TurbinePage.jsx';
import { useRoute } from './hooks/useRoute.js';

export default function App() {
  const { theme, toggle } = useTheme();
  const route = useRoute();
  return (
    <SiteProvider>
      <div className="wrap">
        <TopBar theme={theme} onToggleTheme={toggle} route={route} />
        <main>
          {route === 'turbine' ? <TurbinePage /> : <Dashboard />}
        </main>
        <Footer />
      </div>
    </SiteProvider>
  );
}
