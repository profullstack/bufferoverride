import { db } from '@bufferoverride/db';
import { createProfileStore, type ProfileStore } from '@profullstack/profile';

let store: ProfileStore | undefined;

/**
 * The private signup profile (@profullstack/profile), in `user_profiles` keyed
 * by actors.id. Built on first use, not at import, so `next build` never opens
 * the database.
 */
export function profileStore(): ProfileStore {
  store ??= createProfileStore(db());
  return store;
}
