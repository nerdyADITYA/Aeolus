export const SECTIONS = [
  ['site', 'Site'],
  ['data-turbine', 'Data and turbine'],
  ['forecast', 'Forecast'],
  ['model-quality', 'Model quality'],
  ['open-meteo-comparison', 'Model vs Open-Meteo'],
  ['assumptions', 'Assumptions'],
];

/** Jump links for the long single page. Only shown once the site is ready (before that there is just the site section). */
export default function SectionNav() {
  return (
    <nav className="section-nav" aria-label="Page sections">
      {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
    </nav>
  );
}
