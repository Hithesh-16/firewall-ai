import { ChevronRightIcon } from "@heroicons/react/24/outline";
import { ComponentType, useState } from "react";

interface ToggleWithIconProps {
  icon?: ComponentType<React.SVGProps<SVGSVGElement>> | React.ReactNode;
  isToggleable?: boolean;
  open?: boolean;
  onClick?: () => void;
  className?: string;
  isClickable?: boolean;
}

export function ToggleWithIcon({
  icon: Icon,
  isToggleable = false,
  open = false,
  onClick,
  className = "",
  isClickable = false,
}: ToggleWithIconProps) {
  const [isHovered, setIsHovered] = useState(false);
  const showChevron = isToggleable && (isHovered || open);

  function handleClick() {
    if ((isToggleable || isClickable) && onClick) {
      onClick();
    }
  }

  function renderIcon() {
    if (!Icon && !isToggleable) {
      return null;
    }

    if (showChevron) {
      return (
        <ChevronRightIcon
          className={`text-description h-4 w-4 transition-transform duration-200 ease-in-out ${
            open ? "rotate-90" : "rotate-0"
          }`}
        />
      );
    }

    if (!Icon) return null;

    // If it's already an element (e.g. from getStatusIcon or <ToolProgressIcon />)
    if (
      typeof Icon === "object" &&
      (Icon as any).$$typeof === Symbol.for("react.element")
    ) {
      return <div className="text-description h-4 w-4">{Icon as any}</div>;
    }

    // If it's a component (Function or forwardRef object)
    const isComponent =
      typeof Icon === "function" ||
      (typeof Icon === "object" && (Icon as any).$$typeof);

    if (isComponent) {
      const IconComponent = Icon as ComponentType<
        React.SVGProps<SVGSVGElement>
      >;
      return <IconComponent className="text-description h-4 w-4" />;
    }

    // Fallback for strings or other ReactNodes
    return <div className="text-description h-4 w-4">{Icon as any}</div>;
  }

  return (
    <div
      className={`flex h-4 w-4 flex-shrink-0 flex-col items-center justify-center ${className}`}
      onClick={isToggleable || isClickable ? handleClick : undefined}
      onMouseEnter={isToggleable ? () => setIsHovered(true) : undefined}
      onMouseLeave={isToggleable ? () => setIsHovered(false) : undefined}
    >
      {renderIcon()}
    </div>
  );
}
