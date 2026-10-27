import { SiteProvider } from './state/SiteContext.jsx';
import { useTheme } from './hooks/useTheme.js';
import TopBar from './components/layout/TopBar.jsx';
import Footer from './components/layout/Footer.jsx';
import Dashboard from './pages/Dashboard.jsx';

export default function App() {
  const { theme, toggle } = useTheme();
  return (
    <SiteProvider>
      <div className="wrap">
        <TopBar theme={theme} onToggleTheme={toggle} />
        <main>
          <Dashboard />
        </main>
        <Footer />
      </div>
    </SiteProvider>
  );
}
