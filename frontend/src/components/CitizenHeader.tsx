import { FlaskConical, ShieldCheck } from 'lucide-react';
import { copy, Lang } from '../data/i18n';

export type CitizenRoute = 'submit' | 'confirmation' | 'track' | 'how-it-works';
export type AppPortal = 'citizen' | 'admin' | 'model-lab';

interface CitizenHeaderProps {
  lang: Lang;
  onToggleLang: () => void;
  activeRoute: CitizenRoute;
  onNavigateCitizen: (route: CitizenRoute) => void;
  onNavigatePortal: (portal: AppPortal) => void;
}

export function CitizenHeader({
  lang,
  onToggleLang,
  activeRoute,
  onNavigateCitizen,
  onNavigatePortal,
}: CitizenHeaderProps) {
  const t = copy[lang];

  return (
    <header className="citizen-header">
      <div className="citizen-header-inner">
        <div className="brand-lockup">
          <button
            type="button"
            className="brand-name"
            onClick={() => onNavigateCitizen('submit')}
            style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }}
          >
            {t.brand}
          </button>

          <nav aria-label="Primary">
            <ul className="citizen-nav-list">
              <li>
                <button
                  type="button"
                  className="citizen-nav-btn"
                  aria-current={
                    activeRoute === 'submit' || activeRoute === 'confirmation'
                      ? 'page'
                      : undefined
                  }
                  onClick={() => onNavigateCitizen('submit')}
                >
                  {t.navSubmit}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="citizen-nav-btn"
                  aria-current={activeRoute === 'track' ? 'page' : undefined}
                  onClick={() => onNavigateCitizen('track')}
                >
                  {t.navTrack}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="citizen-nav-btn"
                  aria-current={activeRoute === 'how-it-works' ? 'page' : undefined}
                  onClick={() => onNavigateCitizen('how-it-works')}
                >
                  {t.navHowItWorks}
                </button>
              </li>
            </ul>
          </nav>
        </div>

        <div className="header-actions">
          <button
            type="button"
            className="admin-shortcut"
            onClick={() => onNavigatePortal('admin')}
            title="Open Admin Review Queue"
          >
            <ShieldCheck size={14} aria-hidden="true" />
            {t.navAdmin}
          </button>
          <button
            type="button"
            className="admin-shortcut"
            onClick={() => onNavigatePortal('model-lab')}
            title="Open CSE299 Model Lab"
          >
            <FlaskConical size={14} aria-hidden="true" />
            {t.navModelLab}
          </button>
          <button
            type="button"
            className="lang-toggle"
            onClick={onToggleLang}
            aria-label={lang === 'bn' ? 'Switch interface to English' : 'বাংলা ইন্টারফেসে যান'}
          >
            {t.langToggle}
          </button>
        </div>
      </div>
    </header>
  );
}
