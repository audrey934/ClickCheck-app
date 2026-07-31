# ClickCheck

Every day we receive links promising opportunities, jobs, scholarships, mobile money bonuses, and many others. And while our human intuition can help us deduce scams, sometimes we are too blinded by the opportunities, especially when they are sent from a person we trust, and we have no quick way to check. **ClickCheck** solves that problem. You paste any URL, and ClickCheck scans it against Google Safe Browsing and 70+ antivirus engines (through VirusTotal), then gives a verdict: safe, suspicious, or dangerous with a risk score out of 100.

No account, no login, no app to install. Paste the link, get an answer in a few seconds. 

- Live demo: [https://www.theaudrey.tech](https://www.theaudrey.tech)
- Demo video: [ClickCheck](https://youtu.be/Z1_hk9bj0SI)


## Live deployment
 
| | URL |
|---|---|
| Load balancer (use this one) | https://www.theaudrey.tech |
| Web01 | [http://34.201.241.134:8080](http://34.201.241.134:8080) |
| Web02 | [http://54.91.209.195:8080](http://54.91.209.195:8080) |
 
Each server is listed so it can be verified on its own; normal traffic goes through the load balancer, which terminates HTTPS and splits requests between the two. A bare IP over HTTPS will warn, since the certificate covers the domain names rather than IPs. Port 8080 is public only so each server can be checked directly. In production, it would be scoped to the load balancer's subnet (sudo ufw allow from 10.227.0.0/17 to any port 8080).

## What it does

- Scans every URL with two independent security APIs at the same time
- One combined verdict + risk score, with advice in normal language
- Allows user interactivity
  - **Search** the scan history by URL
  - **Filter** by verdict (safe/suspicious/dangerous)
  - **Sort** by newest, oldest, highest risk or lowest risk
  - **Clear** all history with one button
- Light and dark theme, remembered between visits
- Works on a phone, which is where most scam links are opened

## Error handling
 
| What goes wrong | What happens |
|---|---|
| Empty input | "Please paste a link first", no request sent |
| Invalid URL (`not a url`, `hello`) | 400 with a message explaining the expected format, before either API is called |
| One API key missing or wrong | That source is reported as unavailable, and the verdict is built from the other one |
| One API down or erroring | A partial verdict is returned rather than a failure |
| Both APIs unavailable | 502 with a plain message and the reason from each source |
| VirusTotal rate limit (429) | Specific message telling the user to wait, instead of a generic error |
| VirusTotal analysis never finishes | Polling gives up after a timeout instead of hanging |
| Anything else | Caught by a final handler that logs the real error and returns a generic message, so a raw crash is never sent to the browser |
| Server unreachable from the browser | "Could not reach the server. Check your connection and try again." |
 
Because the two APIs are handled separately, one of them failing never takes down the whole check.

## APIs used (credits)

| API | What I use it for | Docs |
|---|---|---|
| Google Safe Browsing v4 | Google's database of known phishing/malware links | https://developers.google.com/safe-browsing/v4 |
| VirusTotal v3 | Combined results from 70+ antivirus vendors | https://docs.virustotal.com/reference/overview |

## Additional Resources

- [Express](https://expressjs.com/) for the server and routing
- [dotenv](https://github.com/motdotla/dotenv) to load the API keys from a `.env` file
- [HAProxy](https://www.haproxy.org/) as the load balancer
- [Let's Encrypt](https://letsencrypt.org/) and Certbot for the HTTPS certificate
- Fonts: [Archivo](https://fonts.google.com/specimen/Archivo) and [IBM Plex Sans / IBM Plex Mono](https://fonts.google.com/?query=IBM+Plex) from Google Fonts

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


## Testing 
| What you try| What should happen |
|---|---|
| `example.com` | safe |
| `http://testsafebrowsing.appspot.com/apiv4/ANY_PLATFORM/MALWARE/URL/` | dangerous |
| `http://testsafebrowsing.appspot.com/apiv4/ANY_PLATFORM/SOCIAL_ENGINEERING/URL/` | dangerous (phishing) |
| `not a url` | a validation message, and no API call is made |
| the same link twice | the second one comes back instantly from the cache |

## Deployment
 
```
theaudrey.tech  →  Lb01 (HAProxy :80/:443)  →  Web01 :8080
                                            →  Web02 :8080
```
 
| Server | Public IP | Internal IP |
|---|---|---|
| web-01 | 34.201.241.134 | 10.227.85.217 |
| web-02 | 54.91.209.195 | 10.227.42.131 |
| lb-01 | 44.206.225.22 | — |
 
### On each web server
 
Install Node 20, clone the repo into `/var/www/clickcheck`, then:
 
```bash
npm install --omit=dev
```
 
Create `.env` with the two API keys, `PORT=8080`, and `SERVER_NAME` (`web-01` or `web-02`). `SERVER_NAME` is the only difference between the two servers. It is returned by `/health` and in the `X-Served-By` header, which identifies the server that answered a request.
 
Run it under systemd so it restarts on crash and survives a reboot, and open port 8080 in `ufw`, which by default only allows 22, 80, and 443:
 
```bash
sudo cp deployment/clickcheck.service /etc/systemd/system/
sudo systemctl enable --now clickcheck
sudo ufw allow 8080/tcp
``` 
This opens 8080 publicly so each server can be verified directly; see the note above on scoping it to the load balancer's subnet in production. Each server also keeps checked URLs in memory for 10 minutes and returns the saved result instead of calling both APIs again. 

**On the load balancer:** `deployment/haproxy.cfg` goes to `/etc/haproxy/haproxy.cfg`. The important part:
 
```
backend clickcheck_back
    balance roundrobin
    option httpchk GET /health
    http-check expect status 200
    server web-01 10.227.85.217:8080 check
    server web-02 10.227.42.131:8080 check
```
 
`roundrobin` alternates between the two servers. `option httpchk GET /health` uses the app's own health route, so HAProxy checks the app is alive rather than only that the port is open, and `http-check expect status 200` takes a server out of rotation on any other response. The backends are addressed by internal IP.
 
Validate before reloading: a broken config that is reloaded takes the load balancer down:
 
```bash
sudo haproxy -c -f /etc/haproxy/haproxy.cfg
sudo systemctl reload haproxy
```
 
HTTPS is terminated at the load balancer with a Let's Encrypt certificate, and plain HTTP requests are redirected to HTTPS.
 
**Testing it works:**
 
```bash
curl https://www.theaudrey.tech/health
curl https://www.theaudrey.tech/health
```
 
The `server` field alternates between `web-01` and `web-02`. The same thing is visible in the app itself, where the footer shows which server handled each scan.
 
## Security
 
- API keys exist only on the server, in a gitignored `.env`. The frontend calls `/api/check`, never the APIs directly.
- URLs are written into the page with `textContent`, not `innerHTML`, so a URL containing HTML cannot inject anything (XSS).
- Input is validated and normalised before either API is called.

## Known limitations
 
- A "safe" verdict means no engine has flagged the link **yet**. New scam links are often unreported, so caution with passwords, PINs, and personal data still applies.
- VirusTotal's free tier allows 4 checks per minute.
- History is per device and per browser, and is cleared with the browser's data.
- The cache is per server, so a link can be scanned twice before it is cached on both.
- "Suspicious" is uncommon. It requires suspicious engines but no malicious ones, so most results are safe or dangerous.
- Redirects are not followed, so a shortened link is checked as itself rather than its destination.

## Challenges

**Backend unreachable from the load balancer.** Requests from Lb01 to the web servers on port 8080 timed out. The cause was `ufw`, which permitted only ports 22, 80 and 443 by default. Diagnosing it turned on distinguishing a timeout, where traffic is silently dropped by a firewall, from a connection refused, where traffic arrives but nothing is listening. Resolved by adding an explicit rule for port 8080.

**Silent API misconfiguration.** VirusTotal returned "API key not configured" because my earlier placeholder value remained in the server's `.env`. Since each API is handled independently, the application continued returning a valid Google Safe Browsing verdict, so the failure surfaced only in the response body rather than as a visible error.

**Stale process after deployment.** Following the caching update, both servers continued serving the previous responses despite the new code being present on disk. Node loads the source once at startup, so `systemctl restart clickcheck` was required for the change to take effect.

## Author

**Audrey Hategekimana**
[github.com/audrey934](https://github.com/audrey934)
