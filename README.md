# ClickCheck

Every day we receive links promising opportunities, jobs, scholarships, mobile money bonuses, fake delivery messages,  and many others. And while our human intuition can help us deduce that they're scams, sometimes we are too blinded by the opportunities especially when they are sent from a person we trust and we have no quick way to check a link. **ClickCheck** is a way to solve that problem. **Check a link before you click it**. You paste any URL and ClickCheck scans it against Google Safe Browsing and 70+ antivirus engines (through VirusTotal), then gives a verdict:safe, suspicious or dangerous with a risk score out of 100.


- Live demo: 
- Demo video: 

## Features

- Scans every URL with two independent security APIs
- One combined verdict + risk score, with advice in normal language
- Scan history saved on your device, with search, filter by verdict, and sorting by date or risk
- Handles errors properly: bad URLs, an API being down, and VirusTotal's rate limit all show a clear message instead of crashing
- API keys stay on the server only, the browser never sees them and they are not in this repo

## APIs used (credits)

| API | What I use it for | Docs |
|---|---|---|
| Google Safe Browsing v4 | Google's database of known phishing/malware links | https://developers.google.com/safe-browsing/v4 |
| VirusTotal v3 | Combined results from 70+ antivirus vendors | https://docs.virustotal.com/reference/overview |

Thanks to Google and VirusTotal for the free access. 
**N.B: VirusTotal free tier only allows 4 checks per minute, the app detects that and tells you to wait**.

## Tech

- Backend: Node.js (18+) with Express — serves the frontend and makes the API calls so the keys stay secret
- Frontend: plain HTML, CSS and JavaScript, no frameworks

## Run it locally

```bash
git clone https://github.com/audrey934/clickcheck.git
cd clickcheck
npm install
cp .env.example .env   # then open .env and put in your two keys
npm start
```

Open http://localhost:8080

Where the keys come from:
- Google Safe Browsing: console.cloud.google.com → make a project → enable "Safe Browsing API" → Credentials → create API key
- VirusTotal: sign up at virustotal.com → your profile → API key

For testing: `example.com` should come back safe, and `testsafebrowsing.appspot.com/s/phishing.html` (Google's own harmless test page) should come back dangerous.

## Deployment (Web01, Web02, Lb01)



