<div align="center">

<h1>alpaca-automate</h1>

<p><b>An early, partial snapshot of an Alpaca GTT manager.</b></p>

<p><i>The source was lost in a history rewrite. The working project lives on in alpaca-gtt-trading.</i></p>

<h6>

![Python](https://img.shields.io/badge/Python-3.11-111111?style=flat-square&logo=python&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-15-111111?style=flat-square&logo=nextdotjs&logoColor=white)
![API](https://img.shields.io/badge/API-Alpaca-FCD535?style=flat-square)
![Status](https://img.shields.io/badge/status-archived%2C%20incomplete-555555?style=flat-square)

</h6>

<a href="#what-it-was"><b>What it was</b></a> ·
<a href="#whats-in-the-repo"><b>What's in the repo</b></a> ·
<a href="https://github.com/parthchandak02/alpaca-gtt-trading"><b>Successor</b></a>

</div>

<br>

This repository is the first version of a web app for laddered "good-til-triggered" (GTT)
buy orders on [Alpaca](https://alpaca.markets). After a git history rewrite, most of the
backend survived only as compiled `.pyc` files and most of the frontend only as a built
Cloudflare Workers bundle, so it does not build or run. It is kept for reference. For the
code that works, see **[alpaca-gtt-trading](https://github.com/parthchandak02/alpaca-gtt-trading)**.

## What it was

<table>
<tr>
<td width="33%" valign="top">

**1 · Plan a ladder**

Pick a stock or crypto symbol, a starting amount and price, how much to add per step, how far
to drop the price per step, and how many steps.

</td>
<td width="33%" valign="top">

**2 · Store the triggers**

A FastAPI backend kept each rung in SQLite as a GTT order, separate from Alpaca's own order book.

</td>
<td width="33%" valign="top">

**3 · Fire on price**

A polling service watched prices (Alpaca market data, with Yahoo Finance as a fallback) and
submitted the real order when a rung's trigger price was hit.

</td>
</tr>
</table>

The app also showed account, positions, activities and charts, used a password login with JWT
tokens, and switched between paper and live trading with one `USE_PAPER_TRADING` flag. The
frontend was deployed to Cloudflare Workers through OpenNext; the backend ran under pm2 behind
a Cloudflare Tunnel.

## What's in the repo

| Path | State |
|---|---|
| `frontend/components/gtt/CreateGTTForm.tsx` | Readable source: the ladder form with symbol search and order preview |
| `frontend/.open-next/` | Built Cloudflare Workers output, not source |
| `backend/app/services/*.py` | Failed decompile stubs; the real code is only in `__pycache__` |
| `backend/app/**/__pycache__/` | Compiled Python 3.11 bytecode for the API routes, models and services |
| `.env.example` | Every setting the backend read, with placeholders |
| `frontend/wrangler.toml` | Cloudflare Workers deployment config |

<br>

<div align="center">
<sub>Built with FastAPI, SQLite, Next.js and the Alpaca Trading API. Superseded by alpaca-gtt-trading.</sub>
</div>
