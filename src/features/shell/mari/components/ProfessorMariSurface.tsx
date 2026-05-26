import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ChevronUp,
  CircleUser,
  FileDiff,
  FileText,
  Link,
  Paperclip,
  Send,
  Sparkles,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import {
  isMariStagedAction,
  normalizeMariApprovalOutcome,
  normalizeMariApprovalRequest,
  runProfessorMariEntry,
  type MariApprovalRequest,
  type MariEntryAction,
  type MariFileChange,
  type MariMessage,
  type MariStorageAction,
  type MariTraceEvent,
} from "../../../../engine/mari/mari-entry";
import { mariApi } from "../../../../shared/api/mari-api";
import { useConnections } from "../../../catalog/connections/index";
import { usePersonas } from "../../../catalog/characters/index";
import { filterLanguageGenerationConnections } from "../../../../shared/lib/connection-filters";
import { cn, getAvatarCropStyle, parseAvatarCropJson } from "../../../../shared/lib/utils";
import { useUIStore } from "../../../../shared/stores/ui.store";

const MARI_AVATAR_URL = "/sprites/mari/Mari_profile.png";
const MARI_THINKING_URL = "/sprites/mari/Mari_thinking.png";
const MARI_WAVE_URL = "/sprites/mari/Mari_wave.png";
const MARI_WORKING_URL = "/sprites/mari/Mari_point_down_left.png";

type MariAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  content: string;
};

type MariConnection = {
  id: string;
  name?: string;
  provider?: string;
};

type MariPersona = {
  id: string;
  name: string;
  avatarPath?: string | null;
  avatarCrop?: string;
  comment?: string | null;
  description?: string | null;
  personality?: string | null;
  scenario?: string | null;
  backstory?: string | null;
  appearance?: string | null;
};

type MariOptionPanel = "connections" | "personas";

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatDaySeparator(value: string) {
  const date = new Date(value);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const messageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - messageDay.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function getDayKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatTime(value: string) {
  const date = new Date(value);
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatErrorDetails(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  const details = "details" in record ? record.details : record;
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

export function ProfessorMariSurface() {
  const queryClient = useQueryClient();
  const { data: rawConnections } = useConnections();
  const { data: rawPersonas } = usePersonas();
  const convoGradient = useUIStore((s) => s.convoGradient);
  const theme = useUIStore((s) => s.theme);
  const [messages, setMessages] = useState<MariMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<MariAttachment[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [optionPanel, setOptionPanel] = useState<MariOptionPanel | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendErrorDetails, setSendErrorDetails] = useState<string | null>(null);
  const [liveTrace, setLiveTrace] = useState<MariTraceEvent[]>([]);
  const [pendingApproval, setPendingApproval] = useState<MariApprovalRequest | null>(null);
  const [resolvingApproval, setResolvingApproval] = useState<"approve" | "reject" | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<MariEntryAction | null>(null);
  const [applyingAction, setApplyingAction] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLElement>(null);
  const spriteMeasureRef = useRef<HTMLDivElement>(null);
  const [spriteSafeInset, setSpriteSafeInset] = useState(0);
  const canSend = (draft.trim().length > 0 || attachments.length > 0) && !sending && !pendingApproval && !resolvingApproval && !applyingAction;
  const connections = useMemo(
    () =>
      filterLanguageGenerationConnections((rawConnections ?? []) as MariConnection[]).sort((a, b) =>
        (a.name || a.id).localeCompare(b.name || b.id),
      ),
    [rawConnections],
  );
  const personas = useMemo(
    () => ((rawPersonas ?? []) as MariPersona[]).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [rawPersonas],
  );
  const selectedConnection = connections.find((connection) => connection.id === selectedConnectionId) ?? null;
  const selectedPersona = personas.find((persona) => persona.id === selectedPersonaId) ?? null;
  const hasToolActivity = liveTrace.some((event) => event.type === "tool_result" || !!event.tool || (Array.isArray(event.toolCalls) && event.toolCalls.length > 0));
  const mariStage = sendError
    ? { src: MARI_THINKING_URL, mood: "thinking" as const }
    : pendingApproval
      ? { src: MARI_WORKING_URL, mood: "working" as const }
      : sending
        ? hasToolActivity
          ? { src: MARI_WORKING_URL, mood: "working" as const }
          : { src: MARI_THINKING_URL, mood: "thinking" as const }
        : { src: MARI_WAVE_URL, mood: "idle" as const };
  const gradientStyle = useMemo(() => {
    const gradient = convoGradient[theme];
    const isDefaultDark = convoGradient.dark.from === "#0a0a0e" && convoGradient.dark.to === "#1c2133";
    const isDefaultLight = convoGradient.light.from === "#f2eff7" && convoGradient.light.to === "#eae6f0";
    if ((theme === "dark" && isDefaultDark) || (theme === "light" && isDefaultLight)) {
      return {
        background:
          "radial-gradient(circle at 20% 0%, color-mix(in oklab, var(--primary) 12%, transparent), transparent 22rem), var(--secondary)",
      };
    }
    return {
      background: `radial-gradient(circle at 20% 0%, color-mix(in oklab, var(--primary) 14%, transparent), transparent 22rem), linear-gradient(135deg, ${gradient.from}, ${gradient.to})`,
    };
  }, [convoGradient, theme]);
  const surfaceStyle = useMemo(() => {
    const bubbleOverlap = Math.min(spriteSafeInset * 0.28, 48);
    return {
      ...gradientStyle,
      "--mari-sprite-safe": `${spriteSafeInset}px`,
      "--mari-chat-gutter": `${Math.max(0, spriteSafeInset - bubbleOverlap)}px`,
      "--mari-bubble-overlap": `${bubbleOverlap}px`,
    } as CSSProperties;
  }, [gradientStyle, spriteSafeInset]);

  useEffect(() => {
    const updateSpriteSafeInset = () => {
      const surfaceWidth = surfaceRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      const spriteWidth = spriteMeasureRef.current?.getBoundingClientRect().width ?? 0;
      const roomFactor = Math.max(0, Math.min(1, (surfaceWidth - 520) / 320));
      const visualOverlap = Math.min(spriteWidth * 0.22, 56);
      const nextInset = Math.max(0, Math.round((spriteWidth - visualOverlap) * roomFactor));
      setSpriteSafeInset((current) => (Math.abs(current - nextInset) > 1 ? nextInset : current));
    };

    updateSpriteSafeInset();
    window.addEventListener("resize", updateSpriteSafeInset);
    const observers: ResizeObserver[] = [];
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateSpriteSafeInset);
      if (surfaceRef.current) observer.observe(surfaceRef.current);
      if (spriteMeasureRef.current) observer.observe(spriteMeasureRef.current);
      observers.push(observer);
    }
    return () => {
      window.removeEventListener("resize", updateSpriteSafeInset);
      observers.forEach((observer) => observer.disconnect());
    };
  }, [mariStage.src]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, liveTrace.length, pendingApproval?.id]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${Math.min(input.scrollHeight, 148)}px`;
  }, [draft]);

  const readFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const nextAttachments = await Promise.all(
      Array.from(files).map(
        (file) =>
          new Promise<MariAttachment>((resolve, reject) => {
            const finish = (content: string) =>
              resolve({
                id: newId("mari-file"),
                name: file.name,
                type: file.type || "application/octet-stream",
                size: file.size,
                content,
              });
            if (file.type.startsWith("image/")) {
              const reader = new FileReader();
              reader.onload = () => finish(String(reader.result ?? ""));
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(file);
              return;
            }
            file.text().then(finish).catch(reject);
          }),
      ),
    );
    setAttachments((current) => [...current, ...nextAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const send = async () => {
    const userMessage = draft.trim() || (attachments.length > 0 ? "[attachments]" : "");
    if (!userMessage || sending) return;
    const createdAt = new Date().toISOString();
    const user: MariMessage = {
      id: newId("mari-user"),
      role: "user",
      content: userMessage,
      createdAt,
    };
    const currentMessages = messages;
    const currentAttachments = attachments;
    setMessages((current) => [...current, user]);
    setDraft("");
    setAttachments([]);
    setSendError(null);
    setSendErrorDetails(null);
    setActionError(null);
    setApprovalError(null);
    setResolvingApproval(null);
    setPendingApproval(null);
    setPendingAction(null);
    setLiveTrace([]);
    setSending(true);
    setOptionPanel(null);
    requestAnimationFrame(() => inputRef.current?.focus());
    let response;
    try {
      response = await runProfessorMariEntry(
        {
          userMessage,
          messages: currentMessages,
          connectionId: selectedConnection?.id ?? null,
          persona: selectedPersona
            ? {
                id: selectedPersona.id,
                name: selectedPersona.name,
                comment: selectedPersona.comment ?? null,
                description: selectedPersona.description ?? null,
                personality: selectedPersona.personality ?? null,
                scenario: selectedPersona.scenario ?? null,
                backstory: selectedPersona.backstory ?? null,
                appearance: selectedPersona.appearance ?? null,
              }
            : null,
          attachments: currentAttachments.map((attachment) => ({
            id: attachment.id,
            name: attachment.name,
            type: attachment.type,
            size: attachment.size,
            content: attachment.content,
          })),
        },
        {
          prompt: (request) =>
            mariApi.prompt(request, (event) => {
              if (event.type === "trace") {
                setLiveTrace((current) => [...current, event.event]);
                return;
              }
              if (event.type === "approval_request") {
                const approval = normalizeMariApprovalRequest(event.approval);
                if (approval) {
                  setPendingApproval(approval);
                  setResolvingApproval(null);
                  setApprovalError(null);
                }
                return;
              }
              if (event.type === "approval_resolved") {
                const outcome = normalizeMariApprovalOutcome(event.outcome);
                const applied = event.applied ?? outcome?.applied ?? null;
                if (event.approved && applied && applied.applied > 0) {
                  void queryClient.invalidateQueries();
                }
                setPendingApproval((current) => (current?.id === event.approvalId ? null : current));
                setResolvingApproval(null);
                if (event.error || outcome?.error) {
                  setApprovalError(event.error ?? outcome?.error ?? null);
                } else {
                  setApprovalError(null);
                }
              }
            }),
        },
      );
    } catch (error) {
      console.error("Professor Mari failed to respond", error);
      setSendError(error instanceof Error ? error.message : "Professor Mari failed to respond.");
      setSendErrorDetails(formatErrorDetails(error));
      setPendingApproval(null);
      setResolvingApproval(null);
      setSending(false);
      return;
    }
    const assistant: MariMessage = {
      id: newId("mari-assistant"),
      role: "assistant",
      content: response.content,
      createdAt: response.createdAt,
      trace: response.trace,
    };
    setMessages((current) => [...current, assistant]);
    setPendingApproval(null);
    setResolvingApproval(null);
    setPendingAction(isMariStagedAction(response.action) && response.action.changes.length > 0 ? response.action : null);
    setLiveTrace([]);
    setSending(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const resolvePendingApproval = async (approved: boolean) => {
    if (!pendingApproval || resolvingApproval) return;
    setResolvingApproval(approved ? "approve" : "reject");
    setApprovalError(null);
    try {
      await mariApi.resolveApproval(pendingApproval.id, approved);
    } catch (error) {
      console.error("Professor Mari failed to resolve approval", error);
      setApprovalError(error instanceof Error ? error.message : "Professor Mari failed to resolve the approval.");
      setResolvingApproval(null);
    }
  };

  const approvePendingChanges = async () => {
    if (!isMariStagedAction(pendingAction) || pendingAction.storageActions.length === 0 || applyingAction) return;
    setApplyingAction(true);
    setActionError(null);
    try {
      const result = await mariApi.applyStagedChanges(pendingAction);
      setPendingAction(null);
      await queryClient.invalidateQueries();
      setMessages((current) => [
        ...current,
        {
          id: newId("mari-assistant"),
          role: "assistant",
          content: `Saved ${result.applied} staged change${result.applied === 1 ? "" : "s"} to your library.`,
          createdAt: result.appliedAt ?? new Date().toISOString(),
        },
      ]);
    } catch (error) {
      console.error("Professor Mari failed to apply staged changes", error);
      setActionError(error instanceof Error ? error.message : "Professor Mari failed to apply staged changes.");
    } finally {
      setApplyingAction(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const rejectPendingChanges = () => {
    if (applyingAction) return;
    setPendingAction(null);
    setActionError(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <section ref={surfaceRef} className="mari-chat-area relative flex h-full flex-col overflow-hidden text-[var(--foreground)]" style={surfaceStyle}>
      <div className="pointer-events-none absolute inset-0 opacity-[0.045] [background-image:linear-gradient(var(--foreground)_1px,transparent_1px),linear-gradient(90deg,var(--foreground)_1px,transparent_1px)] [background-size:26px_26px]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-[var(--primary)]/10 to-transparent" />
      <MariStageSprite src={mariStage.src} mood={mariStage.mood} measureRef={spriteMeasureRef} />

      <div className="mari-messages-scroll relative z-10 flex-1 overflow-y-auto overflow-x-hidden">
        <main className="relative flex min-h-full w-full flex-col px-4 pb-4 pt-4 sm:px-6 sm:pt-5 lg:px-8">
          <div className="flex-1 space-y-3 pb-32 sm:pb-40" style={{ width: "calc(100% - var(--mari-chat-gutter))", maxWidth: "100%" }}>
            <MariConversation messages={messages} persona={selectedPersona} />
            {sending && <MariLiveMessage events={liveTrace} />}
            {pendingApproval && (
              <MariApprovalPanel
                approval={pendingApproval}
                resolving={resolvingApproval}
                error={approvalError}
                onApprove={() => void resolvePendingApproval(true)}
                onReject={() => void resolvePendingApproval(false)}
              />
            )}
            {pendingAction && (
              <MariStagedChangesPanel
                action={pendingAction}
                applying={applyingAction}
                error={actionError}
                onApprove={() => void approvePendingChanges()}
                onReject={rejectPendingChanges}
              />
            )}
            {sendError && <MariErrorMessage message={sendError} details={sendErrorDetails} />}
            <div ref={messagesEndRef} className="h-1" />
          </div>
        </main>
      </div>

      <footer className="relative z-30 px-4 pb-4 sm:px-6 lg:px-8">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.txt,.md,.markdown,.json,.jsonl,.csv,.log,.xml,.yaml,.yml"
          multiple
          className="hidden"
          onChange={(event) => void readFiles(event.target.files)}
        />

        {optionPanel && (
          <MariOptionPanel
            mode={optionPanel}
            connections={connections}
            personas={personas}
            selectedConnectionId={selectedConnectionId}
            selectedPersonaId={selectedPersonaId}
            onModeChange={setOptionPanel}
            onSelectConnection={(id) => {
              setSelectedConnectionId(id);
              setOptionPanel(null);
            }}
            onSelectPersona={(id) => {
              setSelectedPersonaId(id);
              setOptionPanel(null);
            }}
          />
        )}

        <MariAttachmentTray attachments={attachments} onRemove={(id) => setAttachments((current) => current.filter((item) => item.id !== id))} />

        <div className="relative flex flex-wrap items-center gap-1.5 gap-y-2 rounded-2xl border-2 border-[var(--border)] bg-[var(--card)] px-2.5 py-2.5 transition-all duration-200 dark:bg-black/40 sm:flex-nowrap sm:gap-2 sm:px-4">
          <div className="hidden items-center gap-1.5 sm:flex">
            <MariAttachButton count={attachments.length} onClick={() => fileInputRef.current?.click()} />
            <MariConnectionSwitcherButton
              selectedConnection={selectedConnection}
              open={optionPanel === "connections"}
              onClick={() => setOptionPanel((current) => (current === "connections" ? null : "connections"))}
            />
            <MariPersonaSwitcherButton
              selectedPersona={selectedPersona}
              open={optionPanel === "personas"}
              onClick={() => setOptionPanel((current) => (current === "personas" ? null : "personas"))}
            />
          </div>

          <textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            rows={1}
            spellCheck
            autoCorrect="on"
            placeholder="Ask Mari to edit, compare, rewrite, or organize"
            className="max-h-[12.5rem] min-w-0 basis-full resize-none bg-transparent py-0 text-[1rem] leading-normal text-[var(--foreground)] outline-none placeholder:text-foreground/30 sm:flex-1 sm:basis-auto"
          />

          <div className="flex items-center gap-1.5 sm:hidden">
            <MariAttachButton count={attachments.length} onClick={() => fileInputRef.current?.click()} />
            <MariMobileSwitcherButton
              open={!!optionPanel}
              active={!!selectedConnection || !!selectedPersona}
              onClick={() => setOptionPanel((current) => (current ? null : "connections"))}
            />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:ml-0">
            <button
              type="button"
              onClick={() => void send()}
              disabled={!canSend}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-200",
                canSend ? "text-foreground hover:text-foreground/80 active:scale-90" : "text-foreground/20",
              )}
              title="Send message"
              aria-label="Send message"
            >
              <Send size="0.9375rem" className="translate-x-px" />
            </button>
          </div>
        </div>
      </footer>
    </section>
  );
}

function MariStageSprite({ src, mood, measureRef }: { src: string; mood: "idle" | "thinking" | "working"; measureRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      <div
        ref={measureRef}
        className={cn(
          "absolute bottom-0 right-3 w-[clamp(9rem,26vw,24rem)] origin-bottom-right opacity-70 drop-shadow-2xl transition-all duration-300 sm:right-5 sm:opacity-95",
          mood === "thinking" && "translate-y-2 opacity-90",
          mood === "working" && "sm:translate-x-2",
        )}
      >
        <img
          key={src}
          src={src}
          alt=""
          className={cn("h-auto w-full origin-center object-contain object-bottom", mood === "idle" && "scale-x-[-1]")}
          draggable={false}
        />
      </div>
    </div>
  );
}

function MariWelcomeMessage() {
  return (
    <div className="w-full">
      <div className="flex items-start gap-2.5 sm:gap-3">
        <MariAvatar large />
        <div className="min-w-0 flex-1">
          <div className="relative w-full rounded-2xl rounded-tl-sm bg-[var(--card)]/88 py-3 pl-3.5 pr-[calc(0.875rem+var(--mari-bubble-overlap))] text-sm leading-6 shadow-sm ring-1 ring-[var(--border)] sm:pl-4 sm:pr-[calc(1rem+var(--mari-bubble-overlap))]">
            <span className="absolute -left-1 top-3 h-3 w-3 rotate-45 border-b border-l border-[var(--border)] bg-[var(--card)]/88" />
            <p className="font-semibold text-[var(--foreground)]">Welcome to my domain &gt;:D</p>
            <p className="mt-1 text-[var(--muted-foreground)]">
              Hi! I'm Professor Mari! I can view, edit, and create characters, lorebooks, prompts, and much more! Just ask me anything and I'll do my best to help!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MariConversation({ messages, persona }: { messages: MariMessage[]; persona: MariPersona | null }) {
  return (
    <div className="w-full space-y-3">
      <MariWelcomeMessage />
      {messages.map((message, index) => {
        const previous = messages[index - 1];
        const showSeparator = !!previous && getDayKey(previous.createdAt) !== getDayKey(message.createdAt);
        return (
          <div key={message.id}>
            {showSeparator && (
              <div className="my-3 flex items-center justify-center">
                <span className="rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1 text-[0.6875rem] font-semibold text-[var(--muted-foreground)]">
                  {formatDaySeparator(message.createdAt)}
                </span>
              </div>
            )}
            <MariChatMessage message={message} persona={persona} />
          </div>
        );
      })}
    </div>
  );
}

function MariChatMessage({ message, persona }: { message: MariMessage; persona: MariPersona | null }) {
  const isAssistant = message.role === "assistant";
  if (!isAssistant) {
    return (
      <div className="flex w-full items-start gap-2.5 py-1 sm:gap-3">
        <PersonaAvatar persona={persona} />
        <div className="min-w-0 flex-1">
          <div className="relative w-full rounded-2xl rounded-tl-sm bg-[var(--background)]/62 py-2.5 pl-3.5 pr-[calc(0.875rem+var(--mari-bubble-overlap))] text-sm leading-6 shadow-sm ring-1 ring-[var(--border)]/70">
            <span className="absolute -left-1 top-3 h-3 w-3 rotate-45 border-b border-l border-[var(--border)]/70 bg-[var(--background)]/62" />
            <div className="whitespace-pre-wrap text-[var(--foreground)]/86">{message.content}</div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex w-full items-start gap-2.5 sm:gap-3">
      <MariAvatar />
      <div className="min-w-0 flex-1">
        <div className="relative w-full rounded-2xl rounded-tl-sm bg-[var(--card)]/88 py-3 pl-3.5 pr-[calc(0.875rem+var(--mari-bubble-overlap))] text-sm leading-6 shadow-sm ring-1 ring-[var(--border)] sm:pl-4 sm:pr-[calc(1rem+var(--mari-bubble-overlap))]">
          <span className="absolute -left-1 top-3 h-3 w-3 rotate-45 border-b border-l border-[var(--border)] bg-[var(--card)]/88" />
          <div className="whitespace-pre-wrap text-[var(--foreground)]">{message.content}</div>
          <time className="mt-2 block text-[0.625rem] text-[var(--muted-foreground)]">{formatTime(message.createdAt)}</time>
        </div>
        {message.trace?.length ? <MariToolDetails events={message.trace} /> : null}
      </div>
    </div>
  );
}

function MariApprovalPanel({
  approval,
  resolving,
  error,
  onApprove,
  onReject,
}: {
  approval: MariApprovalRequest;
  resolving: "approve" | "reject" | null;
  error: string | null;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <MariChangeReviewPanel
      action={approval.action}
      title="Review changes"
      eyebrow="Checkpoint"
      toolLabel={approval.label ?? approval.tool ?? "Tool"}
      applying={!!resolving}
      approveBusy={resolving === "approve"}
      rejectBusy={resolving === "reject"}
      error={error}
      approveLabel="Approve"
      rejectLabel="Reject"
      onApprove={onApprove}
      onReject={onReject}
    />
  );
}

function MariStagedChangesPanel({
  action,
  applying,
  error,
  onApprove,
  onReject,
}: {
  action: MariEntryAction;
  applying: boolean;
  error: string | null;
  onApprove: () => void;
  onReject: () => void;
}) {
  if (!isMariStagedAction(action)) return null;
  return (
    <MariChangeReviewPanel
      action={action}
      title="Review changes"
      eyebrow="Staged"
      applying={applying}
      approveBusy={applying}
      error={error}
      approveLabel="Approve"
      rejectLabel="Reject"
      onApprove={onApprove}
      onReject={onReject}
    />
  );
}

function MariChangeReviewPanel({
  action,
  title,
  eyebrow,
  toolLabel,
  applying,
  approveBusy,
  rejectBusy,
  error,
  approveLabel,
  rejectLabel,
  onApprove,
  onReject,
}: {
  action: Extract<MariEntryAction, { type: "staged_file_changes" }>;
  title: string;
  eyebrow: string;
  toolLabel?: string;
  applying: boolean;
  approveBusy?: boolean;
  rejectBusy?: boolean;
  error: string | null;
  approveLabel: string;
  rejectLabel: string;
  onApprove: () => void;
  onReject: () => void;
}) {
  const canApprove = action.storageActions.length > 0 && action.unmappedChanges.length === 0 && !applying;
  return (
    <div className="flex w-full items-start gap-2.5 sm:gap-3">
      <MariAvatar />
      <div className="min-w-0 flex-1">
        <div className="relative w-full rounded-2xl rounded-tl-sm bg-[var(--card)]/95 py-3 pl-3.5 pr-[calc(0.875rem+var(--mari-bubble-overlap))] text-sm leading-6 shadow-sm ring-1 ring-[var(--primary)]/35 sm:pl-4 sm:pr-[calc(1rem+var(--mari-bubble-overlap))]">
          <span className="absolute -left-1 top-3 h-3 w-3 rotate-45 border-b border-l border-[var(--primary)]/35 bg-[var(--card)]/95" />

          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)]/12 text-[var(--primary)]">
              <FileDiff size="0.95rem" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-[0.625rem] font-bold uppercase tracking-[0.14em] text-[var(--primary)]">
                <span>{eyebrow}</span>
                {toolLabel && <span className="font-semibold normal-case tracking-normal text-[var(--muted-foreground)]">{toolLabel}</span>}
              </div>
              <div className="text-base font-semibold leading-6 text-[var(--foreground)]">{title}</div>
            </div>
            <span className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-[0.6875rem] font-semibold text-[var(--muted-foreground)]">
              {action.changes.length} file{action.changes.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="mt-3 space-y-2">
            {action.changes.map((change) => (
              <MariDiffCard key={`${change.op}-${change.path}`} change={change} action={storageActionForChange(change, action.storageActions)} />
            ))}
          </div>

          {error && <div className="mt-3 rounded-xl bg-red-500/10 px-2.5 py-2 text-[0.75rem] text-red-400">{error}</div>}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onApprove}
              disabled={!canApprove}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition",
                canApprove
                  ? "bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 active:scale-95"
                  : "cursor-not-allowed bg-[var(--secondary)] text-[var(--muted-foreground)] opacity-60",
              )}
            >
              <Check size="0.8rem" />
              {approveBusy ? "Saving" : approveLabel}
            </button>
            <button
              type="button"
              onClick={onReject}
              disabled={applying}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-[var(--muted-foreground)] transition hover:bg-[var(--secondary)] hover:text-[var(--foreground)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X size="0.8rem" />
              {rejectBusy ? "Wait" : rejectLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MariDiffCard({ change, action }: { change: MariFileChange; action?: MariStorageAction }) {
  const entity = change.binding?.entity ?? action?.entity;
  const isMetadata = change.path.endsWith("metadata.json");
  return (
    <section className="rounded-xl bg-[var(--secondary)]/38 p-2.5">
      <div className="mb-2 flex min-w-0 flex-wrap items-center gap-1.5">
        <span className={cn("rounded-full px-1.5 py-0.5 text-[0.58rem] font-bold uppercase", changeToneClass(change.op))}>{changeOperationLabel(change.op)}</span>
        {entity && <span className="rounded-full bg-[var(--background)]/60 px-1.5 py-0.5 text-[0.625rem] font-semibold text-[var(--muted-foreground)]">{entityDisplayName(entity, false)}</span>}
        <span className="min-w-0 flex-1 truncate text-[0.75rem] font-semibold text-[var(--foreground)]/90">{shortPath(change.path)}</span>
      </div>
      {isMetadata ? <JsonDiffBody change={change} /> : <TextDiffBody change={change} />}
    </section>
  );
}

function TextDiffBody({ change }: { change: MariFileChange }) {
  if (change.op === "create") {
    return <DiffBlock label="New" value={change.after} empty="Empty file" tone="after" />;
  }
  if (change.op === "delete") {
    return <DiffBlock label="Deleted" value={change.before} empty="Empty file" tone="before" />;
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <DiffBlock label="Before" value={change.before} empty="Empty" tone="before" />
      <DiffBlock label="After" value={change.after} empty="Empty" tone="after" />
    </div>
  );
}

function DiffBlock({ label, value, empty, tone }: { label: string; value?: string; empty: string; tone: "before" | "after" }) {
  return (
    <div className={cn("min-w-0 rounded-lg px-2.5 py-2", tone === "after" ? "bg-emerald-500/10" : "bg-[var(--background)]/58")}>
      <div className="mb-1 text-[0.625rem] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">{label}</div>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-[0.72rem] leading-5 text-[var(--foreground)]/82">
        {value?.trim() ? truncateBlock(value.trim(), 900) : empty}
      </pre>
    </div>
  );
}

function JsonDiffBody({ change }: { change: MariFileChange }) {
  const rows = jsonDiffRows(change).slice(0, 10);
  if (!rows.length) {
    return <div className="rounded-lg bg-[var(--background)]/58 px-2.5 py-2 text-[0.72rem] text-[var(--muted-foreground)]">Metadata changed.</div>;
  }
  return (
    <div className="space-y-1.5">
      {rows.map((row) => (
        <div key={row.path} className="rounded-lg bg-[var(--background)]/58 px-2.5 py-2">
          <div className="mb-1 text-[0.625rem] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">{fieldLabel(row.path)}</div>
          {change.op === "create" ? (
            <div className="text-[0.72rem] leading-5 text-[var(--foreground)]/84">{formatDiffValue(row.after)}</div>
          ) : change.op === "delete" ? (
            <div className="text-[0.72rem] leading-5 text-[var(--foreground)]/84">{formatDiffValue(row.before)}</div>
          ) : (
            <div className="grid gap-1.5 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
              <div className="truncate text-[0.72rem] text-[var(--muted-foreground)]">{formatDiffValue(row.before)}</div>
              <div className="hidden text-[var(--muted-foreground)] sm:block">→</div>
              <div className="truncate text-[0.72rem] text-[var(--foreground)]/86">{formatDiffValue(row.after)}</div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function jsonDiffRows(change: MariFileChange) {
  const before = flattenJsonForDiff(parseJsonObject(change.before));
  const after = flattenJsonForDiff(parseJsonObject(change.after));
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => ({ path: key, before: before[key], after: after[key] }));
}

function flattenJsonForDiff(value: unknown, prefix = "", depth = 0): Record<string, unknown> {
  if (!isPlainRecord(value)) return prefix ? { [prefix]: value } : {};
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (["id", "createdAt", "updatedAt"].includes(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainRecord(nested) && depth < 2) {
      Object.assign(out, flattenJsonForDiff(nested, path, depth + 1));
    } else if (!isEmptyPreviewValue(nested)) {
      out[path] = nested;
    }
  }
  return out;
}

function storageActionForChange(change: MariFileChange, actions: MariStorageAction[]) {
  return actions.find((action) => action.paths?.includes(change.path));
}

function changeOperationLabel(op: string) {
  if (op === "create") return "Add";
  if (op === "delete") return "Delete";
  return "Edit";
}

function parseJsonObject(value?: string) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function formatDiffValue(value: unknown) {
  if (typeof value === "string") return value.trim() ? truncateInline(value.trim(), 140) : "Empty";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")) {
      return truncateInline(value.join(", "), 140);
    }
    return `${value.length} item${value.length === 1 ? "" : "s"}`;
  }
  if (isPlainRecord(value)) return `${Object.keys(value).length} field${Object.keys(value).length === 1 ? "" : "s"}`;
  if (value === null || value === undefined) return "Empty";
  return truncateInline(String(value), 140);
}

function isEmptyPreviewValue(value: unknown) {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function entityDisplayName(entity: string, plural: boolean) {
  const singular: Record<string, string> = {
    characters: "Character",
    "character-groups": "Character group",
    personas: "Persona",
    "persona-groups": "Persona group",
    lorebooks: "Lorebook",
    "lorebook-entries": "Lorebook entry",
    prompts: "Prompt preset",
    "prompt-sections": "Prompt section",
    "prompt-groups": "Prompt group",
    "prompt-variables": "Prompt variable",
  };
  const base = singular[entity] ?? entity.replace(/-/g, " ");
  if (!plural) return base;
  if (base.endsWith("y")) return `${base.slice(0, -1)}ies`;
  return `${base}s`;
}

function changeToneClass(op: string) {
  if (op === "create") return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300";
  if (op === "delete") return "bg-red-500/10 text-red-500";
  return "bg-[var(--primary)]/10 text-[var(--primary)]";
}

function fieldLabel(field: string) {
  return field
    .replace(/^data\./, "")
    .replace(/^extensions\./, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[._-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shortPath(path: string) {
  return path.replace(/^\/workspace\//, "");
}

function truncateInline(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit).trimEnd()}…` : value;
}

function truncateBlock(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit).trimEnd()}\n…` : value;
}

function PersonaAvatar({ persona }: { persona: MariPersona | null }) {
  if (persona?.avatarPath) {
    return (
      <span className="mt-1 block h-8 w-8 shrink-0 overflow-hidden rounded-full border border-[var(--border)] bg-[var(--secondary)] shadow-sm sm:h-9 sm:w-9">
        <img
          src={persona.avatarPath}
          alt={persona.name}
          className="h-full w-full object-cover"
          style={getAvatarCropStyle(parseAvatarCropJson(persona.avatarCrop))}
          draggable={false}
        />
      </span>
    );
  }
  return (
    <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--secondary)] text-[var(--muted-foreground)] shadow-sm sm:h-9 sm:w-9">
      {persona ? <span className="text-xs font-semibold">{(persona.name || "?")[0].toUpperCase()}</span> : <CircleUser size="1rem" />}
    </span>
  );
}

function MariAvatar({ large }: { large?: boolean }) {
  return (
    <span
      className={cn(
        "block shrink-0 overflow-hidden border border-[var(--border)] bg-[var(--secondary)] shadow-sm",
        large ? "h-10 w-10 rounded-2xl sm:h-11 sm:w-11" : "mt-1 h-8 w-8 rounded-full sm:h-9 sm:w-9",
      )}
    >
      <img src={MARI_AVATAR_URL} alt="Professor Mari" className="h-full w-full object-cover" draggable={false} />
    </span>
  );
}

function MariAttachButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <ComposerIconButton onClick={onClick} label="Attach files" active={count > 0}>
      <Paperclip size="1rem" />
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--primary)] px-1 text-[0.5625rem] font-semibold text-[var(--primary-foreground)]">
          {count}
        </span>
      )}
    </ComposerIconButton>
  );
}

function MariConnectionSwitcherButton({
  selectedConnection,
  open,
  onClick,
}: {
  selectedConnection: MariConnection | null;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={selectedConnection ? selectedConnection.name || selectedConnection.id : "Quick Connection Switcher"}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-xl transition-all",
        open ? "bg-foreground/10 text-foreground" : "text-foreground/70 hover:bg-foreground/10 hover:text-foreground",
      )}
    >
      <Link size="1rem" />
    </button>
  );
}

function MariPersonaSwitcherButton({
  selectedPersona,
  open,
  onClick,
}: {
  selectedPersona: MariPersona | null;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={selectedPersona ? selectedPersona.name : "Quick Persona Switcher"}
      className={cn(
        "relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border-2 transition-all",
        open ? "border-foreground/40" : "border-transparent hover:border-foreground/30 hover:opacity-90",
      )}
    >
      {selectedPersona?.avatarPath ? (
        <img
          src={selectedPersona.avatarPath}
          alt=""
          className="h-full w-full rounded-full object-cover"
          style={getAvatarCropStyle(parseAvatarCropJson(selectedPersona.avatarCrop))}
          draggable={false}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center rounded-full bg-[var(--secondary)] text-[0.75rem] font-semibold text-[var(--muted-foreground)]">
          {selectedPersona ? (selectedPersona.name || "?")[0].toUpperCase() : "?"}
        </div>
      )}
    </button>
  );
}

function MariMobileSwitcherButton({ open, active, onClick }: { open: boolean; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Quick Switcher"
      aria-label="Quick Switcher"
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-xl transition-all",
        open || active ? "bg-foreground/10 text-foreground" : "text-foreground/70 hover:bg-foreground/10 hover:text-foreground",
      )}
    >
      <ChevronUp size="1rem" className={cn("transition-transform", open && "rotate-180")} />
    </button>
  );
}

function ComposerIconButton({ children, label, active, onClick }: { children: ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all active:scale-90",
        active ? "bg-foreground/10 text-foreground" : "text-foreground/40 hover:bg-foreground/10 hover:text-foreground/70",
      )}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function MariAttachmentTray({ attachments, onRemove }: { attachments: MariAttachment[]; onRemove: (id: string) => void }) {
  if (!attachments.length) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="group inline-flex max-w-full items-center gap-1.5 rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 text-xs ring-1 ring-[var(--border)]"
        >
          <FileText size="0.8125rem" className="shrink-0" />
          <span className="max-w-[12rem] truncate">{attachment.name}</span>
          <button
            type="button"
            onClick={() => onRemove(attachment.id)}
            className="rounded-full p-0.5 transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            title="Remove attachment"
            aria-label={`Remove ${attachment.name}`}
          >
            <X size="0.6875rem" />
          </button>
        </div>
      ))}
    </div>
  );
}

function MariLiveMessage({ events }: { events: MariTraceEvent[] }) {
  const visibleEvents = events.length ? events : [{ type: "status", label: "Opening the workspace", summary: "Mari is getting her notes ready." } as MariTraceEvent];
  const recent = visibleEvents.slice(-3);
  const earlier = visibleEvents.slice(0, -3);
  return (
    <div className="flex w-full items-start gap-2.5 sm:gap-3">
      <MariAvatar />
      <div className="min-w-0 flex-1">
        <div className="relative w-full rounded-2xl rounded-tl-sm bg-[var(--card)]/88 py-3 pl-3.5 pr-[calc(0.875rem+var(--mari-bubble-overlap))] shadow-sm ring-1 ring-[var(--border)] sm:pl-4 sm:pr-[calc(1rem+var(--mari-bubble-overlap))]">
          <span className="absolute -left-1 top-3 h-3 w-3 rotate-45 border-b border-l border-[var(--border)] bg-[var(--card)]/88" />
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--primary)]" />
            I am checking that now
          </div>
          {earlier.length > 0 && (
            <details className="mb-2 rounded-xl bg-[var(--secondary)]/45 px-2 py-1.5 text-xs text-[var(--muted-foreground)]">
              <summary className="cursor-pointer font-medium">{earlier.length} earlier update{earlier.length === 1 ? "" : "s"}</summary>
              <div className="mt-2 space-y-1.5">
                {earlier.map((event, index) => (
                  <MariToolUpdate key={`${event.type}-earlier-${index}`} event={event} />
                ))}
              </div>
            </details>
          )}
          <div className="space-y-1.5">
            {recent.map((event, index) => (
              <MariToolUpdate key={`${event.type}-recent-${index}`} event={event} active={index === recent.length - 1} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MariToolDetails({ events }: { events: MariTraceEvent[] }) {
  if (!events.length) return null;
  return (
    <details className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--card)]/80 py-2 pl-2.5 pr-[calc(0.625rem+var(--mari-bubble-overlap))] text-xs shadow-sm backdrop-blur-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[var(--muted-foreground)] marker:hidden">
        <Sparkles size="0.8125rem" />
        <span className="font-semibold">Tool details</span>
        <span className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-[0.625rem]">
          {events.length}
        </span>
      </summary>
      <div className="mt-3 space-y-1.5">
        {events.map((event, index) => (
          <MariToolUpdate key={`${event.type}-${index}`} event={event} expandable />
        ))}
      </div>
    </details>
  );
}

function MariToolUpdate({ event, active, expandable }: { event: MariTraceEvent; active?: boolean; expandable?: boolean }) {
  const isTool = event.type === "tool_result";
  const isError = event.status === "error";
  const details = expandable ? traceDetails(event) : null;
  const Icon = isTool ? Terminal : isError ? AlertTriangle : Wrench;
  const summary = traceSummary(event);
  return (
    <div
      className={cn(
        "rounded-xl px-2.5 py-2",
        active ? "bg-[var(--primary)]/10" : "bg-[var(--secondary)]/45",
      )}
    >
      <div className="flex items-start gap-2">
        <Icon size="0.8125rem" className={cn("mt-0.5 shrink-0", isError ? "text-red-400" : active ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]")} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-[var(--foreground)]/90">{traceLabel(event)}</span>
            {active && <span className="rounded-full bg-[var(--primary)]/15 px-1.5 py-0.5 text-[0.625rem] font-semibold text-[var(--primary)]">now</span>}
            {isTool && event.status && (
              <span className={cn("rounded-full px-1.5 py-0.5 text-[0.625rem]", isError ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-500")}>
                {event.status}
              </span>
            )}
          </div>
          {summary && <p className="mt-0.5 text-[0.6875rem] leading-5 text-[var(--muted-foreground)]">{summary}</p>}
          {details && (
            <details className="mt-1.5">
              <summary className="cursor-pointer text-[0.6875rem] font-semibold text-[var(--muted-foreground)]">Details</summary>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--background)] p-2 text-[0.6875rem] leading-5 text-[var(--foreground)]/75">
                {details}
              </pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

function traceLabel(event: MariTraceEvent) {
  if (event.type === "model_turn") return event.toolCalls?.length ? "Choosing tools" : "Reading the brief";
  if (event.type === "tool_result") return event.label || event.tool || "Tool finished";
  return event.label || "Workspace update";
}

function traceSummary(event: MariTraceEvent) {
  if (event.summary) return event.summary;
  if (event.type === "model_turn" && event.toolCalls?.length) return `${event.toolCalls.length} action${event.toolCalls.length === 1 ? "" : "s"} queued.`;
  if (event.type === "model_turn") return "Planning the next step.";
  if (event.error) return event.error;
  return null;
}

function MariErrorMessage({ message, details }: { message: string; details: string | null }) {
  return (
    <div className="flex w-full items-start gap-2.5 sm:gap-3">
      <MariAvatar />
      <div className="min-w-0 flex-1">
        <div className="w-full rounded-2xl rounded-tl-sm border border-red-500/25 bg-red-500/10 py-3 pl-3 pr-[calc(0.75rem+var(--mari-bubble-overlap))] text-sm text-red-400">
          <div className="font-semibold">I hit a snag.</div>
          <div className="mt-1">{message}</div>
          {details && (
            <details className="mt-2 text-[0.6875rem]">
              <summary className="cursor-pointer font-semibold">Debug details</summary>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--background)] p-2">{details}</pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

function traceDetails(event: MariTraceEvent) {
  const payload: Record<string, unknown> = {};
  if (event.type !== "model_turn" && event.content?.trim()) payload.content = event.content;
  if (event.toolCalls?.length) payload.toolCalls = event.toolCalls;
  if (event.arguments !== undefined) payload.arguments = event.arguments;
  if (event.result !== undefined) payload.result = event.result;
  if (event.error) payload.error = event.error;
  if (Object.keys(payload).length === 0) return null;
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function MariOptionPanel({
  mode,
  connections,
  personas,
  selectedConnectionId,
  selectedPersonaId,
  onModeChange,
  onSelectConnection,
  onSelectPersona,
}: {
  mode: MariOptionPanel;
  connections: MariConnection[];
  personas: MariPersona[];
  selectedConnectionId: string | null;
  selectedPersonaId: string | null;
  onModeChange: (mode: MariOptionPanel) => void;
  onSelectConnection: (id: string | null) => void;
  onSelectPersona: (id: string | null) => void;
}) {
  return (
    <div className="mb-2 w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg backdrop-blur-sm sm:w-[22rem]">
      <div className="flex gap-1 border-b border-[var(--border)] p-1">
        <OptionTab active={mode === "connections"} onClick={() => onModeChange("connections")} icon={<Link size="0.8125rem" />}>
          Model
        </OptionTab>
        <OptionTab active={mode === "personas"} onClick={() => onModeChange("personas")} icon={<CircleUser size="0.8125rem" />}>
          Persona
        </OptionTab>
      </div>
      {mode === "connections" ? (
        <div className="max-h-[min(18rem,38dvh)] overflow-y-auto p-1.5">
          <OptionRow active={selectedConnectionId === null} onClick={() => onSelectConnection(null)} title="Use default model" />
          {connections.map((connection) => (
            <OptionRow
              key={connection.id}
              active={connection.id === selectedConnectionId}
              onClick={() => onSelectConnection(connection.id)}
              title={connection.name || connection.id}
              detail={connection.provider}
            />
          ))}
          {connections.length === 0 && <EmptyOption>No models found.</EmptyOption>}
        </div>
      ) : (
        <div className="max-h-[min(18rem,38dvh)] overflow-y-auto p-1.5">
          <OptionRow active={selectedPersonaId === null} onClick={() => onSelectPersona(null)} title="No persona" avatar="?" />
          {personas.map((persona) => (
            <OptionRow
              key={persona.id}
              active={persona.id === selectedPersonaId}
              onClick={() => onSelectPersona(persona.id)}
              title={persona.name || persona.id}
              detail={persona.comment ?? undefined}
              avatar={persona.avatarPath ? { src: persona.avatarPath, crop: persona.avatarCrop } : (persona.name || "?")[0].toUpperCase()}
            />
          ))}
          {personas.length === 0 && <EmptyOption>No personas found.</EmptyOption>}
        </div>
      )}
    </div>
  );
}

function OptionTab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors",
        active ? "bg-[var(--primary)]/10 text-[var(--primary)]" : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function OptionRow({
  active,
  onClick,
  title,
  detail,
  avatar,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  detail?: string;
  avatar?: string | { src: string; crop?: string };
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-[var(--accent)]",
        active && "bg-[var(--primary)]/10 text-[var(--foreground)]",
      )}
    >
      {avatar !== undefined && (
        typeof avatar === "string" ? (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--secondary)] text-xs font-semibold text-[var(--muted-foreground)]">
            {avatar}
          </span>
        ) : (
          <span className="h-8 w-8 shrink-0 overflow-hidden rounded-full border border-[var(--border)] bg-[var(--secondary)]">
            <img
              src={avatar.src}
              alt=""
              className="h-full w-full object-cover"
              style={getAvatarCropStyle(parseAvatarCropJson(avatar.crop))}
              draggable={false}
            />
          </span>
        )
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {detail && <span className="block truncate text-[0.6875rem] text-[var(--muted-foreground)]">{detail}</span>}
      </span>
      {active && <Check size="0.875rem" className="shrink-0" />}
    </button>
  );
}

function EmptyOption({ children }: { children: ReactNode }) {
  return <div className="px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">{children}</div>;
}
