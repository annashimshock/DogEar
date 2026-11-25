/**
 * One book-details dialog for the whole signed-in app.
 *
 * Pages and cards only call `openDetails(book)`. The provider owns the single
 * modal instance, so every surface gets the same close behavior, shelf actions,
 * and live library state without another overlay implementation.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Book } from '../../lib/books'
import { BookDetailsModal } from './BookDetailsModal'

interface BookDetailsContextValue {
  openDetails: (book: Book) => void
}

const BookDetailsContext = createContext<BookDetailsContextValue | null>(null)

export function BookDetailsProvider({ children }: { children: ReactNode }) {
  const [book, setBook] = useState<Book | null>(null)
  const [open, setOpen] = useState(false)

  const openDetails = useCallback((next: Book) => {
    setBook(next)
    setOpen(true)
  }, [])

  const closeDetails = useCallback(() => setOpen(false), [])

  const value = useMemo(() => ({ openDetails }), [openDetails])

  return (
    <BookDetailsContext.Provider value={value}>
      {children}
      <BookDetailsModal book={book} open={open} onClose={closeDetails} />
    </BookDetailsContext.Provider>
  )
}

export function useBookDetails(): BookDetailsContextValue {
  const context = useContext(BookDetailsContext)
  if (!context) throw new Error('useBookDetails must be used within BookDetailsProvider')
  return context
}
