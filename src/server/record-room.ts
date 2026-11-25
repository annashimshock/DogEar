import type { Env } from '../../worker'

/** The app room shared by the browser's RecordScope and worker chat helpers. */
export function recordRoomStub(env: Env): DurableObjectStub {
  return env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
}
