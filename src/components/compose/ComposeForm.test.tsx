// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ComposeForm, type ComposeFormProps } from "@/components/compose/ComposeForm";
import { SUBMIT_FAILED_MESSAGE } from "@/components/compose/fieldErrors";
import { DISPLAY_NAME_KEY, writeDisplayName } from "@/lib/storage/displayName";
import { useDisplayName } from "@/lib/storage/useDisplayName";

const AUTHOR_ERROR = "Display name must be between 1 and 100 characters";
const TEXT_ERROR = "Message must be between 1 and 3000 characters";

function setup(props: Partial<ComposeFormProps> = {}) {
  const onSubmit = vi.fn<ComposeFormProps["onSubmit"]>(async () => {});
  const user = userEvent.setup();
  const view = render(<ComposeForm initialAuthor="" onSubmit={onSubmit} {...props} />);
  return {
    user,
    onSubmit,
    rerender: view.rerender,
    author: () => screen.getByLabelText("Display name"),
    text: () => screen.getByLabelText("Message"),
    submit: () => screen.getByRole("button", { name: props.submitLabel ?? "Send" }),
  };
}

/** Shaped like chunk 4's ApiValidationError without importing it. */
function validationError(fields: { path: string; message: string }[]): Error {
  return Object.assign(new Error("invalid"), { name: "ApiValidationError", fields });
}

beforeEach(() => {
  localStorage.clear();
});

describe("ComposeForm validation", () => {
  it("shows both field errors on an empty submit and does not call onSubmit", async () => {
    const { user, onSubmit, author, text, submit } = setup();

    await user.click(submit());

    expect(await screen.findByText(AUTHOR_ERROR)).toBeInTheDocument();
    expect(screen.getByText(TEXT_ERROR)).toBeInTheDocument();
    expect(author()).toHaveAttribute("aria-invalid", "true");
    expect(text()).toHaveAttribute("aria-invalid", "true");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects a 101-character name before calling onSubmit", async () => {
    const { user, onSubmit, author, text, submit } = setup();
    // fireEvent.change sets the whole value at once; user.type would type 101 keystrokes.
    fireEvent.change(author(), { target: { value: "a".repeat(101) } });
    await user.type(text(), "hello");

    await user.click(submit());

    expect(await screen.findByText(AUTHOR_ERROR)).toBeInTheDocument();
    expect(screen.queryByText(TEXT_ERROR)).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("clears earlier errors on a later valid submit", async () => {
    const { user, author, text, submit } = setup();
    await user.click(submit());
    expect(await screen.findByText(AUTHOR_ERROR)).toBeInTheDocument();

    await user.type(author(), "ann");
    await user.type(text(), "hello");
    await user.click(submit());

    await waitFor(() => expect(screen.queryByText(AUTHOR_ERROR)).not.toBeInTheDocument());
    expect(screen.queryByText(TEXT_ERROR)).not.toBeInTheDocument();
    expect(author()).not.toHaveAttribute("aria-invalid");
  });
});

describe("ComposeForm submit", () => {
  it("submits trimmed values, clears the message, keeps the name and remembers it", async () => {
    const { user, onSubmit, author, text, submit } = setup();
    await user.type(author(), "  ann ");
    await user.type(text(), " hello ");

    await user.click(submit());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ author: "ann", text: "hello" }));
    await waitFor(() => expect(text()).toHaveValue(""));
    expect(author()).toHaveValue("  ann ");
    expect(localStorage.getItem(DISPLAY_NAME_KEY)).toBe("ann");
  });

  it.each(["success", "failure"] as const)(
    "prevents editing and duplicate submits while pending, then handles %s",
    async (outcome) => {
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const { user, onSubmit, author, text, submit } = setup();
      onSubmit.mockImplementation(
        () => new Promise<void>((done, fail) => { resolve = done; reject = fail; }),
      );
      await user.type(author(), "ann");
      await user.type(text(), "hello");

      await user.click(submit());
      await waitFor(() => expect(submit()).toBeDisabled());
      expect(author()).toBeDisabled();
      expect(text()).toBeDisabled();
      await user.type(author(), "other name");
      await user.type(text(), "second, unsent draft");
      await user.click(submit());
      expect(author()).toHaveValue("ann");
      expect(text()).toHaveValue("hello");
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith({ author: "ann", text: "hello" });

      await act(async () => {
        if (outcome === "success") resolve();
        else reject(new TypeError("Failed to fetch"));
      });
      expect(submit()).toBeEnabled();
      expect(author()).toBeEnabled();
      expect(text()).toBeEnabled();
      expect(author()).toHaveValue("ann");
      if (outcome === "success") {
        expect(text()).toHaveValue("");
        expect(localStorage.getItem(DISPLAY_NAME_KEY)).toBe("ann");
      } else {
        expect(text()).toHaveValue("hello");
        expect(screen.getByRole("alert")).toHaveTextContent(SUBMIT_FAILED_MESSAGE);
        expect(localStorage.getItem(DISPLAY_NAME_KEY)).toBeNull();
      }
    },
  );

  it("maps a server validation error to its field and keeps the drafts", async () => {
    const { user, onSubmit, author, text, submit } = setup();
    onSubmit.mockRejectedValueOnce(
      validationError([{ path: "text", message: "must be between 1 and 3000 characters" }]),
    );
    await user.type(author(), "ann");
    await user.type(text(), "hello");

    await user.click(submit());

    expect(await screen.findByText(TEXT_ERROR)).toBeInTheDocument();
    expect(text()).toHaveValue("hello");
    expect(author()).toHaveValue("ann");
    expect(text()).toHaveAttribute("aria-invalid", "true");
    expect(localStorage.getItem(DISPLAY_NAME_KEY)).toBeNull();
  });

  it("shows a form-level message when the request fails and keeps the drafts", async () => {
    const { user, onSubmit, author, text, submit } = setup();
    onSubmit.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await user.type(author(), "ann");
    await user.type(text(), "hello");

    await user.click(submit());

    expect(await screen.findByRole("alert")).toHaveTextContent(SUBMIT_FAILED_MESSAGE);
    expect(text()).toHaveValue("hello");
    expect(author()).toHaveValue("ann");
    expect(submit()).toBeEnabled();
  });

  it("shows the server's message for an unavailable request error", async () => {
    const message = "Could not find a free room name, please try again";
    const { user, onSubmit, author, text, submit } = setup();
    onSubmit.mockRejectedValueOnce(
      Object.assign(new Error(message), { name: "ApiRequestError", status: 503, code: "unavailable" }),
    );
    await user.type(author(), "ann");
    await user.type(text(), "hello");

    await user.click(submit());

    expect(await screen.findByText(message)).toBeInTheDocument();
  });
});

describe("ComposeForm props", () => {
  it("prefills the name and the message", () => {
    const { author, text } = setup({ initialAuthor: "ann", initialText: "draft" });
    expect(author()).toHaveValue("ann");
    expect(text()).toHaveValue("draft");
  });

  it("adopts a display name that arrives after mount while the field is untouched", async () => {
    const { user, onSubmit, rerender, author } = setup();
    expect(author()).toHaveValue("");

    rerender(<ComposeForm initialAuthor="ann" onSubmit={onSubmit} />);
    expect(author()).toHaveValue("ann");

    await user.type(author(), "e");
    rerender(<ComposeForm initialAuthor="zed" onSubmit={onSubmit} />);
    expect(author()).toHaveValue("anne");
  });

  it("hydrates an empty server field, adopts storage, and preserves a later user edit", async () => {
    localStorage.setItem(DISPLAY_NAME_KEY, "ann");
    const onSubmit = vi.fn<ComposeFormProps["onSubmit"]>(async () => {});
    const onRecoverableError = vi.fn();
    function StoredCompose() {
      const [name] = useDisplayName();
      return <ComposeForm initialAuthor={name} onSubmit={onSubmit} />;
    }

    const container = document.createElement("div");
    container.innerHTML = renderToString(<StoredCompose />);
    document.body.appendChild(container);
    const author = () => within(container).getByLabelText("Display name");
    let root: Root | undefined;
    try {
      expect(author()).toHaveValue("");
      await act(async () => {
        root = hydrateRoot(container, <StoredCompose />, { onRecoverableError });
      });
      await waitFor(() => expect(author()).toHaveValue("ann"));
      expect(onRecoverableError).not.toHaveBeenCalled();

      const user = userEvent.setup();
      await user.type(author(), "e");
      act(() => writeDisplayName("bob"));
      expect(author()).toHaveValue("anne");
      expect(onRecoverableError).not.toHaveBeenCalled();
    } finally {
      // hydrateRoot is created outside RTL, so its cleanup must be explicit.
      await act(async () => { root?.unmount(); });
      container.remove();
    }
  });

  it("passes textareaClassName to the message field only", () => {
    const { author, text } = setup({ textareaClassName: "field-sizing-fixed h-16" });
    expect(text()).toHaveClass("field-sizing-fixed", "h-16");
    expect(text()).not.toHaveClass("field-sizing-content"); // the default sizing is replaced, not doubled
    expect(author()).not.toHaveClass("h-16");
  });

  it("keeps the content-sized message field by default", () => {
    const { text } = setup();
    expect(text()).toHaveClass("field-sizing-content");
  });

  it("uses submitLabel for the button", () => {
    const { submit } = setup({ submitLabel: "Create" });
    expect(submit()).toHaveTextContent("Create");
  });

  it("disables every control when disabled", () => {
    const { author, text, submit } = setup({ disabled: true });
    expect(author()).toBeDisabled();
    expect(text()).toBeDisabled();
    expect(submit()).toBeDisabled();
  });
});

describe("ComposeForm counters", () => {
  it("starts at the limits", () => {
    setup();
    expect(screen.getByText("100 characters left")).toBeInTheDocument();
    expect(screen.getByText("3000 characters left")).toBeInTheDocument();
  });

  it("counts code points, not UTF-16 units", () => {
    const { text } = setup();
    // Two astral characters: 4 UTF-16 units, 2 code points.
    fireEvent.change(text(), { target: { value: "\u{1D518}\u{1D518}" } });
    expect(screen.getByText("2998 characters left")).toBeInTheDocument();
  });

  it("goes negative past the limit and uses the singular form at one", () => {
    const { author } = setup();
    fireEvent.change(author(), { target: { value: "a".repeat(101) } });
    expect(screen.getByText("-1 characters left")).toBeInTheDocument();
    fireEvent.change(author(), { target: { value: "a".repeat(99) } });
    expect(screen.getByText("1 character left")).toBeInTheDocument();
  });
});
