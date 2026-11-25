/** Derive a short conversation title from the first reader message. */
export function deriveChatTitle(content: string): string {
  const first =
    content
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? 'Untitled'
  return first.length <= 50 ? first : `${first.slice(0, 47).trimEnd()}…`
}
