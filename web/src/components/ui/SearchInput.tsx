import React, { useEffect, useRef, useState } from "react";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { cn } from "../../utils/cn";

interface SearchInputProps {
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  debounceMs?: number;
}

export function SearchInput({
  placeholder = "Search...",
  value,
  onChange,
  className,
  debounceMs = 300,
}: SearchInputProps) {
  const [local, setLocal] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setLocal(value);
  }, [value]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setLocal(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(next), debounceMs);
  }

  return (
    <div className={cn("relative", className)}>
      <MagnifyingGlassIcon className="text-description-muted absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
      {/* Height locked at 40 px (h-10) — matches the `md` Button so
          search bars and primary actions line up pixel-perfect when
          rendered side-by-side in a toolbar. Part of the 32/40/48
          height system defined in ui-design-plan §2. */}
      <input
        type="text"
        value={local}
        onChange={handleChange}
        placeholder={placeholder}
        className="border-input-border bg-input text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:ring-border-focus h-10 w-full rounded-md border pl-9 pr-3 text-sm focus:outline-none focus:ring-1"
      />
    </div>
  );
}
