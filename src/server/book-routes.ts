import type { AppContext } from '../../worker'
import type { Hono } from 'hono'

interface GoogleBook {
  id: string
  volumeInfo?: {
    title?: string
    authors?: string[]
    description?: string
    categories?: string[]
    publishedDate?: string
    imageLinks?: {
      thumbnail?: string
    }
  }
}

interface GoogleBooksResponse {
  totalItems?: number
  items?: GoogleBook[]
}

export function registerBookRoutes(app: Hono<AppContext>): void {
  app.get('/api/books/search', async (c) => {
    const query = c.req.query('q')?.trim()

    if (!query) {
      return c.json(
        { error: 'A search query is required.' },
        400
      )
    }

    const requestedLimit = Number(c.req.query('limit') ?? 12)
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(40, Math.max(1, Math.floor(requestedLimit)))
      : 12

    const url = new URL(
      'https://www.googleapis.com/books/v1/volumes'
    )

    url.searchParams.set('q', query)
    url.searchParams.set('key', c.env.GOOGLE_BOOKS_API_KEY)
    url.searchParams.set('maxResults', String(limit))
    url.searchParams.set('printType', 'books')

    try {
      const response = await fetch(url)

      if (!response.ok) {
        const errorDetails = await response.text()

        console.error('Google Books API error:', {
            status: response.status,
            details: errorDetails,
        })

        return c.json(
            {
            error: 'Google Books search failed.',
            googleStatus: response.status,
            details: errorDetails,
            },
            502
        )
        }

      const data = await response.json() as GoogleBooksResponse

      // Convert Google's response into DogEar's book format.
      const books = (data.items ?? []).map((item) => {
        const info = item.volumeInfo ?? {}

        const thumbnail = info.imageLinks?.thumbnail

        return {
          source: 'google_books',
          sourceId: item.id,
          title: info.title ?? 'Untitled',
          authors: info.authors ?? [],
          description: info.description ?? '',
          categories: info.categories ?? [],
          publishedDate: info.publishedDate ?? '',
          coverUrl: thumbnail?.replace(/^http:/, 'https:') ?? null,
        }
      })

      return c.json({
        totalItems: data.totalItems ?? 0,
        books,
      })
    } catch (error) {
      console.error('Google Books search failed:', error)

      return c.json(
        { error: 'Unable to search for books right now.' },
        500
      )
    }
  })
}