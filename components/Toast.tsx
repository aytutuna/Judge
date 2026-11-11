"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./Toast.module.css";

/** A line of text that shows for a couple of seconds at the bottom of the screen. */
export function useToast(): [string | null, (message: string) => void] {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const show = useCallback((text: string) => {
    if (timer.current) clearTimeout(timer.current);
    setMessage(text);
    timer.current = setTimeout(() => setMessage(null), 2400);
  }, []);
  return [message, show];
}

export function Toast({ message }: { message: string | null }) {
  return (
    <p className={styles.toast} role="status" data-shown={message ? "" : undefined}>
      {message}
    </p>
  );
}
