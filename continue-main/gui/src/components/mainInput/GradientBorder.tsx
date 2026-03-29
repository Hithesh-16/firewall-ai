import styled from "styled-components";

export const GradientBorder = styled.div<{
  borderRadius?: string;
  borderColor?: string;
  loading: 0 | 1;
}>`
  border-radius: ${(props) => props.borderRadius || "0"};
  border: 1px solid
    ${(props) => props.borderColor || "var(--af-emerald, #059669)"};
  border-left: 2.5px solid
    ${(props) =>
      props.loading
        ? "var(--af-emerald-light, #10b981)"
        : props.borderColor || "var(--af-emerald-light, #10b981)"};
  animation: ${(props) =>
    props.loading ? "emeraldPulse 2s ease-in-out infinite" : "none"};
  width: 100%;
  display: flex;
  flex-direction: row;
  align-items: center;
  transition: border-color 0.3s ease, box-shadow 0.3s ease;
  margin-top: ${(props) => (props.loading ? "8px" : "")};
`;
