import { useRef, type FormEvent } from "react";
import type { FileUIPart } from "ai";
import {
  FileText,
  Image as ImageIcon,
  MessageCircle,
  Paperclip,
  Plus,
} from "lucide-react";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@/components/ai-elements/attachments";
import {
  PromptInput,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";

export type ComposerTool = "chat" | "image";

type UnifiedChatComposerProps = {
  value: string;
  tool: ComposerTool;
  busy: boolean;
  onValueChange: (value: string) => void;
  onToolChange: (tool: ComposerTool) => void;
  onSubmit: (text: string, files: FileUIPart[]) => Promise<void>;
  onStop: () => void;
};

export function UnifiedChatComposer(props: UnifiedChatComposerProps) {
  return (
    <PromptInput
      accept={props.tool === "image" ? "image/*" : "image/*,application/pdf"}
      maxFiles={4}
      maxFileSize={15 * 1024 * 1024}
      onError={(error) => window.dispatchEvent(new CustomEvent("fs:composer-error", { detail: error.message }))}
      onSubmit={({ text, files }) => props.onSubmit(text, files)}
      className="rounded-2xl"
    >
      <ComposerContents {...props} />
    </PromptInput>
  );
}

function ComposerContents({
  value,
  tool,
  busy,
  onValueChange,
  onToolChange,
  onStop,
}: UnifiedChatComposerProps) {
  const attachments = usePromptInputAttachments();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const chooseTool = (next: ComposerTool) => {
    onToolChange(next);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <>
      {attachments.files.length > 0 && (
        <PromptInputHeader className="pb-0">
          <Attachments variant="inline" className="w-full">
            {attachments.files.map((file) => (
              <Attachment key={file.id} data={file} onRemove={() => attachments.remove(file.id)}>
                <AttachmentPreview />
                <AttachmentInfo />
                <AttachmentRemove className="opacity-100" />
              </Attachment>
            ))}
          </Attachments>
        </PromptInputHeader>
      )}

      <PromptInputTextarea
        ref={inputRef}
        autoFocus
        value={value}
        onChange={(event) => onValueChange(event.currentTarget.value)}
        placeholder={tool === "image" ? "Describe the image you want…" : "Ask anything or attach a PDF…"}
        className="min-h-14 px-4 pb-2 pt-3 text-[15px] leading-6"
      />

      <PromptInputFooter className="px-2.5 pb-2.5 pt-1">
        <PromptInputTools>
          <PromptInputActionMenu>
            <PromptInputActionMenuTrigger tooltip="Add or create">
              <Plus className="size-4" />
            </PromptInputActionMenuTrigger>
            <PromptInputActionMenuContent className="w-56 rounded-xl">
              <PromptInputActionMenuItem onSelect={() => chooseTool("chat")}>
                <MessageCircle /> Chat
              </PromptInputActionMenuItem>
              <PromptInputActionMenuItem onSelect={() => chooseTool("image")}>
                <ImageIcon /> Create image
              </PromptInputActionMenuItem>
              <PromptInputActionMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  chooseTool("chat");
                  attachments.openFileDialog();
                }}
              >
                <FileText /> Analyze PDF
              </PromptInputActionMenuItem>
            </PromptInputActionMenuContent>
          </PromptInputActionMenu>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => attachments.openFileDialog()}
            className="h-8 rounded-lg px-2 text-xs text-muted-foreground"
          >
            <Paperclip className="size-3.5" />
            Attach
          </Button>
          <Button
            type="button"
            variant={tool === "image" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => chooseTool(tool === "image" ? "chat" : "image")}
            className="h-8 rounded-lg px-2 text-xs text-muted-foreground"
          >
            <ImageIcon className="size-3.5" />
            Image
          </Button>
        </PromptInputTools>
        <PromptInputSubmit
          status={busy ? "streaming" : "ready"}
          onStop={onStop}
          disabled={!busy && !value.trim() && attachments.files.length === 0}
          className="size-9 rounded-xl"
        />
      </PromptInputFooter>
    </>
  );
}

export function preventEmptySubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
}