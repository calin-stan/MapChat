// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CREATE_FAILED_MESSAGE,
  NEW_ROOM_INFO_TEXT,
  NewRoomPopup,
  type NewRoomPopupProps,
} from "@/components/room/NewRoomPopup";
import { ApiRequestError, ApiValidationError, type CreateRoomOutcome } from "@/lib/api/client";
import type { Message, Room } from "@/lib/schemas/types";
import { DISPLAY_NAME_KEY } from "@/lib/storage/displayName";

const LAT = 46.77120049;
const LNG = 23.6236;

const room: Room = {
  id: "00000000-0000-4000-8000-00000000000a",
  name: "brave-crimson-otter",
  lat: 46.7712,
  lng: 23.6236,
  createdAt: "2026-09-16T15:00:00.000000Z",
};
const message: Message = {
  id: "00000000-0000-4000-8000-0000000000f1",
  chatroomId: room.id,
  author: "ann",
  text: "hello",
  createdAt: "2026-09-16T15:00:00.000000Z",
};

type Create = NonNullable<NewRoomPopupProps["createRoom"]>;

function setup(props: Partial<NewRoomPopupProps> = {}) {
  const createRoom = vi.fn<Create>(async () => ({ status: "created", room, message }));
  const callbacks = { onCreated: vi.fn(), onConflict: vi.fn(), onFailed: vi.fn(), onClose: vi.fn() };
  const user = userEvent.setup();
  const view = render(
    <NewRoomPopup lat={LAT} lng={LNG} createRoom={createRoom} {...callbacks} {...props} />,
  );
  return {
    user,
    createRoom,
    ...callbacks,
    rerender: (next: Partial<NewRoomPopupProps>) =>
      view.rerender(
        <NewRoomPopup lat={LAT} lng={LNG} createRoom={createRoom} {...callbacks} {...props} {...next} />,
      ),
    unmount: view.unmount,
    author: () => screen.getByLabelText("Display name"),
    text: () => screen.getByLabelText("Message"),
    create: () => screen.getByRole("button", { name: "Create" }),
  };
}

/** A `createRoom` call the test settles by hand. */
function pendingCreate() {
  let resolve!: (outcome: CreateRoomOutcome) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<CreateRoomOutcome>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn());
  return () => vi.unstubAllGlobals();
});

describe("NewRoomPopup rendering", () => {
  it("has the title, the close button and the Create button", async () => {
    const { user, onClose, create } = setup();

    expect(screen.getByText("New chatroom")).toBeInTheDocument();
    expect(create()).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the PRD text when the info button gets keyboard focus", async () => {
    localStorage.setItem(DISPLAY_NAME_KEY, "ann"); // focus starts in the message field
    const { user } = setup();
    expect(screen.queryByText(NEW_ROOM_INFO_TEXT)).not.toBeInTheDocument();

    await user.tab({ shift: true }); // message → name
    await user.tab({ shift: true }); // name → close
    await user.tab({ shift: true }); // close → info

    expect(screen.getByRole("button", { name: "About new chatrooms" })).toHaveFocus();
    expect(await screen.findByText(NEW_ROOM_INFO_TEXT)).toBeInTheDocument();
  });

  it("shows both coordinates rounded to six decimals, latitude first", () => {
    setup();

    expect(
      screen.getByText("Your first message creates a chatroom at 46.771200, 23.623600."),
    ).toBeInTheDocument();
  });

  it("prefills the remembered name and bounds the message field", () => {
    localStorage.setItem(DISPLAY_NAME_KEY, "ann");
    const { author, text } = setup();

    expect(author()).toHaveValue("ann");
    expect(text()).toHaveClass("field-sizing-fixed", "h-16", "resize-none", "overflow-y-auto");
  });
});

describe("NewRoomPopup focus", () => {
  it("focuses the message field when a name is remembered", () => {
    localStorage.setItem(DISPLAY_NAME_KEY, "ann");
    const { text } = setup();

    expect(text()).toHaveFocus();
  });

  it("focuses the name field otherwise", () => {
    const { author } = setup();

    expect(author()).toHaveFocus();
  });
});

describe("NewRoomPopup submit", () => {
  it("creates with the trimmed input and the clicked coordinates, then reports created", async () => {
    const { user, createRoom, onCreated, onConflict, onFailed, author, text, create } = setup();
    await user.type(author(), "  ann ");
    await user.type(text(), " hello ");

    await user.click(create());

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(room, message));
    expect(createRoom).toHaveBeenCalledTimes(1);
    expect(createRoom).toHaveBeenCalledWith({ author: "ann", text: "hello", lat: LAT, lng: LNG });
    expect(onConflict).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();
    expect(localStorage.getItem(DISPLAY_NAME_KEY)).toBe("ann");
  });

  it("reports a conflict with the trimmed prefill and posts nothing", async () => {
    const { user, createRoom, onCreated, onConflict, author, text, create } = setup();
    createRoom.mockResolvedValueOnce({ status: "conflict", room });
    await user.type(author(), "  ann ");
    await user.type(text(), " hello ");

    await user.click(create());

    await waitFor(() => expect(onConflict).toHaveBeenCalledWith(room, { author: "ann", text: "hello" }));
    expect(onCreated).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem(DISPLAY_NAME_KEY)).toBe("ann");
  });

  it("makes no request for an invalid form", async () => {
    const { user, createRoom, onFailed, create } = setup();

    await user.click(create());

    expect(await screen.findByText("Message must be between 1 and 3000 characters")).toBeInTheDocument();
    expect(createRoom).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("disables every control while the request is pending and ignores a second submit", async () => {
    const pending = pendingCreate();
    const { user, createRoom, author, text, create } = setup();
    createRoom.mockReturnValueOnce(pending.promise);
    await user.type(author(), "ann");
    await user.type(text(), "hello");

    await user.click(create());
    await waitFor(() => expect(create()).toBeDisabled());
    expect(author()).toBeDisabled();
    expect(text()).toBeDisabled();
    await user.click(create());

    expect(createRoom).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ status: "created", room, message }));
  });
});

describe("NewRoomPopup failures", () => {
  const latError = new ApiValidationError([{ path: "lat", message: "must be between -90 and 90" }]);
  const unavailable = new ApiRequestError(503, "unavailable", "Could not find a free room name, please try again");
  const lost = new TypeError("Failed to fetch");

  it.each([
    ["a validation error on lat", latError, "lat must be between -90 and 90"],
    ["a 503 unavailable", unavailable, "Could not find a free room name, please try again"],
    ["a lost response", lost, CREATE_FAILED_MESSAGE],
  ])("reports %s through onFailed only and keeps the draft", async (_label, error, shown) => {
    const { user, createRoom, onCreated, onConflict, onFailed, author, text, create } = setup();
    createRoom.mockRejectedValueOnce(error);
    await user.type(author(), "  ann ");
    await user.type(text(), " hello ");

    await user.click(create());

    await waitFor(() =>
      expect(onFailed).toHaveBeenCalledWith({ author: "ann", text: "hello", lat: LAT, lng: LNG }, error),
    );
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onCreated).not.toHaveBeenCalled();
    expect(onConflict).not.toHaveBeenCalled();
    // The form saw the rejection: error shown, draft kept, name not remembered.
    expect(await screen.findByRole("alert")).toHaveTextContent(shown);
    expect(text()).toHaveValue(" hello ");
    expect(localStorage.getItem(DISPLAY_NAME_KEY)).toBeNull();
  });

  it.each([
    ["a validation error on lat", latError, "lat must be between -90 and 90"],
    ["a 503 unavailable", unavailable, "Could not find a free room name, please try again"],
    ["a lost response", lost, CREATE_FAILED_MESSAGE],
  ])("a recovered popup shows %s with the submitted draft", (_label, error, shown) => {
    localStorage.setItem(DISPLAY_NAME_KEY, "remembered");
    const { createRoom, author, text } = setup({
      recovery: { input: { author: "ann", text: "hello", lat: LAT, lng: LNG }, error },
    });

    expect(screen.getByRole("alert")).toHaveTextContent(shown);
    expect(author()).toHaveValue("ann"); // the submitted name wins over the remembered one
    expect(text()).toHaveValue("hello");
    expect(text()).toHaveFocus();
    expect(createRoom).not.toHaveBeenCalled();
    expect(localStorage.getItem(DISPLAY_NAME_KEY)).toBe("remembered");
  });

  it("a recovered popup ties a field error to its field", () => {
    const { text } = setup({
      recovery: {
        input: { author: "ann", text: "hello", lat: LAT, lng: LNG },
        error: new ApiValidationError([{ path: "text", message: "contains characters that cannot be stored" }]),
      },
    });

    expect(screen.getByText("Message contains characters that cannot be stored")).toBeInTheDocument();
    expect(text()).toHaveAttribute("aria-invalid", "true");
  });
});

describe("NewRoomPopup and a moving draft", () => {
  it("keeps the typed text, updates the hint and sends the new coordinates", async () => {
    const { user, createRoom, rerender, author, text, create } = setup();
    await user.type(author(), "ann");
    await user.type(text(), "hello");

    rerender({ lat: 10.25, lng: -20.5 });

    expect(text()).toHaveValue("hello");
    expect(
      screen.getByText("Your first message creates a chatroom at 10.250000, -20.500000."),
    ).toBeInTheDocument();
    await user.click(create());
    await waitFor(() =>
      expect(createRoom).toHaveBeenCalledWith({ author: "ann", text: "hello", lat: 10.25, lng: -20.5 }),
    );
  });

  it.each(["created", "conflict", "failed"] as const)(
    "a request in flight keeps its own coordinates and reports %s after the popup unmounts",
    async (kind) => {
      const pending = pendingCreate();
      const { user, createRoom, onCreated, onConflict, onFailed, rerender, unmount, author, text, create } = setup();
      createRoom.mockReturnValueOnce(pending.promise);
      await user.type(author(), "ann");
      await user.type(text(), "hello");
      await user.click(create());
      await waitFor(() => expect(createRoom).toHaveBeenCalledTimes(1));

      rerender({ lat: 10.25, lng: -20.5 });
      unmount();
      const error = new TypeError("Failed to fetch");
      await act(async () => {
        if (kind === "created") pending.resolve({ status: "created", room, message });
        else if (kind === "conflict") pending.resolve({ status: "conflict", room });
        else pending.reject(error);
      });

      if (kind === "created") expect(onCreated).toHaveBeenCalledWith(room, message);
      if (kind === "conflict") expect(onConflict).toHaveBeenCalledWith(room, { author: "ann", text: "hello" });
      if (kind === "failed") {
        expect(onFailed).toHaveBeenCalledWith({ author: "ann", text: "hello", lat: LAT, lng: LNG }, error);
      }
      expect(onCreated.mock.calls.length + onConflict.mock.calls.length + onFailed.mock.calls.length).toBe(1);
    },
  );
});
