import { Text } from "ink";
import React, { useEffect, useState } from "react";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface LoadingAnimationProps {
  visible?: boolean;
  color?: string;
}

const LoadingAnimation: React.FC<LoadingAnimationProps> = ({
  visible = true,
  color = "#10b981",
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!visible) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % SPINNER.length);
    }, 80);

    return () => clearInterval(interval);
  }, [visible]);

  if (!visible) return null;

  return <Text color={color}>{SPINNER[currentIndex]}</Text>;
};

export { LoadingAnimation };
