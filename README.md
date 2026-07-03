# 💊 DawaLens AI

**Smart Medicine Tracker & Scanner — an AI-powered app that identifies medicines from your camera, tracks prescriptions and schedules, and keeps your health data private with end-to-end encryption.**

🔗 **Live:** [dawalens.vercel.app](https://dawalens.vercel.app) · [noorpos.in](https://noorpos.in)

---

## 📖 About

DawaLens AI turns your phone camera into a personal pharmacist's assistant. Point it at a medicine strip or label, and Gemini-powered AI extracts the medicine name, dosage, and scheduling details automatically — no manual data entry. Beyond scanning, it's a full medication management system: track prescriptions, get drug-interaction warnings, chat with an AI assistant about your medicines, sync reminders to Google Tasks, and back up your data to Google Sheets/CSV — all while keeping sensitive medical data private through optional zero-knowledge end-to-end encryption.

It's built as a web app (with an Express backend) and is also packaged for Android via Capacitor, so it works both in the browser and as an installable mobile app.

## ✨ Features

- 📷 **AI Medicine Scanner** — Uses the device camera (`CameraCapture.tsx`) and Gemini's vision capabilities to extract medicine name, dosage, and frequency straight from a photo of a strip or label.
- 💬 **AI Chat Assistant** — A conversational assistant (`ChatView.tsx` + `geminiService.ts`) for asking questions about your medicines and general health guidance, with Markdown-rendered responses.
- 🔔 **Medicine Scheduling & Reminders** — Add, edit, and track prescriptions (`MedicineForm.tsx`, `MedicineList.tsx`) with dosage frequency and timing.
- ⚠️ **Drug Interaction Checks** — Server-side interaction checking (`checkDrugInteractionsServer`) that flags potential conflicts between tracked medicines, with response caching for speed.
- 🔐 **Zero-Knowledge End-to-End Encryption (E2EE)** — Optional client-side encryption (Web Crypto API) of medical records before they're sent to the cloud — the server never has access to decryption keys.
- ☁️ **Firebase Backend** — Authentication (Google Sign-In + email/password) and Firestore for secure, real-time, per-user data storage, with Firebase Storage for images.
- 📊 **Import/Export to CSV & Google Sheets** — Back up or restore your full medicine list as a CSV file compatible with Google Sheets (`papaparse`-powered import/export in `SettingsModal.tsx`).
- 📧 **Email Notifications** — Transactional email support via Resend/Nodemailer (`emailService.ts`, `MailboxModal.tsx`) for reminders and account communication.
- 🔑 **API Key Rotation** — Automatic fallback across multiple configured Gemini API keys (`server/aiService.ts`) to maximize uptime if one key hits a rate limit.
- 📱 **PWA + Android App** — Installable as a standalone Progressive Web App (`manifest.json`, service worker) and packaged as a native Android app via Capacitor.
- 🍪 **Privacy-First** — Built-in cookie consent banner, and dedicated Privacy Policy / Terms of Service pages compliant with the Google API Services User Data Policy (for Google Tasks integration).

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript, Vite |
| Styling | Tailwind CSS v4 |
| Backend | Express (Node.js), served via `app-server.ts` |
| AI | Google Gemini API (`@google/genai`) with multi-key rotation |
| Auth & Database | Firebase Authentication + Firestore + Storage |
| Local Cache | better-sqlite3 |
| Data Import/Export | PapaParse (CSV / Google Sheets) |
| Email | Resend, Nodemailer |
| Mobile | Capacitor (Android) |
| Deployment | Vercel |

## 📁 Project Structure

```
DawaLensAI/
├── app-server.ts             # Express server entry point, API routes, privacy/terms pages
├── api/
│   └── index.ts               # API handler
├── server/
│   └── aiService.ts          # Gemini integration: extraction, interaction checks, chat, key rotation
├── medCache.ts                # Server-side caching (extraction/interaction/chat counts)
├── src/
│   ├── App.tsx                # Main app component & state (medicines, CSV import/export, etc.)
│   ├── main.tsx                # App entry point
│   ├── firebase.ts            # Firebase auth/Firestore/Storage setup
│   ├── constants.tsx
│   ├── types.ts
│   ├── components/
│   │   ├── CameraCapture.tsx  # Camera capture & scanning UI
│   │   ├── ChatView.tsx       # AI chat interface
│   │   ├── MedicineForm.tsx   # Add/edit medicine entries
│   │   ├── MedicineList.tsx   # Medicine list/dashboard
│   │   ├── SettingsModal.tsx  # Settings, CSV import/export, E2EE toggle
│   │   ├── MailboxModal.tsx   # Email/notification management
│   │   └── CookieConsentBanner.tsx
│   ├── services/
│   │   ├── geminiService.ts   # Client-side AI service calls
│   │   ├── emailService.ts    # Email sending logic
│   │   └── localImageStorage.ts
│   └── utils/
├── public/                    # Static assets, manifest, service worker, privacy/terms pages
├── firebase-blueprint.json    # Firebase project blueprint
├── firestore.rules            # Firestore security rules
├── capacitor.config.json      # Android app packaging config
└── vercel.json                 # Vercel deployment config
```

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+ recommended)
- A [Gemini API key](https://ai.google.dev/)
- A [Firebase project](https://firebase.google.com/) (Authentication, Firestore, and Storage enabled)

### Installation

```bash
# Clone the repository
git clone https://github.com/Noor-Junior45/DawaLensAI.git
cd DawaLensAI

# Install dependencies
npm install
```

### Environment Setup

Create a `.env.local` file in the project root and add your Gemini API key (the app also accepts `API_KEY` or `GIMINI_API_KEY` as fallback names, with automatic key rotation across whichever are set):

```
GEMINI_API_KEY=your_api_key_here
```

Firebase configuration is read from `firebase-applet-config.json` — update it with your own Firebase project credentials before running.

### Run Locally

```bash
npm run dev
```

This starts the Express server (via `tsx app-server.ts`), which serves both the API routes and the Vite-built frontend.

### Build for Production

```bash
npm run build
```

Builds the Vite frontend and bundles the Express server into `dist/server.cjs`.

### Start Production Server

```bash
npm run start
```

### Android App

The project includes a Capacitor configuration (`capacitor.config.json`) for building a native Android app from the `dist` web build. Use the standard [Capacitor Android workflow](https://capacitorjs.com/docs/android) (`npx cap add android`, `npx cap sync`, then build via Android Studio) after running `npm run build`.

## 🌐 Deployment

Configured for [Vercel](https://vercel.com/) deployment (see `vercel.json`). Set the following environment variables in your Vercel project settings:
- `GEMINI_API_KEY`
- Firebase credentials (as referenced in `firebase-applet-config.json`)
- Email provider keys (`RESEND_API_KEY` or SMTP credentials) if using email notifications

## 🔐 Privacy & Security

- Optional **Zero-Knowledge E2EE**: medical data is encrypted client-side before being sent to the cloud; the server cannot decrypt it.
- Firestore access is governed by `firestore.rules`, restricting data access to authenticated owners.
- Full Privacy Policy and Terms of Service are served at `/privacy` and `/terms`, compliant with the Google API Services User Data Policy for Google Tasks integration.

## 📄 License

This project currently has no explicit open-source license. All rights reserved unless stated otherwise.

--- 

**Built by [Noor-Junior45](https://github.com/Noor-Junior45)**
