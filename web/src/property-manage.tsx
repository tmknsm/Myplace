import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { api, type PageRefresh, type PropertyPage, type Viewer } from "./api";
import { useAuth } from "./auth";
import { useMeta } from "./meta";
import { DocumentsSection, HandoffSection, MaintainersSection, NotificationsSection } from "./property-owner";
import { DOCUMENT_TYPE_LABEL, useToast, type Toast } from "./property-shared";

/**
 * Owner tools live on their own pages, reached from the account screen's
 * property list rather than from the public profile: the vault, maintainers,
 * and handoff at /property/:id/manage, and notification preferences one level
 * deeper behind the bell.
 */

type PageData = { property: PropertyPage; viewer: Viewer };

function useOwnerRecord(id: string | undefined) {
  const { user, ready } = useAuth();
  const [data, setData] = useState<PageData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setData(await api.property(id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load property");
    }
  }, [id]);

  const refresh = useCallback<PageRefresh>(async (patch) => {
    if (patch) {
      setData((current) => current ? { ...current, property: patch(current.property) } : current);
    }
    await load();
  }, [load]);

  useEffect(() => { setData(null); }, [id]);
  useEffect(() => { if (ready && user) void load(); }, [load, ready, user?.user_id]);

  return { data, error, refresh, user, ready };
}

function useOwnerTitle(data: PageData | null, suffix: string) {
  const title = data?.property.formatted?.split(",")[0] ?? "Untitled parcel";
  useEffect(() => {
    if (!data) return;
    const previous = document.title;
    document.title = `${suffix} · ${title} · Myplace`;
    return () => { document.title = previous; };
  }, [data, title, suffix]);
  return title;
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15L6 16.5Z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </svg>
  );
}

/**
 * Shared frame for the owner pages: sign-in and maintainer gates, the loading
 * and error states, and the header with the address. Children only render
 * once the viewer is confirmed as a maintainer.
 */
function OwnerPage({
  id,
  kicker,
  suffix,
  back,
  aside,
  footer,
  children,
}: {
  id: string | undefined;
  kicker: string;
  suffix: string;
  back?: { to: string; label: string };
  aside?: ReactNode;
  footer?: ReactNode;
  children: (data: PageData, refresh: PageRefresh, toast: Toast) => ReactNode;
}) {
  const { data, error, refresh, user, ready } = useOwnerRecord(id);
  const [toast, showToast] = useToast();
  const title = useOwnerTitle(data, suffix);

  if (!id) return <Navigate to="/account" replace />;
  if (!ready) return <div className="page">Loading…</div>;
  if (!user) return <Navigate to={`/signin?next=/property/${id}/manage`} replace />;
  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!data) return <div className="page">Loading record…</div>;

  const { property, viewer } = data;
  const owner = Boolean(viewer.maintainer && !viewer.openClaim);
  if (!owner) return <Navigate to={`/property/${id}`} replace />;

  const locality = property.formatted?.includes(",")
    ? property.formatted.slice(property.formatted.indexOf(",") + 1).trim()
    : null;

  return (
    <div className="page manage-page" data-testid="owner-tools">
      <div className="manage-body">
        <header className="manage-head">
          <div className="manage-title">
            {back && <Link className="back-link" to={back.to}>‹ {back.label}</Link>}
            <div className="kicker">{kicker}</div>
            <h1 className="display">{title}</h1>
            {locality && <p className="meta-line">{locality}</p>}
          </div>
          {aside}
        </header>
        {toast && <div className="toast" role="status">{toast}</div>}
        {children(data, refresh, showToast)}
      </div>
      {footer}
    </div>
  );
}

export function PropertyManagePage() {
  const { id } = useParams();
  const { user } = useAuth();
  const meta = useMeta();
  return (
    <OwnerPage
      id={id}
      kicker="Owner tools"
      suffix="Owner tools"
      aside={(
        <Link
          className="icon-btn"
          to={`/property/${id}/manage/notifications`}
          aria-label="Notification settings"
          title="Notifications"
          data-testid="notifications-link"
        >
          <BellIcon />
        </Link>
      )}
      footer={(
        <div className="manage-cta">
          <Link className="btn" to={`/property/${id}`} data-testid="view-property">View property</Link>
        </div>
      )}
    >
      {({ property, viewer }, refresh, toast) => (
        <>
          <p className="meta-line manage-lede">Your vault, the people who maintain this record with you, and what happens when it changes hands.</p>
          <DocumentsSection
            propertyId={id!}
            documents={property.documents.filter((doc) => !doc.improvement_id)}
            documentTypes={meta?.documentTypes ?? Object.keys(DOCUMENT_TYPE_LABEL)}
            onChange={refresh}
            toast={toast}
          />
          <MaintainersSection
            propertyId={id!}
            maintainers={property.maintainers}
            invitations={property.invitations}
            viewer={viewer}
            currentUserId={user?.user_id ?? null}
            onChange={refresh}
            toast={toast}
          />
          <HandoffSection propertyId={id!} toast={toast} onChange={refresh} />
        </>
      )}
    </OwnerPage>
  );
}

export function PropertyNotificationsPage() {
  const { id } = useParams();
  const meta = useMeta();
  return (
    <OwnerPage
      id={id}
      kicker="Notifications"
      suffix="Notifications"
      back={{ to: `/property/${id}/manage`, label: "Owner tools" }}
    >
      {({ viewer }, _refresh, toast) => viewer.preferences ? (
        <NotificationsSection
          propertyId={id!}
          preferences={viewer.preferences}
          options={meta?.preferenceOptions ?? {}}
          toast={toast}
        />
      ) : (
        <section className="section">
          <div className="group empty-card">Notification preferences are not available for this record.</div>
        </section>
      )}
    </OwnerPage>
  );
}
