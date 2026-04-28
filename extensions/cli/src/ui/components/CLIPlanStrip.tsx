import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";

import {
  approveProposal,
  rejectProposal,
  subscribePlans,
  type PlanState,
  type PlanTask,
} from "core/tools/implementations/planTool.js";

const EMERALD = "greenBright";
const DIM_GRAY = "gray";
const WHITE = "white";
const AMBER = "yellow";
const RED = "redBright";

/**
 * CLI Plan Strip (kilocode-parity).
 *
 * Displays the current active plan or a pending plan proposal.
 * Uses the global subscription from planTool.ts.
 */
export function CLIPlanStrip() {
  const [currentPlan, setCurrentPlan] = useState<PlanState | null>(null);
  const [pendingProposal, setPendingProposal] = useState<PlanState | null>(
    null,
  );

  useEffect(() => {
    const unsubscribe = subscribePlans((plan, proposal) => {
      setCurrentPlan(plan);
      setPendingProposal(proposal);
    });
    return unsubscribe;
  }, []);

  if (!currentPlan && !pendingProposal) return null;

  // Proposal takes precedence if present
  if (pendingProposal) {
    return (
      <Box
        flexDirection="column"
        paddingX={1}
        paddingY={0}
        marginTop={1}
        borderStyle="round"
        borderColor={AMBER}
      >
        <Box flexDirection="row" gap={1}>
          <Text color={AMBER} bold>
            ▎ PLAN PROPOSAL
          </Text>
          <Text color={WHITE} bold>
            {pendingProposal.title}
          </Text>
        </Box>
        {pendingProposal.risk && (
          <Box marginLeft={2}>
            <Text color={pendingProposal.risk === "high" ? RED : AMBER}>
              Risk: {pendingProposal.risk}
            </Text>
          </Box>
        )}
        {pendingProposal.summary && (
          <Box marginLeft={2} marginTop={0}>
            <Text color={DIM_GRAY}>{pendingProposal.summary}</Text>
          </Box>
        )}
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          {(() => {
            let currentPhase = "";
            return pendingProposal.tasks.slice(0, 8).map((task, i) => {
              const showPhase = task.phase && task.phase !== currentPhase;
              if (showPhase) currentPhase = task.phase!;
              return (
                <Box flexDirection="column" key={i}>
                  {showPhase && (
                    <Text color={DIM_GRAY} bold>{`--- ${task.phase} ---`}</Text>
                  )}
                  <PlanRow task={task} />
                </Box>
              );
            });
          })()}
          {pendingProposal.tasks.length > 8 && (
            <Text
              color={DIM_GRAY}
            >{`  + ${pendingProposal.tasks.length - 8} more…`}</Text>
          )}
        </Box>
        <Box marginTop={1} marginLeft={2}>
          <Text color={WHITE}>Waiting for approval. Type </Text>
          <Text color={EMERALD} bold>
            /approve
          </Text>
          <Text color={WHITE}> or </Text>
          <Text color={RED} bold>
            /reject
          </Text>
        </Box>
      </Box>
    );
  }

  if (!currentPlan) return null;

  const done = currentPlan.tasks.filter((t) => t.status === "completed").length;
  const allDone =
    done === currentPlan.tasks.length && currentPlan.tasks.length > 0;
  const inProgress = currentPlan.tasks.find((t) => t.status === "in_progress");

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0} marginTop={1}>
      <Box flexDirection="row" gap={1}>
        <Text color={EMERALD} bold>
          ▎ PLAN
        </Text>
        <Text color={WHITE} bold>
          {currentPlan.title}
        </Text>
        <Text
          color={allDone ? EMERALD : DIM_GRAY}
        >{`${done}/${currentPlan.tasks.length} done`}</Text>
        {inProgress && <Text color={EMERALD}>◐ in progress</Text>}
      </Box>
      <Box flexDirection="column" marginLeft={2} marginTop={0}>
        {(() => {
          let currentPhase = "";
          return currentPlan.tasks.slice(0, 10).map((task, i) => {
            const showPhase = task.phase && task.phase !== currentPhase;
            if (showPhase) currentPhase = task.phase!;
            return (
              <Box flexDirection="column" key={i}>
                {showPhase && (
                  <Text color={DIM_GRAY} bold>{`--- ${task.phase} ---`}</Text>
                )}
                <PlanRow task={task} />
              </Box>
            );
          });
        })()}
        {currentPlan.tasks.length > 10 && (
          <Text
            color={DIM_GRAY}
          >{`  + ${currentPlan.tasks.length - 10} more…`}</Text>
        )}
      </Box>
    </Box>
  );
}

function PlanRow({ task }: { task: PlanTask }) {
  const { glyph, glyphColor, textColor, strikethrough } = glyphFor(task.status);
  return (
    <Box flexDirection="row" gap={1}>
      <Text color={glyphColor}>{glyph}</Text>
      <Text color={textColor} strikethrough={strikethrough}>
        {truncate(task.content, 80)}
      </Text>
    </Box>
  );
}

function glyphFor(status: PlanTask["status"]): {
  glyph: string;
  glyphColor: string;
  textColor: string;
  strikethrough: boolean;
} {
  switch (status) {
    case "completed":
      return {
        glyph: "✔",
        glyphColor: EMERALD,
        textColor: DIM_GRAY,
        strikethrough: true,
      };
    case "in_progress":
      return {
        glyph: "◐",
        glyphColor: EMERALD,
        textColor: WHITE,
        strikethrough: false,
      };
    case "cancelled":
      return {
        glyph: "⨯",
        glyphColor: DIM_GRAY,
        textColor: DIM_GRAY,
        strikethrough: true,
      };
    case "pending":
    default:
      return {
        glyph: "○",
        glyphColor: DIM_GRAY,
        textColor: AMBER,
        strikethrough: false,
      };
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
