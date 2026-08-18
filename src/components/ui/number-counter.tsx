export interface NumberCounterProps {
  value: number;
  duration?: number;
  decimals?: number;
  className?: string;
  formatter?: (val: number) => string;
}

/** Shows the real score immediately — no count-up through unearned 100%. */
export function NumberCounter({
  value,
  decimals = 0,
  className,
  formatter,
}: NumberCounterProps) {
  const formatted = formatter ? formatter(value) : Number(value).toFixed(decimals);
  return <span className={className}>{formatted}</span>;
}
