# Debank Scraper API

## Usage
GET /api/scrape?address=0x123...&chain=sonic

## Response
{
  "success": true,
  "address": "0x123...",
  "summary": {
    "total_value": 460.93,
    "wallet_value": 3.22,
    "defi_value": 457.71,
    "token_count": 5
  }
}