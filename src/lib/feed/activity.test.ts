// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { attachActivityTracking } from "@/lib/feed/activity";

/** A panel-like root with a scrollable list and a field inside it. */
function mount() {
  const root = document.createElement("div");
  const list = document.createElement("div");
  const field = document.createElement("textarea");
  root.append(list, field);
  document.body.append(root);
  return { root, list, field };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("attachActivityTracking", () => {
  it.each(["pointerdown", "pointermove", "keydown", "wheel", "touchstart"])(
    "reports %s from a descendant",
    (type) => {
      const { root, field } = mount();
      const onActivity = vi.fn();
      attachActivityTracking(root, { onActivity });

      field.dispatchEvent(new Event(type, { bubbles: true }));

      expect(onActivity).toHaveBeenCalledTimes(1);
    },
  );

  it("reports a descendant's scroll, which does not bubble", () => {
    const { root, list } = mount();
    const onActivity = vi.fn();
    attachActivityTracking(root, { onActivity });

    list.dispatchEvent(new Event("scroll")); // bubbles: false, as in a browser

    expect(onActivity).toHaveBeenCalledTimes(1);
  });

  it("ignores events outside the element and events that are not activity", () => {
    const { root, field } = mount();
    const onActivity = vi.fn();
    attachActivityTracking(root, { onActivity });

    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    field.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));

    expect(onActivity).not.toHaveBeenCalled();
  });

  it("delegates an owned scroll target without ignoring other activity", () => {
    const { root, list, field } = mount();
    const onActivity = vi.fn();
    attachActivityTracking(root, { onActivity, ignoreScroll: (target) => target === list });
    list.dispatchEvent(new Event("scroll"));
    expect(onActivity).not.toHaveBeenCalled();
    field.dispatchEvent(new Event("scroll"));
    list.dispatchEvent(new Event("wheel", { bubbles: true }));
    expect(onActivity).toHaveBeenCalledTimes(2);
  });

  it("registers every listener as passive", () => {
    const { root } = mount();
    const add = vi.spyOn(root, "addEventListener");

    attachActivityTracking(root, { onActivity: () => {} });

    expect(add).toHaveBeenCalledTimes(6);
    for (const [, , options] of add.mock.calls) expect(options).toMatchObject({ passive: true });
  });

  it("stops reporting after detach, scroll included", () => {
    const { root, list, field } = mount();
    const onActivity = vi.fn();
    const detach = attachActivityTracking(root, { onActivity });

    detach();
    field.dispatchEvent(new Event("keydown", { bubbles: true }));
    list.dispatchEvent(new Event("scroll"));

    expect(onActivity).not.toHaveBeenCalled();
  });
});
