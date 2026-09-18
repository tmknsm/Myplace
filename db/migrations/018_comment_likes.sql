-- Likes on photo comments. One per person per comment; gone with the comment.
CREATE TABLE IF NOT EXISTS document_comment_likes (
  comment_id TEXT NOT NULL REFERENCES document_comments(comment_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);
