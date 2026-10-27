import PropTypes from 'prop-types';

export default function Section({ title, id, children }) {
  return (
    <section className="section" aria-label={title} id={id} style={{ scrollMarginTop: 72 }}>
      <h2 className="section-title">{title}</h2>
      {children}
    </section>
  );
}
Section.propTypes = { title: PropTypes.string.isRequired, id: PropTypes.string, children: PropTypes.node };
