"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { FaSpinner, FaTimes } from "react-icons/fa";

import { BOUNDED_TEXTAREA_CLASS, ComposeForm } from "@/components/compose/ComposeForm";
import { PanelFrame } from "@/components/panel/PanelFrame";
import { BacklogNotice } from "@/components/room/BacklogNotice";
import { MessageList, type MessageListHandle } from "@/components/room/MessageList";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiValidationError } from "@/lib/api/client";
import { FeedNotReadyError, type FeedDeps } from "@/lib/feed/store";
import type { FeedError } from "@/lib/feed/types";
import { useRoomFeed } from "@/lib/feed/useRoomFeed";
import type { Prefill } from "@/lib/page/selection";
import type { PostMessageInput } from "@/lib/schemas/message";
import type { Message, Room } from "@/lib/schemas/types";
import { useDisplayName } from "@/lib/storage/useDisplayName";

export type RoomPanelProps = {
  room: Room;
  /** First message of a room this visitor just created. */
  seed?: Message;
  /** Unsent draft from a 409 hand-off (chunk 10). */
  prefill?: Prefill;
  onClose(): void;
  /** Tests inject a fake api, subscribe, config and timers. */
  feedDeps?: Partial<FeedDeps>;
};

export const ROOM_GONE_HINT = "This room no longer exists.";
export const LOAD_FAILED_HINT = "Couldn't load this room. Close it and open it again.";
export const OLDER_FAILED = "Couldn't load older messages. Try again.";
export const NEWER_FAILED = "Couldn't check for new messages. Retrying automatically.";
export const NEWER_FAILED_BACKLOG = "Couldn't check for new messages. Use Load more messages to retry.";

function fetchAlertText(error: FeedError, backlog: boolean): string {
  if (error.op === "older") return OLDER_FAILED;
  return backlog ? NEWER_FAILED_BACKLOG : NEWER_FAILED;
}

/**
 * An open room (room-panel design §4): the feed hook, the panel frame, the
 * message list and the footer. Keyed by room id in `MapShell`, so another room
 * remounts it and resets the feed, the drafts and every scroll request.
 */
export function RoomPanel({ room, seed, prefill, onClose, feedDeps }: RoomPanelProps) {
  const feed = useRoomFeed(room.id, { seed, deps: feedDeps });
  const [name] = useDisplayName();
  const listRef = useRef<MessageListHandle>(null);

  // The visitor sees fixed copy; the raw message goes to the console, once per error object.
  const { error } = feed;
  const logged = useRef<FeedError | null>(null);
  useEffect(() => {
    if (error === null || logged.current === error) return;
    logged.current = error;
    console.warn(`Room ${room.id}: ${error.op} fetch failed: ${error.message}`);
  }, [error, room.id]);

  async function submit(input: PostMessageInput): Promise<void> {
    try {
      const message = await feed.send(input);
      listRef.current?.scrollToBottom(message.id); // applied once this row has committed
    } catch (failure) {
      if (failure instanceof FeedNotReadyError) {
        // Known no-write failure: a form-level message, drafts kept, no uncertain-write warning.
        throw new ApiValidationError([{ path: "", message: failure.message }]);
      }
      throw failure; // ComposeForm maps API errors itself
    }
  }

  async function loadMore() {
    // The hold belongs to this request: it ends when this call's completion settles.
    const finish = listRef.current?.holdPosition();
    try {
      await feed.loadNewer();
    } finally {
      finish?.();
    }
  }

  const gone = error?.notFound === true;
  const failedToOpen = !gone && error?.op === "initial";
  const fetchAlert = feed.ready && error !== null && error.op !== "initial" ? error : null;

  let body: ReactNode;
  if (gone) body = <p className="text-muted-foreground">{ROOM_GONE_HINT}</p>;
  else if (failedToOpen) body = <p className="text-muted-foreground">{LOAD_FAILED_HINT}</p>;
  else if (!feed.ready) {
    body = (
      <p role="status" className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
        <FaSpinner aria-hidden className="animate-spin" />
        Loading messages…
      </p>
    );
  } else {
    body = (
      <MessageList
        ref={listRef}
        messages={feed.messages}
        hasOlder={feed.hasOlder}
        loading={feed.loading}
        onLoadOlder={feed.loadOlder}
      />
    );
  }

  return (
    <div data-connection={feed.connection} className="flex min-h-0 w-full flex-col">
      <PanelFrame
        title={room.name}
        onClose={onClose}
        footer={
          <div className="flex w-full flex-col gap-2">
            {fetchAlert ? (
              <Alert className="has-data-[slot=alert-action]:pr-10">
                <AlertDescription>{fetchAlertText(fetchAlert, feed.backlog)}</AlertDescription>
                <AlertAction>
                  <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={feed.dismissError}>
                    <FaTimes aria-hidden />
                  </Button>
                </AlertAction>
              </Alert>
            ) : null}
            {feed.ready && feed.backlog ? (
              <BacklogNotice
                disabled={feed.loading !== null}
                busy={feed.loading === "newer"}
                onLoadMore={() => void loadMore()}
              />
            ) : null}
            <ComposeForm
              submitLabel="Send"
              disabled={!feed.ready}
              initialAuthor={prefill?.author ?? name}
              initialText={prefill?.text}
              textareaClassName={BOUNDED_TEXTAREA_CLASS}
              onSubmit={submit}
            />
          </div>
        }
      >
        {body}
      </PanelFrame>
    </div>
  );
}
