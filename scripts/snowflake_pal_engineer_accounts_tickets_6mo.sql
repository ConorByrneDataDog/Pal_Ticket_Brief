-- RECONSTRUCTED FILE — the original was never present in this repo/machine.
-- Rebuilt from the fragments documented in ../DATA_SOURCES.md (CTE names, join
-- keys, and the exact PAL_PORTFOLIO_CSV_COLUMNS list in lib/palPortfolioSnowflakeExport.js).
--
-- Verbatim from docs: the psr/lia/asm joins in pal_portfolio, the acc join,
-- and the zo/t joins + QUALIFY dedup in pal_tickets_6mo (including the
-- `t.is_support_ticket = TRUE` and `t.created_timestamp >= DATEADD(month, -6, ...)`
-- filters, which app code pattern-matches on to override the 6-month window).
--
-- Column names verified against the real Snowflake schema via DESCRIBE TABLE on
-- dim_zendesk_ticket, dim_zendesk_org, dim_salesforce_premier_support_resource,
-- dim_salesforce_user, dim_salesforce_account, and fact_assembled_users_daily.
-- Corrected from the original guesses: asm.assembled_name -> asm.name,
-- asm.id -> asm.agent_id (for PAL_ASSEMBLED_AGENT_ID), psr.zendesk_user_id
-- (doesn't exist) -> asm.zendesk_id, t.impact -> t.ticket_impact.
--
-- Still unverified: the psr "active" filter logic (assumed
-- `end_date IS NULL OR end_date > CURRENT_DATE()` — the column exists, but the
-- exact business rule for "currently active" wasn't confirmed against docs).

WITH pal_portfolio AS (
  SELECT
    lia.email                                   AS pal_liaison_email,
    lia.name                                     AS pal_liaison_sf_name,
    asm.name                                     AS pal_assembled_name,
    asm.zendesk_id                               AS pal_zendesk_user_id,
    asm.agent_id                                 AS pal_assembled_agent_id,
    psr.id                                       AS psr_id,
    acc.id                                       AS salesforce_account_id,
    acc.name                                     AS salesforce_account_name
  FROM reporting.general.dim_salesforce_premier_support_resource psr
  LEFT JOIN reporting.general.dim_salesforce_user lia
    ON psr.premier_support_liaison_salesforce_user_id = lia.id_case_sensitive
  LEFT JOIN (
    SELECT * FROM reporting.general.fact_assembled_users_daily
    WHERE datadog_role_group IN (
      'Premier Support Engineering',
      'Premier Support Engineering Leadership'
    )
    QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY data_date DESC) = 1
  ) asm ON lia.email = asm.email
  INNER JOIN reporting.general.dim_salesforce_account acc
    ON psr.salesforce_account_id = acc.id
  -- GUESSED active-PSR filter — confirm the real column/logic used for "currently active".
  WHERE psr.end_date IS NULL OR psr.end_date > CURRENT_DATE()
),

pal_tickets_6mo AS (
  SELECT
    pal.pal_liaison_email,
    pal.pal_liaison_sf_name,
    pal.pal_assembled_name,
    pal.pal_zendesk_user_id,
    pal.pal_assembled_agent_id,
    pal.psr_id,
    pal.salesforce_account_id,
    pal.salesforce_account_name,
    zo.datadog_org_id                            AS datadog_org_id,
    zo.name                                       AS zendesk_org_name,
    t.id                                           AS ticket_id,
    t.created_timestamp                           AS ticket_created_timestamp,
    t.subject                                      AS ticket_subject,
    t.status                                       AS ticket_status,
    t.custom_status_name                           AS ticket_custom_status_name,
    t.source                                        AS ticket_source,
    t.is_premier_support_ticket                     AS is_premier_support_ticket,
    t.primary_product_component                    AS primary_product_component,
    t.ticket_impact                                 AS ticket_impact
  FROM pal_portfolio pal
  INNER JOIN reporting.general.dim_zendesk_org zo
    ON zo.salesforce_account_id = pal.salesforce_account_id
  INNER JOIN reporting.general.dim_zendesk_ticket t
    ON t.zendesk_org_id = zo.id
    AND t.is_support_ticket = TRUE
    AND t.created_timestamp >= DATEADD(month, -6, CURRENT_TIMESTAMP())
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY t.id, pal.pal_liaison_email
    ORDER BY pal.psr_id
  ) = 1
)

SELECT
  pal_liaison_email          AS PAL_LIAISON_EMAIL,
  pal_liaison_sf_name        AS PAL_LIAISON_SF_NAME,
  pal_assembled_name         AS PAL_ASSEMBLED_NAME,
  pal_zendesk_user_id        AS PAL_ZENDESK_USER_ID,
  pal_assembled_agent_id     AS PAL_ASSEMBLED_AGENT_ID,
  salesforce_account_id      AS SALESFORCE_ACCOUNT_ID,
  salesforce_account_name    AS SALESFORCE_ACCOUNT_NAME,
  datadog_org_id             AS DATADOG_ORG_ID,
  zendesk_org_name           AS ZENDESK_ORG_NAME,
  ticket_id                  AS TICKET_ID,
  ticket_created_timestamp   AS TICKET_CREATED_TIMESTAMP,
  ticket_subject             AS TICKET_SUBJECT,
  ticket_status               AS TICKET_STATUS,
  ticket_custom_status_name  AS TICKET_CUSTOM_STATUS_NAME,
  ticket_source               AS TICKET_SOURCE,
  is_premier_support_ticket  AS IS_PREMIER_SUPPORT_TICKET,
  primary_product_component  AS PRIMARY_PRODUCT_COMPONENT,
  ticket_impact               AS TICKET_IMPACT
FROM pal_tickets_6mo;
