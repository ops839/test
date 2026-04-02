# Sybill Meeting Processor

A client-side React app that parses Sybill meeting summaries from Slack export JSON files, classifies meetings as internal or external, and uploads external meetings to Google Sheets — one tab per client.

Built for **Blu Mountain RevOps** (blumountain.me).

## Prerequisites

- Node.js 18+
- A Google Cloud project with:
  - **Google Sheets API** enabled
  - **Google Drive API** enabled
  - An **OAuth 2.0 Client ID** (Web application type)
  - An **API Key** with Sheets API access

## Google Cloud Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use an existing one)
3. Go to **APIs & Services → Library**:
   - Search for **Google Sheets API** → Enable
   - Search for **Google Drive API** → Enable
4. Go to **APIs & Services → Credentials**:
   - Click **Create Credentials → API Key**. Copy it.
   - Click **Create Credentials → OAuth 2.0 Client ID**
     - Application type: **Web application**
     - Authorized JavaScript origins: `http://localhost:5173`
     - Click Create. Copy the Client ID.
5. Go to **APIs & Services → OAuth consent screen**:
   - Configure as External (or Internal if using Workspace)
   - Add your email as a test user
   - Add scopes: `https://www.googleapis.com/auth/spreadsheets`, `https://www.googleapis.com/auth/drive.file`

## Running the App

```bash
# Install dependencies
npm install

# Option A: Set credentials via environment variables
echo 'VITE_GOOGLE_API_KEY=your-api-key' >> .env
echo 'VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com' >> .env

# Option B: Enter credentials in the Settings panel in the app

# Start dev server
npm run dev
```

Open http://localhost:5173 in your browser.

## How to Use

1. **Configure credentials**: Enter your Google API Key and OAuth Client ID in the Settings panel (or set them in `.env`).
2. **Upload files**: Drag and drop your Slack export JSON files into the drop zone (or click to browse). These are the daily JSON files from your `#sybill-notifications` channel export.
3. **Connect Google**: Click "Connect Google Account" and sign in. Select an existing spreadsheet or create a new one.
4. **Process**: Click "Start Processing". The app will:
   - Parse each file for Sybill meeting messages
   - Classify each meeting as internal or external
   - For external meetings, create a tab named after the client and append a row
5. **Monitor**: Watch the processing log for real-time status of each meeting.

## Classification Rules

- **External**: At least one Blu Mountain team member AND at least one attendee with a non-personal business email domain
- **Internal**: All attendees are Blu Mountain team members or have personal email domains
- **Feeder agencies** (Liger, Infinite Renewals): The app extracts the real client name when these agencies appear in the meeting title

## Sheet Format

Each client tab has these columns:

| Meeting Date | Meeting Name | Attendees | Summary | Action Items |
|---|---|---|---|---|

New meetings are always appended — existing data is never overwritten.

## Tech Stack

- React + Vite
- Tailwind CSS
- Google Identity Services (OAuth2)
- Google Sheets API v4
- All processing runs client-side in the browser
