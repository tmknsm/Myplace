import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { api, type InboxItem, type PageRefresh, type PropertyPage, type Viewer } from "./api";
import { useAuth } from "./auth";
import { PageSpinner, Spinner } from "./components";
import { useMeta } from "./meta";
import { DocumentsSection, HandoffSection, MaintainersSection, NotificationsSection } from "./property-owner";
import { propertyHeading } from "../../shared/profile";
import { DOCUMENT_TYPE_LABEL, dateLabel, useToast, type Toast } from "./property-shared";

/**
 * Owner tools live on their own pages, reached from the settings button
 * beside Share on a house you maintain: the vault, maintainers, email
 * preferences, and handoff at /property/:id/manage. The bell opens the
 * inbox of neighbor requests, change requests, and notices for that property.
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
  const { title } = propertyHeading(data?.property ?? { formatted: null, municipality: null });
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
  aside?: (data: PageData) => ReactNode;
  footer?: ReactNode;
  children: (data: PageData, refresh: PageRefresh, toast: Toast) => ReactNode;
}) {
  const location = useLocation();
  const { data, error, refresh, user, ready } = useOwnerRecord(id);
  const [toast, showToast] = useToast();
  const title = useOwnerTitle(data, suffix);

  if (!id) return <Navigate to="/account" replace />;
  if (!ready) return <PageSpinner />;
  if (!user) return <Navigate to={`/signin?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!data) return <PageSpinner label="Loading record" />;

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
          {aside?.(data)}
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
      aside={(data) => {
        const count = data.viewer.inboxCount ?? 0;
        return (
          <Link
            className="icon-btn"
            to={`/property/${id}/manage/inbox`}
            aria-label={count ? `Inbox, ${count} waiting` : "Inbox"}
            title="Inbox"
            data-testid="inbox-link"
          >
            <BellIcon />
            {count > 0 && <span className="icon-badge" data-testid="inbox-count">{count > 9 ? "9+" : count}</span>}
          </Link>
        );
      }}
      footer={(
        <div className="manage-cta">
          <Link className="btn" to={`/property/${id}`} data-testid="view-property">View property</Link>
        </div>
      )}
    >
      {({ property, viewer }, refresh, toast) => (
        <>
          <p className="meta-line manage-lede">The private half: the vault, who else can edit, how you're notified, and what happens at closing.</p>
          <DocumentsSection
            propertyId={id!}
            documents={property.documents.filter((doc) => !doc.improvement_id && !doc.room_id && !doc.topic_id && !doc.post_id)}
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
          {viewer.preferences && (
            <NotificationsSection
              propertyId={id!}
              preferences={viewer.preferences}
              options={meta?.preferenceOptions ?? {}}
              toast={toast}
            />
          )}
          <HandoffSection propertyId={id!} toast={toast} onChange={refresh} />
        </>
      )}
    </OwnerPage>
  );
}

const KIND_LABEL: Record<InboxItem["kind"], string> = {
  contribution_request: "Request",
  dispute: "Dispute",
  notice: "Notice",
  neighbor_request: "Neighbor",
};

export function PropertyInboxPage() {
  const { id } = useParams();
  return (
    <OwnerPage
      id={id}
      kicker="Inbox"
      suffix="Inbox"
      back={{ to: `/property/${id}/manage`, label: "Owner tools" }}
    >
      {(_data, refresh, toast) => (
        <InboxList propertyId={id!} onChange={refresh} toast={toast} />
      )}
    </OwnerPage>
  );
}

function InboxList({ propertyId, onChange, toast }: { propertyId: string; onChange: PageRefresh; toast: Toast }) {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.inbox(propertyId);
      setItems(data.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load inbox");
    }
  }, [propertyId]);

  useEffect(() => { void load(); }, [load]);

  const act = async (item: InboxItem, action: InboxItem["actions"][number]) => {
    if (action === "view") return;
    setBusy(`${item.id}:${action}`);
    try {
      if (item.kind === "neighbor_request" && item.neighborRequestId) {
        if (action === "accept") {
          await api.reviewNeighbor(item.neighborRequestId, "accepted");
          toast("You're neighbors.");
        } else if (action === "decline") {
          await api.reviewNeighbor(item.neighborRequestId, "declined");
          toast("Neighbor request declined.");
        }
      } else if (item.contributionId) {
        if (action === "accept") {
          await api.reviewContribution(item.contributionId, "accepted");
          toast(item.fieldLabel ? `${item.fieldLabel} updated from the request.` : "Request accepted.");
        } else if (action === "decline") {
          await api.reviewContribution(item.contributionId, "rejected");
          toast("Request declined.");
        } else if (action === "withdraw") {
          await api.withdrawContribution(item.contributionId);
          toast("Dispute withdrawn.");
        }
      }
      await load();
      await onChange();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not update that item.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="section" id="inbox" data-testid="owner-inbox">
      <h2>Messages</h2>
      <p className="meta-line section-note">
        Neighbor requests, proposed changes, disputes you've filed, and notices from official sources. Accepting a change writes it to the owner layer.
      </p>
      {error && <p className="error">{error}</p>}
      {items === null && !error && (
        <div className="group empty-card" role="status" aria-label="Loading messages">
          <Spinner />
        </div>
      )}
      {items && items.length === 0 && (
        <div className="group empty-card" data-testid="inbox-empty">
          Nothing waiting. Neighbor requests, changes, disputes and county updates land here.
        </div>
      )}
      {items && items.length > 0 && (
        <div className="group">
          {items.map((item) => (
            <div key={item.id} className="row inbox-row" data-testid={`inbox-${item.kind}`}>
              <div className="inbox-row-copy">
                <div className="inbox-title">
                  <strong>{item.title}</strong>
                  <span className={`badge ${item.kind === "contribution_request" || item.kind === "neighbor_request" ? "pending" : item.kind === "dispute" ? "disputed" : ""}`}>
                    {KIND_LABEL[item.kind]}
                  </span>
                </div>
                <div className="meta-line">{item.body}</div>
                <div className="meta-line">{dateLabel(item.createdAt)}</div>
                <div className="inbox-actions">
                  {item.actions.includes("accept") && (
                    <button
                      type="button"
                      className="btn small"
                      disabled={busy !== null}
                      data-testid="inbox-accept"
                      onClick={() => void act(item, "accept")}
                    >
                      {busy === `${item.id}:accept` ? "Saving…" : item.kind === "neighbor_request" ? "Approve" : "Accept"}
                    </button>
                  )}
                  {item.actions.includes("decline") && (
                    <button
                      type="button"
                      className="btn secondary small"
                      disabled={busy !== null}
                      data-testid="inbox-decline"
                      onClick={() => void act(item, "decline")}
                    >
                      {busy === `${item.id}:decline` ? "Saving…" : "Decline"}
                    </button>
                  )}
                  {item.actions.includes("withdraw") && (
                    <button
                      type="button"
                      className="text-link"
                      disabled={busy !== null}
                      onClick={() => void act(item, "withdraw")}
                    >
                      Withdraw
                    </button>
                  )}
                  {item.actions.includes("view") && (
                    <Link className="text-link" to={item.fromPropertyId ? `/property/${item.fromPropertyId}` : `/property/${propertyId}`}>View</Link>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function NotificationsRedirect() {
  const { id } = useParams();
  return <Navigate to={`/property/${id}/manage/inbox`} replace />;
}
