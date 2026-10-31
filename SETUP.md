# Getting the app on your iPhone

The map uses Mapbox, which needs native code, so it won't run in the
"Expo Go" app. Instead you install a **development build**: your own copy of the
app that loads code from this PC while you develop. You only rebuild it when
native packages change. Day-to-day code changes show up instantly.

## 1. Accounts (one time)

| Account | Cost | Why |
|---|---|---|
| [Apple Developer Program](https://developer.apple.com/programs/enroll/) | $99/yr | Required to install your own app on an iPhone. Approval can take a day or two. |
| [Expo](https://expo.dev/signup) | Free tier | Builds the iOS app in the cloud (no Mac needed). |
| [Mapbox](https://account.mapbox.com/auth/signup/) | Free tier | Satellite, topo, terrain and offline maps. |

## 2. Mapbox token

1. In Mapbox, open **Tokens** and copy your **Default public token** (starts with `pk.`).
2. In this folder, copy `.env.example` to `.env` and paste the token:
   ```
   EXPO_PUBLIC_MAPBOX_TOKEN=pk.xxxxxxxx
   ```
   `.env` is git-ignored, so the token never gets committed.

## 3. Pick your bundle identifier

In `app.json`, change `com.yourname.huntingapp` (two places) to something
unique to you, e.g. `com.appelbaum.huntingapp`. Apple needs this to be unique
worldwide, and it is hard to change after you publish.

## 4. Build and install on your iPhone

Run these from this folder:

```bash
npx eas-cli@latest login
```
```bash
npx eas-cli@latest device:create
```
Open the link it gives you on your iPhone to register the phone.

```bash
npx eas-cli@latest build --profile development --platform ios
```
EAS asks you to sign in to your Apple account and sets up certificates for you.
The build takes ~10–20 minutes. When it's done, open the install link on your
iPhone. You may need to turn on **Settings → Privacy & Security → Developer Mode**.

## 5. Run it

```bash
npx expo start
```
Open the app on your iPhone. It finds the dev server on your Wi-Fi (the
phone and PC must be on the same network). If it can't connect, try
`npx expo start --tunnel`.

## Useful commands

```bash
npm run typecheck
```
```bash
npx expo-doctor
```
