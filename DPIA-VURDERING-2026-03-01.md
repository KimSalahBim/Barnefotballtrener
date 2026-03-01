# DPIA-vurdering: Barnefotballtrener.no

**Dato:** 1. mars 2026
**Behandlingsansvarlig:** Holmvik Utvikling ENK, org.nr. [fyll inn]
**Kontakt:** barnefotballtrener@gmail.com
**Versjon:** 1.0

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
i norsk barnefotball (6-12 år). Tjenesten genererer bytteplaner for kamper,
håndterer treningsgrupper, og fører sesongstatistikk (oppmøte, spilletid).

---

## 3. Vurdering mot DPIA-kriteriene

### 3.1 Behandler vi barns personopplysninger?

**Ja**, men med vesentlige begrensninger:

- Kun **fornavn** lagres (ikke etternavn, fødselsdato eller andre identifikatorer)
- Appen har aktiv fullnavns-deteksjon med advarsel dersom bruker prøver å skrive fullt navn
- 50-tegns grense på navnefelt
- Ingen bilder, helseopplysninger eller andre sensitive data

**Risiko:** Fornavn alene gir svært begrenset identifiserbarhet. I en lagliste
med 15 fornavn uten etternavn, klubbtilhørighet eller andre koblinger er
reidentifiseringsrisikoen lav.

### 3.2 Behandler vi i stor skala?

**Nei.**

- Ca. 200 aktive brukere (trenere)
- Anslagsvis 2000-3000 spillerfornavn totalt
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
med Row Level Security i databasen.

---

## 4. Risikoreduserende tiltak (allerede implementert)

| Tiltak | Beskrivelse |
|---|---|
| Dataminimering | Kun fornavn, aktiv fullnavnsdeteksjon med UI-advarsel |
| Tilgangskontroll | Google OAuth, Row Level Security per bruker, per lag |
| Kryptering | HTTPS med HSTS (2 år, preload), Supabase-kryptering at rest |
| Lagdeling | Eiermodell med eksplisitt invitasjon, editor-rolle uten admin-tilgang |
| Rett til sletting | Fullstendig kontosletting inkl. alle tabeller, Stripe-anonymisering |
| Dataportabilitet | JSON-eksport av all brukerdata |
| Informasjonsplikt | Detaljert personvernerklæring (privacy.html) |
| Tredjeparter | Supabase (EU/Frankfurt), Stripe (SCCs), Vercel (SCCs), Umami (EU) |
| Statistikk-gate | Sesongstatistikk krever bekreftelse om NFF-compliance |
| Medansvar | Trener informeres eksplisitt om ansvar for spillerdata (Art. 26) |
| Foresatte | Trener oppfordres til å informere foresatte om verktøybruk |

---

## 5. Konklusjon

Behandlingen tilfredsstiller **ikke** kriteriene for obligatorisk DPIA:

1. Personopplysningene er minimale (kun fornavn på barn)
2. Behandlingen er ikke i stor skala
3. Ingen ny eller eksperimentell teknologi
4. Ingen systematisk overvåking
5. Ingen automatiserte beslutninger med betydelig virkning

De tekniske og organisatoriske tiltakene i seksjon 4 reduserer restrisikoen
til et nivå som ikke krever ytterligere konsekvensvurdering.

**Denne vurderingen bør gjennomgås årlig** eller ved vesentlige endringer i
tjenestens funksjonalitet, omfang eller brukerbase.

---

## 6. Endringslogg

| Dato | Versjon | Endring |
|---|---|---|
| 2026-03-01 | 1.0 | Førstegangs vurdering |
