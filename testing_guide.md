# Comprehensive Testing Guide

Once you have freed up disk space on your `C:` drive (and rebooted to clear memory), follow this step-by-step guide to test the entire `mini-hosting-platform` from top to bottom.

## Prerequisites

1. Ensure **Docker Desktop** is running.
2. Ensure you have at least 5GB of free disk space and a few GBs of free RAM.

## Step 1: Compile the Backend

Because of the previous disk space issues, the Go dependencies failed to download. You must fetch them and compile the backend first.

Open a terminal and run:
```bash
cd d:\ubuntu-web-os\mini-hosting-platform\backend
go mod tidy
go build ./...
go run main.go
```
*Note: Because the reverse proxy binds to ports 80 and 443, you may need to run your terminal as an Administrator.*

## Step 2: Start the React Dashboard

Open a second terminal window to start the beautiful UI.

```bash
cd d:\ubuntu-web-os\mini-hosting-platform\frontend
npm install
npm run dev
```
Open `http://localhost:5173` in your browser.

## Step 3: Test Standard Deployments

1. In your React Dashboard, type a mock domain like `test.com` into the deploy form and click **Deploy**.
2. **Watch the UI:** You should see the live terminal feed update with the WebSocket broadcast, and the new site should appear in the "Active Deployments" grid.
3. **Verify Docker:** Open a third terminal and run `docker ps`. You should see an `nginx:alpine` container running.
4. **Test the Proxy:** Open your browser or use `curl` to hit the proxy on port 80, faking the Host header:
   ```bash
   curl -H "Host: test.com" http://localhost:80
   ```
   *You should see the default "Welcome to nginx!" HTML.*

## Step 4: Test Database Persistence

1. Go back to your backend terminal (the one running `go run main.go`) and kill the server by pressing `Ctrl+C`.
2. Start the server again (`go run main.go`).
3. Make the same `curl` request:
   ```bash
   curl -H "Host: test.com" http://localhost:80
   ```
   *It should still work! The server reloaded the Docker IP mapping from the SQLite database.*

## Step 5: Test Custom Code Uploads

Let's test building your own custom image!

1. Create a temporary folder on your desktop with two files:
   - `index.html`: `<h1>Hello from my custom app!</h1>`
   - `Dockerfile`: 
     ```dockerfile
     FROM nginx:alpine
     COPY index.html /usr/share/nginx/html/index.html
     ```
2. Zip both files together into a file called `app.zip`.
3. Use `curl` to upload the zip file to the engine:
   ```bash
   curl -X POST http://localhost:8080/api/upload -F "file=@app.zip"
   ```
4. The response will look like `{"imageName":"custom-app-1718..."}`. Copy that `imageName`.
5. Deploy your custom image using the API:
   ```bash
   curl -X POST http://localhost:8080/api/deploy \
        -H "Content-Type: application/json" \
        -d '{"domain":"my-custom-site.com", "imageName":"<PASTE_IMAGE_NAME_HERE>"}'
   ```
6. Test it through the proxy:
   ```bash
   curl -H "Host: my-custom-site.com" http://localhost:80
   ```
   *You should see "Hello from my custom app!"*

## Step 6: Test Let's Encrypt (Automated SSL)

Because Let's Encrypt requires a public IP address to verify domain ownership, **you cannot test this on localhost**. 

To test this feature:
1. Deploy the compiled Go binary to a public Linux server (like an AWS EC2 instance or DigitalOcean droplet) that has ports 80 and 443 open.
2. Point a real domain (e.g., `real-site.com`) via a DNS A-Record to that server's public IP.
3. Deploy a container via the engine for `real-site.com`.
4. Navigate to `https://real-site.com`. The engine will automatically intercept the traffic, request a certificate from Let's Encrypt, complete the HTTP-01 challenge, and serve your site securely!




How to test your Custom Code Uploads from the UI:

Create a my-app folder on your computer.
Add an index.html file with some simple text like <h1>My custom app works!</h1>.
Add a Dockerfile with the following contents:
dockerfile
FROM nginx:alpine
COPY index.html /usr/share/nginx/html/index.html
Select both files and Zip them together (e.g., app.zip).
In the React Dashboard, type a domain name (like custom.com), click the file upload button to select your app.zip, and click Deploy Now.
The UI will upload the zip, the backend will dynamically build your custom Docker container inside WSL, and it will deploy it instantly!