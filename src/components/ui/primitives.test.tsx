// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// Proves the component-test toolchain: jsdom, Testing Library, user-event,
// the jest-dom matchers from vitest.setup.ts, and the shadcn primitives.
describe("form primitives", () => {
  it("renders a labelled input the user can type into", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Label htmlFor="name">Display name</Label>
        <Input id="name" />
      </>,
    );

    const input = screen.getByLabelText("Display name");
    await user.type(input, "ann");

    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("ann");
  });

  it("renders a textarea that keeps line breaks", async () => {
    const user = userEvent.setup();
    render(<Textarea aria-label="Message" />);

    const textarea = screen.getByLabelText("Message");
    await user.type(textarea, "a{Enter}b");

    expect(textarea).toHaveValue("a\nb");
  });

  it("cleans the document between tests", () => {
    expect(screen.queryByLabelText("Message")).not.toBeInTheDocument();
  });
});
