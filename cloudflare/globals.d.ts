// Browser globals that shared lib code guards for; workerd has neither.
declare const location: { origin: string } | undefined;
declare const localStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
