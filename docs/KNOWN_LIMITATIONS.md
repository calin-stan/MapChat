# Map Chat — Known limitations and open reliability decisions

Date: 2026-09-16 · Companion to [the PRD](PRD.md)

The POC evaluates whether chatting through a map is useful. Evaluation currently takes place in
a development environment; deployment is not required now. The PRD's hosting assumptions and
Free-plan goals are retained, but are not evidence of a verified capacity guarantee.

## Accepted limitations

| Limitation | Effect on a visitor or the demo | Workaround / future consideration |
| --- | --- | --- |
| Timestamp cursor is not commit-order-safe | A transaction with an earlier timestamp can commit after polling has advanced past it; its message may remain absent from the current feed. | Reopen/reload the room and load older history if necessary. Strict recovery guarantees are deferred. |
| Writes have no idempotency key | If an insert succeeds but its response is lost, a manual retry can post a duplicate. Retrying room creation may return 409 for the room already created by that visitor. In that case the visitor lands in their own room with the "already exists" notice and their message visible as its first entry. | Preserve the draft, avoid automatic write retries, and check the room before resending; for room creation, where there is no room yet to check, retry at the same spot. |
| Newer-message catch-up is manual beyond 100 results | A large backlog is not fully displayed until the visitor clicks "Load more messages" enough times. New realtime messages may appear while some earlier messages remain unloaded. | Show an explicit backlog notice; retain the page continuation cursor and pause periodic catch-up while more pages remain. |
| Realtime quotas are not guaranteed by inactivity handling | Active subscribers, bursts, or cumulative usage can exceed hosted limits even with only tens of users. Polling also consumes server/database resources. | Use a controlled demo and observe usage if a hosted project is used. Admission control and comprehensive resource budgeting are deferred. |
| No moderation, rate limiting, or trusted identity | Visitors can impersonate names and submit spam; the app is not ready for an unrestricted public launch. | Keep the current evaluation in a development environment. Production controls are out of scope. |
| Exact-coordinate uniqueness only | Nearby rooms remain separate and their pins can overlap. | Zoom in; assess this usability limitation during testing. Proximity merging and clustering remain deferred. |
| Viewport is capped at 500 room pins | Some rooms are omitted in dense or wide views. | Display the truncation notice and zoom in. |
| Room discovery is periodically refreshed | Another visitor's new room may take up to the next successful viewport refresh to appear. Background-tab timers may be delayed. | Pan/zoom or wait for the visible-map refresh. The creator's pin appears immediately. |
| The websocket outlives the idle timeout by about 50 seconds | At the idle timeout the room leaves its channel and polls at once, but supabase-js closes the socket only after its deferred disconnect (twice the 25 s heartbeat). Connection counts against the Realtime quota fall that much later. | Accepted. Closing at once makes a quick re-subscribe skip `connect()` while the socket is still disconnecting, and the join then times out. |
| A re-subscribe can find the room's previous channel still leaving | supabase-js reuses a channel by topic and ignores `subscribe()` until the leave is acknowledged. The attempt is refused (`TOPIC_BUSY`) and the room polls until the next sent message tries again. Seen only when the same room is left and rejoined within the leave round trip. | Accepted for the POC. |
| Public anonymous reads | Supabase Data API reads can bypass the app's read endpoint limits; a shared room URL does not make its contents private. | Use only public demo content. Anonymous writes and write-function execution must still be denied. |
| No retention or cleanup policy | Rooms and messages accumulate indefinitely. | Reset disposable demo data manually when needed; automated lifecycle management is deferred. |
| OSM tiles are best-effort | The basemap may fail if the provider is unavailable or blocks access. | Follow the tile policy; provider replacement is deferred until needed. |
| The new-chatroom info bubble opens on hover or keyboard focus only | A tap on a touch screen does not show it. The PRD asks for hover or tap. | Touch support is deferred with the mobile layout. |
| Pending room creations live in the page | A create that is still pending when the page reloads or closes is forgotten: its outcome is not applied and its draft is not restored. Outcomes that do arrive replace intervening drafts, in the order they settle. | Wait for Create to finish before leaving. |
| Creation retry protection is per spot | After a lost response, only a retry at the same rounded coordinates is turned into a 409 for the room that may exist; moving the pin first can create a second room with the same text. | The failure message says so; retry at the same spot first. |
| Locally inserted pins are not retained after closing | A room inserted by a create outcome keeps its pin while selected. After the panel closes, an older or capped viewport response can omit it until a later refresh includes it. | Pan, zoom or wait for the next refresh. |
| The address follows the open room without history entries | Back leaves the app instead of returning to the previous room or the map. The tab title stays "Map Chat" for every room, and the address carries no map position: closing a room and reloading shows the world view. | Accepted: the PRD asks for shareable room URLs only. Share the address while the room is open. |
| A removed room is noticed by the next read, not by a send | The panel closes with the page-level notice when a history or catch-up request answers 404. A message sent to a removed room fails with the form's generic error first; the notice follows with the next poll or catch-up. | Accepted: the app has no way to remove a room; this only follows a manual data reset. |
| A shared URL has no error page of its own | If the database is unreachable while `/room/<id>` renders, the visitor sees Next's default error page instead of the map. `/` still loads and shows "Couldn't refresh rooms". | Reload. A segment `error.tsx` is deferred. |

## Adopted: synchronization bookmark (review item 2)

The PRD now requires a separate synchronization bookmark. Seeing a new message does not prove
that all earlier messages have been received; the newest displayed message cannot be that bookmark.

Example, using A/B/C as chronological labels rather than actual UUIDs:

1. The last successful poll loaded A.
2. Another visitor posts B before the next poll.
3. This visitor posts C and receives C in the POST response.
4. If C becomes the next polling cursor, fetching after C never retrieves B.

Accepted behavior: initialize the bookmark from the newest message in initial HTTP history, or
from the first message returned by atomic room creation. After initialization, only successful
ordered `after` fetches advance it. Later POST responses and realtime events update the display
without moving it. Capture the bookmark before reconnecting, confirm the subscription, then
catch up from that bookmark. Merge by ID and sort for display. If a backlog is already waiting
for a button click, keep that backlog and its bookmark rather than fetching automatically.

Automatic polling, reconnect catch-up, and manual forward pagination share this bookmark. This
addresses the client-side gap above, but does not remove the accepted transaction commit-order
limitation. These are adopted requirements, not claims about an implemented or tested application.

## Pending: connection lifecycle (review item 5)

The PRD describes choosing realtime or polling, but does not yet fully specify what happens when
the environment changes after that choice. Proposed behavior awaiting review:

| Situation | Proposed behavior | Why it matters |
| --- | --- | --- |
| A subscribed connection drops or times out | Enter polling; show a small delayed-updates indicator. Clean up the previous subscription so background reconnects do not compete with the selected mode. | A successful initial subscription is not a permanent connection. |
| A polling request is slow | Allow one message-fetch request at a time; schedule the next poll after completion. | Prevent duplicate work and responses arriving out of order. |
| A polling request fails | Preserve existing messages and cursor; retry with bounded backoff. | A temporary failure should not erase the conversation or create a tight retry loop. |
| The browser goes offline | Suspend network attempts and show an offline indicator; preserve the draft. On restoration, catch up immediately using polling. | Neither transport works without a network connection. |
| The tab becomes hidden | Unsubscribe and suspend polling while hidden. On visibility restoration, immediately catch up using polling. | Avoid doing background work for an unread room. This would replace the current hidden-tab behavior. |
| The visitor closes or switches rooms | Stop old timers/subscriptions, cancel outstanding fetches where possible, and ignore late results for the old room. | A delayed response for room A must not appear in room B. |

Sending while polling would continue to attempt realtime, as already specified. Other activity
would not automatically resubscribe. More elaborate reconnect behavior is unnecessary for this POC.

## Reference notes

- [Supabase Realtime limits](https://supabase.com/docs/guides/realtime/limits) describe throughput
  disconnections as well as join refusals.
- [Supabase message accounting](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages)
  includes fan-out and billing-cycle quotas; changing to Broadcast is not a quota bypass.
- [Supabase API access controls](https://supabase.com/docs/guides/api/securing-your-api) and
  [function permissions](https://supabase.com/docs/guides/database/functions) explain the explicit
  grants required by the PRD.
- [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/) governs the basemap.
