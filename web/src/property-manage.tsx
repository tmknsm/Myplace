import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { api, type InboxItem, type PageRefresh } from "./api";
import { useAuth } from "./auth";
import { PageSpinner, Spinner } from "./components";
import { useMeta } from "./meta";
import { loadMyProperties, markNotificationsSeen, useMyHome } from "./my-properties";
import { DocumentsSection, HandoffSection, MaintainersSection, ManageSection, NotificationsSection, VisibilitySection } from "./property-owner";
import { propertyHeading } from "../../shared/profile";
import { DOCUMENT_TYPE_LABEL, dateLabel, useToast, type Toast } from "./property-shared";
import { liveRefresh, peekProperty, type PageData } from "./page-data";

/**
 * Owner tools live on their own page, reached from the settings button
 * beside Share on a house you maintain: how the house shows you, the switch
 * that takes it off Myplace, the vault, maintainers, email preferences, and
 * handoff at /property/:id/manage. The full notifications list for one house
 * is at /property/:id/manage/inbox, behind View all on the account page.
 */

function useOwnerRecord(id: string | undefined) {
  const { user, ready } = useAuth();
  const [data, setData] = useState<PageData | null>(() => peekProperty(id));
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

  const refresh = useCallback<PageRefresh>(liveRefresh(id, setData, load), [id, load]);

  useEffect(() => { setData(peekProperty(id)); }, [id]);
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
  footer,
  children,
}: {
  id: string | undefined;
  kicker: string;
  suffix: string;
  back?: { to: string; label: string };
  footer?: (data: PageData) => ReactNode;
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
        </header>
        {toast && <div className="toast" role="status">{toast}</div>}
        {children(data, refresh, showToast)}
      </div>
      {footer?.(data)}
    </div>
  );
}

export function PropertyManagePage() {
  const { id } = useParams();
  const { user } = useAuth();
  const meta = useMeta();
  const home = useMyHome(id);
  return (
    <OwnerPage
      id={id}
      kicker="Owner tools"
      suffix="Owner tools"
      footer={({ property }) => (
        <div className="manage-cta">
          {property.removed ? (
            <Link className="btn" to="/account" data-testid="view-property">Back to account</Link>
          ) : (
            <Link className="btn" to={`/property/${id}`} data-testid="view-property">View property</Link>
          )}
        </div>
      )}
    >
      {({ property, viewer }, refresh, toast) => (
        <>
          <p className="meta-line manage-lede">The private half: how this page shows you, whether it is on Myplace, the vault, who else can edit, how you're notified, and what happens at closing.</p>
          <VisibilitySection home={home} onChange={refresh} toast={toast} />
          <ManageSection home={home} onChange={refresh} toast={toast} />
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

/** Every notification for one house. View all on the account page lands here. */
export function PropertyInboxPage() {
  const { id } = useParams();
  return (
    <OwnerPage
      id={id}
      kicker="Notifications"
      suffix="Notifications"
      back={{ to: "/account", label: "Account" }}
    >
      {(_data, refresh, toast) => (
        <InboxFeed propertyId={id!} onChange={refresh} toast={toast} />
      )}
    </OwnerPage>
  );
}

function InboxFeed({ propertyId, onChange, toast }: { propertyId: string; onChange: PageRefresh; toast: Toast }) {
  const inbox = useInbox(propertyId, onChange, toast);
  useEffect(() => {
    if (inbox.items) markNotificationsSeen(propertyId);
  }, [propertyId, inbox.items]);
  return (
    <section className="section" id="inbox" data-testid="owner-inbox">
      {inbox.error && <p className="error">{inbox.error}</p>}
      {inbox.items === null && !inbox.error && (
        <div className="group empty-card" role="status" aria-label="Loading notifications">
          <Spinner />
        </div>
      )}
      {inbox.items && inbox.items.length === 0 && (
        <div className="group" data-testid="inbox-empty"><div className="row"><span className="meta-line">None yet</span></div></div>
      )}
      {inbox.items && inbox.items.length > 0 && (
        <InboxRows propertyId={propertyId} items={inbox.items} busy={inbox.busy} onAct={inbox.act} />
      )}
    </section>
  );
}

/**
 * The house's notifications and the actions on them. Acting reloads the list,
 * the page record it came from, and the account's house list (the badge).
 */
export function useInbox(propertyId: string | null, onChange: PageRefresh | undefined, toast: Toast) {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!propertyId) return;
    try {
      const data = await api.inbox(propertyId);
      setItems(data.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load notifications");
    }
  }, [propertyId]);

  useEffect(() => {
    setItems(null);
    setError(null);
    void load();
  }, [load]);

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
      await Promise.all([onChange?.(), loadMyProperties(true).catch(() => {})]);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not update that item.");
    } finally {
      setBusy(null);
    }
  };

  return { items, error, busy, act, reload: load };
}

export function InboxRows({
  propertyId,
  items,
  busy,
  onAct,
}: {
  propertyId: string;
  items: InboxItem[];
  busy: string | null;
  onAct: (item: InboxItem, action: InboxItem["actions"][number]) => void | Promise<void>;
}) {
  return (
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
                  onClick={() => void onAct(item, "accept")}
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
                  onClick={() => void onAct(item, "decline")}
                >
                  {busy === `${item.id}:decline` ? "Saving…" : "Decline"}
                </button>
              )}
              {item.actions.includes("withdraw") && (
                <button
                  type="button"
                  className="text-link"
                  disabled={busy !== null}
                  onClick={() => void onAct(item, "withdraw")}
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
  );
}

export function NotificationsRedirect() {
  const { id } = useParams();
  return <Navigate to={`/property/${id}/manage/inbox`} replace />;
}
