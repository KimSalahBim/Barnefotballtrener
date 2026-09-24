# DPIA-vurdering: Barnefotballtrener.no

**Dato:** 1. mars 2026 (oppdatert 23. september 2026)
**Behandlingsansvarlig:** Holmvik Utvikling ENK, org.nr. 937 128 746
**Kontakt:** barnefotballtrener@gmail.com
**Versjon:** 1.1

---

## 1. Formål

Denne vurderingen dokumenterer hvorfor det ikke er nødvendig med full
personvernkonsekvensvurdering (DPIA) etter GDPR art. 35 for tjenesten
Barnefotballtrener.no.

Datatilsynets veiledning (januar 2019) angir at DPIA er påkrevd når
behandlingen sannsynligvis vil medføre **høy risiko** for de registrertes
rettigheter og friheter, særlig ved bruk av ny teknologi, systematisk
overvåking, eller behandling i stor skala av særlige kategorier personopplysninger
eller opplysninger om barn.

---

## 2. Tjenestens art

Barnefotballtrener.no er et digitalt treningsverktøy for frivillige trenere
i norsk barnefotball. Hovedmålgruppen er 6-12 år, men appen støtter aldersklasser
til og med 13 år. Tjenesten genererer bytteplaner for kamper, håndterer
treningsgrupper, og fører sesongstatistikk (oppmøte, spilletid).

---

## 3. Vurdering mot DPIA-kriteriene

### 3.1 Behandler vi barns personopplysninger?

**Ja**, men med vesentlige begrensninger:

- Av identifikatorer lagres kun **fornavn** (ikke etternavn, fødselsdato eller andre)
- Appen har aktiv fullnavns-deteksjon med advarsel dersom bruker prøver å skrive fullt navn
- 50-tegns grense på navnefelt
- Ingen bilder, helseopplysninger eller særlige kategorier etter art. 9

I tillegg til fornavnet lagrer appen trenerens egne vurderinger av spilleren:
ferdighetsnivå (`skill`), om spilleren er keeper, posisjoner, samt oppmøte og beregnet
spilletid. Dette er ikke særlige kategorier, men det er vurderinger av et navngitt barn,
og det er mer enn et fornavn. Opplysningene brukes til å fordele spilletid og lage
bytteplaner. De vises aldri på den foresatt-vendte lagsiden: filtreringen er hardkodet
i `api/team-page.js`, som aldri returnerer ferdighetsnivå, posisjoner, fraværsgrunn,
spilletid eller kamphendelser.

**Risiko:** Fornavn alene gir svært begrenset identifiserbarhet. I en lagliste
med 15 fornavn uten etternavn, klubbtilhørighet eller andre koblinger er
reidentifiseringsrisikoen lav. Vurderingene øker konsekvensen dersom data likevel
kommer på avveie, siden de sier noe om det enkelte barnet. Det er hovedgrunnen til at
tilgangskontrollen testes aktivt, se seksjon 5.

### 3.2 Behandler vi i stor skala?

**Nei.**

- Per 23. september 2026: 148 registrerte trenere, 126 lag og 1305 spillerrader
- Ingen systematisk innsamling fra offentlige kilder
- Geografisk begrenset til norsk barnefotball

Datatilsynets veiledning definerer ikke eksakt grense for "stor skala", men
behandlingen er klart under terskelen som gjelder for eksempel
kommunale helsetjenester eller skolesystemer.

### 3.3 Bruker vi ny teknologi?

**Nei.** Tjenesten bruker standard webteknologi (JavaScript, PostgreSQL, OAuth).
Bytteplanalgoritmene er deterministiske (greedy assignment, cyclic rotation) uten
maskinlæring eller automatisert profilering.

### 3.4 Systematisk overvåking?

**Nei.** Tjenesten overvåker ikke barns adferd. Oppmøteregistrering gjøres
manuelt av trener per treningsøkt/kamp og brukes kun til å beregne
spilletidsfordeling. Ingen automatisk sporing, geolokasjon eller biometrisk data.

### 3.5 Automatiserte beslutninger med rettsvirkning?

**Nei.** Bytteplaner er forslag som trener fritt kan justere. Ingen beslutninger
har rettsvirkning eller tilsvarende betydelig virkning for barna.

### 3.6 Kombinasjon av datasett?

**Nei.** Spillerdata kombineres ikke med eksterne kilder. Hvert lag er isolert
med Row Level Security i databasen. Isolasjonen er etterprøvd, ikke bare forutsatt:
ved sikkerhetstesten 23. september 2026 ble spørringer kjørt som databaserollene
`anon` (uinnlogget) og `authenticated` (innlogget bruker) for å bekrefte at data fra
andre brukeres lag faktisk ikke er lesbare. Testen avdekket at isolasjonen ikke holdt,
og forholdene ble rettet samme dag. Se seksjon 5.

---

## 4. Risikoreduserende tiltak (allerede implementert)

| Tiltak | Beskrivelse |
|---|---|
| Dataminimering | Kun fornavn som identifikator, aktiv fullnavnsdeteksjon med UI-advarsel |
| Tilgangskontroll | Google OAuth, Row Level Security per bruker, per lag |
| Sikkerhetstesting | Verifisering av RLS, rettigheter og API-lag ved å kjøre spørringer som rollene `anon` og `authenticated`, samt Supabase security advisor. Gjennomføres minst årlig, jf. seksjon 5 |
| Kryptering | HTTPS med HSTS (2 år, preload), Supabase-kryptering at rest |
| Lagdeling | Eiermodell med eksplisitt invitasjon, editor-rolle uten admin-tilgang |
| Foresatt-visning | Lagsiden bruker eget tilfeldig token, ikke lag-ID, og filtrerer hardkodet bort ferdighetsnivå, posisjoner, fraværsgrunn, spilletid og kamphendelser |
| Rett til sletting | Fullstendig kontosletting inkl. alle tabeller, Stripe-anonymisering |
| Dataportabilitet | JSON-eksport av all brukerdata |
| Informasjonsplikt | Detaljert personvernerklæring (privacy.html) |
| Tredjeparter | Supabase (eu-west-2, London i Storbritannia), Stripe (SCCs), Vercel (SCCs), Umami (EU) |
| Statistikk-gate | Sesongstatistikk krever bekreftelse om NFF-compliance |
| Medansvar | Trener informeres eksplisitt om ansvar for spillerdata (Art. 26) |
| Foresatte | Trener oppfordres til å informere foresatte om verktøybruk |

### 4.1 Overføring til tredjeland

Databasen ligger i Supabase-regionen `eu-west-2`, som er London i Storbritannia.
Storbritannia er ikke EU- eller EØS-medlem, så lagring der er en overføring til
tredjeland etter GDPR kapittel V.

Overføringsgrunnlaget er Europakommisjonens adekvansbeslutning for Storbritannia etter
GDPR art. 45. Beslutningen ble fornyet 19. desember 2025 og løper til 27. desember 2031,
med en midtveisgjennomgang etter fire år. Overføringen krever derfor ikke
standardkontrakter eller andre supplerende garantier.

Tidligere versjoner av dette dokumentet oppga feilaktig Frankfurt som lagringssted.
Rettet 23. september 2026.

---

## 5. Sikkerhetstesting og avviksvurdering

### 5.1 Rutine

GDPR art. 32 nr. 1 bokstav d krever en prosess for regelmessig testing, analysering
og vurdering av hvor effektive sikkerhetstiltakene er. Rutinen for denne tjenesten er:

1. Supabase security advisor og performance advisor kjøres og gjennomgås
2. Tilgangskontrollen testes aktivt ved å kjøre spørringer som databaserollene
   `anon` og `authenticated` mot hver tabell som inneholder personopplysninger.
   Det er ikke tilstrekkelig å konstatere at Row Level Security er påskrudd,
   fordi en policy kan være skrevet for vid
3. Isolasjonen mellom brukere testes med to ulike innloggede brukere, ikke bare
   én, siden flere policyer deler data gjennom `team_members`
4. Alle API-endepunkter kontrolleres for at de verifiserer brukerens token og
   bruker bruker-ID fra tokenet, ikke fra forespørselens innhold
5. Faktisk trafikk mot databasen gjennomgås i `edge_logs`, slik at rettigheter
   kan strammes inn uten å bryte noe som er i bruk
6. Tabeller uten kode som bruker dem identifiseres og stenges eller slettes
7. Funn, rettinger og etterkontroll loggføres

Testen gjennomføres minst årlig, sammen med den årlige gjennomgangen av denne
vurderingen, og ved vesentlige endringer i databasemodellen.

### 5.2 Gjennomført test 23. september 2026

Første fullstendige gjennomføring. Åtte forhold ble avdekket, og alle er rettet samme
dag. Etterkontroll bekreftet at angrepsveiene avvises, at en ekte innlogget bruker
fortsatt ser sine egne lag og spillere, og at en uinnlogget ser null rader i alle
tabeller. Angrepstestene ble kjørt mot nyopprettede testrader, aldri mot ekte data.

| Funn | Hva det innebar | Retting |
|---|---|---|
| Enhver innlogget bruker kunne flytte sin egen medlemsrad i `team_members` til et annet lag og dermed lese det lagets spillere, sesonger, økter og kampdata | Kritisk. Traff hovedtabellene med 1305 spillerrader | UPDATE begrenset til kolonnen `status`, pluss trigger som avviser flytting av raden |
| Fem foreldreløse `j11_*`-tabeller var lesbare og skrivbare for alle med den offentlige anon-nøkkelen | 22 barns fornavn, nivåvurdering, markering av trenerbarn og seks trenernavn. Lagt inn 24. april 2026 | Policyer fjernet, alle rettigheter trukket tilbake fra klientrollene |
| `get_user_id_by_email` kunne kalles uten innlogging | Kunne bekrefte om en e-postadresse hadde konto, og returnerte brukerens interne ID | Kjørerettighet kun for `service_role` |
| Klienten kunne skrive sin egen rad i `subscriptions` | Latent: mønsteret ville gitt gratis tilgang hvis tabellen tas i bruk | Erstattet med ren SELECT-policy, skriverettigheter fjernet |
| Trigger-funksjonen `update_clubs_updated_at` var kallbar via REST | Teknisk herding, ingen kjent utnyttelse | Kjørerettighet trukket tilbake |
| `is_team_owner` var kallbar uten innlogging | Teknisk herding | Kjørerettighet fjernet for `anon`, beholdt for `authenticated` fordi RLS-policyene er avhengige av den |
| Standardrettigheter ga `anon` full skrivetilgang på nye tabeller, og prosjektet manglet automatisk påslag av RLS | Systemisk årsak til funn 2: en ny tabell startet uten RLS og åpen for alle | Skriverettigheter fjernet fra `anon`, standardrettighetene endret, event-triggeren `ensure_rls` opprettet |
| Interne dokumenter ble publisert på nettstedet | DPIA, databehandleravtaler og arkitekturdokumenter var åpent tilgjengelige | `.vercelignore` med `*.md` lagt til |

Full teknisk dokumentasjon: `SIKKERHETSFUNN-DB-2026-09-23.md`.

To forhold gjenstår og er ikke databaseinnstillinger:

- Supabase Auth sin kontroll av nye passord mot kjente lekkasjer (HaveIBeenPwned)
  er slått av og bør slås på
- Loggene har 24 timers oppbevaring. Det er for kort til å etterforske et avvik som
  oppdages senere enn ett døgn etter at det skjedde, jf. 5.3

### 5.3 Vurdering av meldeplikt

To av funnene gjorde personopplysninger tilgjengelige for andre enn de skulle:
de åpne `j11_*`-tabellene, og muligheten for en innlogget bruker til å flytte seg inn
i et annet lag.

Omfang:

- `j11_*`-tabellene inneholdt 22 barns fornavn, en nivåvurdering per barn, markering av
  trenerbarn og navn på seks trenere. De lå åpne fra 24. april 2026, altså omtrent fem
  måneder
- Eskaleringen via `team_members` kunne gitt tilgang til hvilket som helst av 126 lag,
  men forutsatte at angriperen var innlogget og kjente en `team_id`. Lag-ID-ene er på
  formen `t_` pluss åtte tegn, og de er ikke eksponert i noen offentlig URL. Den
  foresatt-vendte lagsiden bruker et eget tilfeldig token, ikke lag-ID-en
- `get_user_id_by_email` kunne bekrefte om en e-postadresse var registrert

Vurderingen er at dette **ikke** utgjør et brudd på personopplysningssikkerheten etter
GDPR art. 4 nr. 12, og at meldeplikten etter art. 33 derfor ikke er utløst. Begrunnelse:

- Bestemmelsen omfatter faktisk uautorisert tilgang, endring eller utlevering, ikke
  muligheten for det. Det er ingen holdepunkter for at noen av veiene ble brukt
- Eskaleringen krevde både innlogging og kjennskap til en lag-ID som ikke er publisert
- Sårbarhetene ble lukket samme dag de ble oppdaget

Forbehold som hører med, og som er avgjørende for hvordan konklusjonen skal leses:
loggene rekker bare 24 timer tilbake. Det er derfor ikke mulig å dokumentere fravær av
uautoriserte kall for de fem månedene `j11_*`-tabellene lå åpne. Vurderingen bygger på
fravær av holdepunkter, ikke på et fullstendig loggbevis. Lengre loggoppbevaring er ført
opp som gjenstående punkt i 5.2, nettopp av denne grunn.

Vurderingen loggføres her i tråd med dokumentasjonsplikten i art. 33 nr. 5.

### 5.4 Lagringsbegrensning

`j11_*`-tabellene hører til en funksjon som ikke finnes i appen lenger. Dataene er fra
april 2026 og har ikke noe aktivt behandlingsgrunnlag. Prinsippet om lagringsbegrensning
i art. 5 nr. 1 bokstav e taler for sletting. Tilgangen er stengt, men dataene er ikke
slettet. Dette er en beslutning som må tas bevisst, og den bør tas.

---

## 6. Konklusjon

Behandlingen tilfredsstiller **ikke** kriteriene for obligatorisk DPIA:

1. Personopplysningene er begrensede: fornavn på barn, pluss trenerens vurderinger
2. Behandlingen er ikke i stor skala
3. Ingen ny eller eksperimentell teknologi
4. Ingen systematisk overvåking
5. Ingen automatiserte beslutninger med betydelig virkning

De tekniske og organisatoriske tiltakene i seksjon 4, sammen med testrutinen i
seksjon 5, reduserer restrisikoen til et nivå som ikke krever ytterligere
konsekvensvurdering.

Det bør likevel noteres at gjennomgangen 23. september 2026 viste at tiltaket
«Row Level Security per bruker, per lag» ikke holdt i praksis. Tiltakstabellen i
seksjon 4 beskriver hva som er på plass, ikke et bevis for at det virker. Det er
testrutinen i seksjon 5 som skal gi det beviset, og den må faktisk kjøres.

**Denne vurderingen bør gjennomgås årlig**, neste gang innen 1. september 2027, eller
ved vesentlige endringer i tjenestens funksjonalitet, omfang eller brukerbase.

---

## 7. Endringslogg

| Dato | Versjon | Endring |
|---|---|---|
| 2026-03-01 | 1.0 | Førstegangs vurdering |
| 2026-09-23 | 1.1 | Organisasjonsnummer lagt inn. Lagringssted rettet fra Frankfurt til London (Supabase eu-west-2), med nytt punkt 4.1 om overføringsgrunnlag etter art. 45. Brukertall erstattet med faktiske tall. Punkt 3.1 utvidet: appen lagrer også trenerens vurderinger av spilleren. Punkt 3.6 viser til gjennomført test. Ny seksjon 5 om sikkerhetstesting, funnene 23. september 2026, vurdering av meldeplikt og lagringsbegrensning. Konklusjon og endringslogg renummerert til 6 og 7 |
