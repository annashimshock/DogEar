/**
 * Persistent AI conversations.
 *
 * Chat and message rows live in the SDK's owner-scoped `ai-chats` and
 * `ai-messages` collections. Clients read them through RecordScope; all writes
 * go through worker routes so message roles cannot be forged.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { getAuthToken, useAuth, useQuery } from 'deepspace'

export interface ChatSummary {
  recordId: string
  title: string
  updatedAt: string
}

interface ChatData {
  userId: string
  title: string
}

function activeKey(userId: string): string {
  return `dogear:active-chat:${userId}`
}

export function useRecommendationChats() {
  const { isSignedIn, userId } = useAuth()
  const ownerId = userId ?? '__anonymous__'

  const { records, status } = useQuery<ChatData>('ai-chats', {
    where: { userId: ownerId },
    orderBy: 'updatedAt',
    orderDir: 'desc',
    limit: 50,
  })

  const [activeChatId, setActiveChatIdState] = useState<string | null>(null)
  const newChatPending = useRef(false)

  const chats: ChatSummary[] = records.map((record) => ({
    recordId: record.recordId,
    title: record.data.title || 'New chat',
    updatedAt: record.updatedAt,
  }))

  const setActiveChat = useCallback(
    (id: string | null) => {
      newChatPending.current = id === null
      setActiveChatIdState(id)
      if (!userId) return
      try {
        if (id) localStorage.setItem(activeKey(userId), id)
        else localStorage.removeItem(activeKey(userId))
      } catch {
        // Private browsing can disable storage; the in-memory choice still works.
      }
    },
    [userId],
  )

  // Restore the last conversation after a refresh, or fall back to the most
  // recently updated one. A manually started new chat stays empty until sent.
  useEffect(() => {
    if (!userId || status !== 'ready' || newChatPending.current) return
    let stored: string | null = null
    try {
      stored = localStorage.getItem(activeKey(userId))
    } catch {
      stored = null
    }
    const exists = (id: string | null): boolean => !!id && chats.some((chat) => chat.recordId === id)
    if (exists(stored)) {
      setActiveChatIdState(stored)
    } else if (!exists(activeChatId)) {
      const first = chats[0]?.recordId ?? null
      setActiveChatIdState(first)
      if (!first) {
        try {
          localStorage.removeItem(activeKey(userId))
        } catch {
          // Ignore storage failures.
        }
      }
    }
  }, [userId, status, chats, activeChatId])

  const createChat = useCallback(async (): Promise<string> => {
    const token = await getAuthToken()
    if (!token || !userId) throw new Error('Sign in to start a conversation.')

    const response = await fetch('/api/ai/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: 'New chat' }),
    })
    const data = (await response.json()) as { chat?: { recordId?: string }; error?: string }
    if (!response.ok || !data.chat?.recordId) {
      throw new Error(data.error ?? 'Could not start a new conversation.')
    }
    newChatPending.current = false
    setActiveChatIdState(data.chat.recordId)
    try {
      localStorage.setItem(activeKey(userId), data.chat.recordId)
    } catch {
      // Ignore storage failures.
    }
    return data.chat.recordId
  }, [userId])

  const deleteChat = useCallback(
    async (id: string) => {
      const token = await getAuthToken()
      if (!token) throw new Error('Sign in to delete a conversation.')

      const response = await fetch(`/api/ai/chats/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) {
        const data = (await response.json()) as { error?: string }
        throw new Error(data.error ?? 'Could not delete that conversation.')
      }
      if (activeChatId === id) {
        newChatPending.current = false
        setActiveChatIdState(null)
        try {
          if (userId) localStorage.removeItem(activeKey(userId))
        } catch {
          // Ignore storage failures.
        }
      }
    },
    [activeChatId, userId],
  )

  return {
    isSignedIn,
    userId,
    chats,
    chatLoading: status === 'loading',
    activeChatId,
    setActiveChat,
    createChat,
    deleteChat,
  }
}
