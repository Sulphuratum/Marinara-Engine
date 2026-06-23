export const CHAT_FLOATING_UI_DISMISS_EVENT = "marinara:chat-floating-ui-dismiss";

export function announceChatFloatingUiDismiss() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CHAT_FLOATING_UI_DISMISS_EVENT));
}
