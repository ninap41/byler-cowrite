# Stashed: the community layer (2026-09-12)

A complete but not-yet-hand-tested feature set is parked in a git stash so
other work can go first. The full suite (853 tests, 19 of them new) was green
and the feed was exercised once in Chrome against a scratch server.

```bash
git stash list                       # look for "community layer: /community feed, …"
git stash apply stash@{N}            # bring it back (keeps the stash) — or `git stash pop`
npm test
```

The stash was made with `-u`, so it holds both the edits AND the five new files.
Plan file: `~/.claude/plans/go-through-the-entire-enumerated-sphinx.md`.

## What is in it

**Decisions made with Nina:** a new `/community` page as a plain reading feed
(signed-in only); games are PRIVATE until the host publishes them (default
unlisted, existing games included); kudos, reader comments, a reading list, and
follows with an activity strip.

- **Opt-in publishing.** Game snapshots gain `listed` / `listedAt`; a solo
  write is "published" when its visibility is `public` (`publishedAt` stamped).
  `POST /api/games/:code/listed {listed}` — original host, acting host or admin.
  `GET /api/stories` lists only listed games (a viewer's own unlisted ones on
  their `?user=` page, flagged); `GET /api/stories/:code` 403s an unlisted code
  to a stranger. **Existing finished games disappear from /stories until
  published** — a startup sweep could grandfather them in if wanted.
- **`src/community.js`** — pure rules: `isPublished`, `canRead` (the ONE gate),
  `authorIds`, kudos toggle, reader comments (`readerComments`, not `comments`),
  bookmarks, follows, `recentActivity` (derived, never stored), and the inbox
  note builders (`noteKudos` folds to one message per story per author,
  `noteComment`, `notePublish` once per story per follower).
- **`src/game.js`** — `updateStory(code, fn)` (live session or snapshot),
  `setListed`, `isActingHost`; `gameSummary` ships `listed/listedAt/kudos/comments`;
  `deleteGame` prunes bookmarks. `setTags` is now a wrapper over `updateStory`.
- **Routes** (src/routes.js, "The community layer"): `GET /api/community`
  (`?page&limit≤10&filter=all|saved&user=`, prose inline), `GET /api/community/:kind/:id`,
  `POST …/kudos`, `GET/POST …/comments`, `DELETE …/comments/:cid`,
  `GET/POST /api/bookmarks`, `DELETE /api/bookmarks/:kind/:id`,
  `POST/DELETE /api/follow/:username`, `GET /api/following`; profile payload adds
  `followState/followers/following/kudosReceived`; dashboard adds
  `readingList/activity`; `msgShape` adds `storyKey/kind/storyId/title/n/byName`.
  Also fixes the comment on the old line ~826 that swallowed `tags/cover/writers`
  on solo-write rows.
- **Store** — users gain `bookmarks[]`, `following[]`; `removeUser` strips follows.
- **Client** — `public/community.html` + `public/js/community-view.js` (pure
  builders); publish chip on the reveal card (`#overPublish`) and archive
  (`#archPublish`); dashboard Community tab gains `#activityCard` and
  `#readingCard`; profile gains a Follow button and a "kudos received" stat;
  inbox knows `kudos/comment/publish` kinds, `NO_REPLY` keeps the composer off
  notices, a Read button opens `/community?story=kind:id`; nav entry 🌐 Community;
  CSS at the end of base.css; `server.js` PAGES gains "community".
- **Tests** — `test/community.test.mjs` (10, every power paired with a refusal),
  `test/client-community-view.test.mjs` (9); `stories/archive/inbox/pages` tests
  updated for the new default-private rule and the `NO_REPLY` rule.
- **CLAUDE.md** — a "The community layer" paragraph.

## Still to do when it comes back

- Hand-test end to end with two accounts (publish from the reveal card, kudos /
  comment / save / follow from the other, check inbox notes and the dashboard).
- Decide whether existing finished games should be grandfathered as listed.
- Commit.
