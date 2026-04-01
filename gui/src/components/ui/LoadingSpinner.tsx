/**
 * Consistent loading spinner used across all pages.
 */

interface LoadingSpinnerProps {
  message?: string;
  size?: "sm" | "md" | "lg";
}

export default function LoadingSpinner({ message, size = "md" }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: "h-4 w-4 border-2",
    md: "h-6 w-6 border-2",
    lg: "h-8 w-8 border-3",
  };

  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8">
      <div
        className={`${sizeClasses[size]} rounded-full border-description/30 border-t-foreground animate-spin`}
      />
      {message && (
        <span className="text-xs text-description">{message}</span>
      )}
    </div>
  );
}
