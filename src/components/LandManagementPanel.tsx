import { Icon } from './Icon';

interface LandManagementPanelProps {
  soilTeaser: string;
  onOpenSoilTests(): void;
  plansTeaser: string;
  onOpenPlans(): void;
  onClose(): void;
}

// Land Management: the tools for working the ground (soil tests and plans for
// sections and areas, more to come). Each tool is a card like the ones on the sidebar.
export function LandManagementPanel(props: LandManagementPanelProps) {
  return (
    <div className="forecast land-panel">
      <div className="forecast-header">
        <button className="back" onClick={props.onClose}>
          ‹ Back
        </button>
        <h2>Land Management</h2>
      </div>

      <section className="sidebar-section">
        <p className="hint">Tools for taking care of the ground: fields, food plots and the work they need.</p>

        <button className="forecast-card summary-card" onClick={props.onOpenSoilTests}>
          <span className="forecast-card-icon" aria-hidden>
            <Icon name="wheat" size={20} />
          </span>
          <span className="forecast-card-text">
            <span className="row-title">Soil Tests</span>
            <span className="row-detail">{props.soilTeaser}</span>
          </span>
          <span className="chevron" aria-hidden>
            ›
          </span>
        </button>

        <button className="forecast-card summary-card" onClick={props.onOpenPlans}>
          <span className="forecast-card-icon" aria-hidden>
            <Icon name="clipboard" size={20} />
          </span>
          <span className="forecast-card-text">
            <span className="row-title">Area Plans</span>
            <span className="row-detail">{props.plansTeaser}</span>
          </span>
          <span className="chevron" aria-hidden>
            ›
          </span>
        </button>
      </section>
    </div>
  );
}
