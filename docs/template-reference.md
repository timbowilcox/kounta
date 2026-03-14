# Template Reference

Kounta ships with 8 business templates. Each template provides a pre-configured chart of accounts, default currency, and accounting basis.

## How Templates Work

- **Apply once**: Templates create accounts in a ledger. They can only be applied once per ledger.
- **Accounts are permanent**: Once created, template accounts cannot be removed (but you can add more).
- **Recommendation engine**: POST `/v1/templates/recommend` scores your business description against all templates using keyword matching (primary keywords weight 3, secondary weight 1).

## Account Code Convention

All templates follow the same numbering scheme:

| Code Range | Account Type |
|------------|-------------|
| 1000–1099 | Cash & equivalents |
| 1100–1499 | Current assets |
| 1500–1999 | Non-current assets |
| 2000–2499 | Current liabilities |
| 2500–2999 | Non-current liabilities |
| 3000–3999 | Equity |
| 4000–4999 | Revenue |
| 5000–5999 | Cost of revenue / COGS |
| 6000–6999 | Operating expenses |

## Quick Reference

| Template | Slug | Accounts | Currency | Basis | Business Type |
|----------|------|----------|----------|-------|---------------|
| SaaS | `saas` | 18 | USD | Accrual | Software-as-a-Service |
| Marketplace | `marketplace` | 18 | USD | Accrual | Two-sided marketplace |
| Agency | `agency` | 18 | USD | Accrual | Service agency |
| E-commerce | `ecommerce` | 20 | USD | Accrual | Online retail |
| Creator | `creator` | 17 | USD | Accrual | Content creator |
| Consulting | `consulting` | 17 | USD | Accrual | Professional services |
| Property Management | `property` | 20 | USD | Cash | Property management |
| Nonprofit | `nonprofit` | 18 | USD | Accrual | Nonprofit organization |

---

## SaaS

**Slug:** `saas`  
**Accounts:** 18  
**Currency:** USD  
**Basis:** Accrual  
**Business type:** Software-as-a-Service  

**Recommended for:** SaaS companies, subscription software, cloud platforms, recurring revenue businesses.

**Keywords:** saas, software, subscription, recurring, cloud, platform, app, digital

### Chart of Accounts

| Code | Name | Type |
|------|------|------|
| 1000 | Cash | asset |
| 1100 | Accounts Receivable | asset |
| 1200 | Prepaid Expenses | asset |
| 2000 | Accounts Payable | liability |
| 2100 | Deferred Revenue | liability |
| 2200 | Accrued Expenses | liability |
| 3000 | Retained Earnings | equity |
| 3100 | Owner Investment | equity |
| 4000 | Subscription Revenue | revenue |
| 4100 | Usage-Based Revenue | revenue |
| 4200 | Professional Services Revenue | revenue |
| 5000 | Hosting & Infrastructure | expense |
| 5100 | Payment Processing Fees | expense |
| 6000 | Salaries & Wages | expense |
| 6100 | Marketing & Advertising | expense |
| 6200 | Software & Tools | expense |
| 6300 | Office & General | expense |
| 6400 | Research & Development | expense |

---

## Marketplace

**Slug:** `marketplace`  
**Accounts:** 18  
**Currency:** USD  
**Basis:** Accrual  
**Business type:** Two-sided marketplace  

**Recommended for:** Online marketplaces, platform businesses, gig economy, peer-to-peer platforms.

**Keywords:** marketplace, platform, sellers, buyers, commission, transactions, gig, freelance

### Chart of Accounts

| Code | Name | Type |
|------|------|------|
| 1000 | Cash | asset |
| 1100 | Accounts Receivable | asset |
| 1200 | Escrow Deposits | asset |
| 2000 | Accounts Payable | liability |
| 2100 | Seller Payables | liability |
| 2200 | Escrow Liability | liability |
| 3000 | Retained Earnings | equity |
| 3100 | Owner Investment | equity |
| 4000 | Platform Commissions | revenue |
| 4100 | Listing Fees | revenue |
| 4200 | Premium Placement Revenue | revenue |
| 5000 | Payment Processing Fees | expense |
| 5100 | Seller Payouts | expense |
| 6000 | Salaries & Wages | expense |
| 6100 | Marketing & Advertising | expense |
| 6200 | Platform Infrastructure | expense |
| 6300 | Trust & Safety | expense |
| 6400 | Customer Support | expense |

---

## Agency

**Slug:** `agency`  
**Accounts:** 18  
**Currency:** USD  
**Basis:** Accrual  
**Business type:** Service agency  

**Recommended for:** Creative agencies, marketing agencies, design studios, development shops.

**Keywords:** agency, creative, marketing, advertising, design, branding, media, digital agency

### Chart of Accounts

| Code | Name | Type |
|------|------|------|
| 1000 | Cash | asset |
| 1100 | Accounts Receivable | asset |
| 1200 | Work in Progress | asset |
| 2000 | Accounts Payable | liability |
| 2100 | Deferred Revenue | liability |
| 2200 | Accrued Expenses | liability |
| 3000 | Retained Earnings | equity |
| 3100 | Owner Investment | equity |
| 4000 | Project Revenue | revenue |
| 4100 | Retainer Revenue | revenue |
| 4200 | Media Commissions | revenue |
| 5000 | Contractor Costs | expense |
| 5100 | Media Buying Costs | expense |
| 6000 | Salaries & Wages | expense |
| 6100 | Software & Tools | expense |
| 6200 | Office & Rent | expense |
| 6300 | Business Development | expense |
| 6400 | Professional Development | expense |

---

## E-commerce

**Slug:** `ecommerce`  
**Accounts:** 20  
**Currency:** USD  
**Basis:** Accrual  
**Business type:** Online retail  

**Recommended for:** Online stores, direct-to-consumer brands, dropshipping, physical goods.

**Keywords:** ecommerce, e-commerce, shop, store, retail, products, inventory, shipping

### Chart of Accounts

| Code | Name | Type |
|------|------|------|
| 1000 | Cash | asset |
| 1100 | Accounts Receivable | asset |
| 1200 | Inventory | asset |
| 1300 | Prepaid Expenses | asset |
| 2000 | Accounts Payable | liability |
| 2100 | Sales Tax Payable | liability |
| 2200 | Gift Card Liability | liability |
| 3000 | Retained Earnings | equity |
| 3100 | Owner Investment | equity |
| 4000 | Product Sales | revenue |
| 4100 | Shipping Revenue | revenue |
| 5000 | Cost of Goods Sold | expense |
| 5100 | Shipping & Fulfillment | expense |
| 5200 | Payment Processing Fees | expense |
| 6000 | Marketing & Advertising | expense |
| 6100 | Platform Fees | expense |
| 6200 | Salaries & Wages | expense |
| 6300 | Packaging & Supplies | expense |
| 6400 | Warehousing | expense |
| 6500 | Returns & Refunds | expense |

---

## Creator

**Slug:** `creator`  
**Accounts:** 17  
**Currency:** USD  
**Basis:** Accrual  
**Business type:** Content creator  

**Recommended for:** YouTubers, podcasters, streamers, newsletter writers, content businesses.

**Keywords:** creator, content, youtube, podcast, streaming, newsletter, influencer, media

### Chart of Accounts

| Code | Name | Type |
|------|------|------|
| 1000 | Cash | asset |
| 1100 | Accounts Receivable | asset |
| 1200 | Equipment | asset |
| 2000 | Accounts Payable | liability |
| 2100 | Deferred Sponsorship Revenue | liability |
| 3000 | Retained Earnings | equity |
| 3100 | Owner Investment | equity |
| 4000 | Ad Revenue | revenue |
| 4100 | Sponsorship Revenue | revenue |
| 4200 | Merchandise Sales | revenue |
| 4300 | Digital Product Sales | revenue |
| 4400 | Membership Revenue | revenue |
| 5000 | Production Costs | expense |
| 5100 | Merchandise COGS | expense |
| 6000 | Software & Tools | expense |
| 6100 | Marketing & Promotion | expense |
| 6200 | Contractor & Editing | expense |

---

## Consulting

**Slug:** `consulting`  
**Accounts:** 17  
**Currency:** USD  
**Basis:** Accrual  
**Business type:** Professional services  

**Recommended for:** Consultants, freelancers, advisory firms, coaches, professional service providers.

**Keywords:** consulting, consultant, advisory, freelance, professional services, coaching, strategy

### Chart of Accounts

| Code | Name | Type |
|------|------|------|
| 1000 | Cash | asset |
| 1100 | Accounts Receivable | asset |
| 1200 | Prepaid Expenses | asset |
| 2000 | Accounts Payable | liability |
| 2100 | Deferred Revenue | liability |
| 2200 | Accrued Expenses | liability |
| 3000 | Retained Earnings | equity |
| 3100 | Owner Investment | equity |
| 4000 | Consulting Fees | revenue |
| 4100 | Advisory Retainers | revenue |
| 4200 | Workshop & Training Revenue | revenue |
| 5000 | Subcontractor Costs | expense |
| 6000 | Salaries & Wages | expense |
| 6100 | Travel & Expenses | expense |
| 6200 | Software & Tools | expense |
| 6300 | Professional Development | expense |
| 6400 | Insurance | expense |

---

## Property Management

**Slug:** `property`  
**Accounts:** 20  
**Currency:** USD  
**Basis:** Cash  
**Business type:** Property management  

**Recommended for:** Landlords, property managers, real estate investors, rental businesses.

**Keywords:** property, real estate, rental, landlord, tenant, lease, apartment, building

> **Note:** This is the only template that defaults to cash-basis accounting, which is common for property management.

### Chart of Accounts

| Code | Name | Type |
|------|------|------|
| 1000 | Operating Cash | asset |
| 1100 | Tenant Receivables | asset |
| 1500 | Properties | asset |
| 1600 | Accumulated Depreciation | asset |
| 2000 | Accounts Payable | liability |
| 2100 | Tenant Security Deposits | liability |
| 2500 | Mortgage Payable | liability |
| 3000 | Retained Earnings | equity |
| 3100 | Owner Investment | equity |
| 4000 | Rental Income | revenue |
| 4100 | Late Fees | revenue |
| 4200 | Parking & Storage Revenue | revenue |
| 5000 | Property Taxes | expense |
| 5100 | Insurance | expense |
| 5200 | Mortgage Interest | expense |
| 6000 | Repairs & Maintenance | expense |
| 6100 | Utilities | expense |
| 6200 | Property Management Fees | expense |
| 6300 | Landscaping & Grounds | expense |
| 6400 | Legal & Professional | expense |

---

## Nonprofit

**Slug:** `nonprofit`  
**Accounts:** 18  
**Currency:** USD  
**Basis:** Accrual  
**Business type:** Nonprofit organization  

**Recommended for:** Charities, foundations, NGOs, community organizations, grant-funded projects.

**Keywords:** nonprofit, non-profit, charity, foundation, ngo, donations, grants, mission

### Chart of Accounts

| Code | Name | Type |
|------|------|------|
| 1000 | Cash | asset |
| 1100 | Grants Receivable | asset |
| 1200 | Pledges Receivable | asset |
| 2000 | Accounts Payable | liability |
| 2100 | Deferred Grant Revenue | liability |
| 2200 | Accrued Expenses | liability |
| 3000 | Unrestricted Net Assets | equity |
| 3100 | Temporarily Restricted Net Assets | equity |
| 3200 | Permanently Restricted Net Assets | equity |
| 4000 | Government Grants | revenue |
| 4100 | Foundation Grants | revenue |
| 4200 | Individual Donations | revenue |
| 4300 | Fundraising Event Revenue | revenue |
| 5000 | Program Expenses | expense |
| 5100 | Grant Pass-Through | expense |
| 6000 | Salaries & Benefits | expense |
| 6100 | Fundraising Costs | expense |
| 6200 | General & Administrative | expense |

---

## Using Templates

### Via SDK

```typescript
import { Kounta } from "@kounta/sdk";

const kounta = new Kounta({
  apiKey: "ldg_live_...",
  adminSecret: "sk_admin_...",
});

// List all templates
const templates = await kounta.templates.list();

// Get template details
const saas = await kounta.templates.get("saas");

// Get recommendations
const recs = await kounta.templates.recommend({
  description: "Online store selling handmade crafts",
  industry: "retail",
  businessModel: "direct-to-consumer",
});

// Apply template to a ledger
await kounta.templates.apply("ldg_abc123", "ecommerce");
```

### Via REST API

```bash
# List templates
curl https://api.kounta.ai/v1/templates

# Get a template
curl https://api.kounta.ai/v1/templates/saas

# Get recommendations
curl -X POST https://api.kounta.ai/v1/templates/recommend \
  -H "Content-Type: application/json" \
  -d '{"description": "SaaS company", "industry": "software"}'

# Apply template (admin auth required)
curl -X POST https://api.kounta.ai/v1/templates/apply \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"ledgerId": "ldg_...", "templateSlug": "saas"}'
```

### Via MCP

```
Tool: setup_ledger
Input: { "description": "I run an online store selling handmade jewelry" }

Response: auto-provisions with the ecommerce template (20 accounts)
```