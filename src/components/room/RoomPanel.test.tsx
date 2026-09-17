// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SUBMIT_FAILED_MESSAGE } from "@/components/compose/fieldErrors";
import { MOVED_NOTICE_TEXT } from "@/components/room/MovedNotice";
import {
  LOAD_FAILED_HINT,
  NEWER_FAILED,
  NEWER_FAILED_BACKLOG,
  OLDER_FAILED,
  ROOM_GONE_HINT,
  RoomPanel,
  type RoomPanelProps,
} from "@/components/room/RoomPanel";
import { ApiRequestError, ApiValidationError } from "@/lib/api/client";
import { FeedNotReadyError, type FeedDeps } from "@/lib/feed/store";
import {
  ROOM,
  TEST_CONFIG,
  catchUp,
  fakeMessages,
  fakeRealtime,
  id,
  manualTimers,
  msg,
  page,
} from "@/lib/feed/test-helpers";
import { DISPLAY_NAME_KEY } from "@/lib/storage/displayName";
import type { Room } from "@/lib/schemas/types";

const room: Room = {
  id: ROOM,
  name: "brave-crimson-otter",
  lat: 46.7712,
  lng: 23.6236,
  createdAt: "2026-09-16T15:00:00.000000Z",
};

/** Lets settled promises run inside `act`, so React commits what the store published. */
const settle = () => act(async () => {});

function setup(props: Partial<RoomPanelProps> = {}) {
  const messages = fakeMessages();
  const realtime = fakeRealtime();
  const clock = manualTimers();
  const feedDeps: FeedDeps = {
    messages: messages.api,
    subscribe: realtime.subscribe,
    config: TEST_CONFIG,
    timers: clock.timers,
  };
  const onClose = vi.fn();
  const user = userEvent.setup();
  const view = render(<RoomPanel room={room} onClose={onClose} feedDeps={feedDeps} {...props} />);
  return {
    user,
    messages,
    realtime,
    onClose,
    tick: () => act(() => clock.tick()),
    root: () => view.container.firstElementChild as HTMLElement,
    author: () => screen.getByLabelText("Display name"),
    text: () => screen.getByLabelText("Message"),
    send: () => screen.getByRole("button", { name: "Send" }),
    unmount: view.unmount,
  };
}

/** History [1, 2] loaded (older pages exist), realtime refused, first catch-up answered empty. */
async function openPolling(props: Partial<RoomPanelProps> = {}) {
  const ctx = setup(props);
  ctx.messages.list[0].resolve(page([msg(1), msg(2)], true));
  await settle();
  act(() => ctx.realtime.attempts[0].handlers.onFailed("refused"));
  ctx.messages.listAfter[0].resolve(catchUp([], id(2)));
  await settle();
  return ctx;
}

/** As `openPolling`, then a poll answers with message 3 and says more rows exist. */
async function openWithBacklog() {
  const ctx = await openPolling();
  ctx.tick();
  ctx.messages.listAfter[1].resolve(catchUp([msg(3)], id(3), true));
  await settle();
  return ctx;
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return () => vi.restoreAllMocks();
});

describe("RoomPanel states", () => {
  it("shows a spinner and a disabled form while opening", async () => {
    const { root, author, text, send, onClose, user } = setup();

    expect(screen.getByRole("status")).toHaveTextContent("Loading messages…");
    expect(screen.getByText(room.name)).toBeInTheDocument();
    expect(author()).toBeDisabled();
    expect(text()).toBeDisabled();
    expect(send()).toBeDisabled();
    expect(root()).toHaveAttribute("data-connection", "connecting");

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders history, enables the form and reports the polling connection", async () => {
    const { root, send, text } = await openPolling();

    const log = screen.getByRole("log");
    expect(within(log).getByText("message 1")).toBeInTheDocument();
    expect(within(log).getByText("message 2")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(send()).toBeEnabled();
    expect(text()).toHaveClass("field-sizing-fixed", "h-16", "resize-none", "overflow-y-auto");
    expect(root()).toHaveAttribute("data-connection", "polling");
  });

  it("shows a persistent hint after an initial failure and keeps the form disabled", async () => {
    const { messages, send } = setup();
    messages.list[0].reject(new Error("offline"));
    await settle();

    expect(screen.getByText(LOAD_FAILED_HINT)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
    expect(screen.queryByRole("log")).not.toBeInTheDocument();
    expect(send()).toBeDisabled();
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("offline"));
  });

  it("shows the room-gone hint after a 404 from any fetch", async () => {
    const { messages, send, user } = await openPolling();
    await user.click(screen.getByRole("button", { name: "Load older" }));
    messages.list[1].reject(new ApiRequestError(404, "not_found", "Room not found"));
    await settle();

    expect(screen.getByText(ROOM_GONE_HINT)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
    expect(screen.queryByRole("log")).not.toBeInTheDocument();
    expect(send()).toBeDisabled();
  });

  it("shows a seeded room at once with no history request", () => {
    const { messages, send } = setup({ seed: msg(7) });

    expect(within(screen.getByRole("log")).getByText("message 7")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(send()).toBeEnabled();
    expect(messages.api.list).not.toHaveBeenCalled();
  });

  it("fills the form from a prefill, ahead of the remembered name", async () => {
    localStorage.setItem(DISPLAY_NAME_KEY, "remembered");
    const { author, text } = await openPolling({ prefill: { author: "ana", text: "unsent draft" } });

    expect(author()).toHaveValue("ana");
    expect(text()).toHaveValue("unsent draft");
  });

  it("falls back to the remembered display name", async () => {
    localStorage.setItem(DISPLAY_NAME_KEY, "remembered");
    const { author } = await openPolling();

    expect(author()).toHaveValue("remembered");
  });
});

describe("RoomPanel fetch errors", () => {
  it("shows a dismissible alert after an older failure; the button is the retry", async () => {
    const { messages, user } = await openPolling();
    const loadOlder = () => screen.getByRole("button", { name: "Load older" });
    await user.click(loadOlder());
    expect(loadOlder()).toBeDisabled();
    messages.list[1].reject(new Error("offline"));
    await settle();

    expect(screen.getByText(OLDER_FAILED)).toBeInTheDocument();
    expect(screen.queryByText(/offline/)).not.toBeInTheDocument(); // raw message stays in the console
    expect(loadOlder()).toBeEnabled();
    expect(screen.getByRole("log")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(OLDER_FAILED)).not.toBeInTheDocument();

    await user.click(loadOlder());
    expect(messages.api.list).toHaveBeenCalledTimes(3);
  });

  it("says a failed check retries automatically when there is no backlog", async () => {
    const { messages, tick } = await openPolling();
    tick();
    messages.listAfter[1].reject(new Error("offline"));
    await settle();

    expect(screen.getByText(NEWER_FAILED)).toBeInTheDocument();
  });

  it("points at Load more messages when a backlog fetch fails", async () => {
    const { messages, user } = await openWithBacklog();
    await user.click(screen.getByRole("button", { name: "Load more messages" }));
    messages.listAfter[2].reject(new Error("offline"));
    await settle();

    expect(screen.getByText(NEWER_FAILED_BACKLOG)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load more messages" })).toBeEnabled();
  });

  it("warns once per error object, not once per render", async () => {
    const { messages, tick, user, text } = await openPolling();
    tick();
    messages.listAfter[1].reject(new Error("offline"));
    await settle();

    await user.type(text(), "re-render"); // the same error object through many renders

    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});

describe("RoomPanel backlog", () => {
  it("shows the notice, loads the next page under a hold and shows the pill", async () => {
    const { messages, user } = await openWithBacklog();
    expect(screen.getByText("More messages are available")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load more messages" }));
    expect(messages.api.listAfter).toHaveBeenLastCalledWith(ROOM, id(3));
    expect(screen.getByRole("button", { name: "Load more messages" })).toBeDisabled();
    messages.listAfter[2].resolve(catchUp([msg(4)], id(4)));
    await settle();

    expect(within(screen.getByRole("log")).getByText("message 4")).toBeInTheDocument();
    expect(screen.queryByText("More messages are available")).not.toBeInTheDocument();
    // jsdom has no layout, so the reader counts as "at the bottom": only the hold explains a pill.
    expect(screen.getByRole("button", { name: "New messages" })).toBeInTheDocument();
  });

  it("shows no pill when an automatic poll brings the same kind of row", async () => {
    const { messages, tick } = await openPolling();
    tick();
    messages.listAfter[1].resolve(catchUp([msg(3)], id(3)));
    await settle();

    expect(within(screen.getByRole("log")).getByText("message 3")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New messages" })).not.toBeInTheDocument();
  });

  it("disables Load more messages during an older fetch, without its spinner", async () => {
    const { user } = await openWithBacklog();
    await user.click(screen.getByRole("button", { name: "Load older" }));

    const loadMore = screen.getByRole("button", { name: "Load more messages" });
    expect(loadMore).toBeDisabled();
    expect(loadMore.querySelector("svg")).toBeNull();
  });
});

describe("RoomPanel submit", () => {
  it("appends the sent message once, clears the draft, and a later poll does not duplicate it", async () => {
    const { messages, user, author, text, send, tick } = await openPolling();
    await user.type(author(), "ann");
    await user.type(text(), "hello");

    await user.click(send());
    expect(messages.api.post).toHaveBeenCalledWith(ROOM, { author: "ann", text: "hello" });
    messages.post[0].resolve(msg(3, { author: "ann", text: "hello" }));
    await settle();

    const log = screen.getByRole("log");
    expect(within(log).getAllByText("hello")).toHaveLength(1);
    expect(text()).toHaveValue("");
    expect(author()).toHaveValue("ann");

    tick();
    messages.listAfter[1].resolve(catchUp([msg(3, { author: "ann", text: "hello" })], id(3)));
    await settle();
    expect(within(log).getAllByText("hello")).toHaveLength(1);
  });

  it("turns FeedNotReadyError into a form-level message and keeps the draft", async () => {
    const { messages, user, author, text, send } = await openPolling();
    await user.type(author(), "ann");
    await user.type(text(), "hello");

    await user.click(send());
    // The store rethrows a POST rejection unchanged, so this reaches the panel's
    // adapter exactly as the store's own readiness rejection does.
    messages.post[0].reject(new FeedNotReadyError());
    await settle();

    expect(screen.getByText("Wait for the room to load, or reopen it if loading failed.")).toBeInTheDocument();
    expect(screen.queryByText(SUBMIT_FAILED_MESSAGE)).not.toBeInTheDocument();
    expect(text()).toHaveValue("hello");
    expect(localStorage.getItem(DISPLAY_NAME_KEY)).toBeNull();
  });

  it("lets ComposeForm map an API validation error to its field", async () => {
    const { messages, user, author, text, send } = await openPolling();
    await user.type(author(), "ann");
    await user.type(text(), "hello");

    await user.click(send());
    messages.post[0].reject(
      new ApiValidationError([{ path: "text", message: "must be between 1 and 3000 characters" }]),
    );
    await settle();

    expect(screen.getByText("Message must be between 1 and 3000 characters")).toBeInTheDocument();
    expect(text()).toHaveValue("hello");
  });

  it("shows the uncertain-write warning when the request itself fails", async () => {
    const { messages, user, author, text, send } = await openPolling();
    await user.type(author(), "ann");
    await user.type(text(), "hello");

    await user.click(send());
    messages.post[0].reject(new TypeError("Failed to fetch"));
    await settle();

    await waitFor(() => expect(screen.getByText(SUBMIT_FAILED_MESSAGE)).toBeInTheDocument());
    expect(text()).toHaveValue("hello");
  });
});

describe("RoomPanel moved notice", () => {
  const prefill = { author: "ana", text: "unsent draft" };
  const notice = () => screen.queryByText(MOVED_NOTICE_TEXT);
  const dismissNotice = () =>
    within(screen.getByText(MOVED_NOTICE_TEXT).closest<HTMLElement>('[role="status"]')!).getByRole("button", {
      name: "Dismiss",
    });

  it("shows with a prefill while opening, as a status", () => {
    setup({ prefill });

    expect(notice()).toBeInTheDocument();
    expect(notice()!.closest('[role="status"]')).not.toBeNull();
    expect(screen.getByText("Loading messages…")).toBeInTheDocument();
  });

  it("stays with the initial-failure hint, above the disabled prefilled form", async () => {
    const { messages, text, send } = setup({ prefill });
    messages.list[0].reject(new Error("offline"));
    await settle();

    expect(screen.getByText(LOAD_FAILED_HINT)).toBeInTheDocument();
    expect(notice()).toBeInTheDocument();
    expect(text()).toHaveValue("unsent draft");
    expect(send()).toBeDisabled();
  });

  it("is absent without a prefill", async () => {
    await openPolling();

    expect(notice()).not.toBeInTheDocument();
  });

  it("is absent for a seeded room", () => {
    setup({ seed: msg(7) });

    expect(notice()).not.toBeInTheDocument();
  });

  it("is hidden by the room-gone hint", async () => {
    const { messages } = setup({ prefill });
    messages.list[0].reject(new ApiRequestError(404, "not_found", "Room not found"));
    await settle();

    expect(screen.getByText(ROOM_GONE_HINT)).toBeInTheDocument();
    expect(notice()).not.toBeInTheDocument();
  });

  it("is dismissed by its own button and keeps the prefilled fields", async () => {
    const { user, author, text } = await openPolling({ prefill });

    await user.click(dismissNotice());

    expect(notice()).not.toBeInTheDocument();
    expect(author()).toHaveValue("ana");
    expect(text()).toHaveValue("unsent draft");
  });

  it("goes away after a send that resolves", async () => {
    const { messages, user, send } = await openPolling({ prefill });

    await user.click(send());
    expect(notice()).toBeInTheDocument(); // still unsent while the request is pending
    messages.post[0].resolve(msg(3, prefill));
    await settle();

    expect(notice()).not.toBeInTheDocument();
  });

  it("stays after a send that is rejected", async () => {
    const { messages, user, send, text } = await openPolling({ prefill });

    await user.click(send());
    messages.post[0].reject(new TypeError("Failed to fetch"));
    await settle();

    await waitFor(() => expect(screen.getByText(SUBMIT_FAILED_MESSAGE)).toBeInTheDocument());
    expect(notice()).toBeInTheDocument();
    expect(text()).toHaveValue("unsent draft");
  });

  it("renders above the fetch alert, and each Dismiss closes its own", async () => {
    const { messages, tick, user } = await openPolling({ prefill });
    tick();
    messages.listAfter[1].reject(new Error("offline"));
    await settle();

    const fetchAlert = screen.getByText(NEWER_FAILED);
    expect(notice()!.compareDocumentPosition(fetchAlert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(dismissNotice());
    expect(notice()).not.toBeInTheDocument();
    expect(fetchAlert).toBeInTheDocument();
  });
});

describe("RoomPanel focus after a hand-off", () => {
  it("focuses the message field of a seeded room at once", () => {
    const { text } = setup({ seed: msg(7) });

    expect(text()).toHaveFocus();
  });

  it("focuses the message field of a prefilled room when the form is first enabled", async () => {
    const { messages, text } = setup({ prefill: { author: "ana", text: "unsent draft" } });
    expect(text()).not.toHaveFocus();

    messages.list[0].resolve(page([msg(1)]));
    await settle();

    expect(text()).toHaveFocus();
  });

  it("leaves focus alone for a room opened from its pin", async () => {
    await openPolling();

    expect(document.body).toHaveFocus();
  });
});
