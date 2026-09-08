# PAL Ticket Review App — system flow companion guide

![PAL Ticket Review App system flow](./pal-ticket-review-app-flow.png)

## What this application is for

The PAL Ticket Review App helps a Premier Account Liaison (PAL) prepare for customer calls. It brings an engineer's assigned accounts and recent support tickets into one local dashboard, identifies tickets that may need discussion, produces short AI-assisted briefings, and exports an account-level ticket snapshot to Google Docs.

The application is designed to answer four questions:

1. Which customer accounts belong to a PAL engineer?
2. What support tickets are associated with a selected account?
3. Which tickets deserve attention before the next customer call?
4. What is the issue, current position, next step, and customer sentiment for each ticket?

This guide follows the system-flow diagram from left to right. For every element, it explains what it is, why the application needs it, what it receives, and what it sends to the next element.

## A short glossary

| Term | Plain-language meaning |
|---|---|
| **PAL** | Premier Account Liaison: the engineer responsible for maintaining technical context across a premier customer's support relationship. |
| **Snowflake** | The company's data warehouse. It contains reporting copies of account, PAL assignment, organization, and support-ticket data. |
| **MCP** | Model Context Protocol. In this app it is the standard interface used to talk to Snowflake and SupportDog. |
| **CSV** | A plain-text spreadsheet-style file. The app uses one CSV as its main local portfolio dataset. |
| **Next.js API route** | Server-side code inside the application. It can safely read files and credentials and call external services on behalf of the browser. |
| **React dashboard** | The web interface the user sees and interacts with. |
| **Zendesk** | The support-ticket system containing ticket fields and conversations. |
| **SupportDog** | An internal MCP service that provides authenticated access to Zendesk ticket and organization context across Datadog regions. |
| **Claude** | The Anthropic language model used to turn gathered evidence into concise briefings and optional export summaries. |
| **TLDR** | A short summary of a ticket. The app uses both existing internal TLDR notes and separately generated two-line export TLDRs. |
| **CSAT** | Customer satisfaction rating submitted after a support interaction. |
| **FR / Jira** | A feature request and its linked Jira work item, commonly identified by a key such as `FR-1234`. |

## The system in one minute

The main journey is:

```text
Snowflake
  -> Snowflake MCP refresh
  -> local portfolio CSV
  -> Next.js API routes
  -> React dashboard
  -> call-prep highlights, ticket briefings, or Google Docs export
```

The CSV defines which PALs, accounts, and tickets belong in the application. The browser filters that data for the selected PAL and account. For ticket briefings, the server enriches the CSV facts with SupportDog evidence, public documentation, ticket age, existing TLDR notes, and repository hints before asking Claude to produce a short summary. For account exports, the server writes a new dated snapshot into a reusable Google Doc.

## 1. Snowflake

### What it does

Snowflake is the upstream reporting warehouse. The app's SQL query joins several reporting datasets to obtain:

- PAL engineer identity and assignment information.
- Salesforce account identifiers and names.
- Datadog and Zendesk organization identifiers.
- Tickets created within the configured reporting window.
- Ticket fields such as subject, status, creation time, source, product component, and impact.

### Why it is included

The application needs one consistent source for the PAL-to-account-to-ticket relationship. Querying several live systems independently in the browser would make that relationship harder to reproduce and would expose credentials. Snowflake gives the app a prepared reporting view that can be exported locally.

### What flows to the next system

The SQL result is a table in which each row represents a PAL engineer, one of their accounts, and a ticket associated with that account. That result flows to the Snowflake MCP refresh process.

### Important limitation

Snowflake is not live Zendesk. A refresh gets the latest warehouse result, but the warehouse can still be behind the current ticket conversation or status.

## 2. Snowflake MCP refresh

### What it does

The **Refresh data** button calls a server route that reads `scripts/snowflake_pal_engineer_accounts_tickets_6mo.sql` and submits it through the Snowflake MCP client. The server converts the returned rows into the exact CSV column order expected by the app.

The write is atomic: the server first writes a temporary file and then renames it into place. This avoids leaving a half-written portfolio file if the process is interrupted.

### Why it is included

MCP provides a controlled integration boundary between the local application and Snowflake. The browser never receives Snowflake credentials or runs SQL directly.

### What flows to the next system

The refresh produces the local portfolio CSV, plus metadata such as its path, row count, and export time. The browser then reloads the portfolio through the normal API.

### If it is unavailable

The app can continue using an existing CSV. Only obtaining a newer portfolio and running live CSAT queries are affected.

## 3. Local portfolio CSV

### What it does

The CSV is the application's primary dataset. It is a local snapshot of the Snowflake query result. Typical fields include:

- `PAL_LIAISON_EMAIL`
- `SALESFORCE_ACCOUNT_ID`
- `DATADOG_ORG_ID`
- `ZENDESK_ORG_NAME`
- `TICKET_ID`
- `TICKET_CREATED_TIMESTAMP`
- `TICKET_SUBJECT`
- `TICKET_STATUS`
- `PRIMARY_PRODUCT_COMPONENT`
- `TICKET_IMPACT`

When the server parses the file, it converts column names to JavaScript-style names, such as `TICKET_STATUS` to `ticketStatus`.

### Why it is included

The CSV makes the portfolio fast, predictable, and usable without a database. It also lets the app start even when Snowflake is temporarily unavailable.

### What flows to the next system

The server returns the parsed rows through `GET /api/pal-portfolio`. Those rows become React state in the dashboard. The same rows are also reused later as portfolio facts for investigation and as the source for Google Docs exports.

### What it does not contain

The export mainly contains reporting and routing fields. It does not reliably contain the complete, current Zendesk conversation, so the app uses SupportDog when it needs the actual discussion.

## 4. Next.js API routes

### What they do

The API routes are the application's server-side control layer. They sit between the browser and anything that requires filesystem access, credentials, or external network calls.

They are responsible for:

- Loading and parsing the portfolio CSV.
- Refreshing the CSV from Snowflake.
- Running Snowflake CSAT queries.
- Fetching or enriching ticket context.
- Managing SupportDog and Google OAuth sessions.
- Calling Anthropic.
- Creating and updating Google Docs.
- Reading and writing the local account-to-document map.

### Why they are included

Credentials must not be exposed to browser JavaScript. Keeping integrations on the server also gives every feature a consistent place to validate input, handle failures, and return safe JSON responses.

### What flows to the next system

For the basic portfolio path, the API returns parsed rows to the React dashboard. For later actions, the dashboard sends a ticket ID, account ID, or date range back to the appropriate API route.

## 5. React dashboard

### What it does

The React dashboard is the user-facing application. Its purple left sidebar contains:

- SupportDog connection status.
- PAL engineer selection.
- Account selection.
- Ticket-created date filters and quick date presets.

After a user selects a PAL and account, the dashboard filters the CSV rows in the browser. It groups tickets by status and displays ticket details. Open-like tickets are sorted using an attention score derived from fields such as age, priority, escalation signals, complexity, and sentiment signals available in the export.

Closed tickets are hidden by default. Solved, Closed, and Merged tickets remain in the table data only when their solved or updated date falls within the trailing 30-day window ending on the selected **To** date.

### Why it is included

The dashboard turns a flat export into a useful call-preparation workflow. The PAL can narrow the portfolio without repeatedly querying Snowflake and can access ticket summaries, Zendesk links, highlights, CSAT, feature requests, and exports in one place.

### What flows out of it

The selected account and date range feed the call-prep section. Ticket IDs feed the investigation endpoint. The Salesforce account ID feeds the Google Docs export endpoint.

## 6. Remember PAL engineer — browser localStorage

### What it does

When the user chooses a PAL engineer, the dashboard saves that engineer's email in the browser under `pp_selected_pal_email`. On a later visit, the app restores the engineer if the email still exists in the loaded portfolio.

The selected account is not persisted.

### Why it is included

Most users repeatedly work with the same PAL portfolio. Remembering the engineer removes one repetitive selection while avoiding the risk of reopening the wrong customer account automatically.

### What flows to the next system

The restored email is applied to the React dashboard's engineer filter. No server or external service receives this preference.

## 7. The two ways a ticket briefing begins

### Manual Show

Every ticket row and highlight can expose a **Show** action. Clicking it sends the ticket ID to `POST /api/pal-portfolio/ticket/[ticketId]/analyze` and expands the returned briefing beneath the row.

This path exists so a user can deliberately inspect any visible ticket.

### Auto-brief active tickets

After an account is selected, the browser automatically requests a briefing for every non-terminal ticket in the current account and table date range. In this context, terminal means Solved, Closed, or Merged.

The app runs up to three briefing requests concurrently and displays progress. This path exists because the **Needs attention** category depends on the AI-generated Customer Temperature, which is not present in the portfolio CSV.

### What flows to the next system

Both paths send the same ticket ID to the same analysis route. They converge on the Investigation Orchestrator. If an automatic briefing already exists, opening it manually reuses the cached result rather than creating a duplicate request.

## 8. Investigation Orchestrator

### What it does

The Investigation Orchestrator gathers the evidence needed to explain one ticket and packages it into a structured Markdown context for Claude.

Its sequence is:

1. Fetch the ticket through SupportDog, probing supported datacenters when necessary.
2. Build deterministic portfolio facts from the matching CSV rows.
3. Calculate the ticket age on the server.
4. Inspect SupportDog comments for an existing TLDR.
5. Build a topic corpus from the ticket subject, product, export facts, and SupportDog content.
6. Use that corpus to select and fetch public Datadog documentation.
7. Use the same corpus to select likely GitHub repositories.
8. Assemble every result into one evidence document.
9. Send the evidence document and the briefing instructions to Claude.

### Why it is included

No single source tells the whole story. The CSV knows portfolio membership, SupportDog knows the conversation, documentation knows intended product behavior, and ticket age helps assess urgency. The orchestrator gives these sources a consistent structure and allows individual sources to fail without collapsing the entire workflow.

### What flows to the next system

The orchestrator sends a single evidence package to Claude. It includes explicit headings for connectivity, existing TLDR status, ticket and organization context, public documentation, GitHub hints, portfolio facts, and ticket age.

## 9. Portfolio facts

### What they do

Portfolio facts are a compact evidence block created from the ticket's matching CSV rows. They establish the ticket's identity and business context, including subject, exported status, account, PAL owner, product component, impact, and relevant timestamps.

### Why they are included

They provide a stable baseline even when live integrations are unavailable. They also ensure Claude is analysing a ticket that belongs to the selected PAL portfolio rather than an arbitrary Zendesk ticket.

### How they flow forward

The facts are inserted directly into the orchestrator's evidence document. They also contribute keywords to the topic corpus used for selecting documentation and repository hints.

## 10. SupportDog MCP

### What it does

SupportDog retrieves the actual Zendesk ticket and organization context. The app can authenticate separately to US1, US3, US5, EU1, AP1, and AP2. During an investigation it tries the appropriate datacenters until it finds the ticket.

The returned material can include:

- Public customer comments.
- Internal agent notes.
- Ticket description and detailed fields.
- Organization details.
- Attachment information.

### Why it is included

The warehouse export cannot explain what the customer said, what troubleshooting has already happened, what is currently blocking progress, or how the customer feels. SupportDog supplies that live conversational evidence.

### How it flows forward

The parsed conversation and organization context enter the orchestrator's evidence document. The raw and formatted ticket content also help determine which public docs and GitHub repositories might be relevant.

### If it is unavailable

With Anthropic configured, the investigation can still run using portfolio facts, ticket age, public docs, and repository hints. The UI warns that the briefing lacks full conversation evidence.

## 11. Existing TLDR

### What it does

The app searches internal SupportDog comments for the latest note that looks like a TLDR. A note qualifies when it explicitly says TLDR or resembles a structured issue-and-next-steps summary.

It then compares the TLDR timestamp with the latest public requester comment:

- **Current:** no newer public customer reply exists.
- **Stale:** the customer replied after the TLDR was written.

### Why it is included

A good internal summary may already capture hours of investigation work. Reusing it avoids needlessly reconstructing the story and helps maintain continuity between engineers.

### How it flows forward

A Current TLDR becomes Claude's primary source. Claude should condense it and add only clearly material missing information. A Stale TLDR remains background, while the newer conversation becomes more important.

## 12. Ticket age

### What it does

The server calculates the number of whole days between the CSV creation timestamp and the current time. Claude receives the original timestamp, the calculated age, and the calculation date.

### Why it is included

The model should not have to perform date arithmetic. An exact age is also important for distinguishing an ordinary calm ticket from a long-running ticket that may be drifting toward escalation.

### How it flows forward

Ticket age becomes a dedicated evidence block. Claude uses it as a secondary Customer Temperature signal. Separately, the dashboard flags any active ticket open for more than seven days as **Needs attention**, even if its temperature is not Red.

## 13. Datadog public docs

### What they do

The app keyword-matches the topic corpus to relevant areas such as Agent troubleshooting, Synthetics, APM, Logs, RUM, Metrics, Monitors, or Security. It selects up to three `docs.datadoghq.com` pages, downloads them, strips the HTML, and includes a bounded text excerpt from each page.

### Why they are included

Public docs give Claude product terminology and documented troubleshooting guidance. They help prevent a summary from relying entirely on assumptions inferred from a short ticket subject.

### How they flow forward

Successful excerpts are inserted into the evidence document with their source URLs. Failed fetches are marked as failed rather than silently replaced with invented content.

### Evidence limitation

Documentation describes intended or documented behavior. It does not prove what happened in this customer's environment and must not override the actual ticket conversation.

## 14. GitHub repo hints

### What they do

The app matches keywords such as Python, Java, Node.js, Go, Ruby, .NET, PHP, or Agent to likely public Datadog repositories. It supplies up to three repository names and URLs.

It does not fetch repository code, inspect files, or perform a code review. If no technology matches, it supplies `dd-trace-py` as a default pointer and explicitly says that the language must be verified.

### Why they are included

Some tickets suggest a possible SDK or Agent implementation issue. Repository hints tell the investigator where deeper source-level diagnosis might begin without claiming that a code defect has been found.

### How they flow forward

The repository table is added to the evidence document as low-authority diagnostic guidance. Claude is instructed not to invent file paths or line numbers and not to propose code changes or pull requests.

## 15. How the evidence should be trusted

The orange arrows in the chart show inputs, but those inputs do not carry equal authority. The intended practical order is:

1. A Current existing TLDR.
2. The latest SupportDog conversation and ticket details.
3. Portfolio facts.
4. Ticket age.
5. Public documentation for product grounding.
6. GitHub repositories as investigation pointers only.

If a TLDR is Stale, the newer conversation takes precedence. Public documentation and repository hints must never be used to claim that a particular customer encountered a confirmed product bug unless the ticket evidence supports that conclusion.

## 16. Claude briefing

### What it does

Claude receives the orchestrator's evidence document plus a strict system prompt. It must return exactly four short sections:

- **Context** — what problem the customer is experiencing.
- **Current Status** — what has happened and what is currently blocking or pending.
- **Next Steps** — one to three concrete actions.
- **Customer Temperature** — Green, Orange, or Red, with a short reason.

Customer language is the primary temperature signal. Ticket age is secondary and can raise a borderline case, but it should not override explicit frustration or escalation language.

### Why it is included

The collected evidence can be long and distributed across several systems. Claude compresses it into something a PAL can read immediately before a customer call.

### What flows to the next system

The API returns the Markdown briefing and information about which integrations succeeded. The browser places that result in the in-tab briefing cache.

### Without an Anthropic key

The route does not run the complete orchestration. It returns a deterministic CSV-only Markdown fallback so the user still gets basic ticket context.

## 17. In-tab briefing cache

### What it does

The React dashboard stores briefing responses in memory, keyed by ticket ID. The call-prep highlights and status tables share the same cache.

### Why it is included

Automatic call-prep analysis and manual expansion often refer to the same ticket. Reusing the response avoids duplicate SupportDog and Anthropic requests during the page session.

### How it flows forward

The cached Markdown is rendered when a user expands a ticket. The dashboard also parses its Customer Temperature to build the **Needs attention** list.

### How long it lasts

The cache is not persistent. Changing PAL or account clears it, and reloading the page starts a new cache.

## 18. Needs attention

### What it does

An active ticket appears in **Needs attention** when either condition is true:

- The generated Customer Temperature is Red.
- The ticket has been open for more than seven days.

Red tickets are listed first, followed by the oldest remaining tickets.

### Why it is included

The list combines qualitative risk from the conversation with a simple age safeguard. It surfaces explicit customer frustration while also catching quiet tickets that have remained unresolved for too long.

### How it flows forward

Needs-attention results become one group in the call-prep highlights section. The associated cached briefing is available through **Show**.

## 19. Call-prep highlights

### What they do

The call-prep area consolidates several signals for the selected account and the same created-date range used by the main table. Its visible groups are:

- Needs attention.
- Bad CSAT ratings.
- Good CSAT ratings.
- Feature requests with open Datadog-side bug signals.
- All feature requests in the current range.

### Why they are included

A status-grouped ticket table is useful for completeness, but it does not tell a PAL what should be discussed first. Call prep provides a shorter agenda-oriented view.

### What flows into it

Four inputs combine here:

1. Briefing-cache results supply Customer Temperature for Needs attention.
2. Snowflake CSAT queries supply good and bad satisfaction ratings.
3. CSV feature-request rules identify feature and possible product-bug tickets.
4. An optional Zendesk lookup finds missing FR/Jira keys.

Each highlighted ticket can reuse or request a full investigation briefing.

## 20. Snowflake CSAT

### What it does

For the selected Datadog organization and table date range, the server runs targeted Snowflake queries for good and bad satisfaction ratings. Results can include ticket status, assignee, satisfaction comment, reason, and product component.

### Why it is included

CSAT fields are not part of the core portfolio CSV. Querying them when an account is selected gives the PAL direct feedback signals without expanding the main export schema.

### How it flows forward

The server returns separate good and bad arrays. The dashboard renders them as two call-prep groups. If Snowflake MCP is unavailable, the dashboard shows the CSAT error while keeping the other groups usable.

## 21. CSV feature-request rules

### What they do

The browser applies heuristics to ticket tags, type, subject, status, and exported signals. These rules identify:

- Feature or enhancement requests.
- Non-terminal feature requests that also contain Datadog product-bug signals.

### Why they are included

Feature requests and possible product defects are common cadence-call topics, but the CSV does not provide one perfectly normalized field for every case. Heuristics let the app surface likely candidates from the fields it already has.

### How they flow forward

The resulting ticket collections become the two feature-request groups in call prep. Missing Jira links can be enriched through the optional Zendesk lookup.

## 22. Zendesk FR/Jira lookup — optional

### What it does

When a highlighted feature request has no `FR-####` key in its CSV row, the browser sends its ticket ID to the resolve endpoint. The server retrieves brief live Zendesk ticket data and searches it for a feature-request Jira key. The browser requests at most 24 unresolved IDs at a time.

### Why it is included

The live ticket may contain a Jira link that was not exported to Snowflake. Resolving it lets the PAL move directly from the support ticket to the tracked feature request.

### How it flows forward

When a key is found, the dashboard adds the Jira link to the corresponding feature-request highlight. If Zendesk credentials are unavailable or no key exists, the ticket remains highlighted without the link.

The repository also contains a public-comment sentiment endpoint, but the current dashboard does not call it.

## 23. Export non-closed tickets

### What it does

The **Export to Google Doc** action sends the selected Salesforce account ID to the export API. The server reloads all CSV rows for that account and removes only tickets whose status is specifically Closed.

This means:

- New, Open, Pending, Hold, Solved, Merged, and other non-Closed statuses can appear.
- The export does not use the browser's selected PAL or date range.
- The account ID, rather than the visible filters, defines the export scope.

### Why it is included

The Google Doc is intended to be an account-level record rather than a copy of a temporary dashboard view. Excluding Closed tickets keeps fully finalized work out while preserving recently Solved or Merged history.

### What flows to the next system

The server groups the non-Closed tickets by status and sends the formatted content to the Google Docs API. Optional short TLDRs can be inserted under eligible tickets.

## 24. Optional Claude TLDRs for export

### What they do

When **Include TLDRs** is checked, the server generates a two-line summary for tickets in New, Open, Pending, or Hold status:

```text
Issue: one concise sentence
Status: one concise sentence
```

These TLDRs use portfolio CSV facts only. They do not run the full SupportDog investigation. Generation is limited to 25 tickets and four concurrent requests.

### Why they are included

The account document should be quickly readable, but running the full investigation workflow for every export entry would be slower and more expensive. The short CSV-based prompt provides a bounded summary suitable for a ticket list.

### How they flow forward

Successful TLDRs are placed below the corresponding ticket link in the Google Doc. A failed or skipped TLDR does not prevent the rest of the document from being exported.

## 25. Local account-to-doc map

### What it does

`data/pal_account_docs.json` maps each Salesforce account ID to its Google document ID, account name, and last export time. The file is written atomically.

### Why it is included

Without this mapping, every export would create a new document. The map lets the app find and reuse the existing account document.

Salesforce account ID is used as the key because it is expected to be present and unique, while other organization identifiers may be missing.

### How it flows forward

Before export, the server looks up the document ID. After a successful export, it saves the document ID and latest metadata. The dashboard uses the same map to display **View Doc**.

### Important limitation

The map is local to this checkout. Another user's copy of the app does not automatically know which documents this copy created.

## 26. Google Docs API

### What it does

The server uses the signed-in user's Google OAuth session to create or modify a document. On first export it:

1. Creates a document named after the Zendesk organization, falling back to the Salesforce account name.
2. Adds a heading and a protected free-form **Notes** area.
3. Adds the first dated ticket snapshot.
4. Grants reader access to anyone in the `datadoghq.com` domain who has the link.

On every later export it prepends another dated snapshot above the existing snapshots. It never deletes or replaces an older section, including another section created on the same day. The insertion point stays below the title and Notes block.

### Why it is included

Google Docs provides a shareable account artifact that teammates can annotate and revisit outside the local application. The append-only approach preserves the history of what the account portfolio looked like at each export.

### What flows to the next system

The API returns the document ID. The local account map stores it, and the dashboard presents a direct link to the reusable account document.

## 27. Reusable account document

### What it contains

The finished document contains:

- An account heading.
- A free-form Notes section.
- One or more dated, append-only ticket snapshots.
- Status group headings and counts.
- Zendesk links for individual tickets.
- Optional two-line TLDRs for active statuses.

### Why it is the final output

The dashboard is optimized for live preparation, while the document is optimized for sharing and historical continuity. Each export adds a new view of the account without erasing earlier views or manually written notes.

## Three complete example journeys

### A user opens an account

1. The app loads the local CSV through a Next.js API route.
2. The dashboard restores the last PAL engineer from browser storage.
3. The user selects an account and date range.
4. React filters and groups the matching rows.
5. CSAT and FR/Jira enrichments start when their prerequisites are available.
6. Active-ticket briefings begin automatically, up to three at once.
7. Needs attention and other call-prep groups fill in as results arrive.

### A user opens a ticket briefing

1. The ticket ID reaches the analysis API.
2. The ticket must exist in the portfolio CSV.
3. The orchestrator obtains SupportDog context and builds the other evidence blocks.
4. Claude creates the four-section briefing.
5. The result enters the in-tab cache.
6. The expanded row renders the briefing, and call prep can use its Customer Temperature.

### A user exports an account

1. The user signs in to Google and selects **Export to Google Doc**.
2. The server reloads every CSV row for the Salesforce account and excludes Closed tickets.
3. If selected, it generates short TLDRs for New, Open, Pending, and Hold tickets.
4. The local map supplies an existing document ID or indicates that a new document is needed.
5. The Google Docs API creates the document or prepends a new dated snapshot.
6. The app saves the document ID and exposes **View Doc**.

## What is stored where

| Information | Storage location | Lifetime |
|---|---|---|
| Portfolio rows | Local CSV | Until the next refresh or manual replacement |
| Selected PAL engineer | Browser localStorage | Across browser visits |
| Selected account and date range | React state | Current page session |
| Generated ticket briefings | React in-memory cache | Until PAL/account change or page reload |
| SupportDog sessions | Sealed HTTP-only browser cookies | Until expiry, logout, or reset |
| Google OAuth session | Sealed browser cookie | Until expiry or logout |
| Account-to-document IDs | Local JSON file | Across app restarts on this checkout |
| Export history and notes | Google Doc | Persistent in Google Drive |

## How the app behaves when integrations are missing

| Missing component | Effect |
|---|---|
| Snowflake MCP | Existing CSV still loads; portfolio refresh and CSAT queries fail. |
| Portfolio CSV | The portfolio cannot load and ticket analysis cannot establish scope. |
| SupportDog | Claude can produce a partial briefing, but it lacks the full conversation. |
| Anthropic key | Full investigation synthesis and export TLDRs are unavailable; ticket analysis returns a CSV-only fallback. |
| Zendesk API credentials | Missing FR/Jira keys cannot be enriched from live ticket data. |
| Google OAuth configuration or sign-in | Google Docs export is unavailable; the dashboard and investigation features still work. |

## Final mental model

Think of the application as three connected layers:

1. **Portfolio layer:** Snowflake becomes a local CSV, and the dashboard turns that snapshot into PAL, account, status, and date views.
2. **Understanding layer:** the Investigation Orchestrator combines ticket-specific evidence and asks Claude to produce a brief, while call prep uses those results plus CSAT and feature-request signals.
3. **Sharing layer:** the export service turns the account's non-Closed tickets into append-only snapshots in a reusable Google Doc.

The CSV decides what belongs to the portfolio. SupportDog explains what happened in the ticket. Public docs and repository hints provide technical context. Claude compresses that evidence. The browser prioritizes it for the call. Google Docs preserves it for the team.
