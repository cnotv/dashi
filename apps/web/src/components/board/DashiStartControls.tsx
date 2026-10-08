import {
  ChatBubbleIcon,
  ExternalLinkIcon,
  InfoCircledIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import {
  AlertDialog,
  Badge,
  Button,
  Flex,
  IconButton,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import { useState } from "react";
import type { SessionStart } from "@dashi/contracts";
import { SessionChatDrawer } from "@/components/sessions/SessionChatDrawer";
import { StartDetailsDrawer } from "@/components/sessions/StartDetailsDrawer";
import { useToast } from "@/hooks/useToast";
import { dashboardApi } from "@/lib/api";
import {
  sessionStartStateColors,
  sessionStartStateLabels,
  startTargetLabels,
} from "@/lib/presentation";
import { canChatWithStart, chatSubjectOfStart } from "@/lib/session-chat";
import { canDiscardStart } from "@/lib/session-starts";

interface DashiStartControlsProps {
  start: SessionStart;
  onStartChanged: () => void;
}

/**
 * What a card in Started from Dashi shows of its start: its state and where it runs, then its
 * details with Retry, its conversation and session link when it has them, and Discard for one that
 * never ran, which sends the card back to No pull request.
 */
export const DashiStartControls = ({
  start,
  onStartChanged,
}: DashiStartControlsProps) => {
  const toast = useToast();
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);

  const discard = async (): Promise<void> => {
    setIsDiscarding(true);
    try {
      await dashboardApi.discardSessionStart(start.startId);
      toast.notifySuccess("Start discarded");
      onStartChanged();
    } catch (discardError) {
      toast.notifyError(discardError);
    } finally {
      setIsDiscarding(false);
    }
  };

  return (
    <Flex direction="column" gap="2">
      <Flex gap="2" align="center" wrap="wrap">
        <Badge color={sessionStartStateColors[start.state]} radius="full">
          {sessionStartStateLabels[start.state]}
        </Badge>
        <Text size="1" color="gray">
          {startTargetLabels[start.target].name}
          {start.runnerLabel ? ` (${start.runnerLabel})` : ""}
        </Text>
      </Flex>
      <Flex className="card-icon-row" gap="2" align="center">
        <Tooltip content="Details">
          <IconButton
            size="1"
            variant="ghost"
            color={start.state === "failed" ? "red" : "gray"}
            aria-label={`Details of the start on #${start.issueNumber}`}
            onClick={() => setIsDetailsOpen(true)}
          >
            <InfoCircledIcon />
          </IconButton>
        </Tooltip>
        {canChatWithStart(start) && (
          <Tooltip content="Open the conversation">
            <IconButton
              size="1"
              variant="ghost"
              aria-label={`Chat with the session on #${start.issueNumber}`}
              onClick={() => setIsChatOpen(true)}
            >
              <ChatBubbleIcon />
            </IconButton>
          </Tooltip>
        )}
        {start.sessionUrl && (
          <Tooltip content="Open the session in Claude">
            <IconButton
              size="1"
              variant="ghost"
              aria-label="Open the session in Claude"
              asChild
            >
              <a
                href={start.sessionUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLinkIcon />
              </a>
            </IconButton>
          </Tooltip>
        )}
        {canDiscardStart(start) && (
          <Flex ml="auto">
            <AlertDialog.Root>
              <Tooltip content="Discard this start">
                <AlertDialog.Trigger>
                  <IconButton
                    size="1"
                    variant="ghost"
                    color="red"
                    disabled={isDiscarding}
                    aria-label="Discard this start"
                  >
                    <TrashIcon />
                  </IconButton>
                </AlertDialog.Trigger>
              </Tooltip>
              <AlertDialog.Content maxWidth="440px">
                <AlertDialog.Title>
                  Discard the start on #{start.issueNumber}?
                </AlertDialog.Title>
                <AlertDialog.Description size="2">
                  {start.state === "queued"
                    ? "Removes it from Dashi before any runner picks it up, so no session starts. "
                    : "Removes the failed start from Dashi. "}
                  The issue stays open on GitHub and goes back to No pull
                  request, where it can be started again.
                </AlertDialog.Description>
                <Flex gap="3" mt="4" justify="end">
                  <AlertDialog.Cancel>
                    <Button variant="soft" color="gray">
                      Cancel
                    </Button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action>
                    <Button color="red" onClick={() => void discard()}>
                      Discard
                    </Button>
                  </AlertDialog.Action>
                </Flex>
              </AlertDialog.Content>
            </AlertDialog.Root>
          </Flex>
        )}
      </Flex>
      <StartDetailsDrawer
        start={isDetailsOpen ? start : null}
        onClose={() => setIsDetailsOpen(false)}
        onRetried={() => {
          setIsDetailsOpen(false);
          onStartChanged();
        }}
      />
      <SessionChatDrawer
        subject={isChatOpen ? chatSubjectOfStart(start) : null}
        onClose={() => setIsChatOpen(false)}
      />
    </Flex>
  );
};
