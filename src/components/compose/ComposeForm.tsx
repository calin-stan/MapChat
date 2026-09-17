"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import {
  SUBMIT_FAILED_MESSAGE,
  submitErrors,
  toComposeErrors,
  type ComposeErrors,
} from "@/components/compose/fieldErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fieldIssues } from "@/lib/api/errors";
import { countChars } from "@/lib/schemas/common";
import {
  AUTHOR_MAX_CHARS,
  TEXT_MAX_CHARS,
  postMessageInputSchema,
  type PostMessageInput,
} from "@/lib/schemas/message";
import { writeDisplayName } from "@/lib/storage/displayName";

/** Limits from PRD 4, in code points after trimming; the counters use the raw value. */
export const AUTHOR_MAX = AUTHOR_MAX_CHARS;
export const TEXT_MAX = TEXT_MAX_CHARS;

/**
 * A fixed 64 px message field that scrolls inside itself (room-panel design
 * §4.1), so a long draft never pushes the submit button out of the panel slot.
 * Pass it as `textareaClassName`; the room panel and the new-room popup both do.
 */
export const BOUNDED_TEXTAREA_CLASS = "field-sizing-fixed h-16 resize-none overflow-y-auto";

export type ComposeFormProps = {
  /** Shown in the name field until the user edits it; a later value is adopted while untouched. */
  initialAuthor: string;
  /** Shown in the message field until the user edits it (chunk 10's 409 hand-off). */
  initialText?: string;
  /** Submit button text. */
  submitLabel?: string;
  /** Disables every control, for example while the room is unavailable. */
  disabled?: boolean;
  /** Extra classes for the message field; the room panel bounds its height with this. */
  textareaClassName?: string;
  /** Focus this field once, the first time the form is enabled after mount. */
  autoFocusField?: "author" | "text";
  /** Replaces SUBMIT_FAILED_MESSAGE for rejections that are neither validation nor `unavailable`. */
  submitFailedMessage?: string;
  /** Errors for this form mount; used to restore a rejected create. Later values are ignored. */
  initialErrors?: ComposeErrors;
  /**
   * Receives the trimmed, validated values. Reject with chunk 4's
   * `ApiValidationError` to show its fields inline; any other rejection shows
   * a form-level message. Drafts survive every rejection.
   */
  onSubmit(input: PostMessageInput): Promise<void>;
};

/**
 * The one compose form shared by the "New chatroom" popup and the room panel
 * (PRD 6.7). Validates with the shared schema, shows per-field errors and
 * remaining-character counters, disables all controls while a request is pending,
 * clears the message only after success and remembers the display name then
 * (PRD 4 "Compose behavior", Flow B step 4).
 */
export function ComposeForm({
  initialAuthor,
  initialText = "",
  submitLabel = "Send",
  disabled = false,
  textareaClassName,
  autoFocusField,
  submitFailedMessage = SUBMIT_FAILED_MESSAGE,
  initialErrors,
  onSubmit,
}: ComposeFormProps) {
  const id = useId();
  const authorId = `${id}-author`;
  const textId = `${id}-text`;

  // null = untouched: the field shows the prop, so a remembered name that
  // arrives after hydration (see useDisplayName) is adopted without an effect.
  const [authorDraft, setAuthorDraft] = useState<string | null>(null);
  const [textDraft, setTextDraft] = useState<string | null>(null);
  const [errors, setErrors] = useState<ComposeErrors>(() => initialErrors ?? {});
  const [pending, setPending] = useState(false);

  // Focus once, the first time the form is enabled. An effect rather than the
  // `autoFocus` attribute, which cannot wait for a form that mounts disabled.
  const authorRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (autoFocusField === undefined || focused.current || disabled || pending) return;
    focused.current = true;
    (autoFocusField === "author" ? authorRef : textRef).current?.focus();
  }, [autoFocusField, disabled, pending]);

  const author = authorDraft ?? initialAuthor;
  const text = textDraft ?? initialText;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || pending) return;

    const parsed = postMessageInputSchema.safeParse({ author, text });
    if (!parsed.success) {
      setErrors(toComposeErrors(fieldIssues(parsed.error)));
      return;
    }

    // Valid: drop stale messages now, so none show while the request is pending.
    setErrors({});
    setPending(true);
    try {
      await onSubmit(parsed.data);
      writeDisplayName(parsed.data.author);
      setTextDraft("");
    } catch (error) {
      setErrors(submitErrors(error, submitFailedMessage));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-busy={pending}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={authorId}>Display name</Label>
        <Input
          ref={authorRef}
          id={authorId}
          name="author"
          autoComplete="nickname"
          value={author}
          onChange={(event) => setAuthorDraft(event.target.value)}
          disabled={disabled || pending}
          aria-invalid={errors.author ? true : undefined}
          aria-describedby={errors.author ? `${authorId}-error` : undefined}
        />
        <FieldFooter
          label="Display name"
          error={errors.author}
          errorId={`${authorId}-error`}
          left={AUTHOR_MAX - countChars(author)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={textId}>Message</Label>
        <Textarea
          ref={textRef}
          id={textId}
          name="text"
          rows={3}
          className={textareaClassName}
          value={text}
          onChange={(event) => setTextDraft(event.target.value)}
          disabled={disabled || pending}
          aria-invalid={errors.text ? true : undefined}
          aria-describedby={errors.text ? `${textId}-error` : undefined}
        />
        <FieldFooter
          label="Message"
          error={errors.text}
          errorId={`${textId}-error`}
          left={TEXT_MAX - countChars(text)}
        />
      </div>

      {errors.form ? (
        <p role="alert" className="text-sm text-destructive">
          {errors.form}
        </p>
      ) : null}

      <Button type="submit" disabled={disabled || pending} className="self-end">
        {submitLabel}
      </Button>
    </form>
  );
}

type FieldFooterProps = {
  label: string;
  error: string | undefined;
  errorId: string;
  /** Characters left before the limit; negative when over it. */
  left: number;
};

/** Error text on the left (prefixed with the field label), counter on the right. */
function FieldFooter({ label, error, errorId, left }: FieldFooterProps) {
  return (
    <div className="flex items-start justify-between gap-2 text-xs">
      {error ? (
        <p id={errorId} className="text-destructive">
          {label} {error}
        </p>
      ) : (
        <span />
      )}
      <span className={left < 0 ? "text-destructive tabular-nums" : "text-muted-foreground tabular-nums"}>
        {charactersLeft(left)}
      </span>
    </div>
  );
}

function charactersLeft(left: number): string {
  return `${left} ${left === 1 ? "character" : "characters"} left`;
}
