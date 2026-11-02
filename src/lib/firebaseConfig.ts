// The free Firebase project that carries hunts and GPS pins from phones to the
// hub. These values only say which project to talk to; they aren't secrets.
// Who can read and write is set by firestore.rules.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAqawBK_ymUh9xPHXSzfcVDZ22z71pRxFQ',
  authDomain: 'hunting-hub-camp.firebaseapp.com',
  projectId: 'hunting-hub-camp',
  appId: '1:106437240630:web:66d52ac59064e8df877597',
};

export const CAMP_SYNC_AVAILABLE = FIREBASE_CONFIG.apiKey !== '';
