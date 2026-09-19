import { useState } from "react";

import { useDebouncedCallback } from "@/hooks/use-debounced-value";
import { errorMessage } from "@/lib/orpc-error";

/** Below this, a remote search matches most of the table, so it is not worth a round trip. */
export const MIN_SEARCH_CHARS = 2;

/** A type-ahead is for recognising a row, not browsing: more rows only cost time. */
export const SEARCH_RESULT_LIMIT = 6;

/**
 * The debounced term and popup state behind a remote type-ahead. The caller owns the
 * query, because only it knows what it is searching; this owns the bookkeeping every
 * combobox repeats.
 */
export function useSearchTerm(delay = 250) {
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const settle = useDebouncedCallback(setTerm, delay);
  const searching = term.length >= MIN_SEARCH_CHARS;

  return {
    term,
    searching,
    // Never a popup before the term is long enough: there is nothing to match yet.
    open: open && searching,
    setOpen,
    onInputValueChange: (value: string) => settle(value.trim()),
    clear: () => {
      settle("");
      setTerm("");
      setOpen(false);
    },
  };
}

/** What the popup says when it has no rows; `null` while the field is empty. */
export function searchEmptyMessage(
  searching: boolean,
  query: { isError: boolean; error: unknown; isPending: boolean },
  messages: { noMatch: string; failed: string },
): string | null {
  if (!searching) return null;

  if (query.isError) return errorMessage(query.error, messages.failed);

  return query.isPending ? "Searching…" : messages.noMatch;
}
