import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Feed, type FeedScope } from "./api";
import { useAuth } from "./auth";
import { SearchBox, Spinner } from "./components";
import { PostCard } from "./property";
import { useToast } from "./property-shared";
import { cacheGet, cacheSet, queryKeys } from "./query-cache";
import { useRetractingChrome } from "./retracting-chrome";

function parseTab(raw: string | null): FeedScope {
  return raw === "neighbors" ? "neighbors" : "all";
}

function peekFeed(scope: FeedScope): Feed | null {
  return cacheGet<Feed>(queryKeys.feed(scope)) ?? null;
}

/**
 * The signed-in landing page. All is everyone on the network. Neighbors is
 * the houses next to yours, plus your own. Each post links back to its house.
 */
export function FeedPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const scope = parseTab(params.get("tab"));
  const [feed, setFeed] = useState<Feed | null>(() => peekFeed(scope));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(() => !peekFeed(scope));
  const [loadingMore, setLoadingMore] = useState(false);
  const [toast, showToast] = useToast();
  // Reading down the feed, the header gets out of the way; a scroll up brings it back.
  useRetractingChrome(Boolean(feed && feed.posts.length > 0));

  const remember = (next: Feed) => {
    cacheSet(queryKeys.feed(scope), next);
    return next;
  };

  const load = useCallback(async () => {
    try {
      const next = await api.feed({ scope });
      setFeed(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load posts.");
    } finally {
      setPending(false);
    }
  }, [scope]);

  useEffect(() => {
    const cached = peekFeed(scope);
    setFeed(cached);
    setPending(!cached);
    setError(null);
    void load();
  }, [load, user?.user_id]);

  const setTab = (next: FeedScope) => {
    if (next === scope) return;
    const nextParams = new URLSearchParams(params);
    if (next === "all") nextParams.delete("tab");
    else nextParams.set("tab", next);
    setParams(nextParams, { replace: true });
  };

  const loadMore = async () => {
    if (!feed?.nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await api.feed({ scope, before: feed.nextBefore });
      setFeed((current) => {
        if (!current) return remember(next);
        const seen = new Set(current.posts.map((post) => post.post_id));
        return remember({ ...next, posts: [...current.posts, ...next.posts.filter((post) => !seen.has(post.post_id))] });
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't load older posts.");
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="page property-page feed-page" data-testid="feed-page">
      <header className="feed-head">
        <div className="segmented feed-tabs" role="tablist" aria-label="Feed">
          <button type="button" role="tab" aria-selected={scope === "all"} className={scope === "all" ? "on" : ""} data-testid="feed-tab-all" onClick={() => setTab("all")}>All</button>
          <button type="button" role="tab" aria-selected={scope === "neighbors"} className={scope === "neighbors" ? "on" : ""} data-testid="feed-tab-neighbors" onClick={() => setTab("neighbors")}>Neighbors</button>
        </div>
      </header>
      {toast && <div className="toast" role="status">{toast}</div>}
      {error && !feed && <p className="error">{error}</p>}
      {!feed && pending && (
        <div className="feed-pending" role="status" aria-label={scope === "neighbors" ? "Loading your street" : "Loading posts"}>
          <Spinner />
        </div>
      )}
      {feed && feed.posts.length === 0 && <FeedEmpty feed={feed} scope={scope} />}
      {feed && feed.posts.length > 0 && (
        <div className="post-list feed-list">
          {feed.posts.map((post) => (
            <PostCard
              key={post.post_id}
              post={post}
              house={post.house}
              owner={post.mine}
              onChange={() => {
                setFeed((current) => {
                  if (!current) return current;
                  return remember({ ...current, posts: current.posts.filter((row) => row.post_id !== post.post_id) });
                });
              }}
              toast={showToast}
            />
          ))}
        </div>
      )}
      {feed?.nextBefore && (
        <div className="action-row feed-more">
          <button type="button" className="btn secondary" disabled={loadingMore} onClick={() => void loadMore()} data-testid="feed-more">
            {loadingMore ? "Loading…" : "Older posts"}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Nothing to show yet. Neighbors explains whether you still need a house or
 * a pairing. All is just a quiet network.
 */
function FeedEmpty({ feed, scope }: { feed: Feed; scope: FeedScope }) {
  if (scope === "all") {
    return (
      <div className="group empty-card" data-testid="feed-empty-all">
        Quiet so far. When someone posts, it shows up here.
      </div>
    );
  }
  if (feed.homeCount === 0) {
    return (
      <div className="group feed-empty" data-testid="feed-empty-no-home">
        <h2>Start with your address.</h2>
        <p>Claim your house, and whatever the houses around it post will show up here.</p>
        <div className="feed-search"><SearchBox /></div>
        <p className="meta-line">or <Link to="/map">browse the map</Link></p>
      </div>
    );
  }
  if (feed.neighborCount === 0) {
    return (
      <div className="group feed-empty" data-testid="feed-empty-no-neighbors">
        <h2>No neighbors yet.</h2>
        <p>Look up a house near yours and tap Neighbor. Once they accept, their posts land here.</p>
        <div className="feed-search"><SearchBox /></div>
        <p className="meta-line">or <Link to="/map">find them on the map</Link></p>
      </div>
    );
  }
  return (
    <div className="group empty-card" data-testid="feed-empty-quiet">
      Quiet so far. When a neighbor posts, it shows up here.
    </div>
  );
}
