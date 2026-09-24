# Sikkerhetsfunn i databasen – 23.09.2026

Full gjennomgang av Supabase-prosjekt `jxteosjxgrblasksfeyu` (eu-west-2) for
Barnefotballtrener.no. Tjenesten er i drift med 148 registrerte brukere, 126 lag og
1305 spillerrader på funntidspunktet.

Alle funn er verifisert ved å kjøre faktiske spørringer som databaserollene `anon`
og `authenticated`, ikke ved lesing av policy-definisjoner alene. Angrepstestene ble
kjørt mot nyopprettede testrader, aldri mot ekte data, og testradene er slettet.
Radtallene over var uendret før og etter testingen.

Dokumentet er vedlegg til `DPIA-VURDERING-2026-03-01.md` seksjon 5.

## Status: rettet samme dag

Fem migrasjoner er kjørt mot produksjon:

- `lockdown_orphaned_j11_tables_and_definer_rpcs`
- `fix_team_members_escalation_and_client_writes`
- `add_ensure_rls_event_trigger`
- `restrict_is_team_owner_to_authenticated`
- `scope_team_members_policies_to_authenticated`

Etterkontroll bekreftet at angrepsveiene avvises, at en ekte innlogget bruker fortsatt
ser sine egne lag og spillere, og at en uinnlogget ser null rader i alle tabeller.

---

## 1. Privilegieeskalering: enhver innlogget bruker kunne lese andres lag (kritisk)

Policyen `tm_update` på `team_members` var definert med `USING ((auth.uid() = user_id)
OR is_team_owner(team_id))` og uten egen `WITH CHECK`. Når en UPDATE-policy mangler
`WITH CHECK`, gjenbruker Postgres USING-uttrykket som sjekk på den nye raden. Uttrykket
er fortsatt sant etter at raden er endret, så en bruker kunne oppdatere sin egen
medlemsrad og peke `team_id` mot et hvilket som helst annet lag, og samtidig sette
`role = 'owner'`.

Alle de store tabellene deler lagdata gjennom nettopp `team_members`. `players_select`,
`seasons_select`, `events_select`, `workouts_select` og de øvrige gir tilgang dersom det
finnes en aktiv medlemsrad for brukeren på laget. Etter en slik flytting fikk brukeren
altså lesetilgang til det lagets spillere, sesonger, økter og kampdata.

Verifisert med isolerte testrader: bruker A så 0 spillere på lag B før angrepet og 1
etter. Ingen feilmelding underveis.

Forutsetninger for å utnytte det: brukeren måtte være innlogget, ha en egen medlemsrad
(den opprettes automatisk når man lager et lag), og kjenne en `team_id`. Lag-ID-ene er
på formen `t_` pluss åtte tegn og er ikke eksponert i noen offentlig URL. Den foresatt-
vendte lagsiden bruker et eget tilfeldig token på 12 tegn, ikke lag-ID-en. Gjetting er
derfor ikke praktisk mulig, men en lag-ID som lekker i en skjermdeling, en lenke eller
en feilmelding ville vært nok.

**Rettet:** Klienten trenger bare å sette `status='active'` når en trener aksepterer en
invitasjon (`showInvitationBanner` i `core.js`). `UPDATE` er derfor trukket tilbake fra `anon` og
`authenticated` og erstattet med kolonnerettigheten
`grant update (status) on team_members to authenticated`. I tillegg er det lagt inn en
BEFORE UPDATE-trigger, `tm_block_row_move`, som avviser endring av `team_id`, `user_id`,
`role` og `invited_by` når kallet kommer fra en klientrolle. `tm_update` har nå også en
eksplisitt `WITH CHECK`.

Etterkontroll: forsøk på å flytte raden avvises med «permission denied», mens
aksepter-invitasjon fortsatt virker og fremmede lag fortsatt er usynlige.

## 2. Fem foreldreløse tabeller lå helt åpne (alvorlig)

`j11_players`, `j11_matches`, `j11_events`, `j11_assignments` og `j11_results` hadde
policyer av typen `FOR ALL USING (true)` for alle roller, i tillegg til fulle
tabellrettigheter til `anon`. Hvem som helst med den offentlige anon-nøkkelen, som
ligger åpent i klientkoden slik den skal, kunne lese, endre, sette inn og slette rader.

Verifisert som uinnlogget: 22 rader lest fra `j11_players`, 396 fra `j11_assignments`,
og en testrad satt inn, oppdatert og slettet uten feil.

`j11_players` inneholder kolonnene `name`, `level`, `is_coach_kid` og `coach_name`.
Altså fornavn på 22 barn, en nivåvurdering per barn på skalaen 2,0 til 4,0, markering av
hvilke som er trenerbarn, og navn på seks trenere. Ingen av navnene inneholder mellomrom,
så det er fornavn, ikke fulle navn. Radene ble opprettet 24. april 2026.

Ingen fil i repoet refererer `j11_`-tabellene, og det er ingen trafikk mot
`/rest/v1/j11_*` i `edge_logs`. Tabellene er rester etter en funksjon som er tatt ut.

**Rettet:** policyene er fjernet og alle rettigheter trukket tilbake fra `anon` og
`authenticated`. Dataene er beholdt urørt. Se punkt 10 om sletting.

## 3. `get_user_id_by_email` kunne kalles uten innlogging (middels)

SECURITY DEFINER-funksjon med EXECUTE til `public`, `anon` og `authenticated`. Den slår
opp en e-postadresse i `auth.users` og returnerer bruker-ID. Kallbar av hvem som helst
via `/rest/v1/rpc/get_user_id_by_email` ga to ting: bekreftelse på om en e-postadresse
har konto (kontoenumerering), og brukerens interne ID.

Funksjonen brukes kun fra `api/invite-coach.js` med tjenestenøkkel.

**Rettet:** EXECUTE trukket tilbake fra `public`, `anon` og `authenticated`,
beholdt for `service_role`.

## 4. Klienten kunne skrive sin egen abonnementsstatus (middels, latent)

`subscriptions` hadde policyen `FOR ALL USING (auth.uid() = user_id) WITH CHECK
(auth.uid() = user_id)`, altså kunne en innlogget bruker sette inn eller endre sin egen
abonnementsrad. Ingen kode i repoet leser tabellen i dag, og den har én rad, så det ga
ingen faktisk gratis tilgang. Men mønsteret er det samme som ville gitt gratis tilgang
hvis tabellen tas i bruk.

**Rettet:** policyen erstattet med en ren SELECT-policy på egen rad.
INSERT, UPDATE og DELETE trukket tilbake fra begge klientroller. Tilsvarende
skriverettigheter er fjernet fra `user_access`, som allerede bare hadde en SELECT-policy.

## 5. Trigger-funksjon eksponert via REST (lav)

`update_clubs_updated_at()` er en ren trigger-funksjon, men var kallbar via
`/rest/v1/rpc/`. Den gjør ingen skade, men hadde ingen grunn til å være eksponert.

**Rettet:** EXECUTE trukket tilbake fra `public`, `anon` og `authenticated`.

## 6. Systemisk: nye tabeller startet åpne (alvorlig som årsak)

To ting virket sammen og forklarer hvorfor funn 2 i det hele tatt var mulig:

- Supabase sine standardrettigheter (`pg_default_acl`) gir `anon` og `authenticated`
  full lese- og skrivetilgang på alle nye tabeller i `public`
- Prosjektet hadde ingen event-trigger som slo på Row Level Security automatisk.
  Håndball-prosjektet har `ensure_rls`, fotball hadde ingen

En ny tabell startet derfor uten RLS og med full tilgang for `anon`. Den eneste
beskyttelsen var at utvikleren husket å slå på RLS og skrive en riktig policy.

**Rettet:** skriverettigheter trukket tilbake fra `anon` på alle eksisterende tabeller,
standardrettighetene endret slik at nye tabeller ikke gir `anon` skrivetilgang, og
event-triggeren `ensure_rls` opprettet med samme funksjon som i håndball-prosjektet.
`anon` beholder SELECT, som RLS uansett stopper, og som keepalive-jobben er avhengig av.

## 7. `is_team_owner` var kallbar uten innlogging (lav)

SECURITY DEFINER-funksjon kallbar av `anon`. Den bruker `auth.uid()` og lekker ingenting
for en uinnlogget, men er unødvendig eksponert.

**Rettet:** EXECUTE trukket tilbake fra `public` og `anon`, beholdt for `authenticated`
og `service_role`.

Merk: `authenticated` MÅ beholde EXECUTE. Funksjonen brukes inne i RLS-policyene på
`team_members`, og policy-uttrykk kjører med den innloggede rollens rettigheter. Trekkes
den tilbake, slutter lagdelingen å virke. Dette er grunnen til at Supabase sin advisor
fortsatt viser ett funn for denne funksjonen. Det er et bevisst valg, ikke et gjenstående
problem.

Fordi `anon` mistet EXECUTE, ga en anon-spørring mot `team_members` først en feilmelding
i stedet for tomt resultat. Policyene er derfor knyttet eksplisitt til `authenticated`,
slik at `anon` ikke treffer dem i det hele tatt.

## 8. Interne dokumenter publiseres på nettstedet (middels)

Repoet har ingen `.vercelignore`. Alle interne markdown-dokumenter er derfor tilgjengelige
på nettstedet. Verifisert: `https://barnefotballtrener.no/DPIA-VURDERING-2026-03-01.md`
returnerer innholdet.

Det gjelder også `DATABEHANDLERAVTALER-2026-03-01.md` og arkitekturdokumentene, som
beskriver datamodellen og dermed gjør det enklere for en angriper å vite hva som finnes.

**Rettes i denne commit-en:** `.vercelignore` med `*.md` legges til, samme løsning som
håndball-prosjektet fikk 22. september.

## 9. Gjenstår: lekkasjesjekk av passord og loggoppbevaring

- Supabase Auth kan sjekke nye passord mot HaveIBeenPwned. Den er av. Dette er en bryter
  i dashbordet (Authentication → Sign In / Providers → Password), ikke noe som kan settes
  via SQL. Kilde: https://supabase.com/docs/guides/auth/password-security
- Loggene har 24 timers oppbevaring. Det er for kort til å etterforske et avvik som
  oppdages senere enn ett døgn etter at det skjedde, og gjør at fravær av uautorisert
  tilgang ikke kan dokumenteres historisk. Relevant for dokumentasjonsplikten i
  GDPR art. 33 nr. 5.

## 10. Til vurdering: sletting av j11-tabellene

Tabellene hører til en funksjon som ikke finnes i appen lenger. Dataene er fra 24. april
2026 og har ikke noe aktivt behandlingsgrunnlag. Prinsippet om lagringsbegrensning i
GDPR art. 5 nr. 1 bokstav e taler for sletting. Tilgangen er stengt, men dataene ligger
der fortsatt. Ikke slettet, fordi det er en beslutning som bør tas bevisst.

---

## Det som var riktig fra før

- RLS er på for alle 23 tabellene i `public`, med policy på hver av de som er i bruk.
- Policy-modellen er granulær, med egne policyer per kommando. Den er på det punktet
  bedre bygget enn håndball-appen.
- Hovedtabellene er korrekt isolert. Verifisert: `players` har 1305 rader,
  en uinnlogget ser 0.
- Alle 11 `/api`-endepunkter verifiserer brukerens token med
  `supabase.auth.getUser(token)`. `webhook.js` bruker Stripe-signatur i stedet,
  som er riktig.
- `join-club.js` sender `user.id` fra verifisert token, aldri en verdi fra request body.
- `api/team-page.js` filtrerer hardkodet bort ferdighetsnivå, posisjoner, fraværsgrunn,
  spilletid og kamphendelser før data vises for foresatte, og bruker et tilfeldig token
  på 12 tegn i stedet for lag-ID.
- Ingen tjenestenøkkel ligger i klientkoden. `export-data.js` i rotmappen refererer
  `process.env.SUPABASE_SERVICE_ROLE_KEY`, men er ikke lastet fra noen HTML-fil og
  inneholder ingen nøkkel i klartekst.
- Ingen storage-bucket og ingen databasevisninger, altså ingen skjult angrepsflate der.
- `anon` og `authenticated` har ikke CREATE i skjemaet `public`.

## Lavere prioritet

- `players_insert` og tilsvarende policyer tillater `auth.uid() = user_id` alene, uten
  å kreve at laget tilhører brukeren. En bruker som kjenner en `team_id` kan altså sette
  inn rader i et annet lag. Radene blir ikke synlige for lagets eier, og gir ingen
  lesetilgang, så det er en integritetssvakhet, ikke en lekkasje. Bør strammes inn,
  men krever en gjennomgang av de legitime skriveflytene først.
- 15 RLS-policyer kaller `auth.uid()` per rad i stedet for `(select auth.uid())`.
- 13 fremmednøkler uten dekkende indeks.
- Ingen rate-limiting på `/api/join-club`.

Kilder:

- Supabase database linter: https://supabase.com/docs/guides/database/database-linter
- Passordsikkerhet: https://supabase.com/docs/guides/auth/password-security
- RLS-ytelse: https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
