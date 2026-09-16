// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PanelFrame } from "@/components/panel/PanelFrame";
import { WelcomeCard } from "@/components/panel/WelcomeCard";

afterEach(cleanup);

describe("PanelFrame", () => {
  it("renders the title, body and footer", () => {
    render(
      <PanelFrame title="Hello" footer={<span>footer here</span>}>
        <p>body here</p>
      </PanelFrame>,
    );

    expect(screen.getByText("Hello")).toBeTruthy();
    expect(screen.getByText("body here")).toBeTruthy();
    expect(screen.getByText("footer here")).toBeTruthy();
  });

  it("has no close button unless onClose is given", () => {
    render(
      <PanelFrame title="Hello">
        <p>body</p>
      </PanelFrame>,
    );

    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("renders a close button that calls onClose", () => {
    const onClose = vi.fn();
    render(
      <PanelFrame title="Hello" onClose={onClose}>
        <p>body</p>
      </PanelFrame>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders the title adornment next to the title", () => {
    render(
      <PanelFrame title="Hello" titleAdornment={<span data-testid="adornment">i</span>}>
        <p>body</p>
      </PanelFrame>,
    );

    expect(screen.getByTestId("adornment")).toBeTruthy();
  });
});

describe("WelcomeCard", () => {
  it("greets without a close button", () => {
    render(<WelcomeCard />);

    expect(screen.getByText("Map Chat")).toBeTruthy();
    expect(screen.getByText("Click on the map to start a chat")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });
});
