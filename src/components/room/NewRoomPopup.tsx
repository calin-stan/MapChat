"use client";

import { FaInfoCircle } from "react-icons/fa";

import { BOUNDED_TEXTAREA_CLASS, ComposeForm } from "@/components/compose/ComposeForm";
import { submitErrors } from "@/components/compose/fieldErrors";
import { PanelFrame } from "@/components/panel/PanelFrame";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, type RoomsApi } from "@/lib/api/client";
import type { Prefill } from "@/lib/page/selection";
import type { PostMessageInput } from "@/lib/schemas/message";
import { roundCoord, type CreateRoomInput } from "@/lib/schemas/room";
import type { Message, Room } from "@/lib/schemas/types";
import { useDisplayName } from "@/lib/storage/useDisplayName";

export type NewRoomPopupProps = {
  lat: number;
  lng: number;
  onCreated(room: Room, message: Message): void;
  onConflict(room: Room, prefill: Prefill): void;
  onFailed(input: CreateRoomInput, error: unknown): void;
  /** A rejected create restored by the shell: the form starts from it. */
  recovery?: { input: CreateRoomInput; error: unknown };
  onClose(): void;
  /** Defaults to `api.rooms.create`; tests inject a fake. */
  createRoom?: RoomsApi["create"];
};

/** PRD 3 Flow A, verbatim. */
export const NEW_ROOM_INFO_TEXT = "This chatroom will receive a name after the first message is sent.";

/**
 * Replaces the form's lost-response message: the popup has no room to check,
 * and only a retry at the same rounded coordinates is protected by the 409.
 */
export const CREATE_FAILED_MESSAGE =
  "Couldn't confirm creation. A chatroom may already exist at the submitted spot. Retry at the same spot to open it if it exists. Moving the pin starts a separate creation at the new spot.";

/** Stock tooltip: opens on hover and keyboard focus, not on tap (KNOWN_LIMITATIONS). */
function NewRoomInfo() {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="About new chatrooms" />}>
        <FaInfoCircle aria-hidden />
      </TooltipTrigger>
      <TooltipContent>{NEW_ROOM_INFO_TEXT}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The draft panel (new-room design §4): names the spot, takes the first
 * message and owns the create call. It reports created, conflict or failure to
 * the shell and never posts a message itself. `lat` and `lng` may change while
 * it is mounted; typed text survives and the next submit uses the new spot.
 */
export function NewRoomPopup({
  lat,
  lng,
  onCreated,
  onConflict,
  onFailed,
  recovery,
  onClose,
  createRoom,
}: NewRoomPopupProps) {
  const [name] = useDisplayName();
  const initialAuthor = recovery?.input.author ?? name;

  async function submit(input: PostMessageInput): Promise<void> {
    const submitted: CreateRoomInput = { ...input, lat, lng }; // this request's snapshot
    let outcome;
    try {
      outcome = await (createRoom ?? api.rooms.create)(submitted);
    } catch (error) {
      // No "is mounted" guard here or below: the outcome takes over the panel
      // even after this popup has been closed or replaced (design decision 3).
      onFailed(submitted, error);
      throw error; // the form must not remember the name or clear the draft
    }
    if (outcome.status === "created") onCreated(outcome.room, outcome.message);
    else onConflict(outcome.room, { author: input.author, text: input.text });
  }

  return (
    <PanelFrame
      title="New chatroom"
      titleAdornment={<NewRoomInfo />}
      onClose={onClose}
      footer={
        // CardFooter is a row flexbox; the form needs the full width.
        <div className="w-full">
          <ComposeForm
            submitLabel="Create"
            initialAuthor={initialAuthor}
            initialText={recovery?.input.text}
            textareaClassName={BOUNDED_TEXTAREA_CLASS}
            autoFocusField={initialAuthor ? "text" : "author"}
            submitFailedMessage={CREATE_FAILED_MESSAGE}
            initialErrors={recovery ? submitErrors(recovery.error, CREATE_FAILED_MESSAGE) : undefined}
            onSubmit={submit}
          />
        </div>
      }
    >
      <p className="text-muted-foreground">
        Your first message creates a chatroom at {roundCoord(lat).toFixed(6)}, {roundCoord(lng).toFixed(6)}.
      </p>
    </PanelFrame>
  );
}
