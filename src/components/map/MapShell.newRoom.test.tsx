// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MapShell } from "@/components/map/MapShell";
import type { MapViewProps } from "@/components/map/MapView";
import { MOVED_NOTICE_TEXT } from "@/components/room/MovedNotice";
import { CREATE_FAILED_MESSAGE } from "@/components/room/NewRoomPopup";
import { ApiRequestError, ApiValidationError, type CreateRoomOutcome, type MessagesApi } from "@/lib/api/client";
import { type Deferred, deferred, fakeMessages, msg, page } from "@/lib/feed/test-helpers";
import type { RoomPins } from "@/lib/map/useRoomPins";
import type { CreateRoomInput } from "@/lib/schemas/room";
import type { Message, Room } from "@/lib/schemas/types";
import { DISPLAY_NAME_KEY } from "@/lib/storage/displayName";

const fakePins = vi.hoisted(() => ({ current: null as RoomPins | null }));
// Realtime is refused, as before chunk 11: these tests describe a polling room.
vi.mock("@/lib/feed/realtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/feed/realtime")>();
  return { ...actual, subscribeToRoom: actual.pollingOnlySubscribe };
});

vi.mock("@/lib/map/useRoomPins", () => ({
  useRoomPins: () => {
    if (fakePins.current === null) throw new Error("test did not set fakePins");
    return fakePins.current;
  },
}));

vi.mock("@/lib/config/client", () => ({
  getClientConfig: () => ({
    supabaseUrl: "http://127.0.0.1:55021",
    supabaseAnonKey: "anon",
    pollIntervalMs: 30_000,
    realtimeIdleTimeoutMs: 180_000,
  }),
}));

// The popup and the room panel run for real, against an API each test scripts.
// The holder is read at call time, so every test installs a fresh fake.
type FakeApi = { rooms: { create(input: CreateRoomInput): Promise<CreateRoomOutcome> }; messages: MessagesApi };
const fakeApi = vi.hoisted(() => ({ current: null as FakeApi | null }));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  api: {
    get rooms() {
      return fakeApi.current!.rooms;
    },
    get messages() {
      return fakeApi.current!.messages;
    },
  },
}));

const A = { lat: 46.5, lng: 23.5 };
const B = { lat: 10.25, lng: -20.5 };
const HINT_A = "Your first message creates a chatroom at 46.500000, 23.500000.";
const HINT_B = "Your first message creates a chatroom at 10.250000, -20.500000.";

// The fake MapView renders pins as buttons and offers two empty spots, A and B.
vi.mock("next/dynamic", () => ({
  default: () =>
    function FakeMapView(props: MapViewProps) {
      return (
        <div data-testid="map">
          {props.rooms.map((room) => (
            <button
              key={room.id}
              type="button"
              data-testid="pin"
              data-selected={String(room.id === props.selectedRoomId)}
              onClick={() => props.onPinClick(room)}
            >
              {room.name}
            </button>
          ))}
          {props.draft ? (
            <span data-testid="draft">
              {props.draft.lat},{props.draft.lng}
            </span>
          ) : null}
          <button type="button" data-testid="empty-a" onClick={() => props.onEmptyClick(A)}>
            empty a
          </button>
          <button type="button" data-testid="empty-b" onClick={() => props.onEmptyClick(B)}>
            empty b
          </button>
        </div>
      );
    },
}));

const existing: Room = {
  id: "00000000-0000-4000-8000-00000000000a",
  name: "brave-crimson-otter",
  lat: A.lat,
  lng: A.lng,
  createdAt: "2026-09-16T15:00:00.000000Z",
};
const other: Room = { ...existing, id: "00000000-0000-4000-8000-00000000000b", name: "calm-amber-heron", lat: 1, lng: 2 };
const created: Room = { ...existing, id: "00000000-0000-4000-8000-00000000000c", name: "eager-violet-lynx" };
const first: Message = {
  id: "00000000-0000-4000-8000-0000000000f1",
  chatroomId: created.id,
  author: "ann",
  text: "first message here",
  createdAt: "2026-09-16T15:00:01.000000Z",
};

const lost = () => new TypeError("Failed to fetch");

function setup(rooms: Room[] = [existing, other]) {
  const messages = fakeMessages();
  const creates: (Deferred<CreateRoomOutcome> & { input: CreateRoomInput })[] = [];
  const create = vi.fn((input: CreateRoomInput) => {
    const call = { ...deferred<CreateRoomOutcome>(), input };
    creates.push(call);
    return call.promise;
  });
  fakeApi.current = { rooms: { create }, messages: messages.api };
  const insertRoom = vi.fn();
  fakePins.current = {
    rooms,
    truncated: false,
    status: "ready",
    setViewport: vi.fn(),
    refresh: vi.fn(),
    insertRoom,
  };
  const user = userEvent.setup();
  render(<MapShell initialSelection={{ kind: "none" }} initialCenter={{ lat: 0, lng: 0 }} initialZoom={2} />);

  const author = () => screen.getByLabelText("Display name");
  const text = () => screen.getByLabelText("Message");
  return {
    user,
    messages,
    creates,
    create,
    insertRoom,
    author,
    text,
    clickEmpty: (spot: "a" | "b" = "a") => fireEvent.click(screen.getByTestId(`empty-${spot}`)),
    clickPin: (room: Room) => fireEvent.click(screen.getByRole("button", { name: room.name })),
    close: () => fireEvent.click(screen.getByRole("button", { name: "Close" })),
    /** Fills the open draft and presses Create; the request stays pending in `creates`. */
    async submitDraft(name = "ann", body = "first message here") {
      await user.clear(author());
      await user.type(author(), name);
      await user.clear(text());
      await user.type(text(), body);
      const before = creates.length;
      await user.click(screen.getByRole("button", { name: "Create" }));
      await waitFor(() => expect(creates).toHaveLength(before + 1));
    },
  };
}

/** Settles a pending call inside `act`, so React commits what follows from it. */
const settle = (run: () => void) =>
  act(async () => {
    run();
  });

const heading = (name: string) => screen.queryByText(name, { selector: '[data-slot="card-title"] *' });
const notice = () => screen.queryByText(MOVED_NOTICE_TEXT);

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return () => {
    vi.restoreAllMocks();
    fakePins.current = null;
    fakeApi.current = null;
  };
});

describe("MapShell draft", () => {
  it("renders the new-room popup with the draft's coordinates", () => {
    const { clickEmpty } = setup();

    clickEmpty();

    expect(screen.getByText(HINT_A)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "About new chatrooms" })).toBeInTheDocument();
    expect(screen.getByTestId("draft")).toHaveTextContent("46.5,23.5");
  });

  it("keeps the typed text and updates the hint when the draft moves", async () => {
    const { user, clickEmpty, author, text } = setup();
    clickEmpty();
    await user.type(author(), "ann");
    await user.type(text(), "half a thought");

    clickEmpty("b");

    expect(screen.getByText(HINT_B)).toBeInTheDocument();
    expect(author()).toHaveValue("ann");
    expect(text()).toHaveValue("half a thought");
  });
});

describe("MapShell create outcomes", () => {
  it("created: inserts the pin and opens the seeded room without a history request", async () => {
    const { clickEmpty, submitDraft, creates, insertRoom, messages, text } = setup();
    clickEmpty();
    await submitDraft();

    await settle(() => creates[0].resolve({ status: "created", room: created, message: first }));

    expect(creates[0].input).toEqual({ author: "ann", text: "first message here", ...A });
    expect(insertRoom).toHaveBeenCalledTimes(1);
    expect(insertRoom).toHaveBeenCalledWith(created);
    expect(heading(created.name)).toBeInTheDocument();
    expect(within(screen.getByRole("log")).getAllByText("first message here")).toHaveLength(1);
    expect(screen.queryByTestId("draft")).toBeNull();
    expect(screen.getByRole("button", { name: created.name })).toHaveAttribute("data-selected", "true");
    expect(notice()).not.toBeInTheDocument();
    expect(text()).toHaveValue("");
    expect(text()).toHaveFocus();
    expect(localStorage.getItem(DISPLAY_NAME_KEY)).toBe("ann");
    expect(messages.api.list).not.toHaveBeenCalled();
    // The stand-in realtime adapter refuses on the next macrotask; the first poll starts at the seed.
    await waitFor(() => expect(messages.api.listAfter).toHaveBeenCalledWith(created.id, first.id));
    expect(messages.api.list).not.toHaveBeenCalled();
    expect(within(screen.getByRole("log")).getAllByText("first message here")).toHaveLength(1);
  });

  it("conflict: opens the existing room with the notice and the unsent draft, and posts nothing", async () => {
    const { clickEmpty, submitDraft, creates, insertRoom, messages, author, text } = setup();
    clickEmpty();
    await submitDraft("  ann ", " my first words ");

    await settle(() => creates[0].resolve({ status: "conflict", room: existing }));

    expect(insertRoom).toHaveBeenCalledWith(existing);
    expect(heading(existing.name)).toBeInTheDocument();
    expect(notice()).toBeInTheDocument();
    expect(author()).toHaveValue("ann");
    expect(text()).toHaveValue("my first words");
    expect(messages.api.list).toHaveBeenCalledTimes(1);
    expect(messages.api.list).toHaveBeenCalledWith(existing.id);

    await settle(() => messages.list[0].resolve(page([msg(1)])));
    expect(text()).toHaveFocus();
    expect(within(screen.getByRole("log")).queryByText("my first words")).not.toBeInTheDocument();
    expect(messages.api.post).not.toHaveBeenCalled();
    expect(creates).toHaveLength(1);
  });
});

describe("MapShell take-over", () => {
  const away = [
    ["a pin was clicked", (ctx: ReturnType<typeof setup>) => ctx.clickPin(other)],
    ["the panel was closed", (ctx: ReturnType<typeof setup>) => ctx.close()],
  ] as const;

  it.each(away)("created takes over after %s", async (_label, leave) => {
    const ctx = setup();
    ctx.clickEmpty();
    await ctx.submitDraft();
    leave(ctx);

    await settle(() => ctx.creates[0].resolve({ status: "created", room: created, message: first }));

    expect(heading(created.name)).toBeInTheDocument();
    expect(within(screen.getByRole("log")).getAllByText("first message here")).toHaveLength(1);
    expect(ctx.messages.api.list).not.toHaveBeenCalledWith(created.id);
  });

  it.each(away)("conflict takes over after %s", async (_label, leave) => {
    const ctx = setup();
    ctx.clickEmpty();
    await ctx.submitDraft();
    leave(ctx);

    await settle(() => ctx.creates[0].resolve({ status: "conflict", room: existing }));

    expect(heading(existing.name)).toBeInTheDocument();
    expect(notice()).toBeInTheDocument();
    expect(ctx.text()).toHaveValue("first message here");
  });

  it("a click on the already selected pin keeps the panel, its edits and its notice", async () => {
    const { clickEmpty, submitDraft, creates, clickPin, messages, user, text } = setup();
    clickEmpty();
    await submitDraft();
    await settle(() => creates[0].resolve({ status: "conflict", room: existing }));
    await settle(() => messages.list[0].resolve(page([msg(1)])));
    await user.type(text(), " and more");

    clickPin(existing);

    expect(text()).toHaveValue("first message here and more");
    expect(notice()).toBeInTheDocument();
    expect(messages.api.list).toHaveBeenCalledTimes(1);
  });
});

describe("MapShell outcome for the room that is already open", () => {
  /** Create pending at A, then the eventual conflict room opened from its pin and loaded. */
  async function openExistingWhileCreating() {
    const ctx = setup();
    ctx.clickEmpty();
    await ctx.submitDraft("ann", "submitted words");
    ctx.clickPin(existing);
    await settle(() => ctx.messages.list[0].resolve(page([msg(1)])));
    return ctx;
  }

  it("conflict after an edit: a fresh panel with the submitted prefill, the notice and focus", async () => {
    const ctx = await openExistingWhileCreating();
    await ctx.user.clear(ctx.author());
    await ctx.user.type(ctx.author(), "someone else");
    await ctx.user.type(ctx.text(), "typed in the open room");

    await settle(() => ctx.creates[0].resolve({ status: "conflict", room: existing }));

    expect(ctx.author()).toHaveValue("ann");
    expect(ctx.text()).toHaveValue("submitted words");
    expect(notice()).toBeInTheDocument();
    expect(ctx.messages.api.list).toHaveBeenCalledTimes(2); // a fresh feed loads history again
    expect(ctx.text()).toBeDisabled();
    await settle(() => ctx.messages.list[1].resolve(page([msg(1)])));
    expect(ctx.text()).toHaveFocus();
  });

  it("conflict after a send: the notice shows again, and the old panel's pending send cannot touch the new one", async () => {
    const ctx = await openExistingWhileCreating();
    await ctx.user.type(ctx.author(), "ann");
    await ctx.user.type(ctx.text(), "sent from the open room");
    await ctx.user.click(screen.getByRole("button", { name: "Send" }));
    await settle(() => ctx.messages.post[0].resolve(msg(2, { text: "sent from the open room" })));
    await ctx.user.type(ctx.text(), "a second one");
    await ctx.user.click(screen.getByRole("button", { name: "Send" }));
    expect(ctx.messages.post).toHaveLength(2); // still pending when the conflict arrives

    await settle(() => ctx.creates[0].resolve({ status: "conflict", room: existing }));
    await settle(() => ctx.messages.list[1].resolve(page([msg(1), msg(2, { text: "sent from the open room" })])));
    expect(notice()).toBeInTheDocument();
    expect(ctx.text()).toHaveValue("submitted words");

    await settle(() => ctx.messages.post[1].resolve(msg(3, { text: "a second one" })));

    expect(notice()).toBeInTheDocument();
    expect(ctx.text()).toHaveValue("submitted words");
    expect(within(screen.getByRole("log")).queryByText("a second one")).not.toBeInTheDocument();
  });

  it("created: the feed opened from the pin is disposed and a seeded one takes its place", async () => {
    const ctx = setup([existing, other, created]); // the new room was already discovered by a refresh
    ctx.clickEmpty();
    await ctx.submitDraft();
    ctx.clickPin(created);
    expect(ctx.messages.api.list).toHaveBeenCalledTimes(1); // the pin's own history request, still pending

    await settle(() => ctx.creates[0].resolve({ status: "created", room: created, message: first }));

    expect(within(screen.getByRole("log")).getAllByText("first message here")).toHaveLength(1);
    expect(ctx.messages.api.list).toHaveBeenCalledTimes(1); // the seeded feed asks for no history
    await waitFor(() => expect(ctx.messages.api.listAfter).toHaveBeenCalledWith(created.id, first.id));

    // The disposed feed's late history is ignored.
    await settle(() => ctx.messages.list[0].resolve(page([msg(1, { text: "late history row" })])));
    expect(screen.queryByText("late history row")).not.toBeInTheDocument();
    expect(within(screen.getByRole("log")).getAllByText("first message here")).toHaveLength(1);
  });
});

describe("MapShell failure recovery", () => {
  const unavailable = new ApiRequestError(503, "unavailable", "Could not find a free room name, please try again");
  const badLat = new ApiValidationError([{ path: "lat", message: "must be between -90 and 90" }]);

  function expectRecoveredAtA(ctx: ReturnType<typeof setup>, shown: string) {
    expect(screen.getByText(HINT_A)).toBeInTheDocument();
    expect(screen.getByTestId("draft")).toHaveTextContent("46.5,23.5");
    expect(ctx.author()).toHaveValue("ann");
    expect(ctx.text()).toHaveValue("first message here");
    expect(ctx.text()).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent(shown);
    expect(ctx.create).toHaveBeenCalledTimes(1);
    expect(ctx.messages.api.post).not.toHaveBeenCalled();
    expect(localStorage.getItem(DISPLAY_NAME_KEY)).toBeNull();
  }

  it("restores the draft in place when the popup is still open", async () => {
    const ctx = setup();
    ctx.clickEmpty();
    await ctx.submitDraft("  ann ", " first message here ");

    await settle(() => ctx.creates[0].reject(lost()));

    expectRecoveredAtA(ctx, CREATE_FAILED_MESSAGE); // trimmed, as submitted
  });

  it("restores it after the panel was closed", async () => {
    const ctx = setup();
    ctx.clickEmpty();
    await ctx.submitDraft();
    ctx.close();

    await settle(() => ctx.creates[0].reject(unavailable));

    expectRecoveredAtA(ctx, "Could not find a free room name, please try again");
  });

  it("restores it over a room that was opened meanwhile", async () => {
    const ctx = setup();
    ctx.clickEmpty();
    await ctx.submitDraft();
    ctx.clickPin(other);

    await settle(() => ctx.creates[0].reject(badLat));

    expectRecoveredAtA(ctx, "lat must be between -90 and 90");
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("restores it over a replacement draft, whose own edits are replaced", async () => {
    const ctx = setup();
    ctx.clickEmpty();
    await ctx.submitDraft();
    ctx.close();
    ctx.clickEmpty("b");
    await ctx.user.type(ctx.text(), "typed into the replacement");

    await settle(() => ctx.creates[0].reject(lost()));

    expectRecoveredAtA(ctx, CREATE_FAILED_MESSAGE);
  });

  it("submit at A, move to B, reject: A comes back and an immediate retry targets A", async () => {
    const ctx = setup();
    ctx.clickEmpty();
    await ctx.submitDraft();
    ctx.clickEmpty("b");
    expect(screen.getByText(HINT_B)).toBeInTheDocument();

    await settle(() => ctx.creates[0].reject(lost()));
    expectRecoveredAtA(ctx, CREATE_FAILED_MESSAGE);

    await ctx.user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(ctx.creates).toHaveLength(2));
    expect(ctx.creates[1].input).toEqual({ author: "ann", text: "first message here", ...A });
    expect(screen.queryByText(CREATE_FAILED_MESSAGE)).not.toBeInTheDocument(); // cleared by the submit
  });

  it("moving the recovered draft keeps the guidance and makes the next create target B", async () => {
    const ctx = setup();
    ctx.clickEmpty();
    await ctx.submitDraft();
    await settle(() => ctx.creates[0].reject(lost()));

    ctx.clickEmpty("b");

    expect(screen.getByText(HINT_B)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(CREATE_FAILED_MESSAGE);
    expect(ctx.text()).toHaveValue("first message here");
    await ctx.user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(ctx.creates).toHaveLength(2));
    expect(ctx.creates[1].input).toEqual({ author: "ann", text: "first message here", ...B });
  });

  it("closing a recovered draft discards it", async () => {
    const ctx = setup();
    ctx.clickEmpty();
    await ctx.submitDraft();
    await settle(() => ctx.creates[0].reject(lost()));

    ctx.close();
    ctx.clickEmpty();

    expect(ctx.text()).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("MapShell with several creates pending", () => {
  it("applies outcomes in settlement order, each from its own snapshot", async () => {
    const ctx = setup();
    ctx.clickEmpty();
    await ctx.submitDraft("ann", "request one");
    ctx.close();
    ctx.clickEmpty("b");
    await ctx.submitDraft("bea", "request two");
    ctx.close();

    await settle(() =>
      ctx.creates[1].resolve({ status: "created", room: created, message: { ...first, author: "bea", text: "request two" } }),
    );
    expect(heading(created.name)).toBeInTheDocument();
    expect(within(screen.getByRole("log")).getAllByText("request two")).toHaveLength(1);

    await settle(() => ctx.creates[0].reject(lost()));
    expect(screen.getByText(HINT_A)).toBeInTheDocument();
    expect(ctx.author()).toHaveValue("ann");
    expect(ctx.text()).toHaveValue("request one");
    expect(screen.getByRole("alert")).toHaveTextContent(CREATE_FAILED_MESSAGE);
    expect(ctx.create).toHaveBeenCalledTimes(2);
  });

  it("a conflict that settles after a created outcome replaces that room's panel", async () => {
    const ctx = setup();
    ctx.clickEmpty();
    await ctx.submitDraft("ann", "request one");
    ctx.close();
    ctx.clickEmpty("b");
    await ctx.submitDraft("bea", "request two");

    await settle(() => ctx.creates[1].resolve({ status: "created", room: created, message: first }));
    await settle(() => ctx.creates[0].resolve({ status: "conflict", room: existing }));

    expect(heading(existing.name)).toBeInTheDocument();
    expect(notice()).toBeInTheDocument();
    expect(ctx.author()).toHaveValue("ann");
    expect(ctx.text()).toHaveValue("request one");
    expect(ctx.insertRoom.mock.calls).toEqual([[created], [existing]]);
  });
});
