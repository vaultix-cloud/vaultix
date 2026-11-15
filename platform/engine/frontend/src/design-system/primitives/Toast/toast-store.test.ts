import { describe, expect, it } from "vitest";

import { createToastStore, durationFor } from "./toast-store";

describe("durationFor", () => {
  it("gives each tone its default", () => {
    expect(durationFor({ title: "Saved", tone: "success" })).toBe(6000);
    expect(durationFor({ title: "Check this", tone: "warning" })).toBe(10000);
    expect(durationFor({ title: "Failed", tone: "danger" })).toBe(Number.POSITIVE_INFINITY);
    expect(durationFor({ title: "Plain" })).toBe(6000);
  });

  it("keeps a toast with an action for at least ten seconds", () => {
    const action = { label: "Undo", onAction: () => undefined };
    expect(durationFor({ title: "Deleted", action })).toBe(10000);
    expect(durationFor({ title: "Deleted", action, duration: 3000 })).toBe(10000);
    expect(durationFor({ title: "Deleted", action, duration: 20000 })).toBe(20000);
  });
});

describe("toast store", () => {
  it("adds, dismisses and notifies in order", () => {
    const store = createToastStore();
    let calls = 0;
    const stop = store.subscribe(() => {
      calls += 1;
    });
    const first = store.show({ title: "One" });
    const second = store.show({ title: "Two", tone: "danger" });
    expect(store.snapshot().map((item) => item.title)).toEqual(["One", "Two"]);
    expect(store.snapshot()[1].duration).toBe(Number.POSITIVE_INFINITY);
    store.dismiss(first);
    expect(store.snapshot().map((item) => item.id)).toEqual([second]);
    store.dismiss(first);
    expect(calls).toBe(3);
    stop();
    store.clear();
    expect(calls).toBe(3);
    expect(store.snapshot()).toEqual([]);
  });
});
