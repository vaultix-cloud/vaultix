// A tiny store for toasts so any code can raise one with toast(...) and one <Toaster /> shows
// them. Pure apart from the module state, and unit tested.

export type TToastTone = "info" | "success" | "warning" | "danger";

export type TToastInput = {
  title: string;
  description?: string;
  tone?: TToastTone;
  action?: { label: string; onAction: () => void };
  // Milliseconds before it closes on its own; Infinity keeps it until dismissed.
  duration?: number;
};

export type TToast = Required<Pick<TToastInput, "title" | "tone" | "duration">> &
  Omit<TToastInput, "title" | "tone" | "duration"> & { id: number };

const BASE_MS: Record<TToastTone, number> = {
  info: 6000,
  success: 6000,
  warning: 10000,
  // A failure stays until someone has read it and closed it.
  danger: Number.POSITIVE_INFINITY
};

// Something to act on (Undo, Retry) needs time to reach by keyboard: at least ten seconds.
const ACTION_MIN_MS = 10000;

export const durationFor = (input: TToastInput): number => {
  const tone = input.tone ?? "info";
  const requested = input.duration ?? BASE_MS[tone];
  return input.action ? Math.max(requested, ACTION_MIN_MS) : requested;
};

type TListener = () => void;

const createToastStore = () => {
  let toasts: TToast[] = [];
  let nextId = 1;
  const listeners = new Set<TListener>();
  const emit = () => listeners.forEach((listener) => listener());

  return {
    show(input: TToastInput) {
      const id = nextId;
      nextId += 1;
      toasts = [
        ...toasts,
        { ...input, id, tone: input.tone ?? "info", duration: durationFor(input) }
      ];
      emit();
      return id;
    },
    dismiss(id: number) {
      const next = toasts.filter((item) => item.id !== id);
      if (next.length === toasts.length) return;
      toasts = next;
      emit();
    },
    clear() {
      toasts = [];
      emit();
    },
    subscribe(listener: TListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => toasts
  };
};

export const toastStore = createToastStore();
export const toast = (input: TToastInput) => toastStore.show(input);
export const dismissToast = (id: number) => toastStore.dismiss(id);
export { createToastStore };
