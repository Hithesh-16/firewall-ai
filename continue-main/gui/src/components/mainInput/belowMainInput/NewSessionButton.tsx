import styled from "styled-components";
import { defaultBorderRadius, vscFocusBorder, vscForeground } from "../..";
import { varWithFallback } from "../../../styles/theme";
import { getFontSize } from "../../../util";

export const NewSessionButton = styled.div`
  width: fit-content;
  margin-right: auto;
  margin-left: 6px;
  margin-top: 2px;
  margin-bottom: 8px;
  font-size: ${getFontSize() - 2}px;

  border-radius: ${defaultBorderRadius};
  padding: 2px 8px;
  color: ${vscForeground};
  border: 1px solid transparent;
  transition: all 0.2s ease;

  &:hover {
    border-color: ${vscFocusBorder};
    background-color: ${varWithFallback("list-hover")};
    color: ${vscFocusBorder};
  }

  cursor: pointer;
`;
