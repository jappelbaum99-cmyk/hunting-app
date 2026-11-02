// The free Firebase project that carries hunts and GPS pins from phones to the
// hub. These values only say which project to talk to; they aren't secrets.
// Who can read and write is set by firestore.rules.
export const FIREBASE_CONFIG = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  appId: '',
};

export const CAMP_SYNC_AVAILABLE = FIREBASE_CONFIG.apiKey !== '';
