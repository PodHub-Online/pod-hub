# Previews: test copies of Pod Hub

Every push to `main` goes live for everyone right away. Every other branch (each Claude session works on its own `claude/…` branch) gets a **preview** from Vercel: a private test copy of the app at its own address. You try a change there on your phone first, and only then send it to everyone.

The settings below make every preview use its own test database, never the live one. They are named `STAGING_…` (from when the test copy was a `staging` branch); the names stay, because the code looks for them.

Setting it up takes about 30 minutes, once. You need: your Supabase login, your Vercel login, and a computer (the Vercel and Supabase dashboards are hard to use on a phone).

---

## Why it needs its own database

Every time Vercel builds the app, it also updates the database (the build command is `npm run build && npm run db:push`). If the test copy used the live database, every test build would change the live database before you had tried anything. So the previews get their own empty database (one shared by all previews), and nothing it does can touch the live app or the live data.

---

## Part 1: a second database in Supabase (about 10 minutes)

1. Go to **supabase.com** and sign in.
2. Top left, click your organization name, then **New project**.
   - **Name:** `pod-hub-staging`
   - **Database password:** click **Generate a password**, then copy it somewhere safe for the next few minutes (a note on your computer). You'll need it in step 5.
   - **Region:** the same region as your live project (it's shown on your live project's home page, for example "East US (North Virginia)"). Same region = same speed.
   - **Plan:** Free.
   - Click **Create new project** and wait 1–2 minutes until it says the project is ready.
3. In the new project, click **Connect** (top of the page, next to the project name). A window opens with connection strings.
4. In that window, stay on the first tab, **Connection String** (not "App Frameworks", "ORMs" or "API Keys"), and set the dropdowns to **Type: URI** and **Source: Primary Database**. Then copy two strings:
   - **Method: Transaction pooler**: copy the string. It ends in **`:6543/postgres`** and looks like
     `postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres`
     This one is the **pooled** string.
   - **Method: Session pooler**: copy that string too. It ends in **`:5432/postgres`**. This one is the **non-pooled** string.
   - Don't use **Direct connection**: it only works over IPv6, which Vercel can't reach ("Not IPv4 compatible"), so the build would fail.
   - If your screen has no Method dropdown and shows the poolers as separate sections instead, take the strings ending in `:6543` and `:5432`.
5. In both strings, replace `[YOUR-PASSWORD]` (including the brackets) with the password from step 2.
   - If the password has characters like `@`, `#`, `/` or `?`, generate a new password made of only letters and numbers instead (Project Settings → Database → Reset database password), because those characters break the string.
6. Keep the two finished strings open in your note. Don't paste them in the chat.

You don't need to create any tables: the first preview build creates all of them by itself.

---

## Part 2: tell Vercel which database the test copy uses (about 10 minutes)

Vercel keeps three sets of settings: **Production** (the live app), **Preview** (test copies) and **Development** (the laptop). The live database variables (`POSTGRES_…`) come from the Supabase connection, which locks them to both Production and Preview (their menu only says **Manage connection**). So you **don't change any existing variable**. Instead, you add new ones whose names start with `STAGING_`. A test copy uses those in place of the live ones; the live app never reads them.

1. Go to **vercel.com**, open the project (**eight**), then **Settings** → **Environment Variables**.
2. Leave every existing variable exactly as it is. If you already unticked **Preview** on one (for example `CRON_SECRET` or `JWT_SECRET`), tick it back on and **Save**; the build needs them present.
3. Click **Add New** (or **Create new**) at the top, and add each of these, every time ticking **only Preview**:

   | Name | Value |
   |---|---|
   | `STAGING_POSTGRES_URL` | the **pooled** string from Part 1 (port 6543) |
   | `STAGING_POSTGRES_URL_NON_POOLING` | the **non-pooled** string from Part 1 (port 5432) |
   | `STAGING_JWT_SECRET` | a new random value (see below) |
   | `STAGING_TOKEN_KEY` | another new random value |
   | `STAGING_CRON_SECRET` | another new random value |
   | `STAGING_OWNER_EMAIL` | your own email (makes you the owner of the test copy) |

   **New random values:** open https://www.uuidgenerator.net/version4 and copy one; press **Generate** again for the next one. Use a different value for each of the three. They must not be the same as the live ones.
4. If Vercel asks to **Redeploy** after saving, you can say no; the next preview build picks them up.

**Safety net:** a test build without `STAGING_POSTGRES_URL` stops with an error before it touches any database, so a missing variable can never change the live data.

---

## Part 3: open a preview (about 5 minutes)

1. When Claude has a change ready, it pushes it to its branch and sends you the preview link. Vercel builds it automatically.
2. In Vercel → **Deployments**, the newest row says **Preview** and the Claude branch. Wait until it says **Ready** (2–3 minutes).
   - If it says **Error**, click it and open **Building**. If the log says something about the database, the strings from Part 1 are wrong (most often the password). Fix them in Part 2 and click **Redeploy**.
3. Open the link (or click the deployment, then **Visit**). It looks like `eight-git-claude-….vercel.app`. The address is different for every Claude session, so there is nothing to bookmark.
4. The page shows a yellow **TEST SITE** bar at the top. That's how you know you're not on the live app.

### Keep strangers out of the previews
Vercel → **Settings** → **Deployment Protection** → **Vercel Authentication**: set it to **Standard Protection** (or "Only Preview Deployments") and **Save**. Now only people signed in to your Vercel account can open previews.

---

## Part 4: on a preview

1. Open the preview on your phone and sign in with your **Eight Sleep** account. Each new preview address asks once; your schedule and settings there come from the shared test database, not the live app.
2. You're the owner on previews (from `OWNER_EMAIL`), so you get the Statistics button and Invites.
3. **Important: a preview controls your real Pod.** Pressing − / + or Nap there really changes your bed, the same as the live app.
4. **Don't add a preview to cron-job.org.** Without it, a preview's schedule never runs by itself, so it can't fight with the live schedule. If you want to see a schedule run on a preview, use **Settings → Account → Run schedule check now**, and then turn "Follow schedule" back off there.
5. WHOOP won't connect on a preview, because its address isn't in the WHOOP developer page as a redirect URL (and it changes every session). Skip WHOOP there.

---

## Every day after that

- **Try something first:** Claude makes the change on its branch and sends you the preview link. Wait for **Ready**, then open it.
- **Looks good:** tell Claude **"send it live"**. Claude merges its branch into `main`, and Vercel updates the live app.
- **Something's wrong:** tell Claude what you saw. Nothing reached the live app.
- Small fixes can go straight to `main` when you say so. Previews are for anything big or risky.
- Once a change is live, its Claude branch can be deleted (GitHub → **Branches**, or ask Claude).

---

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| The live app suddenly can't sign anyone in | A Production setting was changed by mistake in Part 2 | In Vercel → Environment Variables, check that the Production values are still the old ones, then redeploy the latest Production deployment |
| The Preview build fails with a database error | The Part 1 strings are wrong | Check the password in both strings, fix them for Preview only, Redeploy |
| The Preview build fails with "STAGING_POSTGRES_URL isn't set" | The test copy's database variable is missing | Add `STAGING_POSTGRES_URL` (Preview only) as in Part 2, Redeploy |
| A preview shows someone else's data | It's using the live database | A `STAGING_` name is misspelled (for example `STAGING_POSTGRES_URL`); fix it in Part 2 and Redeploy |
| No yellow TEST SITE bar | You're on the live app | Use the preview link (`…git-claude-…`) |
