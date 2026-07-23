// Tiny module-level event bus for global chat notifications.
// Used by useChatNotifications (publisher) and ChatPopupNotifier (subscriber)
// so we don't open a second realtime channel.

export type IncomingChatMessage = {
  id: string;
  room_id: string;
  sender_id: string;
  sender_email?: string | null;
  message_type: "text" | "voice" | "image" | "file" | string;
  body?: string | null;
  created_at?: string;
};

type Listener = (msg: IncomingChatMessage) => void;

const listeners = new Set<Listener>();

export const chatEvents = {
  emit(msg: IncomingChatMessage) {
    listeners.forEach((l) => {
      try { l(msg); } catch {}
    });
  },
  on(l: Listener) {
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
};
