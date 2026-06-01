type SendShortcutEvent = {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  nativeEvent?: {
    isComposing?: boolean;
  };
};

export function isSendShortcut(event: SendShortcutEvent, enterToSend: boolean): boolean {
  if (event.nativeEvent?.isComposing) return false;
  if (event.key !== "Enter") return false;
  if (event.shiftKey) return false;
  return enterToSend || event.ctrlKey || event.metaKey;
}
