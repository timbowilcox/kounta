# Dashboard Design Specification
## Design Direction
The Kounta dashboard follows the Stockholm Design Lab / Sana Labs
aesthetic: radical simplicity, generous whitespace, bold typography,
and restrained colour. It should feel like Linear or Vercel — not
like QuickBooks.
This is NOT an accounting app. It is a financial health viewer and
credential manager. Builders should spend 2 minutes here, not 30.
## Visual System
### Colour
- Background: #0F172A (Slate 900) — dark mode only, no light mode toggle
- Card surfaces: rgba(255,255,255,0.02) with 1px border rgba(255,255,255,0.03)
- Card hover: rgba(255,255,255,0.04)
- Primary accent: #0D9488 (Teal 600) — used sparingly for CTAs, active states, key data
- Secondary accent: #5EEAD4 (Teal 300) — code syntax, account codes, hover states on dark
- Text primary: #F8FAFC (Slate 50)
- Text secondary: #94A3B8 (Slate 400)
- Text muted: #64748B (Slate 500)
- Success: #22C55E
- Error: #EF4444
- Warning: #F59E0B
- Borders: rgba(255,255,255,0.04) for most dividers, rgba(255,255,255,0.06) on hover
### Typography
- Display/headings: Satoshi (import from Fontshare), weight 700, tight tracking (-0.02em at 20px+)
- Body/UI: General Sans (import from Fontshare), weight 400-600
- Code/data: JetBrains Mono (Google Fonts), weight 400-500
- Financial amounts always use JetBrains Mono
- Account codes always use JetBrains Mono in Teal 300
- Section labels: 10-11px, uppercase, letter-spacing 1.5px, Slate 500
### Spacing
- Page padding: 36px
- Card padding: 24px
- Card border-radius: 16px
- Between cards: 16px gap
- Section gaps: 28px
- Component border-radius: 10px (buttons, inputs)
- Badge border-radius: 9999px (pill)
### Components
**Cards:** No visible border in default state — use background
shift only. The card becomes visible through its background
difference from the page, not through a hard border. Subtle border
appears only on hover.
**Buttons:**
- Primary: bg #0D9488, text white, rounded 10px, shadow 0 2px 8px rgba(13,148,136,0.2). Hover: darken to #0F766E, shadow grows
- Secondary: bg transparent, border 1px rgba(255,255,255,0.06), text Slate 400. Hover: bg rgba(255,255,255,0.06)
- Ghost: no bg, no border, text Slate 500. Hover: text Slate 300
**Tables:** No heavy borders. Header row uses Slate 500 uppercase
text at 11px. Rows separated by 1px rgba(255,255,255,0.02). Row
hover: bg rgba(255,255,255,0.015). Financial data right-aligned
in JetBrains Mono.
**Badges:** pill-shaped, rgba background with matching rgba border.
Teal for status, green for success, amber for warning, red for error.
Never solid backgrounds — always translucent.
**Inputs:** bg rgba(255,255,255,0.03), border 1px rgba(255,255,255,0.06),
rounded 12px. Focus: border-color rgba(13,148,136,0.3). Placeholder
text in Slate 500.
**Sidebar:** bg #0A0F1C (Slate 950), width 244px. Active item has
bg rgba(13,148,136,0.1), text Teal 300, with a 3px teal bar on the
left edge. Inactive items Slate 400.
### Principles
- 90% of any screen is neutral. Teal occupies no more than 10% of visual area.
- No gradients on UI elements (subtle page-level gradients are fine).
- No shadows on cards — depth comes from background layering.
- No decorative elements. Every pixel serves a purpose.
- Tables show data. Cards contain related groups. That's it.
- Error states use red but never aggressively — red text or red badge, never a red background block.
- Loading states use skeleton shimmer (Slate 700 to Slate 800 sweep), never spinners.
- Transitions are 150ms for hover, 200ms for layout changes. Easing: ease-out. Nothing bounces.
## Screens
### Signup / Sign in
- Full-screen centered card on Slate 900 background
- Kounta logo at top
- Two buttons only: "Continue with GitHub" and "Continue with Google"
- No email/password fields, no "create account" vs "sign in" distinction
- Subtle teal radial gradient glow behind the card
- After auth: redirect straight to template picker (if no ledger) or dashboard (if ledger exists)
### Template Picker
- Heading: "Choose a starting point" in Satoshi 24px
- Subhead: "Pick the template closest to your business. You can customise everything later." in Slate 400
- Grid of 8 template cards (2 columns on desktop)
- Each card: template name (Satoshi 18px bold), short description (Slate 400), list of 4-5 key account categories
- Click a card → ledger is created with that template → redirect to dashboard
- "Skip — I'll configure manually" link at the bottom in Slate 500
### Dashboard (Ledger Overview)
- Top bar: ledger name, entity, template used
- Four metric cards in a row: transaction count, account count, ledger value, plan usage percentage
- Recent transactions table (5 most recent)
- "View all transactions" link
### API Keys
- Heading: "API Keys"
- Table of existing keys: name, prefix (kounta_live_xxxx...), created date, last used, status
- "Create new key" button → modal with name input → shows full key ONCE with copy button and .env snippet
- Revoke button per key with confirmation
### Account Tree
- Read-only hierarchical view
- Expand/collapse per parent account
- Each row: account code (JetBrains Mono, Teal 300), account name, type badge, balance (JetBrains Mono, right-aligned)
- Positive balances in white, negative in red
### Transactions
- Paginated table
- Columns: ID (monospace, truncated), date, description, amount (monospace), status badge
- Click row → expand to show line items (account, debit/credit, amount)
- Search bar at top
- Filter by status (posted, reversed, all)
### Statements
- Tab selector: Income Statement, Balance Sheet, Cash Flow
- Date range picker (start, end)
- Plain-language summary at the top in a teal-tinted card
- Formal statement below as a table
- Category headers in Teal 300
- Totals rows use heavier weight and top border
- Net income / total row highlighted with teal background tint
### MCP Connection Guide
- Step-by-step instructions for connecting Kounta MCP in:
  - Claude Code
  - Cursor
  - Windsurf
- Each section shows the exact config to copy-paste
- Uses code blocks with copy buttons
- API key placeholder with note to replace with real key
