export function shiftLocalMinute(value: string, minutes: number): string {
  return new Date(Date.parse(`${value}:00Z`) + minutes * 60_000).toISOString().slice(0, 16);
}
