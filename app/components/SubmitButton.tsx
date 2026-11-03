"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pendingText = "處理中…",
  className,
  confirm,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? pendingText : children}
    </button>
  );
}
