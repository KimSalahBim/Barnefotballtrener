# Databehandleravtaler (DPA-logg)

**Behandlingsansvarlig:** Holmvik Utvikling ENK
**Tjeneste:** Barnefotballtrener.no
**Sist oppdatert:** 1. mars 2026

---

## Oversikt

Per GDPR art. 28 skal behandlingsansvarlig ha databehandleravtale med alle
underleverandører som behandler personopplysninger på vegne av virksomheten.

---

## Aktive databehandlere

### 1. Supabase Inc.

| Felt | Detalj |
|---|---|
| Tjeneste | Database (PostgreSQL), autentisering (Google OAuth), Row Level Security |
| Data som behandles | Brukerkontoer (e-post, user_id), spillerfornavn, lagdata, sesongdata, oppmøte |
| Dataregion | EU (eu-west-2, Frankfurt) |
| DPA | https://supabase.com/legal/dpa |
| Akseptert dato | 23. januar 2026 (prosjekt opprettet) |
| Overføringsgrunnlag | Data forblir i EU. Supabase Inc. (USA) har tilgang til infrastruktur under SCCs |
| Sub-processors | https://supabase.com/legal/subprocessors |
| Merknader | RLS sikrer at brukere kun ser egne data |

### 2. Stripe Inc.

| Felt | Detalj |
|---|---|
| Tjeneste | Betalingsbehandling, abonnementshåndtering |
| Data som behandles | E-post, navn (fra Google-profil), betalingshistorikk, IP-adresse (angrerett-dok.) |
| Dataregion | USA (med europeisk prosessering) |
| DPA | Integrert i Stripe Services Agreement, seksjon 10 |
| Akseptert dato | Ca. februar 2026 (første produkt opprettet 8. februar 2026) |
| Overføringsgrunnlag | Standard Contractual Clauses (SCCs) |
| Sub-processors | https://stripe.com/legal/service-providers |
| Merknader | Stripe er selvstendig behandlingsansvarlig for PCI DSS-data |

### 3. Vercel Inc.

| Felt | Detalj |
|---|---|
| Tjeneste | Hosting, CDN, serverless functions |
| Data som behandles | IP-adresser (serverlogger), HTTP-forespørsler |
| Dataregion | Global CDN, funksjoner kjører nærmest bruker (typisk EU) |
| DPA | https://vercel.com/legal/dpa |
| Akseptert dato | 23. januar 2026 (prosjekt opprettet) |
| Overføringsgrunnlag | Standard Contractual Clauses (SCCs) |
| Sub-processors | https://vercel.com/legal/sub-processors |
| Merknader | Vercel-logger roteres automatisk |

### 4. Google LLC (Google Identity / OAuth)

| Felt | Detalj |
|---|---|
| Tjeneste | Innlogging via Google OAuth (Sign in with Google) |
| Data som behandles | E-post, navn, profilbilde-URL (mottas ved innlogging) |
| Dataregion | Global |
| DPA | Google Cloud Platform Terms of Service inkl. Data Processing Amendment |
| Akseptert dato | Ca. 17. januar 2026 (basert på free trial-nedtelling) |
| Overføringsgrunnlag | Standard Contractual Clauses (SCCs) |
| Merknader | Google er selvstendig behandlingsansvarlig for brukerens Google-konto |

### 5. Umami (umami.is)

| Felt | Detalj |
|---|---|
| Tjeneste | Anonym bruksstatistikk (cookieless, ingen IP-lagring) |
| Data som behandles | Anonyme sidevisninger, referrals, enhetsinformasjon (aggregert) |
| Dataregion | EU (Frankfurt) |
| DPA | https://umami.is/legal/dpa |
| Akseptert dato | Ca. 12. februar 2026 (første trafikk registrert) |
| Overføringsgrunnlag | Data forblir i EU |
| Merknader | Ingen personopplysninger behandles. Ingen cookies. Unntatt fra samtykke per ekomloven § 2-7b |

---

## Handlingspunkter

- [ ] Fyll inn akseptdatoer for alle DPA-er
- [ ] Verifiser at Supabase DPA er akseptert i Dashboard → Settings → Legal
- [ ] Verifiser at Vercel DPA er akseptert i Dashboard → Settings
- [ ] Last ned og arkiver kopi av alle DPA-er lokalt
- [ ] Sett årlig påminnelse for gjennomgang (1. mars 2027)

---

## Tidligere databehandlere (ikke lenger i bruk)

*Ingen per 1. mars 2026.*

---

## Endringslogg

| Dato | Endring |
|---|---|
| 2026-03-01 | Førstegangs dokumentasjon |
