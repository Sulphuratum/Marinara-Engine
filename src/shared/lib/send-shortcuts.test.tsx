import { describe, expect, it } from "vitest";
import { isSendShortcut } from "./send-shortcuts";

function keyEvent(overrides: Partial<Parameters<typeof isSendShortcut>[0]> = {}) {
  return {
    key: "Enter",
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    ...overrides,
  };
}

describe("isSendShortcut", () => {
  it("sends on plain Enter only when Enter-to-send is enabled", () => {
    expect(isSendShortcut(keyEvent(), true)).toBe(true);
    expect(isSendShortcut(keyEvent(), false)).toBe(false);
  });

  it("sends on Ctrl+Enter or Command+Enter when Enter-to-send is disabled", () => {
    expect(isSendShortcut(keyEvent({ ctrlKey: true }), false)).toBe(true);
    expect(isSendShortcut(keyEvent({ metaKey: true }), false)).toBe(true);
  });

  it("keeps Shift+Enter and IME composition from sending", () => {
    expect(isSendShortcut(keyEvent({ shiftKey: true, ctrlKey: true }), false)).toBe(false);
    expect(isSendShortcut(keyEvent({ nativeEvent: { isComposing: true }, ctrlKey: true }), false)).toBe(false);
  });
});
