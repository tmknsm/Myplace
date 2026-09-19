import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Feed } from "./api";
import { useAuth } from "./auth";
import { PageSpinner, SearchBox } from "./components";
import { PostCard } from "./property";
import { useToast } from "./property-shared";

/**
 * The signed-in landing page: what the houses next to yours have posted,
 * newest first, with your own posts in the same stream. Each post links back
 * to its house.
 */
export function FeedPage() {
  const { user } = useAuth();
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    try {
      setFeed(await api.feed());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your neighbors' posts.");
    }
  }, []);

  useEffect(() => { void load(); }, [load, user?.user_id]);

  const loadMore = async () => {
    if (!feed?.nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await api.feed(feed.nextBefore);
      setFeed((current) => {
        if (!current) return next;
        const seen = new Set(current.posts.map((post) => post.post_id));
        return { ...next, posts: [...current.posts, ...next.posts.filter((post) => !seen.has(post.post_id))] };
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't load older posts.");
    } finally {
      setLoadingMore(false);
    }
  };

  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!feed) return <PageSpinner label="Loading your street" />;

  return (
    <div className="page property-page feed-page" data-testid="feed-page">
      <header className="section-head feed-head">
        <div>
          <div className="kicker">Your street</div>
          <h1>Neighbors</h1>
        </div>
      </header>
      {toast && <div className="toast" role="status">{toast}</div>}
      {feed.posts.length === 0 ? (
        <FeedEmpty feed={feed} />
      ) : (
        <div className="post-list feed-list">
          {feed.posts.map((post) => (
            <PostCard key={post.post_id} post={post} house={post.house} owner={post.mine} onChange={load} toast={showToast} />
          ))}
        </div>
      )}
      {feed.nextBefore && (
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
 * Nothing to show yet, and why: no house, no neighbors, or a quiet street.
 * The first two get a search box, since the fix is to find an address.
 */
function FeedEmpty({ feed }: { feed: Feed }) {
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
