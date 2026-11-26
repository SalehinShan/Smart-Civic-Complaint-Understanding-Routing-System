import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { CATEGORY_MAP, INITIAL_COMPLAINTS } from './data/seed';
import { Lang } from './data/i18n';
import { CategoryCode, ComplaintRecord } from './types/complaint';
import { submitComplaintToBackend } from './services/api';
import { AppPortal, CitizenHeader, CitizenRoute } from './components/CitizenHeader';
import { SubmitComplaintPage } from './pages/SubmitComplaintPage';
import { SubmissionConfirmationPage } from './pages/SubmissionConfirmationPage';
import { TrackStatusPage } from './pages/TrackStatusPage';
import { HowItWorksPage } from './pages/HowItWorksPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { ModelLabPage } from './pages/ModelLabPage';

function parseHashLocation(): { portal: AppPortal; citizenRoute: CitizenRoute } {
  const hash = window.location.hash.replace(/^#/, '') || '/';
  if (hash.startsWith('/admin')) return { portal: 'admin', citizenRoute: 'submit' };
  if (hash.startsWith('/model-lab')) return { portal: 'model-lab', citizenRoute: 'submit' };
  if (hash.startsWith('/track')) return { portal: 'citizen', citizenRoute: 'track' };
  if (hash.startsWith('/confirmation')) return { portal: 'citizen', citizenRoute: 'confirmation' };
  if (hash.startsWith('/how-it-works')) return { portal: 'citizen', citizenRoute: 'how-it-works' };
  return { portal: 'citizen', citizenRoute: 'submit' };
}

export function App() {
  const initial = parseHashLocation();
  const [portal, setPortal] = useState<AppPortal>(initial.portal);
  const [citizenRoute, setCitizenRoute] = useState<CitizenRoute>(initial.citizenRoute);
  const [lang, setLang] = useState<Lang>('bn');
  const [complaints, setComplaints] = useState<ComplaintRecord[]>(INITIAL_COMPLAINTS);
  const [latestComplaintId, setLatestComplaintId] = useState<string>('cmp-4812');
  const [trackedCode, setTrackedCode] = useState<string>('SC-2026-04812');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    const onHashChange = () => {
      const next = parseHashLocation();
      setPortal(next.portal);
      setCitizenRoute(next.citizenRoute);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const showToast = (msg: string) => {
    setToastMsg(msg);
  };

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 3200);
    return () => clearTimeout(t);
  }, [toastMsg]);

  const navigateCitizen = (route: CitizenRoute) => {
    setPortal('citizen');
    setCitizenRoute(route);
    window.location.hash = route === 'submit' ? '/' : `/${route}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const navigatePortal = (nextPortal: AppPortal) => {
    setPortal(nextPortal);
    if (nextPortal === 'admin') window.location.hash = '/admin';
    else if (nextPortal === 'model-lab') window.location.hash = '/model-lab';
    else window.location.hash = citizenRoute === 'submit' ? '/' : `/${citizenRoute}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmitComplaint = async (payload: {
    text: string;
    inputMode: 'text' | 'voice';
    areaText: string;
    phone?: string;
    photoName?: string;
    audioDurationSec?: number;
    audioUrl?: string;
  }) => {
    const created = await submitComplaintToBackend(payload);
    setComplaints((prev) => [created, ...prev]);
    setLatestComplaintId(created.id);
    setTrackedCode(created.trackingCode);
    navigateCitizen('confirmation');
  };

  const handleCitizenCorrectCategory = (complaintId: string, newCategory: CategoryCode) => {
    const meta = CATEGORY_MAP[newCategory];
    setComplaints((prev) =>
      prev.map((c) =>
        c.id === complaintId
          ? {
              ...c,
              category: newCategory,
              categorySource: 'citizen',
              citizenCorrected: true,
              departmentEn: meta.departmentEn,
              departmentBn: meta.departmentBn,
            }
          : c,
      ),
    );
  };

  const handleAdminConfirmRoute = (complaintId: string, finalCategory: CategoryCode) => {
    const meta = CATEGORY_MAP[finalCategory];
    setComplaints((prev) =>
      prev.map((c) => {
        if (c.id !== complaintId) return c;
        return {
          ...c,
          category: finalCategory,
          categorySource: 'admin',
          needsReview: false,
          status: 'assigned',
          departmentEn: meta.departmentEn,
          departmentBn: meta.departmentBn,
          timeline: c.timeline.map((step) =>
            step.id === 't2'
              ? {
                  ...step,
                  completed: true,
                  current: true,
                  detail: `Confirmed & routed to ${meta.departmentEn}`,
                }
              : step,
          ),
        };
      }),
    );
  };

  const handleAddNote = (complaintId: string, note: string, isPublic: boolean) => {
    setComplaints((prev) =>
      prev.map((c) => {
        if (c.id !== complaintId) return c;
        return {
          ...c,
          departmentNote: isPublic ? `Department note: ${note}` : c.departmentNote,
          internalNotes: [...c.internalNotes, note],
        };
      }),
    );
  };

  const handleEscalate = (complaintId: string, reason: string) => {
    setComplaints((prev) =>
      prev.map((c) =>
        c.id === complaintId
          ? {
              ...c,
              status: 'escalated',
              departmentNote: `Escalated to Ward Councillor's office: ${reason}`,
            }
          : c,
      ),
    );
  };

  const latestComplaint =
    complaints.find((c) => c.id === latestComplaintId) || complaints[0];

  return (
    <>
      {portal === 'citizen' && (
        <>
          <CitizenHeader
            lang={lang}
            onToggleLang={() => setLang((l) => (l === 'bn' ? 'en' : 'bn'))}
            activeRoute={citizenRoute}
            onNavigateCitizen={navigateCitizen}
            onNavigatePortal={navigatePortal}
          />

          {citizenRoute === 'submit' && (
            <SubmitComplaintPage
              lang={lang}
              onSubmitComplaint={handleSubmitComplaint}
              onGoTrack={() => navigateCitizen('track')}
            />
          )}

          {citizenRoute === 'confirmation' && latestComplaint && (
            <SubmissionConfirmationPage
              lang={lang}
              complaint={latestComplaint}
              onCorrectCategory={handleCitizenCorrectCategory}
              onViewStatus={(code) => {
                setTrackedCode(code);
                navigateCitizen('track');
              }}
              onFileAnother={() => navigateCitizen('submit')}
              onToast={showToast}
            />
          )}

          {citizenRoute === 'track' && (
            <TrackStatusPage
              lang={lang}
              complaints={complaints}
              initialTrackingCode={trackedCode}
              onEscalate={handleEscalate}
              onToast={showToast}
            />
          )}

          {citizenRoute === 'how-it-works' && (
            <HowItWorksPage
              onStartComplaint={() => navigateCitizen('submit')}
              onOpenModelLab={() => navigatePortal('model-lab')}
            />
          )}
        </>
      )}

      {portal === 'admin' && (
        <AdminDashboardPage
          complaints={complaints}
          onConfirmAndRoute={handleAdminConfirmRoute}
          onAddNote={handleAddNote}
          onNavigatePortal={navigatePortal}
          onToast={showToast}
        />
      )}

      {portal === 'model-lab' && (
        <ModelLabPage onNavigatePortal={navigatePortal} onToast={showToast} />
      )}

      {toastMsg && (
        <div className="toast-banner" role="status" aria-live="polite">
          <CheckCircle2 size={16} aria-hidden="true" />
          <span>{toastMsg}</span>
        </div>
      )}
    </>
  );
}

export default App;
