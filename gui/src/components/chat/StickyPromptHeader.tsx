import {
  ArrowPathIcon,
  ArrowUturnLeftIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DocumentIcon,
  PencilIcon,
  PhotoIcon,
} from "@heroicons/react/24/outline";
import { MessagePart } from "core";
import { renderChatMessage } from "core/util/messageContent";
import React, { useEffect, useState } from "react";
import styled from "styled-components";
import {
  vscCommandCenterInactiveBorder,
  vscEditorBackground,
  vscForeground,
  vscInputBackground,
} from "..";
import { useAppSelector } from "../../redux/hooks";
import HeaderButtonWithToolTip from "../gui/HeaderButtonWithToolTip";

// Full-width backdrop covers scrolling content behind the sticky area.
// This prevents overlap between chat content and the sticky card.
const StickyBackdrop = styled.div<{ $isVisible: boolean }>`
  position: sticky;
  top: 0;
  z-index: 10;
  background-color: ${vscEditorBackground};
  padding: 4px 8px;
  opacity: ${({ $isVisible }) => ($isVisible ? 1 : 0)};
  pointer-events: ${({ $isVisible }) => ($isVisible ? "auto" : "none")};
  transition: opacity 150ms ease;
`;

// Card styled to match ContinueInputBox history messages
const StickyCard = styled.div<{ $expanded: boolean }>`
  border-radius: 0.625rem;
  border: 1px solid ${vscCommandCenterInactiveBorder};
  border-left: 2.5px solid var(--af-emerald-light, #10b981);
  background-color: ${vscInputBackground};
  padding: 8px 10px;
  max-height: ${({ $expanded }) => ($expanded ? "60vh" : "44px")};
  overflow: hidden;
  transition: max-height 200ms ease;
  cursor: pointer;
`;

const CollapsedRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
`;

const PromptText = styled.span<{ $expanded: boolean }>`
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: ${vscForeground};
  ${({ $expanded }) =>
    $expanded
      ? `
    white-space: pre-wrap;
    word-break: break-word;
    overflow-y: auto;
    max-height: 40vh;
  `
      : `
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `}
`;

const ButtonGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
`;

const AttachmentRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid ${vscCommandCenterInactiveBorder};
`;

const AttachmentChip = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  color: ${vscForeground};
  opacity: 0.7;
  background: rgba(128, 128, 128, 0.15);
`;

const ImageThumbnail = styled.img`
  width: 48px;
  height: 48px;
  border-radius: 4px;
  object-fit: cover;
  border: 1px solid ${vscCommandCenterInactiveBorder};
`;

const ToggleButton = styled.button`
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  padding: 2px 0;
  border: none;
  background: transparent;
  color: ${vscForeground};
  opacity: 0.5;
  font-size: 11px;
  cursor: pointer;

  &:hover {
    opacity: 0.8;
  }
`;

interface StickyPromptHeaderProps {
  activePromptIndex: number | null;
  isVisible: boolean;
  onEdit: (index: number) => void;
  onRetry: (index: number) => void;
  onRevert: () => void;
  canRevert: boolean;
  isStreaming: boolean;
}

const StickyPromptHeader: React.FC<StickyPromptHeaderProps> = ({
  activePromptIndex,
  isVisible,
  onEdit,
  onRetry,
  onRevert,
  canRevert,
  isStreaming,
}) => {
  const history = useAppSelector((state) => state.session.history);
  const [expanded, setExpanded] = useState(false);

  const activeItem =
    activePromptIndex !== null ? history[activePromptIndex] : null;

  const promptText = activeItem ? renderChatMessage(activeItem.message) : "";

  // Extract images from message content
  const images: string[] = [];
  if (activeItem && typeof activeItem.message.content !== "string") {
    (activeItem.message.content as MessagePart[]).forEach((part) => {
      if (part.type === "imageUrl") {
        images.push(part.imageUrl.url);
      }
    });
  }

  // Get context items (files, code, etc.)
  const contextItems = activeItem?.contextItems ?? [];
  const hasAttachments = images.length > 0 || contextItems.length > 0;
  const isLongPrompt = promptText.length > 100;
  const isExpandable = isLongPrompt || hasAttachments;

  // Collapse when active prompt changes
  useEffect(() => {
    setExpanded(false);
  }, [activePromptIndex]);

  const handleCardClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    if (isExpandable) {
      setExpanded((prev) => !prev);
    }
  };

  return (
    <StickyBackdrop
      $isVisible={isVisible && activeItem !== null}
      role="toolbar"
      aria-label="Current prompt actions"
      aria-live="polite"
    >
      <StickyCard $expanded={expanded} onClick={handleCardClick}>
        <CollapsedRow>
          <PromptText $expanded={expanded} aria-label="Current prompt text">
            {promptText}
          </PromptText>

          <ButtonGroup>
            {isExpandable && (
              <HeaderButtonWithToolTip
                text={expanded ? "Show less" : "Show more"}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  setExpanded((prev) => !prev);
                }}
              >
                {expanded ? (
                  <ChevronUpIcon className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDownIcon className="h-3.5 w-3.5" />
                )}
              </HeaderButtonWithToolTip>
            )}

            <HeaderButtonWithToolTip
              text="Edit this prompt"
              disabled={isStreaming || activePromptIndex === null}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                if (activePromptIndex !== null) {
                  onEdit(activePromptIndex);
                }
              }}
            >
              <PencilIcon className="h-3.5 w-3.5" />
            </HeaderButtonWithToolTip>

            <HeaderButtonWithToolTip
              text="Retry this prompt"
              disabled={isStreaming || activePromptIndex === null}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                if (activePromptIndex !== null) {
                  onRetry(activePromptIndex);
                }
              }}
            >
              <ArrowPathIcon className="h-3.5 w-3.5" />
            </HeaderButtonWithToolTip>

            {canRevert && (
              <HeaderButtonWithToolTip
                text="Revert to before retry"
                disabled={isStreaming}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  onRevert();
                }}
              >
                <ArrowUturnLeftIcon className="h-3.5 w-3.5" />
              </HeaderButtonWithToolTip>
            )}
          </ButtonGroup>
        </CollapsedRow>

        {expanded && hasAttachments && (
          <AttachmentRow>
            {images.map((url, i) => (
              <ImageThumbnail
                key={`img-${i}`}
                src={url}
                alt="Attached image"
              />
            ))}
            {contextItems
              .filter((item) => !item.hidden)
              .map((item, i) => (
                <AttachmentChip key={`ctx-${i}`}>
                  {item.uri?.type === "file" ? (
                    <DocumentIcon className="h-3 w-3" />
                  ) : (
                    <PhotoIcon className="h-3 w-3" />
                  )}
                  <span>{item.name}</span>
                </AttachmentChip>
              ))}
          </AttachmentRow>
        )}

        {expanded && (
          <ToggleButton
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(false);
            }}
          >
            <ChevronUpIcon className="h-3 w-3" />
            Show less
          </ToggleButton>
        )}
      </StickyCard>
    </StickyBackdrop>
  );
};

export default StickyPromptHeader;
