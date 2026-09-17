// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import NotFound, { NOT_FOUND_TEXT } from "@/app/not-found";

describe("not-found page", () => {
  it("says what happened and links back to the map", () => {
    render(<NotFound />);

    expect(screen.getByText("Not found")).toBeInTheDocument();
    expect(screen.getByText(NOT_FOUND_TEXT)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the map" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });
});
