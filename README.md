# 99expert Prerender Server

A simple Express.js server that serves OG meta tags for social media crawlers (LinkedIn, Facebook, etc.) and redirects regular users to the main SPA.

## Deploy to Railway

### 1. Create Railway Project
1. Go to [railway.app](https://railway.app) and sign in
2. Click "New Project" → "Empty Project"
3. Click "Add a Service" → "GitHub Repo" or "Empty Service"

### 2. If using GitHub (Recommended)
1. Create a new GitHub repo with just the contents of this `prerender-server` folder
2. Connect Railway to your GitHub repo
3. Railway will auto-deploy on every push

### 3. If using Railway CLI
```bash
cd prerender-server
npm install -g @railway/cli
railway login
railway init
railway up
```

### 4. Configure Domain
1. In Railway, go to your service → Settings → Domains
2. Add a custom domain: `share.99expert.com`
3. Railway will show you the CNAME record to add to your DNS

### 5. Update DNS
Add a CNAME record at your domain registrar:
- Type: CNAME
- Name: share
- Value: [Railway provided value, e.g., your-app.up.railway.app]

## Usage

Once deployed, update the ShareButton in Lovable to use:
- `https://share.99expert.com/expert/{id}` for expert profiles
- `https://share.99expert.com/talk/{id}` for arrangements

## Endpoints

- `GET /expert/:id` - Serves OG meta for expert profiles
- `GET /talk/:id` - Serves OG meta for arrangements
- `GET /health` - Health check endpoint
- `GET *` - Redirects to 99expert.com

## Environment Variables (Optional)

The Supabase credentials are hardcoded for simplicity, but you can use environment variables:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `PORT` (defaults to 3000)
